import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pvpFixture } from './helpers/nile-pvp-fixture';
import { block } from './helpers/nile-play-fixture';
import { NileGameRuntime, type NativeCommand } from '../../server/finance/nile-game-runtime';
import { CARIBBEAN_GAME } from '../../src/shared/caribbeanTreasures';
import { validCaribbeanSession } from '../../src/shared/caribbeanTransport';
const command = (body:unknown = null):NativeCommand => ({
  path:'/expansion',caribbeanRules:1,body,method:body === null ? 'GET' : 'POST',flags:Array(9).fill(true),rules:2,query:{},
});
for (const mode of ['normal','buy-raid','buy-flagship'] as const)
  test('Caribbean ' + mode + ' uses the common Nile journal, reserves the accepted configuration and settles once',async () => {
    const c = await pvpFixture();
    try {
      await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(address => address.userId === 'reserve')!.address));
      await c.ledger.sync(c.source,await c.reconciliation());
      let draws = 0, games = new NileGameRuntime(c.ledger,() => { draws++; return 0; });
      const op = {id:randomUUID(),action:'start',gameId:CARIBBEAN_GAME,stakeUnits:'100',
        settings:{caribbean:{lines:1,mode}}};
      const before = BigInt((await c.ledger.wallet(c.a) as any).balanceUnits);
      await assert.rejects(games.run(c.a,{...command(op),caribbeanRules:0}));assert.equal(draws,0);
      let reply:any = await games.run(c.a,command(op));
      assert(validCaribbeanSession(reply.session));
      const spent = BigInt(reply.session.spentUnits) * 10000n;
      assert.equal(BigInt(reply.wallet.balanceUnits),before - spent);
      const maximum = mode === 'normal' ? 15000n : mode === 'buy-raid' ? 14000n : 6000n;
      assert.equal(BigInt(reply.wallet.reservedUnits),100n * maximum * 10000n);
      const startDraws = draws;
      const retry:any = await games.run(c.a,command(op));
      assert(retry.replayed); assert.equal(draws,startDraws);
      assert.equal(retry.wallet.balanceUnits,reply.wallet.balanceUnits);
      const older:any=await games.run(c.a,{...command(),caribbeanRules:0});assert.equal(older.sessions.some((s:any)=>s.gameId===CARIBBEAN_GAME),false);
      games = new NileGameRuntime(c.ledger,() => { draws++; return 0; });
      const recovered:any = await games.run(c.a,command());
      assert.deepEqual(recovered.sessions.find((session:any) => session.id === op.id),reply.session);
      let last:unknown = op;
      while (reply.session.state === 'active') {
        const view = reply.session.view.caribbean;
        last = {id:randomUUID(),action:'move',gameId:CARIBBEAN_GAME,sessionId:op.id,
          move:view.phase === 'choice' ? 'caribbean-choose-raid' : 'caribbean-spin',revision:view.revision};
        reply = await games.run(c.a,command(last));
        assert(validCaribbeanSession(reply.session));
        if (reply.session.state === 'active') assert.equal(BigInt(reply.wallet.balanceUnits),before - spent);
      }
      const expected = before - spent + BigInt(reply.session.returnedUnits) * 10000n;
      assert.equal(BigInt(reply.wallet.balanceUnits),expected); assert.equal(reply.wallet.reservedUnits,'0');
      const endDraws = draws;
      const repeated:any = await games.run(c.a,command(last));
      assert(repeated.replayed); assert.equal(draws,endDraws); assert.equal(BigInt(repeated.wallet.balanceUnits),expected);
      await assert.rejects(games.run(c.b,command({...last as object,id:randomUUID()})));
      assert.equal(BigInt((await c.ledger.wallet(c.a) as any).balanceUnits),expected);
      await c.ledger.audit();
    } finally { await c.close(); }
  });
