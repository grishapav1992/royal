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

test('windows share in-flight downloads and cached frames while a ready scene can open before background art',async()=>{
  const a=deferred(),b=deferred(),calls:string[]=[];
  const store=new CrLeoAssetStore(specs.slice(0,2),spec=>{calls.push(spec.key);return spec.key==='a'?a.promise:b.promise;});
  let firstUpdates=0,secondUpdates=0;
  const release=store.subscribe(()=>firstUpdates++);store.subscribe(()=>secondUpdates++);
  const first=store.start(['a']),second=store.start(['a']);assert.equal(first,second);
  assert.deepEqual(calls,['a']);
  release();const stoppedAt=firstUpdates;const prepared=asset();a.resolve(prepared);await flush();
  assert.equal(store.state(['a']).ready,true);assert.equal(store.state().ready,false);assert.equal(firstUpdates,stoppedAt);
  b.resolve(asset());await first;await store.start();assert.deepEqual(calls,['a','b']);assert.equal(store.get('a'),prepared);assert(secondUpdates>firstUpdates);
});

test('a failed image blocks that scene, retries only unfinished art and preserves successful frames',async()=>{
  const calls:string[]=[],retries:boolean[]=[],cached=asset();let fail=true;
  const store=new CrLeoAssetStore(specs.slice(0,2),async(spec,_progress,retry)=>{calls.push(spec.key);retries.push(retry);if(spec.key==='a'&&fail)throw Error('offline');return cached;});
  await store.start();assert.equal(store.state(['a']).ready,false);assert.equal(store.state(['a']).failed,true);assert.equal(store.state(['b']).ready,true);
  fail=false;await store.start(['a']);assert.deepEqual(calls,['a','b','a']);assert.deepEqual(retries,[false,false,true]);assert.equal(store.get('b'),cached);assert.equal(store.state().failed,false);assert.equal(store.state().percent,100);
});

test('switching the selected scene prioritizes its pending art ahead of optional background downloads',async()=>{
  const jobs=new Map<string,ReturnType<typeof deferred>>(),calls:string[]=[];
  specs.forEach(s=>jobs.set(s.key,deferred()));
  const store=new CrLeoAssetStore(specs,spec=>{calls.push(spec.key);return jobs.get(spec.key)!.promise;});
  const pending=store.start();assert.deepEqual(calls,['a','b']);store.start(['e']);jobs.get('a')!.resolve(asset());await flush();assert.deepEqual(calls,['a','b','e']);
  jobs.forEach(job=>job.resolve(asset()));await pending;assert.equal(store.state().ready,true);
});
