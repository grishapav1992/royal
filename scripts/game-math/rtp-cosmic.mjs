// Cosmic qualification: exact uncapped expectation and deterministic capped RTP bounds.
// Column probabilities, Jensen bounds and settlement are independently checked against the server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const COSMIC_QUALIFICATION_METHOD = 'bounded-analytical-cosmic';
// Reviewed 2026-10-31: the original 26-stake model, probabilities and consumed-draw paths are unchanged.
// The opt-in final-cent policy restores fractions after the historical transcript is validated.
export const COSMIC_QUALIFICATION_MODEL = {
  "reviewedSourceSha256": {
    "server/games/luelonSlots.ts": "be78b2715aa850d3801445edf0f714b89dcb76ed98719e5589fcac71dc7fe3f2",
    "src/shared/luelonSlots.ts": "1867b3f6e7e3fbc1e00dd6fad2bb094c42e6038f8eba18e0ef7250381f95cdcb",
    "src/shared/luelonSlotsLines.ts": "cc9e2528bae03e8965c154f82aa271b3c9976bb3d817130ba51dedf6e8eb67ee",
    "src/shared/luelonSlotsModels.ts": "b8644fecff250437909ff88950c5ef129c1d534108344f9643b815614d844c74",
    "src/shared/cosmicEscapeBets.ts": "a810b0f394e290eae0ccbf2f1745ada20f280bb08bd176eb534d0390871f99c7"
  },
  "gameId": "studio-cosmic-escape",
  "rulesVersion": 2,
  "progressVersion": 1,
  "mathProfileVersion": 3,
  "entryPerMillion": 14332,
  "target": 0.96,
  "tolerance": 0.002,
  "stakes": [
    20,
    40,
    60,
    80,
    100,
    200,
    300,
    400,
    500,
    600,
    800,
    1000,
    1500,
    2000,
    3000,
    5000,
    7500,
    10000,
    15000,
    20000,
    30000,
    50000,
    75000,
    100000,
    150000,
    200000
  ],
  "profiles": {
    "cosmicEntryPerMillion": 14332,
    "cosmicBeamPerThousand": {
      "cosmic-chaos": 224,
      "ufo-invasion": 170,
      "deep-echo": 287
    },
    "cosmicBeamAttempts": {
      "cosmic-chaos": 1,
      "ufo-invasion": 2,
      "deep-echo": 1
    },
    "cosmicEchoPerHundred": {
      "cosmic-chaos": 3,
      "ufo-invasion": 3,
      "deep-echo": 6
    }
  },
  "rule": {
    "ordinary": 7,
    "wild": 7,
    "scatter": 8,
    "bonusLimit": 15,
    "trigger": 3,
    "retrigger": 0,
    "retriggerSpins": 0,
    "info": {
      "id": "studio-cosmic-escape",
      "cols": 5,
      "rows": 3,
      "maxWin": 10000,
      "paylines": [
        [
          0,
          0,
          0,
          0,
          0
        ],
        [
          1,
          1,
          1,
          1,
          1
        ],
        [
          2,
          2,
          2,
          2,
          2
        ],
        [
          0,
          1,
          2,
          1,
          0
        ],
        [
          2,
          1,
          0,
          1,
          2
        ],
        [
          0,
          0,
          1,
          0,
          0
        ],
        [
          2,
          2,
          1,
          2,
          2
        ],
        [
          1,
          1,
          0,
          1,
          1
        ],
        [
          1,
          1,
          2,
          1,
          1
        ],
        [
          0,
          1,
          1,
          1,
          0
        ],
        [
          2,
          1,
          1,
          1,
          2
        ],
        [
          1,
          0,
          0,
          0,
          1
        ],
        [
          1,
          2,
          2,
          2,
          1
        ],
        [
          0,
          1,
          0,
          1,
          0
        ],
        [
          2,
          1,
          2,
          1,
          2
        ],
        [
          1,
          0,
          1,
          0,
          1
        ],
        [
          1,
          2,
          1,
          2,
          1
        ],
        [
          0,
          2,
          1,
          2,
          0
        ],
        [
          2,
          0,
          1,
          0,
          2
        ],
        [
          0,
          2,
          2,
          2,
          0
        ]
      ],
      "symbols": [
        {
          "id": 0,
          "role": "ordinary",
          "pays": {
            "3": 120,
            "4": 480,
            "5": 2000
          }
        },
        {
          "id": 1,
          "role": "ordinary",
          "pays": {
            "3": 95,
            "4": 360,
            "5": 1440
          }
        },
        {
          "id": 2,
          "role": "ordinary",
          "pays": {
            "3": 80,
            "4": 280,
            "5": 1120
          }
        },
        {
          "id": 3,
          "role": "ordinary",
          "pays": {
            "3": 55,
            "4": 200,
            "5": 800
          }
        },
        {
          "id": 4,
          "role": "ordinary",
          "pays": {
            "3": 50,
            "4": 160,
            "5": 640
          }
        },
        {
          "id": 5,
          "role": "ordinary",
          "pays": {
            "3": 30,
            "4": 120,
            "5": 480
          }
        },
        {
          "id": 6,
          "role": "ordinary",
          "pays": {
            "3": 25,
            "4": 80,
            "5": 320
          }
        },
        {
          "id": 7,
          "role": "wild",
          "pays": {
            "3": 200,
            "4": 800,
            "5": 4000
          }
        },
        {
          "id": 8,
          "role": "scatter",
          "pays": {}
        }
      ],
      "modes": [
        {
          "id": "normal",
          "cost": 1,
          "bonus": null,
          "spins": 0,
          "startMultiplier": 1
        },
        {
          "id": "cosmic-chaos",
          "cost": 40,
          "bonus": "cosmic-chaos",
          "spins": 10,
          "startMultiplier": 1
        },
        {
          "id": "ufo-invasion",
          "cost": 75,
          "bonus": "ufo-invasion",
          "spins": 12,
          "startMultiplier": 1
        },
        {
          "id": "deep-echo",
          "cost": 135,
          "bonus": "deep-echo",
          "spins": 15,
          "startMultiplier": 3
        }
      ]
    }
  }
};
const game=COSMIC_QUALIFICATION_MODEL.gameId, rule=COSMIC_QUALIFICATION_MODEL.rule, info=rule.info;
const COSMIC_MATH_PROFILE_VERSION=COSMIC_QUALIFICATION_MODEL.mathProfileVersion;
const COSMIC_MATH_ENTRY_PER_MILLION={3:COSMIC_QUALIFICATION_MODEL.entryPerMillion};
const COSMIC_MATH_TARGET_RTP=COSMIC_QUALIFICATION_MODEL.target, COSMIC_MATH_RTP_TOLERANCE=COSMIC_QUALIFICATION_MODEL.tolerance;
const LUELON_SLOT_PROFILES=COSMIC_QUALIFICATION_MODEL.profiles, COSMIC_ESCAPE_BET_UNITS=COSMIC_QUALIFICATION_MODEL.stakes.map(String);
let startLuelonSlotGame,moveLuelonSlotGame,luelonSlotLineWins;
function seededRandom(seed){let state=seed>>>0;return()=>{state=(state+0x6d2b79f5)>>>0;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
function fraction(n, d = 1n) { n = BigInt(n); d = BigInt(d); assert(d !== 0n); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a, b) => fraction(a.n * b.n, a.d * b.d);
const number = a => Number(a.n) / Number(a.d);
const exact = a => ({ numerator: String(a.n), denominator: String(a.d), value: number(a) });
const choose = (n, k) => k < 0 || k > n ? 0 : k === 0 ? 1 : choose(n - 1, k - 1) * n / k;
const zero = () => fraction(0);
const sum = values => values.reduce(add, zero());
const popcount = mask => mask.toString(2).replaceAll('0', '').length;

// A WILD prefix can win on its own, even when an ordinary symbol extends farther.
// All ordinary prefix pays are below the WILD pay for the same length.
for (const count of [3, 4, 5]) for (let symbol = 0; symbol < rule.ordinary; symbol++) assert(info.symbols[symbol].pays[count] <= info.symbols[rule.wild].pays[count]);
function score(line) {
  let wildPrefix = 0;
  while (line[wildPrefix] === rule.wild && wildPrefix < 5) wildPrefix++;
  let best = wildPrefix >= 3 ? { symbol: rule.wild, count: wildPrefix, pay: info.symbols[rule.wild].pays[wildPrefix] } : { symbol: -1, count: 0, pay: 0 };
  const ordinary = line[wildPrefix];
  if (wildPrefix < 5 && ordinary < rule.ordinary) {
    let count = wildPrefix;
    while (count < 5 && (line[count] === ordinary || line[count] === rule.wild)) count++;
    const pay = info.symbols[ordinary].pays[count] ?? 0;
    if (pay > best.pay) best = { symbol: ordinary, count, pay };
  }
  return best;
}

let scorerChecks = 0, shorterWildPrefixWins = 0;
const scoreCache = new Uint32Array(9 ** 5), allPays = new Set([0]);
function enumerate(callback, fixedMask = 0, weights = Array(9).fill(1n)) {
  const line = Array(5).fill(0);
  function visit(col, weight, code) {
    if (col === 5) { callback(line, weight, code); return; }
    if (fixedMask & (1 << col)) { line[col] = rule.wild; visit(col + 1, weight, code * 9 + rule.wild); return; }
    for (let symbol = 0; symbol < 9; symbol++) if (weights[symbol]) { line[col] = symbol; visit(col + 1, weight * weights[symbol], code * 9 + symbol); }
  }
  visit(0, 1n, 0);
}
enumerate((line,_weight,code)=>{const independent=score(line);scoreCache[code]=independent.pay;assert.equal(scoreCache[code],independent.pay);allPays.add(independent.pay);if(independent.symbol===rule.wild&&independent.count<5&&line[independent.count]<rule.ordinary)shorterWildPrefixWins++;scorerChecks++;});

function computeCosmicAnalysis(){
const settlementDivisibility = COSMIC_ESCAPE_BET_UNITS.every(stake => [...allPays].every(pay => Array.from({ length: 50 }, (_, i) => i + 1).every(multiplier => BigInt(stake) * BigInt(pay) * BigInt(multiplier) % 100n === 0n)));
assert(settlementDivisibility, 'Stake normalization needs separate flooring calculations');

// Raw free-spin line probabilities have integer weights on a common denominator.
// A scatter replaces a given line cell with probability 8/1000 * 1/3.
const freeDenominator = 262500n, freeWeights = [...Array(7).fill(36652n), 5236n, 700n];
assert.equal(freeWeights.reduce((a, b) => a + b), freeDenominator);
const freeMaskMeans = new Map(), freeMaskMoments = new Map(), momentOrder = 8;
for (let mask = 0; mask < 32; mask++) if (popcount(mask) <= 2) {
  let totalWeight = 0n, payWeight = 0n;
  const moments = Array(momentOrder + 1).fill(0n);
  enumerate((_line, weight, code) => { totalWeight += weight; const pay = BigInt(scoreCache[code]); payWeight += weight * pay; let power = 1n; for (let k = 0; k <= momentOrder; k++) { moments[k] += weight * power; power *= pay; } }, mask, freeWeights);
  const denominator = freeDenominator ** BigInt(5 - popcount(mask));
  assert.equal(totalWeight, denominator);
  freeMaskMeans.set(mask, fraction(payWeight, denominator));
  freeMaskMoments.set(mask, moments.map((n, k) => fraction(n, denominator * 100n ** BigInt(k))));
}

function beamDistribution(mode) {
  const chance = LUELON_SLOT_PROFILES.cosmicBeamPerThousand[mode], attempts = LUELON_SLOT_PROFILES.cosmicBeamAttempts[mode];
  let distribution = new Map([[0, 1n]]);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const next = new Map();
    const append = (mask, weight) => next.set(mask, (next.get(mask) ?? 0n) + weight);
    for (const [mask, weight] of distribution) {
      append(mask, weight * BigInt(5 * (1000 - chance)));
      for (let col = 0; col < 5; col++) append(mask | (1 << col), weight * BigInt(chance));
    }
    distribution = next;
  }
  const denominator = 5000n ** BigInt(attempts);
  assert.equal([...distribution.values()].reduce((a, b) => a + b), denominator);
  return [...distribution].map(([mask, weight]) => ({ mask, probability: fraction(weight, denominator) }));
}
const frameMeans = Object.fromEntries(info.modes.filter(mode => mode.bonus).map(mode => {
  const meanLineHundredths = sum(beamDistribution(mode.id).map(({ mask, probability }) => mul(freeMaskMeans.get(mask), probability)));
  return [mode.id, mul(meanLineHundredths, fraction(20, 100))];
}));

// All operations in the upper moment bound round outward to the next positive float.
// The exact rational input is compared with the float's exact binary fraction.
const floatBuffer = new ArrayBuffer(8), floatView = new DataView(floatBuffer);
function nextUp(value) { if (value === 0) return Number.MIN_VALUE; assert(value > 0 && Number.isFinite(value)); floatView.setFloat64(0, value); floatView.setBigUint64(0, floatView.getBigUint64(0) + 1n); return floatView.getFloat64(0); }
function nextDown(value) { if (!value) return -Number.MIN_VALUE; assert(value > 0 && Number.isFinite(value)); floatView.setFloat64(0, value); floatView.setBigUint64(0, floatView.getBigUint64(0) - 1n); return floatView.getFloat64(0); }
function floatFraction(value) { if (!value) return fraction(0); floatView.setFloat64(0, value); const bits = floatView.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n) - 1023 - 52, mantissa = (bits & ((1n << 52n) - 1n)) + (1n << 52n); return exponent >= 0 ? fraction(mantissa << BigInt(exponent)) : fraction(mantissa, 1n << BigInt(-exponent)); }
function upper(a) { let value = number(a); while (true) { const represented = floatFraction(value); if (represented.n * a.d >= a.n * represented.d) return value; value = nextUp(value); } }
function lower(a) { let value = number(a); while (true) { const represented = floatFraction(value); if (represented.n * a.d <= a.n * represented.d) return value; value = nextDown(value); } }
const plus = (a, b) => a === 0 ? b : b === 0 ? a : nextUp(a + b);
const times = (a, b) => a === 0 || b === 0 ? 0 : nextUp(a * b);
const powerUpper = (a, k) => { let value = 1; for (let i = 0; i < k; i++) value = times(value, a); return value; };
const columnDen = 46875000n, columns = [];
for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) for (let c = 0; c < 9; c++) {
  const values = [a,b,c], scatters = values.filter(x => x === 8).length;
  if (scatters > 1) continue;
  const ordinary = values.filter(x => x < 7).length;
  columns.push({values, weight: (scatters ? 50n : 372n) * 7n ** BigInt(ordinary)});
}
assert.equal(columns.length,704);
assert.equal(columns.reduce((s,c)=>s+c.weight,0n),columnDen);
const fixedColumn = [{values:[7,7,7],weight:1n}];
const coefficientGroups = [], coefficientDen = [];
const prefixMaximum=Array.from({length:81},(_,prefix)=>{const a=Math.floor(prefix/9),b=prefix%9;if(a===8||b===8||a!==7&&b!==7&&a!==b)return 0;if(a===7&&b===7)return 4000;return info.symbols[a===7?b:a].pays[5];});
const actualPrefixMaximum2=Array(81).fill(0),actualPrefixMaximum3=Array(729).fill(0);
for(let code=0;code<scoreCache.length;code++){const prefix2=Math.floor(code/729),prefix3=Math.floor(code/81);actualPrefixMaximum2[prefix2]=Math.max(actualPrefixMaximum2[prefix2],scoreCache[code]);actualPrefixMaximum3[prefix3]=Math.max(actualPrefixMaximum3[prefix3],scoreCache[code]);}
assert.deepEqual(prefixMaximum,actualPrefixMaximum2,'Unsupported maximum payment after a two-column prefix');
const maximumLCM=prefixMaximum.filter(Boolean).map(BigInt).reduce((a,b)=>a/gcd(a,b)*b,1n);
for(let mask=0;mask<4;mask++) {
  const grouped=new Map();
  const first=mask&1?fixedColumn:columns, second=mask&2?fixedColumn:columns;
  const histogram=new Uint8Array(81), pairs=[];
  for(const a of first)for(const b of second) {
    histogram.fill(0);pairs.length=0;let active=0,totalMaximum=0;
    for(const rows of info.paylines) {
      const x=a.values[rows[0]], y=b.values[rows[1]];
      if(x===8||y===8||x!==7&&y!==7&&x!==y)continue;
      const pair=x*9+y;if(!histogram[pair])pairs.push(pair);histogram[pair]++;active++;totalMaximum+=prefixMaximum[pair];
    }
    if(!active)continue;
    const weight=a.weight*b.weight;
    if(!grouped.has(totalMaximum))grouped.set(totalMaximum,Array(81).fill(0n));
    const target=grouped.get(totalMaximum);for(const pair of pairs)target[pair]+=weight*BigInt(histogram[pair]);
  }
  coefficientDen.push(columnDen**BigInt(2-popcount(mask)));
  coefficientGroups.push(grouped);
}
const suffixMoments=[];
for(let suffixMask=0;suffixMask<8;suffixMask++) {
  const rows=[];
  for(let prefix=0;prefix<81;prefix++) {
    const moments=Array(momentOrder+1).fill(0n);
    function walk(col,code,weight) {
      if(col===3) {
        const pay=BigInt(scoreCache[prefix*729+code]);let power=pay;
        for(let k=1;k<=momentOrder;k++){moments[k]+=weight*power;power*=pay;}
        return;
      }
      if(suffixMask&(1<<col)){walk(col+1,code*9+7,weight);return;}
      for(let symbol=0;symbol<9;symbol++)walk(col+1,code*9+symbol,weight*freeWeights[symbol]);
    }
    walk(0,0,1n);rows.push(moments);
  }
  suffixMoments.push(rows);
}
const conditionalBoard=[];
for(let mask=0;mask<32;mask++)if(popcount(mask)<=2) {
  const prefixMask=mask&3,suffixMask=mask>>2,grouped=coefficientGroups[prefixMask];
  const moments=[fraction(1)];
  for(let k=1;k<=momentOrder;k++) {
    let numerator=0n;
    for(const [totalMaximum,group]of grouped) {
      let contribution=0n;
      for(let prefix=0;prefix<81;prefix++)if(group[prefix])contribution+=group[prefix]*suffixMoments[suffixMask][prefix][k]*(maximumLCM/BigInt(prefixMaximum[prefix]))**BigInt(k-1);
      numerator+=BigInt(totalMaximum)**BigInt(k-1)*contribution;
    }
    moments.push(fraction(numerator,coefficientDen[prefixMask]*freeDenominator**BigInt(3-popcount(suffixMask))*100n**BigInt(k)*maximumLCM**BigInt(k-1)));
  }
  conditionalBoard[mask]=moments;
}
const prefix3Maximum=Array.from({length:729},(_,prefix)=>{
  const values=[Math.floor(prefix/81),Math.floor(prefix/9)%9,prefix%9];
  if(values.includes(8))return 0;
  const ordinary=values.find(x=>x!==7);
  if(ordinary===undefined)return 4000;
  return values.every(x=>x===7||x===ordinary)?info.symbols[ordinary].pays[5]:0;
});
assert.deepEqual(prefix3Maximum,actualPrefixMaximum3,'Unsupported maximum payment after a three-column prefix');
const thirdGroups=[],thirdDen=[];
for(let mask=1;mask<8;mask++) {
  const grouped=new Map(),sets=[0,1,2].map(col=>mask&(1<<col)?fixedColumn:columns),histogram=new Uint8Array(729),pairs=[];
  for(const a of sets[0])for(const b of sets[1])for(const c of sets[2]) {
    histogram.fill(0);pairs.length=0;let totalMaximum=0;
    for(const rows of info.paylines) {
      const prefix=a.values[rows[0]]*81+b.values[rows[1]]*9+c.values[rows[2]],maximum=prefix3Maximum[prefix];
      if(!maximum)continue;
      if(!histogram[prefix])pairs.push(prefix);histogram[prefix]++;totalMaximum+=maximum;
    }
    if(!totalMaximum)continue;
    const weight=a.weight*b.weight*c.weight;
    if(!grouped.has(totalMaximum))grouped.set(totalMaximum,new Map());
    const target=grouped.get(totalMaximum);for(const prefix of pairs)target.set(prefix,(target.get(prefix)??0n)+weight*BigInt(histogram[prefix]));
  }
  thirdGroups[mask]=grouped;thirdDen[mask]=columnDen**BigInt(3-popcount(mask));
}
const last2Moments=[];
for(let suffixMask=0;suffixMask<4;suffixMask++) {
  const rows=[];
  for(let prefix=0;prefix<729;prefix++) {
    const moments=Array(momentOrder+1).fill(0n);
    if(prefix3Maximum[prefix]){
      function walk(col,code,weight) {
        if(col===2){const pay=BigInt(scoreCache[prefix*81+code]);let power=pay;for(let k=1;k<=momentOrder;k++){moments[k]+=weight*power;power*=pay;}return;}
        if(suffixMask&(1<<col)){walk(col+1,code*9+7,weight);return;}
        for(let symbol=0;symbol<9;symbol++)walk(col+1,code*9+symbol,weight*freeWeights[symbol]);
      }
      walk(0,0,1n);
    }
    rows.push(moments);
  }
  last2Moments.push(rows);
}
for(let mask=0;mask<32;mask++)if(popcount(mask)<=2&&(mask&7)) {
  const prefixMask=mask&7,suffixMask=mask>>3,grouped=thirdGroups[prefixMask];
  for(let k=1;k<=momentOrder;k++) {
    let numerator=0n;
    for(const [totalMaximum,group]of grouped) {
      let contribution=0n;
      for(const [prefix,coefficient]of group)contribution+=coefficient*last2Moments[suffixMask][prefix][k]*(maximumLCM/BigInt(prefix3Maximum[prefix]))**BigInt(k-1);
      numerator+=BigInt(totalMaximum)**BigInt(k-1)*contribution;
    }
    const moment=fraction(numerator,thirdDen[prefixMask]*freeDenominator**BigInt(2-popcount(suffixMask))*100n**BigInt(k)*maximumLCM**BigInt(k-1));
    if(moment.n*conditionalBoard[mask][k].d<conditionalBoard[mask][k].n*moment.d)conditionalBoard[mask][k]=moment;
  }
}

