// Cache serialized fields so mutable game objects do not invalidate the baseline.
export class ActivityChanges<T extends object> {
  private fields=new Map<keyof T,string|undefined>();
  constructor(state:T){this.take(state);}
  take(state:T,keys=(Object.keys(state) as (keyof T)[])):Partial<T>{
    const changed:[keyof T,T[keyof T]][]=[];
    for(const key of keys){
      const value=JSON.stringify(state[key]);
      if(this.fields.get(key)===value)continue;
      this.fields.set(key,value);changed.push([key,state[key]]);
    }
    return Object.fromEntries(changed) as Partial<T>;
  }
}
