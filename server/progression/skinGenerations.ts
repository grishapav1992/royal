import type { PostgresDatabase } from '../database';
import type { SkinPayments } from '../skinStudio';
import { CryptoError } from '../crypto/config';
import { PROGRESSION_CURRENCY, PROGRESSION_LOCATION, type SkinGenerationGrant } from '../../src/shared/progression';
import { SKIN_UUID, type SkinPurchase } from '../../src/shared/skinStudio';

/** A generation right funds the existing atelier job; it never credits or debits player money. */
export class FreeSkinGenerations implements SkinPayments {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<unknown>, private now=Date.now) {
    this.ready=prerequisite.then(()=>db.transaction(()=>db.exec(`CREATE TABLE IF NOT EXISTS progression_skin_uses(
      job_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,grant_id TEXT NOT NULL REFERENCES progression_skin_rewards(id),
      state TEXT NOT NULL CHECK(state IN ('reserved','captured','refunded')),created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS progression_skin_uses_grant ON progression_skin_uses(grant_id);`)));
  }
  async available(accountId:string):Promise<SkinGenerationGrant[]> {
    await this.ready;
    const rows=await this.db.prepare('SELECT * FROM progression_skin_rewards WHERE account_id=? AND location_id=? AND currency=? AND remaining>0 ORDER BY level,id')
      .all(accountId,PROGRESSION_LOCATION,PROGRESSION_CURRENCY);
    return rows.map(r=>({id:r.id,count:Number(r.count),remaining:Number(r.remaining),level:Number(r.level),theme:r.theme,variantCount:2,currency:r.currency}));
  }
  async reserveForJob(accountId:string,id:string,grantId:string):Promise<SkinPurchase> {
    await this.ready;
    if(!SKIN_UUID.test(grantId))throw new CryptoError(400,'Некорректная бесплатная генерация.');
    return this.db.transaction(async()=>{
      const old=await this.db.prepare('SELECT * FROM progression_skin_uses WHERE job_id=?').get(id);
      if(old){if(old.account_id!==accountId||old.grant_id!==grantId)throw new CryptoError(409,'Нельзя изменить бесплатную генерацию.');return {id,state:old.state,amountUnits:'0'};}
      const enabled=await this.db.prepare('SELECT skins_enabled FROM progression_settings WHERE scope=?').get(PROGRESSION_CURRENCY+':'+PROGRESSION_LOCATION);
      if(!enabled?.skins_enabled)throw new CryptoError(503,'Бесплатные генерации временно приостановлены. Награда сохранена.');
      const grant=await this.db.prepare('SELECT * FROM progression_skin_rewards WHERE id=? AND account_id=? FOR UPDATE').get(grantId,accountId);
      if(!grant||grant.currency!==PROGRESSION_CURRENCY||grant.location_id!==PROGRESSION_LOCATION||grant.theme!==PROGRESSION_LOCATION||Number(grant.variant_count)!==2)
        throw new CryptoError(404,'Бесплатная генерация не найдена.');
      if(Number(grant.remaining)<1)throw new CryptoError(409,'Эта бесплатная генерация уже использована. Обнови ателье.');
      await this.db.prepare('UPDATE progression_skin_rewards SET remaining=remaining-1 WHERE id=?').run(grantId);
      await this.db.prepare("INSERT INTO progression_skin_uses VALUES(?,?,?,'reserved',?,?)").run(id,accountId,grantId,this.now(),this.now());
      return {id,state:'reserved',amountUnits:'0'};
    });
  }
  async skinPurchase(accountId:string,id:string,action:'reserve'|'capture'|'refund'):Promise<SkinPurchase> {
    await this.ready;
    if(!SKIN_UUID.test(id)||!['reserve','capture','refund'].includes(action))throw new CryptoError(400,'Некорректная бесплатная генерация.');
    return this.db.transaction(async()=>{
      const row=await this.db.prepare('SELECT * FROM progression_skin_uses WHERE job_id=? FOR UPDATE').get(id);
      if(!row||row.account_id!==accountId)throw new CryptoError(409,'Право на бесплатную генерацию не подтверждено.');
      let state=row.state as SkinPurchase['state'];
      if(state==='reserved'&&action!=='reserve'){
        state=action==='capture'?'captured':'refunded';
        await this.db.prepare('UPDATE progression_skin_uses SET state=?,updated_at=? WHERE job_id=?').run(state,this.now(),id);
        if(state==='refunded')await this.db.prepare('UPDATE progression_skin_rewards SET remaining=remaining+1 WHERE id=? AND remaining<count').run(row.grant_id);
      }else if(state==='captured'&&action==='refund')throw new CryptoError(409,'Готовая бесплатная генерация уже использована.');
      return {id,state,amountUnits:'0'};
    });
  }
}
