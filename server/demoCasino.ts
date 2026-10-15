import { randomInt } from 'node:crypto';
import { isRetiredCardGame } from '../src/shared/cardTables';
import type { PostgresDatabase } from './database';
import { DEMO_BETS, type DemoWallet } from '../src/shared/demoWallet';
import { casinoActionKey, validCasinoAction, isSessionGame, type SessionGameId } from '../src/shared/casinoSessions';
import { advanceSession, publicSession, sessionPayout, sessionReservation, startSession, type SessionState } from './games/casinoSessions';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { WalletError } from './demoWallet';

export async function casinoDemoSchema(db:PostgresDatabase) {
  await db.exec(`CREATE TABLE IF NOT EXISTS demo_casino_sessions (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,game_id TEXT NOT NULL,
    state TEXT NOT NULL,payload TEXT NOT NULL,reserved_units BIGINT NOT NULL CHECK(reserved_units>=0),PRIMARY KEY(account_id,id));
    CREATE UNIQUE INDEX IF NOT EXISTS demo_casino_active ON demo_casino_sessions(account_id,game_id) WHERE state='active';
    CREATE TABLE IF NOT EXISTS demo_casino_requests(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id TEXT NOT NULL,request_key TEXT NOT NULL,session_id TEXT NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(account_id,id),
    FOREIGN KEY(account_id,session_id) REFERENCES demo_casino_sessions(account_id,id));
    CREATE INDEX IF NOT EXISTS demo_casino_request_time ON demo_casino_requests(account_id,created_at);
    CREATE INDEX IF NOT EXISTS demo_casino_request_session ON demo_casino_requests(account_id,session_id);`);
}
export class DemoCasinoStore {
  readonly ready:Promise<void>;
  constructor(private db:PostgresDatabase,private snapshot:(id:string)=>Promise<DemoWallet>,private draw:(n:number)=>number=randomInt,
    private settleOther:(id:string)=>Promise<void>=async()=>{},prerequisite:Promise<void>=Promise.resolve()) {
    this.ready=prerequisite.then(()=>db.transaction(()=>casinoDemoSchema(db)));
  }
  async reservedUnits(id:string) {await this.ready;return Number((await this.db.prepare("SELECT COALESCE(SUM(reserved_units),0) AS units FROM demo_casino_sessions WHERE account_id=? AND state='active'").get(id))!.units);}
  async sessions(id:string) {
    return (await this.db.prepare("SELECT payload FROM demo_casino_sessions WHERE account_id=? AND state='active' AND game_id IN ('github-hilo','github-tower') ORDER BY game_id").all(id)).map(row=>publicSession(JSON.parse(row.payload)));
  }
  async active(id:string) {
    await this.ready;return this.db.transaction(async()=>{await this.settleOther(id);return {wallet:await this.snapshot(id),sessions:await this.sessions(id)};},{lockKey:'account:'+id});
  }
  async operate(account:string,value:unknown) {
    await this.ready;
    if(!validCasinoAction(value))throw new WalletError(400,'Некорректное действие казино.');
    const op=structuredClone(value),key=casinoActionKey(op);
    if(op.action==='start'&&!(DEMO_BETS as readonly number[]).some(amount=>String(amount*100)===op.stakeUnits))throw new WalletError(400,'Недопустимая ставка.');
    return this.db.transaction(async()=>{
      if(op.action==='start'&&isRetiredCardGame(op.gameId)&&!await this.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(account,op.id))throw new WalletError(409,'Эта карточная игра удалена из каталога.');
      await this.settleOther(account);
      const previous=await this.db.prepare('SELECT * FROM demo_casino_requests WHERE account_id=? AND id=?').get(account,op.id);
      if(previous){if(previous.request_key!==key)throw new WalletError(409,'Нельзя изменить уже отправленную операцию.');const row=await this.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(account,previous.session_id);return {wallet:await this.snapshot(account),session:publicSession(JSON.parse(row!.payload)),sessions:await this.sessions(account),replayed:true};}
      for(const table of ['demo_operations','demo_mines_requests','demo_flight_requests']) {
        const column=table==='demo_operations'?'operation_id':'id';
        if(await this.db.prepare(`SELECT 1 FROM ${table} WHERE account_id=? AND ${column}=?`).get(account,op.id))throw new WalletError(409,'Этот номер операции уже использован.');
      }
      const recent=await this.db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM demo_casino_requests WHERE account_id=? AND created_at>? LIMIT 120) recent').get(account,Date.now()-60000);
      if(Number(recent!.n)>=120)throw new WalletError(429,'Слишком много ходов. Подожди минуту.');
      let balance=await demoBalanceUnits(this.db,account),state:SessionState;
      if(op.action==='start') {
        if(await this.db.prepare("SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='active'").get(account,op.gameId))throw new WalletError(409,'Сначала заверши текущую партию этой игры.');
        const stake=Number(op.stakeUnits);if(balance<stake)throw new WalletError(409,'Недостаточно демомонет.');
        // Check coverage before drawing hidden cards or cells.
        const probe={gameId:op.gameId,settings:op.settings,state:'active',stakeUnits:op.stakeUnits} as SessionState;
        const reserved=Number(sessionReservation(probe));
        if(balance-stake+reserved+await demoReservedUnits(this.db,account)>MAX_DEMO_UNITS)throw new WalletError(409,'Уменьши ставку: возможная выплата превышает лимит баланса.');
        state=startSession(op,this.draw);balance-=stake;
        await recordDemoUnits(this.db,account,op.id,'bet',-stake,balance,op.gameId,gameName(op.gameId));
        await this.db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(account,state.id,state.gameId,state.state,JSON.stringify(state),reserved);
      }else{
        const row=await this.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=? AND game_id=?').get(account,op.sessionId,op.gameId);
        if(!row)throw new WalletError(404,'Партия не найдена.');
        try{state=advanceSession(JSON.parse(row.payload),op);}catch(error){throw new WalletError(409,(error as Error).message);}
        await this.db.prepare('UPDATE demo_casino_sessions SET state=?,payload=?,reserved_units=? WHERE account_id=? AND id=?').run(state.state,JSON.stringify(state),Number(sessionReservation(state)),account,state.id);
        if(state.state!=='active'){const payout=Number(sessionPayout(state));balance+=payout;await recordDemoUnits(this.db,account,state.id,'win',payout,balance,op.gameId,gameName(op.gameId));}
      }
      await saveDemoUnits(this.db,account,balance);
      await this.db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(account,op.id,key,state.id,Date.now());
      return {wallet:await this.snapshot(account),session:publicSession(state),sessions:await this.sessions(account),replayed:false};
    },{lockKey:'account:'+account});
  }
}
export function gameName(id:SessionGameId) {if(!isSessionGame(id))throw Error('Invalid casino game');return id==='github-hilo'?'Hi-Lo':'Dragon Tower';}
