/** Test stand only: seeded entropy through the real transactional wallet service. Never mounted by production. */
import type { Plugin } from 'vite';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { seededRandom } from '../src/shared/draconaMath';

export function neopolisTestRng(api:string, environment:NodeJS.ProcessEnv):Plugin {
  let db:PostgresDatabase|undefined, wallet:DemoWalletStore;
  const stores=new Map<string,DemoExpansionStore>();
  return {name:'neopolis-test-rng',configureServer(server){
    server.middlewares.use('/__test/neopolis/operate',async(req,res)=>{
      try {
        if(req.method!=='POST'){res.statusCode=405;res.end();return;}
        const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie??''}}).then(response=>response.json());
        if(!identity.account){res.statusCode=401;res.end();return;}
        if(!db){db=new PostgresDatabase('neopolis_preview',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
        let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Oversized fixture request');}
        const operation=JSON.parse(body);
        if(operation.gameId!=='studio-neopolis')throw Error('Fixture only supports Neopolis');
        const account=identity.account.id;
        let store=stores.get(account);
        if(!store){const random=seededRandom(95);store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},max=>Math.floor(random()*max));stores.set(account,store);}
        const reply=await store.operate(account,operation);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
      }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error instanceof Error?error.message:'Fixture failed'}));}
    });
    server.httpServer?.once('close',()=>{void db?.close();});
  }};
}
