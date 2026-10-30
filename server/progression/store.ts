import { randomUUID, createHash } from 'node:crypto';
import type { PostgresDatabase, DatabaseRow } from '../database';
import { DEFAULT_PROGRESSION_POLICY, PROGRESSION_CURRENCY, PROGRESSION_LOCATION, type ExperienceSource, type ProgressionPolicy, type ProgressionSnapshot } from '../../src/shared/progression';

export type RoundContext = { sourceType: ExperienceSource; sourceId: string; accountId: string; locationId: string; gameId: string;
  environment: string; fundingSource: 'cash' | 'reward'; acceptedAt: number; policyVersion?: string };
export type SettledExperience = { sourceType: ExperienceSource; sourceId: string; accountId: string; paidUnits: string; refundedUnits: string;
  settledAt: number; outcome: 'settled' | 'refunded' };
const units = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,29})$/.test(v);
const scopeKey = (e: string, l: string) => e + ':' + l;
const key = (c: Pick<RoundContext, 'sourceType' | 'sourceId' | 'accountId'>) => createHash('sha256').update(JSON.stringify([c.sourceType,c.sourceId,c.accountId])).digest('hex');
export class ProgressionStore {
  readonly ready: Promise<void>;
  readonly policy: ProgressionPolicy;
  readonly environment: string;
  readonly locationId: string;
  private scope: string;
  constructor(readonly db: PostgresDatabase, private options: { policy?: ProgressionPolicy; environment?: string; locationId?: string;
    now?: () => number; prerequisite?: Promise<unknown>; readOnly?: boolean } = {}) {
    this.policy = structuredClone(options.policy ?? DEFAULT_PROGRESSION_POLICY);
    this.environment = options.environment ?? PROGRESSION_CURRENCY;
    this.locationId = options.locationId ?? PROGRESSION_LOCATION;
    this.scope = scopeKey(this.environment,this.locationId);
    this.validatePolicy();
    this.ready = (options.prerequisite ?? Promise.resolve()).then(() => this.initialize());
    this.ready.catch(() => {});
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private validatePolicy() {
    if (!/^[a-z0-9-]{1,64}$/.test(this.policy.version) || this.policy.levels.length !== 100 || this.policy.levels[0].xp !== '0') throw Error('Invalid progression policy');
    for (const [i,row] of this.policy.levels.entries()) {
      if (row.level !== i+1 || !units(row.xp) || i > 0 && BigInt(row.xp) <= BigInt(this.policy.levels[i-1].xp)) throw Error('Invalid level threshold');
      const r=row.reward;
      if (r && (r.kind!=='free_spins'||!['royal-coins','royal-fruits'].includes(r.gameId)||!Number.isInteger(r.count)||r.count<1||r.count>10000
        || !units(r.stakeUnits)||BigInt(r.stakeUnits)<100000n||BigInt(r.stakeUnits)>2000000n||BigInt(r.stakeUnits)%10000n!==0n)) throw Error('Invalid reward policy');
    }
    for (const source of ['paid-game','pvp'] as const) { const c=this.policy.coefficients[source]; if(!c||![c.numerator,c.denominator].every(Number.isSafeInteger)||c.numerator<0||c.denominator<1||c.denominator>1000000)throw Error('Invalid experience coefficient'); }
  }
  private async initialize() {
    if (this.options.readOnly) return;
    await this.db.transaction(async () => {
      await this.db.exec(`CREATE TABLE IF NOT EXISTS progression_settings(scope TEXT PRIMARY KEY,activated_at BIGINT NOT NULL,earn_enabled BOOLEAN NOT NULL DEFAULT true,spins_enabled BOOLEAN NOT NULL DEFAULT true);
        CREATE TABLE IF NOT EXISTS progression_policies(scope TEXT NOT NULL,version TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(scope,version));
        CREATE TABLE IF NOT EXISTS progression_rounds(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,scope TEXT NOT NULL,context_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','settled')));
        CREATE INDEX IF NOT EXISTS progression_pending_account ON progression_rounds(account_id,state);
        CREATE TABLE IF NOT EXISTS progression_outbox(id TEXT PRIMARY KEY REFERENCES progression_rounds(id),account_id TEXT NOT NULL,payload TEXT NOT NULL,processed BOOLEAN NOT NULL DEFAULT false,created_at BIGINT NOT NULL);
        CREATE INDEX IF NOT EXISTS progression_unprocessed ON progression_outbox(processed,account_id);
        CREATE TABLE IF NOT EXISTS progression_players(account_id TEXT NOT NULL,scope TEXT NOT NULL,policy_version TEXT NOT NULL,xp TEXT NOT NULL CHECK(xp ~ '^[0-9]+$'),remainder TEXT NOT NULL DEFAULT '0',level BIGINT NOT NULL CHECK(level BETWEEN 1 AND 100),PRIMARY KEY(account_id,scope));
        CREATE TABLE IF NOT EXISTS progression_xp(id TEXT PRIMARY KEY REFERENCES progression_outbox(id),account_id TEXT NOT NULL,scope TEXT NOT NULL,policy_version TEXT NOT NULL,xp TEXT NOT NULL,created_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS progression_rewards(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,location_id TEXT NOT NULL,milestone_id TEXT NOT NULL,policy_version TEXT NOT NULL,type TEXT NOT NULL CHECK(type='free_spins'),level BIGINT NOT NULL,
          game_id TEXT NOT NULL,count BIGINT NOT NULL CHECK(count>0),remaining BIGINT NOT NULL CHECK(remaining>=0 AND remaining<=count),nominal_units TEXT NOT NULL,currency TEXT NOT NULL,rules_version BIGINT NOT NULL,created_at BIGINT NOT NULL,
          UNIQUE(account_id,location_id,currency,milestone_id));`);
      await this.db.prepare('INSERT INTO progression_settings(scope,activated_at) VALUES(?,?) ON CONFLICT DO NOTHING').run(this.scope,this.now());
      const definition=JSON.stringify(this.policy);
      await this.db.prepare('INSERT INTO progression_policies VALUES(?,?,?) ON CONFLICT DO NOTHING').run(this.scope,this.policy.version,definition);
      if ((await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,this.policy.version))?.definition !== definition) throw Error('Published progression policy changed without version');
    });
  }
  async spinsEnabled() { await this.ready; return !!(await this.db.prepare('SELECT spins_enabled FROM progression_settings WHERE scope=?').get(this.scope))?.spins_enabled; }
  async acceptRound(c: RoundContext) {
    await this.ready;
    if (!['paid-game','pvp'].includes(c.sourceType)||!c.sourceId||c.sourceId.length>256||!c.accountId||!c.gameId||!Number.isSafeInteger(c.acceptedAt)||c.acceptedAt<1) throw Error('Invalid progression round context');
    if(c.environment!==this.environment||c.locationId!==this.locationId||c.fundingSource!=='cash')return false;
    return this.db.transaction(async()=>{
      const settings=await this.db.prepare('SELECT * FROM progression_settings WHERE scope=?').get(this.scope);
      if(!settings?.earn_enabled||c.acceptedAt<Number(settings.activated_at))return false;
      const existing=await this.db.prepare('SELECT context_json FROM progression_rounds WHERE id=?').get(key(c));
      if(existing){const old=JSON.parse(existing.context_json);for(const field of ['sourceType','sourceId','accountId','gameId','locationId','environment','fundingSource'] as const)if(old[field]!==c[field])throw Error('Progression source identity conflict');return true;}
      // Pin before settlement: a delayed round and a policy rollout must not assign different tracks.
      await this.db.prepare('INSERT INTO progression_players VALUES(?,?,?,\'0\',\'0\',1) ON CONFLICT DO NOTHING').run(c.accountId,this.scope,this.policy.version);
      const player=await this.db.prepare('SELECT policy_version FROM progression_players WHERE account_id=? AND scope=?').get(c.accountId,this.scope);
      const context={...c,policyVersion:player?.policy_version??this.policy.version};
      await this.db.prepare("INSERT INTO progression_rounds VALUES(?,?,?,?,'pending')").run(key(c),c.accountId,this.scope,JSON.stringify(context));
      return true;
    });
  }
  async pendingRounds(accountId: string, sourceType?: ExperienceSource): Promise<RoundContext[]> {
    await this.ready;
    const rows=await this.db.prepare("SELECT context_json FROM progression_rounds WHERE account_id=? AND scope=? AND state='pending'").all(accountId,this.scope);
    return rows.map(r=>JSON.parse(r.context_json) as RoundContext).filter(c=>!sourceType||c.sourceType===sourceType);
  }
  async recordSettled(e: SettledExperience) {
    await this.ready;
    if(!units(e.paidUnits)||!units(e.refundedUnits)||BigInt(e.refundedUnits)>BigInt(e.paidUnits)||!Number.isSafeInteger(e.settledAt)||!['settled','refunded'].includes(e.outcome))throw Error('Invalid settled experience');
    return this.db.transaction(async()=>{
      const row=await this.db.prepare('SELECT * FROM progression_rounds WHERE id=? AND scope=?').get(key(e),this.scope);
      if(!row)return false;
      const old=await this.db.prepare('SELECT payload FROM progression_outbox WHERE id=?').get(key(e));
      if(old){const p=JSON.parse(old.payload);for(const f of ['paidUnits','refundedUnits','outcome'] as const)if(p[f]!==e[f])throw Error('Settled experience conflict');return true;}
      await this.db.prepare('INSERT INTO progression_outbox(id,account_id,payload,created_at) VALUES(?,?,?,?)').run(key(e),e.accountId,JSON.stringify(e),e.settledAt);
      await this.db.prepare("UPDATE progression_rounds SET state='settled' WHERE id=?").run(key(e));
      return true;
    });
  }
  async processPending(accountId?: string, limit=200) {
    await this.ready;
    if(this.options.readOnly)return 0;
    return this.db.transaction(async()=>{
      const rows=await this.db.prepare('SELECT o.*,r.context_json,r.scope FROM progression_outbox o JOIN progression_rounds r ON r.id=o.id WHERE NOT o.processed AND r.scope=?'
        +(accountId?' AND o.account_id=?':'')+' ORDER BY o.created_at,o.id LIMIT ? FOR UPDATE OF o SKIP LOCKED').all(...(accountId?[this.scope,accountId,limit]:[this.scope,limit]));
      for(const row of rows)await this.apply(row);
      return rows.length;
    });
  }
  private async apply(row: DatabaseRow) {
    const c=JSON.parse(row.context_json) as RoundContext,e=JSON.parse(row.payload) as SettledExperience;
    const policyRow=await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(row.scope,c.policyVersion);
    if(!policyRow)throw Error('Missing accepted progression policy');
    const policy=JSON.parse(policyRow.definition) as ProgressionPolicy;
    await this.db.prepare('INSERT INTO progression_players VALUES(?,?,?,\'0\',\'0\',1) ON CONFLICT DO NOTHING').run(c.accountId,row.scope,c.policyVersion);
    const player=(await this.db.prepare('SELECT * FROM progression_players WHERE account_id=? AND scope=? FOR UPDATE').get(c.accountId,row.scope))!;
    if(player.policy_version!==c.policyVersion)throw Error('Progression policy migration is required');
    const coefficient=policy.coefficients[c.sourceType];
    const net=e.outcome==='refunded'?0n:BigInt(e.paidUnits)-BigInt(e.refundedUnits);
    const gcd=(a:bigint,b:bigint):bigint=>b===0n?a:gcd(b,a%b);
    const denominators=Object.values(policy.coefficients).map(v=>BigInt(v.denominator));
    const common=denominators.reduce((a,b)=>a/gcd(a,b)*b,1n),precision=common*10000n;
    const scaled=net*BigInt(coefficient.numerator)*(common/BigInt(coefficient.denominator))+BigInt(player.remainder);
    const delta=scaled/precision, remainder=scaled%precision,xp=BigInt(player.xp)+delta;
    let level=1;for(const threshold of policy.levels)if(xp>=BigInt(threshold.xp))level=threshold.level;
    await this.db.prepare('INSERT INTO progression_xp VALUES(?,?,?,?,?,?)').run(row.id,c.accountId,row.scope,c.policyVersion,String(delta),e.settledAt);
    await this.db.prepare('UPDATE progression_players SET xp=?,remainder=?,level=? WHERE account_id=? AND scope=?').run(String(xp),String(remainder),level,c.accountId,row.scope);
    for(const milestone of policy.levels.filter(l=>l.level<=level&&l.reward)){
      const r=milestone.reward!;
      await this.db.prepare('INSERT INTO progression_rewards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,location_id,currency,milestone_id) DO NOTHING')
        .run(randomUUID(),c.accountId,c.locationId,'level:'+milestone.level,c.policyVersion,'free_spins',milestone.level,r.gameId,r.count,r.count,r.stakeUnits,c.environment,1,this.now());
    }
    await this.db.prepare('UPDATE progression_outbox SET processed=true WHERE id=?').run(row.id);
  }
  async snapshot(accountId: string, locationId=this.locationId): Promise<ProgressionSnapshot> {
    await this.ready;
    if(locationId!==this.locationId)throw Error('Unknown progression location');
    await this.processPending(accountId);
    return this.db.transaction(async()=>{
      const player=await this.db.prepare('SELECT * FROM progression_players WHERE account_id=? AND scope=?').get(accountId,this.scope);
      const policy=player?JSON.parse((await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,player.policy_version))!.definition):this.policy;
      const grants=await this.db.prepare('SELECT * FROM progression_rewards WHERE account_id=? AND location_id=? AND currency=? ORDER BY level,id').all(accountId,this.locationId,this.environment);
      return {accountId,locationId,policyVersion:policy.version,currency:this.environment,xp:String(player?.xp??'0'),level:Number(player?.level??1),levels:policy.levels,
        grants:grants.map(g=>({id:g.id,gameId:g.game_id,count:Number(g.count),remaining:Number(g.remaining),stakeUnits:g.nominal_units,level:Number(g.level),currency:g.currency})),enabled:await this.spinsEnabled()};
    });
  }
  async report() {
    await this.ready;
    return this.db.transaction(async()=>{
      const rows=await this.db.prepare('SELECT * FROM progression_rewards WHERE location_id=? AND currency=?').all(this.locationId,this.environment);
      let issuedExpected=0n,outstandingExpected=0n;
      for(const r of rows){const numerator=r.game_id==='royal-coins'?24n:97n,denominator=r.game_id==='royal-coins'?25n:100n;
        issuedExpected+=BigInt(r.nominal_units)*BigInt(r.count)*numerator/denominator;
        outstandingExpected+=BigInt(r.nominal_units)*BigInt(r.remaining)*numerator/denominator;}
      const hasUses=await this.db.hasTable('progression_spin_uses');
      const actual=hasUses?await this.db.prepare(`SELECT count(*) AS n,coalesce(sum((u.result_json::jsonb->>'payoutUnits')::numeric),0)::text AS payout
        FROM progression_spin_uses u JOIN progression_rewards r ON r.id=u.grant_id WHERE r.location_id=? AND r.currency=?`).get(this.locationId,this.environment):{n:0,payout:'0'};
      const pending=await this.db.prepare('SELECT count(*) AS n FROM progression_outbox o JOIN progression_rounds r ON r.id=o.id WHERE NOT o.processed AND r.scope=?').get(this.scope);
      return {currency:this.environment,locationId:this.locationId,grants:rows.length,issuedSpins:rows.reduce((n,r)=>n+Number(r.count),0),
        availableSpins:rows.reduce((n,r)=>n+Number(r.remaining),0),usedSpins:Number(actual?.n??0),actualPayoutUnits:String(actual?.payout??'0'),
        expectedIssuedPayoutUnits:String(issuedExpected),expectedOutstandingPayoutUnits:String(outstandingExpected),pendingEvents:Number(pending?.n??0)};
    });
  }
  async audit() {
    await this.ready;
    return this.db.transaction(async()=>{
      const mismatches=await this.db.prepare(`SELECT p.account_id FROM progression_players p LEFT JOIN
        (SELECT account_id,scope,sum(xp::numeric)::text AS xp FROM progression_xp GROUP BY account_id,scope) x
        ON x.account_id=p.account_id AND x.scope=p.scope WHERE p.scope=? AND p.xp::numeric<>coalesce(x.xp::numeric,0)`).all(this.scope);
      const missing=await this.db.prepare(`SELECT o.id FROM progression_outbox o JOIN progression_rounds r ON r.id=o.id LEFT JOIN progression_xp x ON x.id=o.id
        WHERE r.scope=? AND o.processed<>(x.id IS NOT NULL)`).all(this.scope);
      const badRemaining=await this.db.hasTable('progression_spin_uses')?await this.db.prepare(`SELECT r.id FROM progression_rewards r
        LEFT JOIN (SELECT grant_id,count(*) AS n FROM progression_spin_uses GROUP BY grant_id) u ON u.grant_id=r.id
        WHERE r.location_id=? AND r.currency=? AND r.remaining<>r.count-coalesce(u.n,0)`).all(this.locationId,this.environment):[];
      let projectionMismatches=0,milestoneMismatches=0;
      const players=await this.db.prepare('SELECT * FROM progression_players WHERE scope=?').all(this.scope);
      for(const player of players){
        const definition=await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,player.policy_version);
        if(!definition){projectionMismatches++;continue;}
        const policy=JSON.parse(definition.definition) as ProgressionPolicy;
        const expected=policy.levels.filter(l=>BigInt(l.xp)<=BigInt(player.xp)),level=expected.at(-1)?.level??1;
        if(Number(player.level)!==level)projectionMismatches++;
        const grants=await this.db.prepare('SELECT * FROM progression_rewards WHERE account_id=? AND location_id=? AND currency=?').all(player.account_id,this.locationId,this.environment);
        const milestones=expected.filter(l=>l.reward);
        for(const milestone of milestones){const grant=grants.find(g=>g.milestone_id==='level:'+milestone.level),reward=milestone.reward!;
          if(!grant||Number(grant.level)!==milestone.level||grant.type!=='free_spins'||grant.game_id!==reward.gameId||Number(grant.count)!==reward.count
            ||grant.nominal_units!==reward.stakeUnits||grant.policy_version!==player.policy_version||Number(grant.rules_version)!==1)milestoneMismatches++;}
        milestoneMismatches+=grants.filter(g=>!milestones.some(m=>g.milestone_id==='level:'+m.level)).length;
      }
      return {ok:[mismatches.length,missing.length,badRemaining.length,projectionMismatches,milestoneMismatches].every(n=>n===0),
        xpMismatches:mismatches.length,outboxMismatches:missing.length,rewardMismatches:badRemaining.length,projectionMismatches,milestoneMismatches};
    });
  }
  async setSwitches(value:{earnEnabled?:boolean;spinsEnabled?:boolean}) {
    await this.ready;
    if(Object.values(value).some(v=>typeof v!=='boolean'))throw Error('Invalid progression switches');
    await this.db.transaction(async()=>{
      if(value.earnEnabled!==undefined)await this.db.prepare('UPDATE progression_settings SET earn_enabled=? WHERE scope=?').run(value.earnEnabled,this.scope);
      if(value.spinsEnabled!==undefined)await this.db.prepare('UPDATE progression_settings SET spins_enabled=? WHERE scope=?').run(value.spinsEnabled,this.scope);
    });
  }
}
