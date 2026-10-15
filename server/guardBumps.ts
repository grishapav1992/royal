export const BUMP_STREAK_MS=30000;
export class GuardBumps {
  private streaks=new Map<string,{count:number;at:number}>();
  record(account:string,now=Date.now()) {
    for(const [id,s] of this.streaks)if(now-s.at>=BUMP_STREAK_MS)this.streaks.delete(id);
    const count=(this.streaks.get(account)?.count??0)+1;
    if(count>=10)this.streaks.delete(account);else this.streaks.set(account,{count,at:now});
    return count;
  }
}
export const guardBumps=new GuardBumps();
