import { accounts } from '../../server/accounts';
if(process.env.NODE_ENV!=='test')throw Error('Jackie fixture requires an isolated test database');
let lose=false;
Reflect.set(accounts.wallet.expansion,'draw',(max:number)=>max===100&&lose?99:0);
process.on('message',message=>{if(message==='win'||message==='lose'){lose=message==='lose';process.send?.(message);}});
await import('../../server/index');
