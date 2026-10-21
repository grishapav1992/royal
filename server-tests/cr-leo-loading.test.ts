import test from 'node:test';
import assert from 'node:assert/strict';
import { CrLeoAssetStore, type CrLeoAsset } from '../src/ui/crLeoAssets';

const specs = ['a','b','c','d','e'].map((key,i) => ({ key, file:key+'.webp', bytes:(i+1)*100 }));
const asset = (): CrLeoAsset => ({ image: {} as HTMLImageElement });
function deferred() {
  let resolve!: (value: CrLeoAsset) => void, reject!: (reason: Error) => void;
  const promise = new Promise<CrLeoAsset>((yes,no) => { resolve=yes; reject=no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('progress follows downloaded bytes and reaches 100 only after image preparation finishes',async()=>{
  const a=deferred(),b=deferred(),updates=new Map<string,(n:number)=>void>();
  const store=new CrLeoAssetStore(specs.slice(0,2),(spec,progress)=>{updates.set(spec.key,progress);return spec.key==='a'?a.promise:b.promise;});
  const pending=store.start(); updates.get('a')!(.5);updates.get('b')!(.25);
  assert.equal(store.state().percent,33);assert.equal(store.state().ready,false);
  updates.get('a')!(.99);updates.get('b')!(.99);assert.equal(store.state().percent,99);
  b.resolve(asset());await flush();assert.equal(store.state().ready,false);
  a.resolve(asset());await pending;assert.equal(store.state().percent,100);assert.equal(store.state().ready,true);
});

test('windows share in-flight downloads and cached frames and wait for every image before opening',async()=>{
  const a=deferred(),b=deferred(),calls:string[]=[];
  const store=new CrLeoAssetStore(specs.slice(0,2),spec=>{calls.push(spec.key);return spec.key==='a'?a.promise:b.promise;});
  let firstUpdates=0,secondUpdates=0;
  const release=store.subscribe(()=>firstUpdates++);store.subscribe(()=>secondUpdates++);
  const first=store.start(),second=store.start();assert.equal(first,second);
  assert.deepEqual(calls,['a','b']);
  release();const stoppedAt=firstUpdates;const prepared=asset();a.resolve(prepared);await flush();
  assert.equal(store.state().ready,false);assert.equal(firstUpdates,stoppedAt);
  b.resolve(asset());await first;await store.start();assert.deepEqual(calls,['a','b']);assert.equal(store.get('a'),prepared);assert(secondUpdates>firstUpdates);
});

test('a failed image blocks the game, retries only unfinished art and preserves successful frames',async()=>{
  const calls:string[]=[],retries:boolean[]=[],cached=asset();let fail=true;
  const store=new CrLeoAssetStore(specs.slice(0,2),async(spec,_progress,retry)=>{calls.push(spec.key);retries.push(retry);if(spec.key==='a'&&fail)throw Error('offline');return cached;});
  await store.start();assert.equal(store.state().ready,false);assert.equal(store.state().failed,true);assert.equal(store.get('b'),cached);
  fail=false;await store.start();assert.deepEqual(calls,['a','b','a']);assert.deepEqual(retries,[false,false,true]);assert.equal(store.get('b'),cached);assert.equal(store.state().failed,false);assert.equal(store.state().percent,100);
});

test('the last image keeps the whole game loading, then every mode and player switch reuses the complete cache',async()=>{
  const all=Array.from({length:9},(_,i)=>({key:String(i),file:i+'.webp',bytes:100}));
  const jobs=new Map(all.map(spec=>[spec.key,deferred()])),calls:string[]=[];
  const store=new CrLeoAssetStore(all,spec=>{calls.push(spec.key);return jobs.get(spec.key)!.promise;});
  const pending=store.start();
  for(let i=0;i<8;i++)jobs.get(String(i))!.resolve(asset());
  await flush();assert.equal(calls.length,9);assert.equal(store.state().ready,false);assert(store.state().percent<100);
  jobs.get('8')!.resolve(asset());await pending;assert.equal(store.state().ready,true);assert.equal(store.state().percent,100);
  for(let hero=0;hero<2;hero++)for(let risk=0;risk<3;risk++){await store.start();assert.equal(store.state().ready,true);}
  assert.equal(calls.length,9);
});
