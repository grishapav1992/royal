import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Owner } from '../lib/owner.mjs';
import { scryptSync } from 'node:crypto';

const email='owner@example.com';

test('owner setup token is single use, password is hashed, and state survives restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-'));
  try{
    const owner=new Owner(directory);await owner.init();
    const bootstrap=JSON.parse(await readFile(join(directory,'owner.json'),'utf8')).bootstrap;
    assert.equal(await owner.setup('wrong','long-test-password',email),false);
    assert.equal(await owner.setup(bootstrap,'long-test-password',' Owner@Example.COM '),true);
    assert.equal(await owner.setup(bootstrap,'different-password','another@example.com'),false);
    const saved=await readFile(join(directory,'owner.json'),'utf8');
    assert.ok(!saved.includes('long-test-password'));assert.ok(!saved.includes(bootstrap));
    assert.equal(JSON.parse(saved).email,email);
    const restarted=new Owner(directory);
    assert.equal(await restarted.verify('long-test-password',' OWNER@example.com '),true);
    assert.equal(await restarted.verify('wrong',email),false);
    assert.equal(await restarted.verify('long-test-password','another@example.com'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('concurrent setup requests cannot replace the first owner password',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-race-'));
  try{
    const owner=new Owner(directory);await owner.init();
    const token=(await owner.read()).bootstrap;
    const results=await Promise.all([owner.setup(token,'first-valid-password',email),owner.setup(token,'second-valid-password','another@example.com')]);
    assert.deepEqual(results,[true,false]);
    assert.equal(await owner.verify('first-valid-password',email),true);
    assert.equal(await owner.verify('second-valid-password','another@example.com'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('setup requires a plain email and rejected values leave the setup token usable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-email-'));
  try{
    const owner=new Owner(directory);await owner.init();
    const token=(await owner.read()).bootstrap;
    for(const invalid of [undefined,null,123,{},'', 'not-an-email','owner@example','owner@@example.com',
      'owner name@example.com','owner@example..com','owner@-example.com','owner@example-.com',
      '.owner@example.com','owner..name@example.com','owner@example.com\n','owner\u0000@example.com',
      'a'.repeat(65)+'@example.com','owner@'+'a'.repeat(64)+'.com',
      'a'.repeat(64)+'@'+'a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(60)+'.com']){
      await assert.rejects(owner.setup(token,'long-test-password',invalid),{status:400});
      assert.equal(await owner.configured(),false);
      assert.equal((await owner.read()).bootstrap,token);
    }
    assert.equal(await owner.setup(token,'long-test-password','owner+test@example.com'),true);
    assert.equal(await owner.verify('long-test-password','owner+test@example.com'),true);
    for(const invalid of [undefined,null,123,{},'','owner+test@example.com\n','invalid']){
      assert.equal(await owner.verify('long-test-password',invalid),false);
    }
    assert.equal(await owner.verify(undefined,'owner+test@example.com'),false);
    assert.equal(await owner.verify('x'.repeat(129),'owner+test@example.com'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('binding legacy owner email preserves the existing password hash and all saved fields',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-bind-'));
  try{
    const owner=new Owner(directory);
    const legacy={salt:'legacy-salt',password:scryptSync('legacy-valid-password','legacy-salt',64).toString('hex'),created:123456789,custom:{preserve:true}};
    await owner.save(legacy);
    assert.equal(await owner.configured(),true);
    assert.equal(await owner.verify('legacy-valid-password',email),false);
    await assert.rejects(owner.bindEmail('invalid'),{status:400});
    assert.deepEqual(await owner.read(),legacy);
    assert.equal(await owner.bindEmail(' Owner@Example.COM '),true);
    assert.deepEqual(await owner.read(),{...legacy,email});
    const saved=await readFile(owner.file,'utf8');
    assert.equal(await owner.bindEmail(' OWNER@EXAMPLE.COM '),true);
    assert.equal(await readFile(owner.file,'utf8'),saved);
    await assert.rejects(owner.bindEmail('another@example.com'),{status:409});
    assert.equal(await readFile(owner.file,'utf8'),saved);
    const restarted=new Owner(directory);
    assert.equal(await restarted.verify('legacy-valid-password',email),true);
    assert.equal(await restarted.verify('legacy-valid-password'),false);
    assert.equal(await restarted.verify('wrong',email),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('email binding is serialized and cannot overwrite an existing owner email',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-bind-race-'));
  try{
    const owner=new Owner(directory);
    await owner.save({salt:'legacy-salt',password:scryptSync('legacy-valid-password','legacy-salt',64).toString('hex'),created:123456789});
    const results=await Promise.allSettled([owner.bindEmail(email),owner.bindEmail('another@example.com')]);
    assert.equal(results[0].status,'fulfilled');
    assert.equal(results[0].value,true);
    assert.equal(results[1].status,'rejected');
    assert.equal(results[1].reason.status,409);
    assert.equal((await owner.read()).email,email);
    assert.equal(await owner.bindEmail(email),true);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('email cannot be bound before the owner password has been configured',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'factory-owner-bind-empty-'));
  try{
    const owner=new Owner(directory);
    await assert.rejects(owner.bindEmail(email),{status:409});
    await owner.init();
    const original=await owner.read();
    await assert.rejects(owner.bindEmail(email),{status:409});
    assert.deepEqual(await owner.read(),original);
  }finally{await rm(directory,{recursive:true,force:true});}
});
