import test from 'node:test';
import assert from 'node:assert/strict';
import {caribbeanOutcome,caribbeanBeforeReveal} from '../games/caribbean-treasures/presentation';
import {startCaribbean,moveCaribbean} from '../server/games/caribbeanTreasures';
test('feedback compares the full accepted cost, including a purchased series',()=>{
 const classify=(paid:string,cost='17804')=>caribbeanOutcome({costUnits:cost,totalPayoutUnits:paid});
 assert.equal(classify('0'),'loss');assert.equal(classify('1000'),'partial');assert.equal(classify('17804'),'return');assert.equal(classify('17805'),'win');assert.equal(classify('356080'),'bigwin');
 assert.equal(classify('900719925474099399','900719925474099400'),'partial');
});
test('staged cannon uses the exact server before-field and does not alter accepted data',()=>{
 const start=startCaribbean({lines:20,mode:'buy-raid'},'100',()=>0);
 const end=moveCaribbean(start.view,start.view.revision,'spin',()=>0),saved=JSON.stringify(end.view);
 assert(end.view.spins.at(-1)!.frame.cannon);
 const stage=caribbeanBeforeReveal(end.view,start.view),spin=stage.spins.at(-1)!;
 assert.equal(spin.frame.block!.size,2);assert.equal(end.view.spins.at(-1)!.frame.block!.size,3);
 assert.deepEqual(spin.frame.grid,end.view.spins.at(-1)!.frame.gridBefore);assert.deepEqual(spin.frame.wins,[]);assert.equal(stage.totalPayoutUnits,'0');
 stage.spins[0].frame.grid[0]=5;assert.equal(JSON.stringify(end.view),saved);
});