const boardMomentBounds=Object.fromEntries(info.modes.filter(mode=>mode.bonus).map(mode=>{
  const distribution=beamDistribution(mode.id);
  const moments=Array.from({length:momentOrder+1},(_,k)=>sum(distribution.map(({mask,probability})=>mul(conditionalBoard[mask][k],probability))));
  assert.equal(moments[1].n*frameMeans[mode.id].d,frameMeans[mode.id].n*moments[1].d);
  return[mode.id,moments.map(upper)];
}));


// Exact distribution of persistent capped energy after every first free-spin frame.
const transitions = [[0, 3000], [1, 800], [2, 100], [3, 50], [5, 30], [10, 15], [25, 4], [50, 1]];
assert.equal(transitions.reduce((s, row) => s + row[1], 0), 4000);
function energy(start, spins) {
  let counts = Array(51).fill(0n); counts[start] = 1n;
  let denominator = 1n;
  const means = [], atLimit = [];
  for (let spin = 1; spin <= spins; spin++) {
    const next = Array(51).fill(0n);
    for (let multiplier = 1; multiplier <= 50; multiplier++) if (counts[multiplier]) for (const [increment, weight] of transitions) next[Math.min(50, multiplier + increment)] += counts[multiplier] * BigInt(weight);
    counts = next; denominator *= 4000n;
    assert.equal(counts.reduce((a, b) => a + b), denominator);
    means.push(fraction(counts.reduce((s, count, multiplier) => s + count * BigInt(multiplier), 0n), denominator));
    atLimit.push(fraction(counts[50], denominator));
  }
  return { means, atLimit, total: sum(means) };
}
function campaign(mode, spins, start) {
  const chain = energy(start, spins), echo = fraction(100 + LUELON_SLOT_PROFILES.cosmicEchoPerHundred[mode], 100);
  return { mean: mul(mul(frameMeans[mode], echo), chain.total), chain };
}

