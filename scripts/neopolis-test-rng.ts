/** Test stand only: seeded entropy through the real transactional wallet service. Never mounted by production. */
import type { Plugin } from 'vite';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { seededRandom } from '../src/shared/draconaMath';

export function neopolisTestRng(api:string, environment:NodeJS.ProcessEnv, seeded=false):Plugin {
  let db:PostgresDatabase|undefined, wallet:DemoWalletStore;
  const stores=new Map<string,DemoExpansionStore>();
  return {name:'neopolis-test-rng',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      const path=new URL(req.url??'/',api).pathname;
      const fixture=path==='/__test/neopolis/operate';
      if(!fixture&&!/^\/api\/(?:demo|game)-wallet(?:\/expansion|\/operations)?$/.test(path)){next();return;}
      try {
        if(fixture&&!seeded){res.statusCode=404;res.end();return;}
        const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie??''}}).then(response=>response.json());
        if(!identity.account){res.statusCode=401;res.end();return;}
        if(!db){db=new PostgresDatabase('neopolis_preview',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
        const account=identity.account.id;
        let reply:unknown;
        if(req.method==='GET')reply=path.endsWith('/expansion')?await wallet.expansion.active(account):await wallet.snapshot(account);
        else if(req.method==='POST') {
          let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Oversized fixture request');}
          const operation=JSON.parse(body);
          if(path.endsWith('/operations'))reply=await wallet.operate(account,operation);
          else {
            if(!['studio-neopolis','studio-dracona'].includes(operation.gameId))throw Error('Preview supports only the two slots');
            let store=wallet.expansion;
            if(fixture){const key=account+':'+operation.gameId;let saved=stores.get(key);
              if(!saved){const random=seededRandom(operation.gameId==='studio-neopolis'?95:1);saved=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},max=>Math.floor(random()*max));stores.set(key,saved);}store=saved;}
            reply=await store.operate(account,operation);
          }
        } else {res.statusCode=405;res.end();return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
      }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error instanceof Error?error.message:'Fixture failed'}));}
    });
    server.httpServer?.once('close',()=>{void db?.close();});
  }};
}
