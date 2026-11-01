import { randomUUID, createHash } from 'node:crypto';
import type { PostgresDatabase, DatabaseRow } from '../database';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_PROGRESSION_HANDLERS, type ExperienceHandler, type MilestoneClaim, type ProgressionHandlers, type RewardHandler } from './handlers';
import { DEFAULT_PROGRESSION_POLICY, PROGRESSION_CURRENCY, PROGRESSION_LOCATION, rewardGames, validLevelReward, validRewardSpinResult, type ExperienceSource, type LevelReward, type ProgressionReward, type ProgressionPolicy, type ProgressionSnapshot } from '../../src/shared/progression';

export type RoundContext<S extends string = ExperienceSource> = { sourceType: S; sourceId: string; accountId: string; locationId: string; gameId: string;
  environment: string; fundingSource: S extends ExperienceSource ? 'cash' | 'reward' : string; acceptedAt: number; policyVersion?: string };
export type SettledExperience<S extends string = ExperienceSource> = { sourceType: S; sourceId: string; accountId: string;
  settledAt: number; outcome: 'settled' | 'refunded' } & (S extends ExperienceSource ? { paidUnits: string; refundedUnits: string } : { valueUnits: string; data?: unknown });
const units = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,29})$/.test(v);
const scopeKey = (e: string, l: string) => e + ':' + l;
const key = (c: Pick<RoundContext<string>, 'sourceType' | 'sourceId' | 'accountId'>) => createHash('sha256').update(JSON.stringify([c.sourceType,c.sourceId,c.accountId])).digest('hex');
export class ProgressionStore<S extends string = ExperienceSource, R extends ProgressionReward = LevelReward> {
  readonly ready: Promise<void>;
  readonly policy: ProgressionPolicy<S,R>;
  private handlers: ProgressionHandlers<S,R>;
  readonly environment: string;
  readonly locationId: string;
  private scope: string;
  constructor(readonly db: PostgresDatabase, private options: { policy?: ProgressionPolicy<S,R>; handlers?: ProgressionHandlers<S,R>; environment?: string; locationId?: string;
    now?: () => number; prerequisite?: Promise<unknown>; readOnly?: boolean } = {}) {
    this.policy = structuredClone(options.policy ?? DEFAULT_PROGRESSION_POLICY as unknown as ProgressionPolicy<S,R>);
    this.handlers = options.handlers ?? DEFAULT_PROGRESSION_HANDLERS as unknown as ProgressionHandlers<S,R>;
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
      if (r && !this.rewardHandler(r).valid(r)) throw Error('Invalid reward policy');
    }
    if(Object.keys(this.handlers.sources).some(s=>!Object.hasOwn(this.policy.coefficients,s)))throw Error('Missing experience coefficient');
    for (const source of Object.keys(this.policy.coefficients) as S[]) { this.sourceHandler(source); const c=this.policy.coefficients[source]; if(!c||![c.numerator,c.denominator].every(Number.isSafeInteger)||c.numerator<0||c.denominator<1||c.denominator>1000000)throw Error('Invalid experience coefficient'); }
  }
  private sourceHandler(source: S): ExperienceHandler<S> {
    if(!Object.hasOwn(this.handlers.sources,source))throw Error('Unregistered experience source');
    return this.handlers.sources[source] as ExperienceHandler<S>;
  }
  private rewardHandler(definition: R): RewardHandler<R> {
    if(!Object.hasOwn(this.handlers.rewards,definition.kind))throw Error('Unregistered reward kind');
    return this.handlers.rewards[definition.kind as R['kind']] as RewardHandler<R>;
  }
  private claim(row: DatabaseRow): MilestoneClaim {
    return {id:row.id,accountId:row.account_id,locationId:this.locationId,environment:this.environment,milestoneId:row.milestone_id,policyVersion:row.policy_version,level:Number(row.level),createdAt:Number(row.created_at)};
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
          UNIQUE(account_id,location_id,currency,milestone_id));
        CREATE TABLE IF NOT EXISTS progression_milestones(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,scope TEXT NOT NULL,milestone_id TEXT NOT NULL,policy_version TEXT NOT NULL,level BIGINT NOT NULL,kind TEXT NOT NULL,definition_json TEXT NOT NULL,created_at BIGINT NOT NULL,UNIQUE(account_id,scope,milestone_id));
        CREATE TABLE IF NOT EXISTS progression_skin_rewards(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,location_id TEXT NOT NULL,milestone_id TEXT NOT NULL,policy_version TEXT NOT NULL,level BIGINT NOT NULL,
          theme TEXT NOT NULL,variant_count BIGINT NOT NULL CHECK(variant_count=2),count BIGINT NOT NULL CHECK(count>0),remaining BIGINT NOT NULL CHECK(remaining>=0 AND remaining<=count),currency TEXT NOT NULL,created_at BIGINT NOT NULL,
          UNIQUE(account_id,location_id,currency,milestone_id));`);
      await this.db.exec('ALTER TABLE progression_rewards ADD COLUMN IF NOT EXISTS pool_id TEXT');
      // Preserve already issued v1 rights if upgrading a database created before the handler seam.
      await this.db.exec(`INSERT INTO progression_milestones SELECT id,account_id,currency||':'||location_id,milestone_id,policy_version,level,type,
        jsonb_build_object('kind','free_spins','gameId',game_id,'count',count,'stakeUnits',nominal_units)::text,created_at
        FROM progression_rewards WHERE pool_id IS NULL ON CONFLICT DO NOTHING`);
      await this.db.exec('ALTER TABLE progression_settings ADD COLUMN IF NOT EXISTS skins_enabled BOOLEAN NOT NULL DEFAULT true');
      await this.db.prepare('INSERT INTO progression_settings(scope,activated_at) VALUES(?,?) ON CONFLICT DO NOTHING').run(this.scope,this.now());
      const definition=JSON.stringify(this.policy);
      await this.db.prepare('INSERT INTO progression_policies VALUES(?,?,?) ON CONFLICT DO NOTHING').run(this.scope,this.policy.version,definition);
      if ((await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,this.policy.version))?.definition !== definition) throw Error('Published progression policy changed without version');
    });
  }
  async spinsEnabled() { await this.ready; return !!(await this.db.prepare('SELECT spins_enabled FROM progression_settings WHERE scope=?').get(this.scope))?.spins_enabled; }
  async acceptRound(c: RoundContext<S>) {
    await this.ready;
    if (!c.sourceId||c.sourceId.length>256||!c.accountId||!c.gameId||!Number.isSafeInteger(c.acceptedAt)||c.acceptedAt<1) throw Error('Invalid progression round context');
    if(c.environment!==this.environment||c.locationId!==this.locationId||!this.sourceHandler(c.sourceType).eligible(c))return false;
    return this.db.transaction(async()=>{
      const settings=await this.db.prepare('SELECT * FROM progression_settings WHERE scope=?').get(this.scope);
      if(!settings?.earn_enabled||c.acceptedAt<Number(settings.activated_at))return false;
      const existing=await this.db.prepare('SELECT context_json FROM progression_rounds WHERE id=?').get(key(c));
      if(existing){const old=JSON.parse(existing.context_json);for(const field of ['sourceType','sourceId','accountId','gameId','locationId','environment','fundingSource'] as const)if(old[field]!==c[field])throw Error('Progression source identity conflict');return true;}
      // Pin before settlement: a delayed round and a policy rollout must not assign different tracks.
      await this.db.prepare('INSERT INTO progression_players VALUES(?,?,?,\'0\',\'0\',1) ON CONFLICT DO NOTHING').run(c.accountId,this.scope,this.policy.version);
      const player=await this.db.prepare('SELECT policy_version FROM progression_players WHERE account_id=? AND scope=?').get(c.accountId,this.scope);
      const pinned=await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,player!.policy_version);
      if(!pinned)throw Error('Missing accepted progression policy');
      if(!Object.hasOwn(JSON.parse(pinned.definition).coefficients,c.sourceType))return false;
      const context={...c,policyVersion:player?.policy_version??this.policy.version};
      await this.db.prepare("INSERT INTO progression_rounds VALUES(?,?,?,?,'pending')").run(key(c),c.accountId,this.scope,JSON.stringify(context));
      return true;
    });
  }
  async pendingRounds<K extends S>(accountId: string, sourceType: K): Promise<RoundContext<K>[]>;
  async pendingRounds(accountId: string): Promise<RoundContext<S>[]>;
  async pendingRounds(accountId: string, sourceType?: S): Promise<RoundContext<S>[]> {
    await this.ready;
    const rows=await this.db.prepare("SELECT context_json FROM progression_rounds WHERE account_id=? AND scope=? AND state='pending'").all(accountId,this.scope);
    return rows.map(r=>JSON.parse(r.context_json) as RoundContext<S>).filter(c=>!sourceType||c.sourceType===sourceType);
  }
  async recordSettled(e: SettledExperience<S>) {
    await this.ready;
    const handler=this.sourceHandler(e.sourceType);
    if(!handler.valid(e)||!Number.isSafeInteger(e.settledAt)||!['settled','refunded'].includes(e.outcome))throw Error('Invalid settled experience');
    return this.db.transaction(async()=>{
      const row=await this.db.prepare('SELECT * FROM progression_rounds WHERE id=? AND scope=?').get(key(e),this.scope);
      if(!row)return false;
      const old=await this.db.prepare('SELECT payload FROM progression_outbox WHERE id=?').get(key(e));
      if(old){if(handler.identity(JSON.parse(old.payload))!==handler.identity(e))throw Error('Settled experience conflict');return true;}
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
    const c=JSON.parse(row.context_json) as RoundContext<S>,e=JSON.parse(row.payload) as SettledExperience<S>;
    const policyRow=await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(row.scope,c.policyVersion);
    if(!policyRow)throw Error('Missing accepted progression policy');
    const policy=JSON.parse(policyRow.definition) as ProgressionPolicy<S,R>;
    await this.db.prepare('INSERT INTO progression_players VALUES(?,?,?,\'0\',\'0\',1) ON CONFLICT DO NOTHING').run(c.accountId,row.scope,c.policyVersion);
    const player=(await this.db.prepare('SELECT * FROM progression_players WHERE account_id=? AND scope=? FOR UPDATE').get(c.accountId,row.scope))!;
    if(player.policy_version!==c.policyVersion)throw Error('Progression policy migration is required');
    const coefficient=policy.coefficients[c.sourceType];
    const net=this.sourceHandler(c.sourceType).basisUnits(e);if(net<0n)throw Error('Invalid normalized experience');
    const gcd=(a:bigint,b:bigint):bigint=>b===0n?a:gcd(b,a%b);
    const denominators=Object.values(policy.coefficients as Record<string,{denominator:number}>).map(v=>BigInt(v.denominator));
    const common=denominators.reduce((a,b)=>a/gcd(a,b)*b,1n),precision=common*10000n;
    const scaled=net*BigInt(coefficient.numerator)*(common/BigInt(coefficient.denominator))+BigInt(player.remainder);
    const delta=scaled/precision, remainder=scaled%precision,xp=BigInt(player.xp)+delta;
    let level=1;for(const threshold of policy.levels)if(xp>=BigInt(threshold.xp))level=threshold.level;
    await this.db.prepare('INSERT INTO progression_xp VALUES(?,?,?,?,?,?)').run(row.id,c.accountId,row.scope,c.policyVersion,String(delta),e.settledAt);
    await this.db.prepare('UPDATE progression_players SET xp=?,remainder=?,level=? WHERE account_id=? AND scope=?').run(String(xp),String(remainder),level,c.accountId,row.scope);
    for(const milestone of policy.levels.filter(l=>l.level>Number(player.level)&&l.level<=level&&l.reward)){
      const r=milestone.reward!;
      const claim:MilestoneClaim={id:randomUUID(),accountId:c.accountId,locationId:c.locationId,environment:c.environment,milestoneId:'level:'+milestone.level,policyVersion:c.policyVersion!,level:milestone.level,createdAt:this.now()};
      const inserted=await this.db.prepare('INSERT INTO progression_milestones VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,scope,milestone_id) DO NOTHING')
        .run(claim.id,claim.accountId,row.scope,claim.milestoneId,claim.policyVersion,claim.level,r.kind,JSON.stringify(r),claim.createdAt);
      if(inserted.changes===1)await this.rewardHandler(r).issue(this.db,claim,r);
    }
    await this.db.prepare('UPDATE progression_outbox SET processed=true WHERE id=?').run(row.id);
  }
  async snapshot(accountId: string, locationId=this.locationId): Promise<ProgressionSnapshot<R>> {
    await this.ready;
    if(locationId!==this.locationId)throw Error('Unknown progression location');
    await this.processPending(accountId);
    return this.db.transaction(async()=>{
      const player=await this.db.prepare('SELECT * FROM progression_players WHERE account_id=? AND scope=?').get(accountId,this.scope);
      const policy=player?JSON.parse((await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,player.policy_version))!.definition):this.policy;
      const grants=await this.db.prepare('SELECT * FROM progression_rewards WHERE account_id=? AND location_id=? AND currency=? ORDER BY level,id').all(accountId,this.locationId,this.environment);
      const skins=await this.db.prepare('SELECT * FROM progression_skin_rewards WHERE account_id=? AND location_id=? AND currency=? ORDER BY level,id').all(accountId,this.locationId,this.environment);
      return {accountId,locationId,policyVersion:policy.version,currency:this.environment,xp:String(player?.xp??'0'),level:Number(player?.level??1),levels:policy.levels,
        grants:grants.map(g=>({id:g.id,...(g.pool_id?{poolId:g.pool_id}:{gameId:g.game_id}),count:Number(g.count),remaining:Number(g.remaining),stakeUnits:g.nominal_units,level:Number(g.level),currency:g.currency})),
        skinGrants:skins.map(g=>({id:g.id,count:Number(g.count),remaining:Number(g.remaining),level:Number(g.level),theme:g.theme,variantCount:2 as const,currency:g.currency})),enabled:await this.spinsEnabled()};
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
      const skins=await this.db.prepare('SELECT coalesce(sum(count),0)::text AS issued,coalesce(sum(remaining),0)::text AS available FROM progression_skin_rewards WHERE location_id=? AND currency=?').get(this.locationId,this.environment);
      return {currency:this.environment,locationId:this.locationId,grants:rows.length,issuedSpins:rows.reduce((n,r)=>n+Number(r.count),0),
        availableSpins:rows.reduce((n,r)=>n+Number(r.remaining),0),usedSpins:Number(actual?.n??0),actualPayoutUnits:String(actual?.payout??'0'),
        expectedIssuedPayoutUnits:String(issuedExpected),expectedOutstandingPayoutUnits:String(outstandingExpected),expectedPayoutBasis:'highest-return-eligible-game',pendingEvents:Number(pending?.n??0),
        issuedSkinGenerations:Number(skins?.issued??0),availableSkinGenerations:Number(skins?.available??0)};
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
      const badSkins=await this.db.hasTable('progression_skin_uses')?await this.db.prepare(`SELECT r.id FROM progression_skin_rewards r LEFT JOIN
        (SELECT grant_id,count(*) AS n FROM progression_skin_uses WHERE state IN ('reserved','captured') GROUP BY grant_id) u ON u.grant_id=r.id
        WHERE r.location_id=? AND r.currency=? AND r.remaining<>r.count-coalesce(u.n,0)`).all(this.locationId,this.environment):[];
      let projectionMismatches=0,milestoneMismatches=0,receiptMismatches=0;
      if (await this.db.hasTable('progression_spin_uses')) {
        const uses = await this.db.prepare(`SELECT u.*,r.account_id AS grant_owner,r.game_id,r.pool_id,r.nominal_units
          FROM progression_spin_uses u JOIN progression_rewards r ON r.id=u.grant_id WHERE r.location_id=? AND r.currency=?`).all(this.locationId,this.environment);
        for (const use of uses) {
          try {
            const result = JSON.parse(use.result_json);
            const definition = { kind: 'free_spins', count: 1, stakeUnits: use.nominal_units,
              ...(use.pool_id ? { poolId: use.pool_id } : { gameId: use.game_id }) };
            if (!validRewardSpinResult({ ...result, wallet: { balance: 0, entries: [] }, replayed: false })
              || !validLevelReward(definition) || definition.kind !== 'free_spins'
              || use.account_id !== use.grant_owner || result.id !== use.operation_id || result.grantId !== use.grant_id
              || !rewardGames(definition).includes(result.gameRound.gameId)
              || use.pool_id && result.gameId !== result.gameRound.gameId
              || BigInt(result.gameRound.stakeUnits) * 10000n !== BigInt(use.nominal_units)
              || createHash('sha256').update(JSON.stringify({fundingSource:'reward',accountId:use.account_id,...result})).digest('hex') !== use.money_request_hash) receiptMismatches++;
          } catch { receiptMismatches++; }
        }
      }
      const players=await this.db.prepare('SELECT * FROM progression_players WHERE scope=?').all(this.scope);
      for(const player of players){
        const definition=await this.db.prepare('SELECT definition FROM progression_policies WHERE scope=? AND version=?').get(this.scope,player.policy_version);
        if(!definition){projectionMismatches++;continue;}
        const policy=JSON.parse(definition.definition) as ProgressionPolicy<S,R>;
        const expected=policy.levels.filter(l=>BigInt(l.xp)<=BigInt(player.xp)),level=expected.at(-1)?.level??1;
        if(Number(player.level)!==level)projectionMismatches++;
        const grants=await this.db.prepare('SELECT * FROM progression_milestones WHERE account_id=? AND scope=?').all(player.account_id,this.scope);
        const milestones=expected.filter(l=>l.reward);
        for(const milestone of milestones){const grant=grants.find(g=>g.milestone_id==='level:'+milestone.level),reward=milestone.reward!;
          if(!grant||Number(grant.level)!==milestone.level||grant.kind!==reward.kind||grant.policy_version!==player.policy_version
            ||!isDeepStrictEqual(JSON.parse(grant.definition_json),reward)||!await this.rewardHandler(reward).audit(this.db,this.claim(grant),reward))milestoneMismatches++;}
        milestoneMismatches+=grants.filter(g=>!milestones.some(m=>g.milestone_id==='level:'+m.level)).length;
      }
      return {ok:[mismatches.length,missing.length,badRemaining.length,badSkins.length,projectionMismatches,milestoneMismatches,receiptMismatches].every(n=>n===0),
        xpMismatches:mismatches.length,outboxMismatches:missing.length,rewardMismatches:badRemaining.length,skinRewardMismatches:badSkins.length,projectionMismatches,milestoneMismatches,receiptMismatches};
    });
  }
  async setSwitches(value:{earnEnabled?:boolean;spinsEnabled?:boolean;skinsEnabled?:boolean}) {
    await this.ready;
    if(Object.values(value).some(v=>typeof v!=='boolean'))throw Error('Invalid progression switches');
    await this.db.transaction(async()=>{
      if(value.earnEnabled!==undefined)await this.db.prepare('UPDATE progression_settings SET earn_enabled=? WHERE scope=?').run(value.earnEnabled,this.scope);
      if(value.spinsEnabled!==undefined)await this.db.prepare('UPDATE progression_settings SET spins_enabled=? WHERE scope=?').run(value.spinsEnabled,this.scope);
      if(value.skinsEnabled!==undefined)await this.db.prepare('UPDATE progression_settings SET skins_enabled=? WHERE scope=?').run(value.skinsEnabled,this.scope);
    });
  }
}