// Conditional base boards have K distinct scatter columns and one random row in each.
// For a fixed set of q scatter line cells, this is its exact joint probability.
const baseMeanByCount = [];
for (let count = 0; count <= 5; count++) {
  const denominator = 7000n ** 5n * BigInt(choose(5, count)) * 3n ** BigInt(count);
  let totalWeight = 0n, payWeight = 0n;
  enumerate((line, _weight, code) => {
    const q = line.filter(symbol => symbol === rule.scatter).length;
    if (q > count) return;
    let weight = 7000n ** BigInt(q) * BigInt(choose(5 - q, count - q)) * 2n ** BigInt(count - q);
    for (const symbol of line) if (symbol !== rule.scatter) weight *= symbol === rule.wild ? 21n : 997n;
    totalWeight += weight; payWeight += weight * BigInt(scoreCache[code]);
  });
  assert.equal(totalWeight, denominator);
  baseMeanByCount.push(mul(fraction(payWeight, denominator), fraction(20, 100)));
}
const entry = fraction(COSMIC_MATH_ENTRY_PER_MILLION[COSMIC_MATH_PROFILE_VERSION], 1000000);
const nonEntry = fraction(entry.d - entry.n, entry.d);
const countWeights = [mul(nonEntry, fraction(1, 3)), mul(nonEntry, fraction(1, 3)), mul(nonEntry, fraction(1, 3)), mul(entry, fraction(80, 100)), mul(entry, fraction(15, 100)), mul(entry, fraction(5, 100))];
const countMass = sum(countWeights); assert.equal(countMass.n, countMass.d);
const baseContribution = sum(baseMeanByCount.map((mean, count) => mul(mean, countWeights[count])));
const naturalCampaigns = [10, 12, 15].map(spins => ({ spins, ...campaign('cosmic-chaos', spins, 1) }));
const naturalBonusConditional = sum(naturalCampaigns.map((row, index) => mul(row.mean, [fraction(80, 100), fraction(15, 100), fraction(5, 100)][index])));
const naturalBonusContribution = mul(entry, naturalBonusConditional);
const modes = info.modes.map(mode => {
  const bonus = mode.bonus ? campaign(mode.id, mode.spins, mode.startMultiplier) : null;
  const expectation = bonus ? bonus.mean : add(baseContribution, naturalBonusContribution);
  const rtp = mul(expectation, fraction(1, mode.cost));
  return { id: mode.id, costInStakes: mode.cost, spins: mode.spins, startMultiplier: mode.startMultiplier, uncappedExpectedPayoutInStakes: exact(expectation), uncappedRtp: exact(rtp), uncappedRtpOutward: [lower(rtp), upper(rtp)], deviationFromTarget: number(rtp) - COSMIC_MATH_TARGET_RTP,
    energyMeanBySpin: bonus ? bonus.chain.means.map(exact) : null, energyAt50BySpin: bonus ? bonus.chain.atLimit.map(exact) : null };
});

