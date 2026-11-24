import test from 'node:test';import assert from 'node:assert/strict';
import {routePosition,zoneOf,zones} from '../games/last-exit/route';
test('each multiplier interval has its own location and exact transition edges',()=>{
 for(const [value,expected] of [[1,0],[1.99,0],[2,1],[3.99,1],[4,2],[7.99,2],[8,3],[100,3],[NaN,0],[Infinity,0]] as const)assert.equal(zoneOf(value),expected);
 assert.deepEqual(zones.map(z=>z.min),[1,2,4,8]);for(const z of zones){assert(z.ru&&z.en);assert.equal(z.props.length,2);assert(z.horizon>.4&&z.horizon<.6);}
});
test('the route strip rises with the multiplier and keeps both ends',()=>{
 assert.equal(routePosition(1),0);assert.equal(routePosition(100),100);assert.equal(routePosition(.5),0);assert.equal(routePosition(500),100);
 let previous=-1;for(let v=1;v<=100;v+=.25){const p=routePosition(v);assert(p>previous&&p>=0&&p<=100);previous=p;}
 assert.equal(Math.round(routePosition(2)),24);assert.equal(Math.round(routePosition(8)),72);
});
