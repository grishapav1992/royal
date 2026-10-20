import test from 'node:test';import assert from 'node:assert/strict';
import {locationIndex,RouteTransition,routeBlendSeconds,routeProfiles} from '../src/ui/lastExitRoute';

test('locations use the confirmed multiplier thresholds at 2x, 4x and 8x',()=>{
 for(const [value,expected]of [[1,0],[1.99,0],[2,1],[3.99,1],[4,2],[7.99,2],[8,3],[100,3],[NaN,0],[Infinity,0]])assert.equal(locationIndex(value),expected);
 assert.deepEqual(routeProfiles.map(p=>p.minimum),[1,2,4,8]);
});
test('crossfade keeps a normalized image and reaches the next environment smoothly',()=>{
 const route=new RouteTransition();route.update('a','racing',1,0);
 assert.deepEqual(route.update('a','racing',2,0).weights,[1,0,0,0]);
 const middle=route.update('a','racing',2,routeBlendSeconds/2);assert.deepEqual(middle.weights,[.5,.5,0,0]);
 const end=route.update('a','racing',2,routeBlendSeconds/2);assert.deepEqual(end.weights,[0,1,0,0]);assert.equal(end.key,'interchange');
});
test('interrupted transitions keep the exact current composition instead of snapping',()=>{
 const route=new RouteTransition();route.update('a','racing',1,0);const before=route.update('a','racing',2,.7);
 const interrupted=route.update('a','racing',8,0);assert.deepEqual(interrupted.weights,before.weights);
 for(let i=0;i<200;i++){const s=route.update('a','racing',8,.02);assert(Math.abs(s.weights.reduce((a,b)=>a+b,0)-1)<1e-12);assert(s.weights.every(w=>Number.isFinite(w)&&w>=0&&w<=1));}
 assert.deepEqual(route.inspect().weights,[0,0,0,1]);
});
test('settlement and delayed values keep the reached zone; a new round returns smoothly',()=>{
 const route=new RouteTransition();route.update('a','racing',4,0);route.update('a','racing',4,3);
 assert.equal(route.update('a','escaped',3.99,100).index,2);assert.equal(route.update('a','crashed',1.01,100).index,2);
 const previous=route.inspect().weights;assert.deepEqual(route.update('b','waiting',1,0).weights,previous);assert.equal(route.inspect().index,0);
 assert.deepEqual(route.update('b','racing',1,3).weights,[1,0,0,0]);
});
test('reduced motion switches directly and resuming does not replay an old blend',()=>{
 const route=new RouteTransition();route.update('a','racing',1,0);assert.deepEqual(route.update('a','racing',8,.01,true).weights,[0,0,0,1]);
 assert.deepEqual(route.update('a','racing',8,.01,false).weights,[0,0,0,1]);
});