function capLossBound(mode, spins, start, cap = 10000) {
  const board = boardMomentBounds[mode], echoNumerator = LUELON_SLOT_PROFILES.cosmicEchoPerHundred[mode];
  const echo = upper(fraction(echoNumerator, 100)), noEcho = upper(fraction(100 - echoNumerator, 100));
  const spinMoments = Array.from({ length: 51 }, (_, multiplier) => Array.from({ length: momentOrder + 1 }, (_, k) => {
    if (!k) return 1;
    let twoFrames = 0;
    for (let j = 0; j <= k; j++) twoFrames = plus(twoFrames, times(choose(k, j), times(board[j], board[k - j])));
    return times(powerUpper(multiplier, k), plus(times(noEcho, board[k]), times(echo, twoFrames)));
  }));
  let moments = Array.from({ length: 51 }, () => Array(momentOrder + 1).fill(0)); moments[start][0] = 1;
  for (let spin = 0; spin < spins; spin++) {
    const next = Array.from({ length: 51 }, () => Array(momentOrder + 1).fill(0));
    for (let before = 1; before <= 50; before++) if (moments[before][0]) for (const [increment, weight] of transitions) {
      const after = Math.min(50, before + increment), probability = upper(fraction(weight, 4000));
      for (let k = 0; k <= momentOrder; k++) {
        let sum = 0;
        for (let j = 0; j <= k; j++) sum = plus(sum, times(choose(k, j), times(moments[before][k - j], spinMoments[after][j])));
        next[after][k] = plus(next[after][k], times(probability, sum));
      }
    }
    moments = next;
  }
  const bounds=[]; let bestUpperInStakes=0; const byTerminalEnergy=[];
  for(let terminalEnergy=1;terminalEnergy<=50;terminalEnergy++){
    if(!moments[terminalEnergy][0])continue;
    const stateBounds=[];
    for(let k=2;k<=momentOrder;k++){
      const coefficient=upper(fraction(BigInt(k-1)**BigInt(k-1),BigInt(k)**BigInt(k)*BigInt(cap)**BigInt(k-1)));
      stateBounds.push({momentOrder:k,capLossUpperInStakes:times(moments[terminalEnergy][k],coefficient)});
    }
    const stateBest=Math.min(...stateBounds.map(row=>row.capLossUpperInStakes));
    bestUpperInStakes=plus(bestUpperInStakes,stateBest);byTerminalEnergy.push({terminalEnergy,stateBest,stateBounds});
  }
  return{mode,spins,start,cap,bounds:[{momentOrder:'statewise',capLossUpperInStakes:bestUpperInStakes}],byTerminalEnergy,bestUpperInStakes};
}
const capBounds = info.modes.filter(mode => mode.bonus).map(mode => capLossBound(mode.id, mode.spins, mode.startMultiplier));
const naturalBounds = [10, 12, 15].map(spins => capLossBound('cosmic-chaos', spins, 1, 9200));
const naturalLossUpper = times(upper(entry), naturalBounds.reduce((value, bound, index) => plus(value, times(upper([fraction(80, 100), fraction(15, 100), fraction(5, 100)][index]), bound.bestUpperInStakes)), 0));
for (const mode of modes) {
  const loss = mode.id === 'normal' ? naturalLossUpper : capBounds.find(row => row.mode === mode.id).bestUpperInStakes;
  const lossRtpUpper = times(loss, upper(fraction(1, mode.costInStakes)));
  const conservativeLower = nextDown(mode.uncappedRtpOutward[0] - lossRtpUpper);
  mode.capLossUpperInStakes = loss;
  mode.cappedRtpBound = [conservativeLower, mode.uncappedRtpOutward[1]];
}


return {method:COSMIC_QUALIFICATION_METHOD, mathProfileVersion:COSMIC_MATH_PROFILE_VERSION, target:COSMIC_MATH_TARGET_RTP,tolerance:COSMIC_MATH_RTP_TOLERANCE,scorerStrings:scorerChecks,shorterWildPrefixWins,integerSettlementForEveryCombination:settlementDivisibility,boardMomentUpper:boardMomentBounds,base:{entryProbability:exact(entry),contribution:exact(baseContribution),bonusConditionalMean:exact(naturalBonusConditional),bonusContribution:exact(naturalBonusContribution)},capBounds,naturalCapBounds:naturalBounds,modes,derivation:{uncapped:'Exact rational single-line distribution, beam masks, base scatter mixture, echo and 50-state energy chain.',boardMoments:'Exact joint raw column weights: 704 vectors on denominator 46875000. Conditional weighted Jensen with A_line=max possible pay from prefix, T=sum A_line, E[board^k|prefix]<=T^(k-1)*sum(E[line^k|prefix]/A_line^(k-1)). Prefix 2 always, prefix 3 when it contains at least one beam, then exact rational minimum per moment.',capLoss:'Joint reward moments with terminal energy indicator. Apply polynomial stop-loss bounds per terminal state, select minimum orders 2..8 in each state, then sum with outward floating arithmetic.',coupling:'Every line reward is nonnegative. Actual capped complete round pays min(latent uncapped complete round, 10000 base stakes), including all free continuations and echo. Normal base payout is at most 800 base stakes.',stakes:'All 26 allowed stakes are divisible by 20; all line coefficients divisible by 5. Integer multipliers imply exact per-line settlement at every stake and pointwise identical normalized capped outcomes.'},qualification:'All complete paid-round RTP bounds are inside the unchanged 96% plus/minus 0.2 percentage-point target. These are deterministic bounds, not confidence intervals or an exact point estimate of capped RTP.'};
}
function drawStream(seed, forcedCount) {
  const random = seededRandom(seed); let calls = 0;
  return max => {
    let value = Math.floor(random() * max);
    if (forcedCount !== undefined && calls === 30) { assert.equal(max, 1000000); value = forcedCount ? 0 : 999999; }
    if (forcedCount && calls === 31) { assert.equal(max, 100); value = forcedCount === 5 ? 0 : forcedCount === 4 ? 10 : 99; }
    calls++; return value;
  };
}
function shadowRound(mode, stake, draw) {
  const cap = BigInt(stake) * 10000n, spins = [];
  let multiplier = mode.startMultiplier, total = 0n, remaining = mode.spins;
  function board(free) {
    const grid = Array.from({ length: 15 }, () => draw(7));
    for (let cell = 0; cell < 15; cell++) if (draw(1000) < (free ? 20 : 3)) grid[cell] = 7;
    if (free) { for (let col = 0; col < 5; col++) if (draw(1000) < 8) grid[draw(3) * 5 + col] = 8; }
    else {
      const trigger = draw(1000000) < COSMIC_MATH_ENTRY_PER_MILLION[COSMIC_MATH_PROFILE_VERSION], roll = trigger ? draw(100) : 0;
      const count = trigger ? roll < 5 ? 5 : roll < 20 ? 4 : 3 : draw(3), pool = [0, 1, 2, 3, 4];
      for (let n = 0; n < count; n++) { const col = pool.splice(draw(pool.length), 1)[0]; grid[draw(3) * 5 + col] = 8; }
    }
    return grid;
  }
  function frame(raw, free, id, echo) {
    const grid = [...raw], beamColumns = [];
    if (free) {
      if (!echo && draw(100) < 25) {
        const roll = draw(1000), increment = roll < 800 ? 1 : roll < 900 ? 2 : roll < 950 ? 3 : roll < 980 ? 5 : roll < 995 ? 10 : roll < 999 ? 25 : 50;
        multiplier = Math.min(50, multiplier + increment);
      }
      for (let attempt = 0; attempt < LUELON_SLOT_PROFILES.cosmicBeamAttempts[id]; attempt++) if (draw(1000) < LUELON_SLOT_PROFILES.cosmicBeamPerThousand[id]) {
        const col = draw(5); if (beamColumns.includes(col)) continue;
        beamColumns.push(col); for (let row = 0; row < 3; row++) grid[row * 5 + col] = 7;
      }
    }
    const wins = [];
    let rawUnits = 0n;
    for (let line = 0; line < info.paylines.length; line++) {
      const result = score(info.paylines[line].map((row, col) => grid[row * 5 + col]));
      if (!result.pay) continue;
      const factor = free ? multiplier : 1, units = BigInt(stake) * BigInt(result.pay) * BigInt(factor) / 100n;
      rawUnits += units; wins.push({ line, symbol: result.symbol, count: result.count, payHundredths: result.pay, factor, uncappedPayoutUnits: String(units) });
    }
    const paid = rawUnits < cap - total ? rawUnits : cap - total; total += paid;
    return { raw, grid, beamColumns, wins, rawUnits: String(rawUnits), paid: String(paid), multiplier };
  }
  let free = !!mode.bonus;
  do {
    const before = multiplier, raw = board(free), id = mode.bonus ?? 'cosmic-chaos';
    const frames = [frame(raw, free, id, false)];
    if (free && total < cap && draw(100) < LUELON_SLOT_PROFILES.cosmicEchoPerHundred[id]) frames.push(frame(board(true), true, id, true));
    let grant = 0;
    if (!free && total < cap) { const count = raw.filter(symbol => symbol === 8).length; if (count >= 3) { grant = count >= 5 ? 15 : count === 4 ? 12 : 10; remaining = grant; } }
    if (free) remaining--;
    spins.push({ before, after: multiplier, frames, grant, total: String(total) });
    free = true;
  } while (remaining > 0 && total < cap);
  return { spins, credit: Number(total), capped: total === cap };
}
function serverChecks(policy) {
  const configurations = [], seen = { echoes: 0, energyEvents: 0, beams: 0, naturalAwards: {} };
  for (const mode of info.modes) for (const stake of COSMIC_ESCAPE_BET_UNITS) {
    for(const qualificationSeed of policy.seeds) for(let caseIndex=0;caseIndex<policy.serverReplayRoundsPerSeed;caseIndex++){
      const forcedCount=mode.bonus?undefined:[0,3,4,5][caseIndex];
      const seed=qualificationSeed+caseIndex*7919+info.modes.indexOf(mode)*1000003;
      const expected = shadowRound(mode, stake, drawStream(seed, forcedCount));
      const actualDraw = drawStream(seed, forcedCount);
      let actual = startLuelonSlotGame(game, { luelon: { mode: mode.id } }, stake, actualDraw), index = 0;
      function check() {
        const spin = actual.luelon.history[index], shadow = expected.spins[index];
        assert(spin && shadow); assert.equal(spin.featuresBefore.multiplier, shadow.before); assert.equal(spin.featuresAfter.multiplier, shadow.after);
        assert.equal(spin.triggerAwards, shadow.grant); assert.equal(actual.luelon.totalPayoutUnits, shadow.total);
        assert.equal(spin.frames.length, shadow.frames.length);
        for (let frameIndex = 0; frameIndex < spin.frames.length; frameIndex++) {
          const frame = spin.frames[frameIndex], expectedFrame = shadow.frames[frameIndex];
          assert.deepEqual(frame.gridBefore, expectedFrame.raw); assert.deepEqual(frame.gridAfter, expectedFrame.grid);
          assert.equal(frame.payoutUnits, expectedFrame.paid); assert.equal(frame.uncappedPayoutUnits, expectedFrame.rawUnits);
          assert.deepEqual(frame.wins.map(({ line, symbol, count, payHundredths, factor, uncappedPayoutUnits }) => ({ line, symbol, count, payHundredths, factor, uncappedPayoutUnits })), expectedFrame.wins);
          assert.deepEqual(frame.events.filter(event => event.kind === 'expand').map(event => event.positions[0] % 5), expectedFrame.beamColumns);
          seen.echoes += frame.events.filter(event => event.kind === 'echo').length; seen.energyEvents += frame.events.filter(event => event.kind === 'energy').length; seen.beams += expectedFrame.beamColumns.length;
        }
        if (shadow.grant) seen.naturalAwards[shadow.grant] = (seen.naturalAwards[shadow.grant] ?? 0) + 1;
        index++;
      }
      if (actual.luelon.history.length) check();
      while (!actual.ended) {
        actual = moveLuelonSlotGame(JSON.parse(JSON.stringify(actual.luelon)), stake, actual.luelon.revision, 'luelon-spin', undefined, actualDraw);
        check();
      }
      assert.equal(index, expected.spins.length); assert.equal(actual.credit, expected.credit); assert.equal(actual.luelon.capped, expected.capped);
      configurations.push({ mode: mode.id, stakeUnits: stake, qualificationSeed,seed,forcedNaturalScatterCount:forcedCount,spins:index,finalPayoutUnits:String(actual.credit) });
    }
  }
  assert(seen.echoes > 0 && seen.energyEvents > 0 && seen.beams > 0);
  assert.deepEqual(Object.keys(seen.naturalAwards).sort(), ['10', '12', '15']);
  const coverage=[];for(const mode of info.modes)for(const stake of COSMIC_ESCAPE_BET_UNITS){const rows=configurations.filter(row=>row.mode===mode.id&&row.stakeUnits===stake);coverage.push({choice:mode.id,stakeUnits:Number(stake),paidRounds:rows.length,spins:rows.reduce((n,row)=>n+row.spins,0),sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')});}
  return { serverReplayChecks:configurations.length,coverage,seeds:policy.seeds,counters:seen,method: 'Independent board, energy, beam and echo implementation and prefix scorer compared with real start/move after serializing each saved continuation. All 26 stakes and all 4 modes; natural 3/4/5-scatter branches forced independently of future seed draws.' };
}

let cachedAnalysis;
export function cosmicAnalysis(){if(!cachedAnalysis)cachedAnalysis=computeCosmicAnalysis();return cachedAnalysis;}
export function cosmicQualificationEvidence(policy){
 assert.equal(policy.method,COSMIC_QUALIFICATION_METHOD);assert.equal(policy.rulesVersion,2);assert.equal(policy.progressVersion,1);assert.equal(policy.mathProfileVersion,3);
 assert.equal(policy.target,COSMIC_QUALIFICATION_MODEL.target);assert.equal(policy.tolerance,COSMIC_QUALIFICATION_MODEL.tolerance);
 assert.deepEqual(policy.stakes,COSMIC_QUALIFICATION_MODEL.stakes);assert.deepEqual(policy.choices,info.modes.map(mode=>mode.id));
 assert.equal(policy.serverReplayRoundsPerSeed,32);assert.equal(policy.seeds.length,2);assert(new Set(policy.seeds).size===2&&policy.seeds.every(Number.isSafeInteger));
 const analysis=cosmicAnalysis();const results=[];for(const mode of analysis.modes)for(const stake of policy.stakes){
  assert(mode.cappedRtpBound[0]>=policy.target-policy.tolerance&&mode.cappedRtpBound[1]<=policy.target+policy.tolerance&&mode.cappedRtpBound[1]<1,'Cosmic complete-round RTP bound is outside the approved target: '+mode.id);
  results.push({choice:mode.id,stakeUnits:stake,costInStakes:mode.costInStakes,uncappedRtp:mode.uncappedRtp,capLossUpperInStakes:mode.capLossUpperInStakes,rtpBounds:mode.cappedRtpBound});
 }return{method:COSMIC_QUALIFICATION_METHOD,analysis,results};
}
export async function qualifyCosmic(policy,progress=()=>{}){
 const sourceDigests=Object.fromEntries(await Promise.all(Object.keys(COSMIC_QUALIFICATION_MODEL.reviewedSourceSha256).map(async path=>[path,createHash('sha256').update((await readFile(new URL('../../'+path,import.meta.url),'utf8')).replace(/\r\n/g,'\n')).digest('hex')])));
 assert.deepEqual(sourceDigests,COSMIC_QUALIFICATION_MODEL.reviewedSourceSha256,'Cosmic mathematical source changed: independently review the analytical model before qualification');
 const models=await import('../../src/shared/luelonSlotsModels.ts');const stakes=await import('../../src/shared/cosmicEscapeBets.ts');const shared=await import('../../src/shared/luelonSlots.ts');const server=await import('../../server/games/luelonSlots.ts');
 ({startLuelonSlotGame,moveLuelonSlotGame}=server);({luelonSlotLineWins}=shared);
 const actual=models.getLuelonSlotRules(game);const actualModel={reviewedSourceSha256:sourceDigests,gameId:game,rulesVersion:2,progressVersion:1,mathProfileVersion:models.COSMIC_MATH_PROFILE_VERSION,entryPerMillion:models.COSMIC_MATH_ENTRY_PER_MILLION[models.COSMIC_MATH_PROFILE_VERSION],target:models.COSMIC_MATH_TARGET_RTP,tolerance:models.COSMIC_MATH_RTP_TOLERANCE,stakes:stakes.COSMIC_ESCAPE_BET_UNITS.map(Number),profiles:models.LUELON_SLOT_PROFILES,rule:{ordinary:actual.ordinary,wild:actual.wild,scatter:actual.scatter,bonusLimit:actual.bonusLimit,trigger:actual.trigger,retrigger:actual.retrigger,retriggerSpins:actual.retriggerSpins,info:{id:actual.info.id,cols:actual.info.cols,rows:actual.info.rows,maxWin:actual.info.maxWin,paylines:actual.info.paylines,symbols:actual.info.symbols.map(({id,role,pays})=>({id,role,pays})),modes:actual.info.modes.map(({id,cost,bonus,spins,startMultiplier})=>({id,cost,bonus,spins,startMultiplier}))}}};
 assert.deepEqual(actualModel,COSMIC_QUALIFICATION_MODEL,'Cosmic source model changed: independently review and update the analytical model before qualification');
 enumerate((line)=>{const independent=score(line),grid=Array(15).fill(rule.scatter);line.forEach((symbol,col)=>grid[col]=symbol);const actual=luelonSlotLineWins(game,grid).find(win=>win.line===0);assert.equal(independent.pay,actual?.payHundredths??0);if(actual){assert.equal(independent.symbol,actual.symbol);assert.equal(independent.count,actual.count);}});
 progress({phase:'exact-model',scorerChecks,shorterWildPrefixWins});
 const evidence=cosmicQualificationEvidence(policy);const replay=serverChecks(policy);progress({phase:'server-replay',serverReplayChecks:replay.serverReplayChecks});
 return{...evidence,serverReplayChecks:replay.serverReplayChecks,serverReplay:replay,scorerReplayChecks:scorerChecks};
}
