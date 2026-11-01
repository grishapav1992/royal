import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { startVariant as engineStartVariant, moveVariant as engineMoveVariant } from '../server/games/casinoVariants';
import {
  VARIANT_GAMES, VARIANT_DEFAULTS, VARIANT_MAX, validVariantView,
  type VariantGameId, type VariantRisk, type VariantGem,
} from '../src/shared/casinoVariants';
import { NEXT_CARD_LABELS, type CardColor, type DuelBand } from '../src/shared/casinoNextVariants';
import { DEMO_BETS } from '../src/shared/demoWallet';
import { prepareGame, verifyGameRound } from '../server/games/core';
import { getKenoMultipliers, getKenoRtp, getPlinkoMultipliers, getPlinkoRtp, getDiceRtpForStake, getLimboWinProbability, getLimboRtp, minesOdds } from '../src/shared/originalGames';
import { deal as dealClassicDiamonds } from '../server/games/rush/diamonds';
import { advanceSession, sessionPayout, maxSessionMultiplier, publicSession, type SessionState } from '../server/games/casinoSessions';
import { HILO_MAX_GUESSES } from '../src/shared/casinoSessions';

// The oracle uses separately derived rational probabilities and payouts.
// Production payout/probability helpers are never used as an expected-value oracle.
const stakes = DEMO_BETS.map(amount => amount * 100);
type Row = { game:string; mode:string; stakeUnits:number; probability?:number; rtp:number; maxMultiplier:number; outcomes:number; method:string };
const report:Row[] = [];
const sourceRoundingBoundaries:{gameMode:string;slider:number;stakeUnits:number;idealMultiplier:number;sourceMultiplier:number;idealPayout:number;actualPayout:number}[]=[];
const adapterCalls={starts:0,moves:0};
function startVariant(...args:Parameters<typeof engineStartVariant>) {adapterCalls.starts++;return engineStartVariant(...args);}
function moveVariant(...args:Parameters<typeof engineMoveVariant>) {adapterCalls.moves++;return engineMoveVariant(...args);}
function choose(n:number, k:number):bigint {
  if (k < 0 || k > n) return 0n;
  let numerator = 1n, denominator = 1n;
  for (let index = 0; index < k; index++) { numerator *= BigInt(n-index); denominator *= BigInt(index+1); }
  return numerator / denominator;
}
function fixed98(numerator:bigint, denominator:bigint):bigint { return 9800n * numerator / denominator; }
function paid(stake:number, fixed:bigint):number { return Number(BigInt(stake) * fixed / 10000n); }
function close(actual:number, expected:number, label:string) { assert(Math.abs(actual-expected) < 1e-11, `${label}: ${actual} != ${expected}`); }
function sequence(values:number[], expectedMax?:number) {
  let index = 0;
  const draw = (max:number) => { if (expectedMax !== undefined) assert.equal(max, expectedMax); assert(index < values.length); return values[index++]; };
  return { draw, consumed:() => index };
}
function poolDraw(ids:number[], size:number) {
  const pool = Array.from({length:size}, (_, index) => index), queue = [...ids];
  return (max:number) => { assert.equal(max, pool.length); const index = pool.indexOf(queue.shift()!); assert(index >= 0); pool.splice(index,1); return index; };
}
function* subsets(size:number, length:number, prefix:number[] = [], start = 0):Generator<number[]> {
  if (!length) { yield prefix; return; }
  for (let value = start; value <= size-length; value++) yield* subsets(size, length-1, [...prefix,value], value+1);
}
function checkReserve(game:VariantGameId, stake:number, credit:number) {
  assert(Number.isSafeInteger(credit) && credit >= 0);
  assert(credit <= stake * VARIANT_MAX[game], `${game} exceeds reserve`);
}
function record(game:string, mode:string, stake:number, numerator:number, outcomes:number, maxMultiplier:number, method:string, probability?:number) {
  report.push({game,mode,stakeUnits:stake,rtp:numerator/outcomes/stake,maxMultiplier,outcomes,method,...(probability === undefined ? {} : {probability})});
}

test('math audit: Dice exhausts every 0.01 outcome and all permitted stakes', () => {
  for (const width of [30,50,70] as const) for (const stake of stakes) {
    let returned = 0, wins = 0;
    const fixed = 980000n / BigInt(width), low = (100-width)*50, high = low+width*100;
    for (let integer = 0; integer < 10000; integer++) {
      const result = startVariant('variant-dice',{variant:{width}},String(stake),max => { assert.equal(max,10000); return integer; });
      const won = integer >= low && integer < high, expected = won ? paid(stake,fixed) : 0;
      assert.equal(result.credit,expected); assert.equal(result.variant.kind,'dice');
      if (result.variant.kind !== 'dice') throw Error('Wrong Dice view');
      assert.equal(result.variant.won,won); assert.equal(result.variant.multiplier,Number(fixed)/10000);
      wins += Number(won); returned += result.credit; checkReserve('variant-dice',stake,result.credit);
    }
    assert.equal(wins,width*100);
    record('variant-dice',String(width),stake,returned,10000,Number(fixed)/10000,'Exhaustive uniform outcomes',wins/10000);
  }
});

const plinkoTables:Record<VariantRisk,number[]> = {
  low:[10,3,1.6,1.4,1.1,1,.5,1,1.1,1.4,1.6,3,10],
  medium:[33,11,4,2,1.1,.6,.3,.6,1.1,2,4,11,33],
  high:[170,24,8.1,2,.7,.2,.2,.2,.7,2,8.1,24,170],
};
test('math audit: both Plinko streams use independent paths and source payouts', () => {
  for (const risk of ['low','medium','high'] as const) for (const stake of stakes) {
    let returned = 0;
    for (let mask = 0; mask < 4096; mask++) {
      const first = Array.from({length:12}, (_, bit) => mask >>> bit & 1), second = [...first].reverse();
      const draws = sequence([...first,...second],2), bucket = first.reduce((sum,bit) => sum+bit,0);
      const result = startVariant('variant-plinko',{variant:{risk}},String(stake),draws.draw);
      const expected = paid(stake/2,BigInt(Math.round(plinkoTables[risk][bucket]*10000)))*2;
      assert.equal(draws.consumed(),24); assert.equal(result.credit,expected);
      if (result.variant.kind !== 'plinko') throw Error('Wrong Plinko view');
      assert.deepEqual(result.variant.balls.map(ball => ball.path),[first,second]); assert.deepEqual(result.variant.table,plinkoTables[risk]);
      returned += result.credit; checkReserve('variant-plinko',stake,result.credit);
    }
    record('variant-plinko',risk,stake,returned,4096,Math.max(...plinkoTables[risk]),'Exhaustive 4096 paths per stream; linearity of independent payouts');
  }
  const draws = sequence([...Array(12).fill(0),...Array(12).fill(1)],2);
  const result = startVariant('variant-plinko',{variant:{risk:'high'}},'1000',draws.draw);
  assert.equal(result.credit,170000);
});

test('math audit: Limbo exact integer win cutoffs and split payouts', () => {
  const count = 2n**32n;
  for (const target of [3,5,10] as const) for (const stake of stakes) {
    // Both permitted thresholds are exact halves/integers, so two cent floors do not change these cutoffs.
    const lowLast = 196n*count/300n, highLast = 98n*count/(100n*BigInt(target));
    const lowCount = Number(lowLast+1n), highCount = Number(highLast+1n);
    const first = paid(stake/2,15000n), second = paid(stake/2,BigInt(target)*10000n);
    for (const integer of new Set([0,1,Number(highLast)-1,Number(highLast),Number(highLast)+1,Number(lowLast)-1,Number(lowLast),Number(lowLast)+1,Number(count)-1])) {
      const result = startVariant('variant-limbo',{variant:{target}},String(stake),max => { assert.equal(max,Number(count)); return integer; });
      assert.equal(result.credit,(BigInt(integer)<=lowLast?first:0)+(BigInt(integer)<=highLast?second:0));
      checkReserve('variant-limbo',stake,result.credit); assert(validVariantView(result.variant,'variant-limbo',true));
    }
    record('variant-limbo',String(target),stake,lowCount*first+highCount*second,Number(count),(1.5+target)/2,'Exact 32-bit cutoff plus adjacent losing/winning integers');
  }
});

test('math audit: all 560 Vault layouts and every cashout stage', () => {
  const total = Number(choose(16,3));
  for (const stake of stakes) {
    const returns = Array(6).fill(0), surviving = Array(6).fill(0);
    for (const mines of subsets(16,3)) {
      let result = startVariant('variant-mines',{variant:{}},String(stake),poolDraw(mines,16));
      for (let step = 1; step <= 6; step++) {
        result = moveVariant('variant-mines',result.engine,'reveal',[step-1],String(stake));
        if (mines.includes(step-1)) { assert.equal(result.credit,0); break; }
        const safeLayouts = choose(16-step,3), fixed = fixed98(BigInt(total),safeLayouts), expected = paid(stake,fixed);
        const stopped = step === 6 ? result : moveVariant('variant-mines',result.engine,'cashout',undefined,String(stake));
        assert.equal(stopped.credit,expected); assert(validVariantView(stopped.variant,'variant-mines',true)); checkReserve('variant-mines',stake,stopped.credit);
        returns[step-1] += stopped.credit; surviving[step-1]++;
      }
    }
    for (let step = 1; step <= 6; step++) {
      assert.equal(surviving[step-1],Number(choose(16-step,3)));
      record('variant-mines',String(step),stake,returns[step-1],total,Number(fixed98(BigInt(total),choose(16-step,3)))/10000,'Every mine layout; fixed-stage cashouts. Symmetry makes adaptive cell choices equivalent',surviving[step-1]/total);
    }
  }
});

test('math audit: Sic Bo enumerates all 216 rolls including every triplet', () => {
  const counts = Array(19).fill(0);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) counts[a+b+c]++;
  assert.deepEqual(counts.slice(3),[1,3,6,10,15,21,25,27,27,25,21,15,10,6,3,1]);
  for (let sum = 3; sum <= 18; sum++) for (const stake of stakes) {
    let returned = 0;
    const fixed = fixed98(216n,BigInt(counts[sum]));
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
      const draws = sequence([a-1,b-1,c-1],6), result = startVariant('variant-sic-bo',{variant:{sum}},String(stake),draws.draw);
      assert.equal(result.credit,a+b+c===sum?paid(stake,fixed):0); assert.equal(draws.consumed(),3);
      returned += result.credit; checkReserve('variant-sic-bo',stake,result.credit);
    }
    record('variant-sic-bo',String(sum),stake,returned,216,Number(fixed)/10000,'Exhaustive three dice',counts[sum]/216);
  }
});

const gemWeights = [30,25,20,15,8,2], gemStops = [0,30,55,75,90,98], gems = ['🟡','🟢','🔵','🟣','🟠','💎'];
test('math audit: Diamonds enumerates all 7776 weighted hands for every selection', () => {
  const total = 100n**5n;
  const winningCounts = gemWeights.map(weight => { const p = BigInt(weight), q = 100n-p; return total-q**5n-5n*p*q**4n; });
  for (let gem = 0; gem < 6; gem++) for (const stake of stakes) {
    let weightedReturned = 0n, actualWinningCount = 0n;
    const fixed = fixed98(total,winningCounts[gem]);
    for (let mask = 0; mask < 6**5; mask++) {
      let number = mask, weight = 1n; const hand:number[] = [];
      for (let position = 0; position < 5; position++) { const symbol = number%6; number = Math.floor(number/6); hand.push(symbol); weight *= BigInt(gemWeights[symbol]); }
      const draws = sequence(hand.map(symbol => gemStops[symbol]),100), result = startVariant('variant-diamonds',{variant:{gem:gem as VariantGem}},String(stake),draws.draw);
      const won = hand.filter(symbol => symbol===gem).length >= 2;
      assert.equal(result.credit,won?paid(stake,fixed):0); assert.equal(draws.consumed(),5);
      if (result.variant.kind !== 'diamonds') throw Error('Wrong Diamonds view'); assert.deepEqual(result.variant.hand,hand.map(symbol => gems[symbol]));
      if (won) actualWinningCount += weight; weightedReturned += weight*BigInt(result.credit); checkReserve('variant-diamonds',stake,result.credit);
    }
    assert.equal(actualWinningCount,winningCounts[gem]);
    record('variant-diamonds',String(gem),stake,Number(weightedReturned),Number(total),Number(fixed)/10000,'Exhaustive weighted symbol hands',Number(winningCounts[gem])/Number(total));
  }
});

test('math audit: Keno enumerates all 15504 five-number draws and both thresholds', () => {
  const selections = [1,2,3,4,5], counts = Array(6).fill(0);
  for (const drawn of subsets(20,5)) counts[drawn.filter(number => number < 5).length]++;
  assert.deepEqual(counts,[3003,6825,4550,1050,75,1]);
  const total = Number(choose(20,5));
  for (const target of [2,3] as const) for (const stake of stakes) {
    let returned = 0, wins = 0;
    const count = counts.slice(target).reduce((sum,n) => sum+n,0), fixed = fixed98(BigInt(total),BigInt(count));
    for (const drawn of subsets(20,5)) {
      const result = startVariant('variant-keno',{variant:{numbers:selections,target}},String(stake),poolDraw(drawn,20));
      const hits = drawn.filter(number => number < 5).length, won = hits>=target;
      assert.equal(result.credit,won?paid(stake,fixed):0); assert(validVariantView(result.variant,'variant-keno',true));
      wins += Number(won); returned += result.credit; checkReserve('variant-keno',stake,result.credit);
    }
    assert.equal(wins,count);
    record('variant-keno',String(target),stake,returned,total,Number(fixed)/10000,'Every unordered draw; sampling without replacement gives equal subset probability',count/total);
  }
});

const redIds = Array.from({length:26}, (_, index) => index+13), blackIds = [...Array.from({length:13},(_,i)=>i),...Array.from({length:13},(_,i)=>i+39)];
function colorDeck(colors:CardColor[]):number[] {
  const red = [...redIds], black = [...blackIds], selected = colors.map(color => (color==='red'?red:black).shift()!);
  return [...selected,...red,...black];
}
function colorOracle(colors:CardColor[]) {
  let red = 26n, black = 26n, numerator = 1n, denominator = 1n;
  for (const color of colors) { numerator *= color==='red'?red:black; denominator *= red+black; if (color==='red') red--; else black--; }
  return {numerator,denominator,fixed:fixed98(denominator,numerator)};
}
test('math audit: Color tests every successful color prefix and conditional odds', () => {
  for (const stake of stakes) for (let length = 1; length <= 6; length++) {
    let minRtp = Infinity, maxRtp = 0, maxMultiplier = 0;
    for (let mask = 0; mask < 2**length; mask++) {
      const colors = Array.from({length},(_,bit):CardColor => mask>>>bit&1?'red':'black'), oracle = colorOracle(colors);
      let result = startVariant('variant-color',{variant:{}},String(stake),poolDraw(colorDeck(colors),52));
      assert.throws(() => moveVariant('variant-color',result.engine,'cashout',undefined,String(stake)));
      for (const color of colors) result = moveVariant('variant-color',result.engine,color,undefined,String(stake));
      const stopped = length===6?result:moveVariant('variant-color',result.engine,'cashout',undefined,String(stake));
      assert.equal(stopped.credit,paid(stake,oracle.fixed)); assert(validVariantView(stopped.variant,'variant-color',true)); checkReserve('variant-color',stake,stopped.credit);
      const rtp = Number(oracle.numerator)/Number(oracle.denominator)*stopped.credit/stake;
      minRtp = Math.min(minRtp,rtp); maxRtp = Math.max(maxRtp,rtp); maxMultiplier = Math.max(maxMultiplier,Number(oracle.fixed)/10000);
      if (length<6) {
        const future = NEXT_CARD_LABELS[(result.engine as {deck:number[]}).deck[length]], prediction:CardColor = future.endsWith('♥')||future.endsWith('♦')?'black':'red';
        const failed = moveVariant('variant-color',result.engine,prediction,undefined,String(stake)); assert.equal(failed.credit,0); assert(failed.ended);
      }
    }
    report.push({game:'variant-color',mode:`${length} successful predictions: path RTP range`,stakeUnits:stake,rtp:minRtp,maxMultiplier,outcomes:2**length,method:`Every color prefix. Maximum path RTP ${maxRtp}`});
    assert(maxRtp<=.98+1e-12); assert(minRtp>=.979-1e-12);
  }
});

test('math audit: adaptive Color decisions and early cashouts cannot exceed 98%', () => {
  for (const stake of stakes) {
    const memo = new Map<string,number>();
    function value(red:number, black:number):number {
      const steps = 52-red-black, key = `${red},${black}`; if (memo.has(key)) return memo.get(key)!;
      const colors:CardColor[] = [...Array(26-red).fill('red'),...Array(26-black).fill('black')];
      const cashout = steps?paid(stake,colorOracle(colors).fixed):0;
      if (steps===6) return cashout;
      const best = Math.max(cashout,red/(red+black)*value(red-1,black),black/(red+black)*value(red,black-1));
      memo.set(key,best); return best;
    }
    const expected = value(26,26); close(expected/stake,.98,'Optimal color policy');
    record('variant-color','optimal adaptive policy',stake,expected,1,86.6626,'Dynamic program chooses color or cashout at every observed color-count state');
  }
});

test('math audit: Keys covers every trap board and every cashout stage', () => {
  for (const pair of subsets(4,2)) { let wins = 0; for (let trap = 0; trap < 4; trap++) wins += Number(!pair.includes(trap)); assert.equal(wins,2); }
  for (const stake of stakes) {
    const returns = Array(6).fill(0), survives = Array(6).fill(0);
    for (let mask = 0; mask < 4**6; mask++) {
      let number = mask; const traps:number[] = []; for (let row = 0; row < 6; row++) { traps.push(number%4); number=Math.floor(number/4); }
      const draws = sequence(traps,4); let result = startVariant('variant-keys',{variant:{}},String(stake),draws.draw);
      for (let step = 1; step <= 6; step++) {
        result = moveVariant('variant-keys',result.engine,'unlock',[0,1],String(stake));
        if (traps[step-1]<2) { assert.equal(result.credit,0); break; }
        const fixed = 9800n*2n**BigInt(step), stopped = step===6?result:moveVariant('variant-keys',result.engine,'cashout',undefined,String(stake));
        assert.equal(stopped.credit,paid(stake,fixed)); assert(validVariantView(stopped.variant,'variant-keys',true)); checkReserve('variant-keys',stake,stopped.credit);
        survives[step-1]++; returns[step-1] += stopped.credit;
      }
    }
    for (let step = 1; step <= 6; step++) { assert.equal(survives[step-1],4096/2**step); close(returns[step-1]/4096/stake,.98,'Keys stage RTP'); record('variant-keys',String(step),stake,returns[step-1],4096,.98*2**step,'Every trap board and all six possible two-cell choices per row',1/2**step); }
  }
});

const fruitSymbol = (stop:number) => stop<8?0:stop<14?1:stop<18?2:3;
const fruitPayout = (symbols:number[]) => symbols.every(symbol=>symbol===symbols[0])?[5,10,30,140][symbols[0]]:0;
test('math audit: Fruits exact 97% source and every cent in 2/3-line splits', () => {
  for (const lines of [2,3] as const) for (const stake of stakes) {
    let returned = 0;
    const shares = Array.from({length:lines},(_,index) => Math.floor(stake/lines)+Number(index<stake%lines));
    assert.equal(shares.reduce((sum,n)=>sum+n,0),stake);
    for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) for (let c = 0; c < 20; c++) {
      const draws = sequence(Array.from({length:lines},()=>[a,b,c]).flat(),20), result = startVariant('variant-fruits',{variant:{lines}},String(stake),draws.draw);
      const multiplier = fruitPayout([a,b,c].map(fruitSymbol)); assert.equal(result.credit,stake*multiplier); assert.equal(draws.consumed(),lines*3);
      if (result.variant.kind !== 'fruits') throw Error('Wrong Fruits view'); assert.deepEqual(result.variant.rows.map(row=>Number(row.stakeUnits)),shares);
      assert(validVariantView(result.variant,'variant-fruits',true)); returned += result.credit; checkReserve('variant-fruits',stake,result.credit);
    }
    close(returned/8000/stake,.97,'Fruits RTP'); record('variant-fruits',String(lines),stake,returned,8000,140,'All independent reel stops; linearity across separately funded rows');
  }
  const draws = sequence([0,0,0,8,8,8,19,19,19],20), result = startVariant('variant-fruits',{variant:{lines:3}},'1000',draws.draw);
  assert.equal(result.credit,334*5+333*10+333*140);
  let classicReturned=0;
  for (let a=0;a<20;a++) for(let b=0;b<20;b++) for(let c=0;c<20;c++) { const draws=sequence([a,b,c],20),round=prepareGame('royal-fruits',1,{}).play(1000n,draws.draw); assert.equal(Number(round.payoutUnits),1000*fruitPayout([a,b,c].map(fruitSymbol))); classicReturned += Number(round.payoutUnits); }
  close(classicReturned/8000000,.97,'Classic Fruits RTP');
  for(const stake of stakes)record('royal-fruits','classic reel paytable',stake,stake*8000*.97,8000,140,'Every reel-stop combination; integer multipliers make all permitted stakes exact');
});

const duelBand = (gap:number):DuelBand => gap===0?'tie':gap<=3?'near':gap<=7?'middle':'far';
test('math audit: Dragon gap bands partition all 2652 distinct-card pairs', () => {
  const counts:Record<DuelBand,number> = {tie:0,near:0,middle:0,far:0};
  for (let a=0;a<52;a++) for (let b=0;b<52;b++) if(a!==b) counts[duelBand(Math.abs(a%13-b%13))]++;
  assert.deepEqual(counts,{tie:156,near:1056,middle:960,far:480});
  for (const band of ['tie','near','middle','far'] as const) for (const stake of stakes) {
    let returned=0; const fixed=fixed98(2652n,BigInt(counts[band]));
    for (let a=0;a<52;a++) for (let b=0;b<52;b++) if(a!==b) {
      const result=startVariant('variant-duel',{variant:{band}},String(stake),poolDraw([a,b],52)),won=duelBand(Math.abs(a%13-b%13))===band;
      assert.equal(result.credit,won?paid(stake,fixed):0); assert(validVariantView(result.variant,'variant-duel',true)); returned += result.credit; checkReserve('variant-duel',stake,result.credit);
    }
    record('variant-duel',band,stake,returned,2652,Number(fixed)/10000,'Every ordered pair of distinct cards',counts[band]/2652);
  }
});

test('math audit: War Ace-high results and both modes for every distinct-card pair', () => {
  const rank=(id:number)=>id%13===0?14:id%13+1,counts={win:0,tie:0,loss:0};
  for(let a=0;a<52;a++) for(let b=0;b<52;b++) if(a!==b) counts[rank(a)>rank(b)?'win':rank(a)===rank(b)?'tie':'loss']++;
  assert.deepEqual(counts,{win:1248,tie:156,loss:1248});
  for (const mode of ['shield','attack'] as const) for (const stake of stakes) {
    let returned=0;
    for(let a=0;a<52;a++) for(let b=0;b<52;b++) if(a!==b) {
      let index=0, draw=poolDraw([a,b],52);
      const result=startVariant('variant-war',{variant:{mode}},String(stake),max=>{if(index++===2)draw=poolDraw([a,b],52);return draw(max);});
      const expectedResult=rank(a)>rank(b)?'win':rank(a)===rank(b)?'tie':'loss',fixed=expectedResult==='loss'?0n:mode==='attack'?(expectedResult==='win'?20825n:0n):(expectedResult==='win'?19600n:9800n);
      assert.equal(result.credit,paid(stake/2,fixed)*2); assert(validVariantView(result.variant,'variant-war',true)); returned += result.credit; checkReserve('variant-war',stake,result.credit);
    }
    record('variant-war',mode,stake,returned,2652,mode==='attack'?2.0825:1.96,'Every distinct pair on each independent front; payout linearity',1248/2652);
  }
  const draws=sequence([0,11,11,0]),result=startVariant('variant-war',{variant:{mode:'shield'}},'1000',draws.draw);
  if(result.variant.kind!=='war')throw Error('Wrong War view'); assert.deepEqual(result.variant.fronts.map(front=>front.result),['win','loss']); assert.equal(result.credit,980);
});

test('math audit: all 12 adapters reject out-of-range randomness and accept both endpoints', () => {
  for (const game of VARIANT_GAMES) {
    for (const bad of [-1,NaN,Infinity,.5]) assert.throws(()=>startVariant(game,structuredClone(VARIANT_DEFAULTS[game]),'1000',()=>bad),/random/);
    assert.throws(()=>startVariant(game,structuredClone(VARIANT_DEFAULTS[game]),'1000',max=>max),/random/);
    for (const draw of [()=>0,(max:number)=>max-1]) { const result=startVariant(game,structuredClone(VARIANT_DEFAULTS[game]),'1000',draw); assert(validVariantView(result.variant,game,result.ended)); checkReserve(game,1000,result.credit); }
  }
});

test('math audit: classic Keno and Plinko tables match independent distributions', () => {
  for(let count=1;count<=10;count++) for(const risk of ['classic','low','medium','high'] as const) {
    const table=getKenoMultipliers(count,risk),denominator=choose(40,10); let weighted=0;
    for(let hits=0;hits<=count;hits++) weighted += Number(choose(count,hits)*choose(40-count,10-hits))/Number(denominator)*table[hits];
    close(getKenoRtp(count,risk),weighted,'Classic Keno distribution'); assert(weighted>0&&weighted<=1);
    report.push({game:'royal-keno',mode:`${count} picks/${risk}`,stakeUnits:1000,rtp:weighted,maxMultiplier:Math.max(...table),outcomes:Number(denominator),method:'Exact hypergeometric 10-of-40 draw distribution'});
  }
  for(let rows=8;rows<=16;rows++) for(const risk of ['easy','medium','hard','expert'] as const) {
    const table=getPlinkoMultipliers(rows,risk); let weighted=0;
    for(let bucket=0;bucket<=rows;bucket++) weighted += Number(choose(rows,bucket))/2**rows*table[bucket];
    close(getPlinkoRtp(rows,risk),weighted,'Classic Plinko distribution'); assert(weighted>0&&weighted<=1);
    report.push({game:'royal-plinko',mode:`${rows} rows/${risk}`,stakeUnits:1000,rtp:weighted,maxMultiplier:Math.max(...table),outcomes:2**rows,method:'Exact binomial left/right path distribution'});
  }
});

test('math audit: classic HiLo uses 99% once and reserves cover exact payouts', () => {
  const state:SessionState={id:'audit',gameId:'github-hilo',rulesVersion:1,state:'cashed_out',stakeUnits:'1000',settings:{},choices:[],cards:[]};
  for(const stake of stakes) {
    let minHiloRtp=Infinity,maxHiloRtp=0;
    for(let rank=1;rank<=13;rank++) for(const direction of ['higher','lower'] as const) {
      const winningRanks=direction==='higher'?13-rank:rank-1;if(!winningRanks)continue;
      const current={...state,stakeUnits:String(stake),choices:[direction],cards:[{rank,suit:0},{rank:direction==='higher'?rank+1:rank-1,suit:0}]};
      const expected=BigInt(stake)*99n*13n/(100n*BigInt(winningRanks)); assert.equal(sessionPayout(current),expected);
      const rtp=winningRanks/13*Number(expected)/stake;
      assert(Number(expected)<=stake*maxSessionMultiplier('github-hilo',{})); assert(rtp<=.99+1e-12);minHiloRtp=Math.min(minHiloRtp,rtp);maxHiloRtp=Math.max(maxHiloRtp,rtp);
    }
    report.push({game:'github-hilo',mode:'all permitted first predictions, min RTP',stakeUnits:stake,rtp:minHiloRtp,maxMultiplier:maxSessionMultiplier('github-hilo',{}),outcomes:13,method:`Uniform rank law; exact compounded probability and edge applied once. Maximum first-step RTP ${maxHiloRtp}; later choices cannot exceed 99% before cent flooring`});
    const maxHilo={...state,stakeUnits:String(stake),choices:Array(HILO_MAX_GUESSES).fill('higher' as const),cards:Array(HILO_MAX_GUESSES+1).fill({rank:12,suit:0})};
    assert.equal(sessionPayout(maxHilo),BigInt(stake)*99n*13n**BigInt(HILO_MAX_GUESSES)/100n);
    assert(Number(sessionPayout(maxHilo))<=stake*maxSessionMultiplier('github-hilo',{}));
  }
});

test('math audit: classic Dice validates every allowed threshold and exact minor-unit flooring', () => {
  for (const stake of stakes) {
    let minRtp=Infinity,maxRtp=0, modes=0;
    for (const gameMode of ['rollUnder','rollOver'] as const) for (let sliderUnits=1;sliderUnits<10000;sliderUnits++) {
      let game;
      try { game=prepareGame('royal-dice',1,{gameMode,sliderValue:sliderUnits/100}); } catch { continue; }
      modes++;
      const wins=gameMode==='rollUnder'?sliderUnits:10000-sliderUnits;
      // Source Dice rounds the 98% inverse chance to the nearest 0.0001.
      const numerator=98000000n,denominator=BigInt(wins),fixed=(numerator*2n+denominator)/(denominator*2n);
      let sourceFixed:bigint|undefined;
      for (const integer of new Set([0,sliderUnits-1,sliderUnits,Math.min(9999,sliderUnits+1),9999])) {
        const round=game.play(BigInt(stake),max=>{assert.equal(max,10000);return integer;}),won=gameMode==='rollUnder'?integer<sliderUnits:integer>=sliderUnits;
        if(won){
          const actualFixed=BigInt(Math.round(round.multiplier*10000));
          assert(actualFixed===fixed||actualFixed===fixed-1n);
          if(actualFixed!==fixed){
            assert.equal((numerator%denominator)*2n,denominator,'Only exact half ties may reflect upstream binary rounding');
            if(sourceFixed===undefined)sourceRoundingBoundaries.push({gameMode,slider:sliderUnits/100,stakeUnits:stake,idealMultiplier:Number(fixed)/10000,sourceMultiplier:round.multiplier,idealPayout:paid(stake,fixed),actualPayout:Number(round.payoutUnits)});
          }
          sourceFixed=actualFixed;
        }
        assert.equal(Number(round.payoutUnits),won?paid(stake,sourceFixed!):0,`Dice ${gameMode} slider ${sliderUnits/100}, stake ${stake}, integer ${integer}, multiplier ${round.multiplier}`); assert(Number(round.payoutUnits)<=stake*game.maxMultiplier);
      }
      assert(sourceFixed!==undefined);
      const rtp=wins/10000*paid(stake,sourceFixed)/stake;minRtp=Math.min(minRtp,rtp);maxRtp=Math.max(maxRtp,rtp);
    }
    assert(modes>19000);assert(maxRtp<1);
    report.push({game:'royal-dice',mode:`all ${modes} permitted thresholds, min RTP`,stakeUnits:stake,rtp:minRtp,maxMultiplier:9800,outcomes:10000,method:`Exact threshold counts, nearest 0.0001 multiplier, payout flooring. Maximum RTP ${maxRtp}`});
  }
});

test('math audit: classic HiLo checks every two-step rank transition and auto settlement', () => {
  assert.equal(HILO_MAX_GUESSES,2);
  for(const stake of stakes)for(let firstRank=1;firstRank<=13;firstRank++)for(let secondRank=1;secondRank<=13;secondRank++)for(let thirdRank=1;thirdRank<=13;thirdRank++)for(const firstChoice of ['higher','lower'] as const) {
    const firstCount=firstChoice==='higher'?13-firstRank:firstRank-1;
    const state:SessionState={id:'00000000-0000-4000-8000-000000000001',gameId:'github-hilo',rulesVersion:1,state:'active',stakeUnits:String(stake),settings:{},choices:[],cards:[firstRank,secondRank,thirdRank].map(rank=>({rank,suit:0})),dragons:[]};
    const pick=(choice:'higher'|'lower')=>({id:'00000000-0000-4000-8000-000000000002',gameId:'github-hilo' as const,action:'pick' as const,sessionId:state.id,choice});
    if(!firstCount){assert.throws(()=>advanceSession(state,pick(firstChoice)));continue;}
    const first=advanceSession(state,pick(firstChoice)),firstWon=firstChoice==='higher'?secondRank>firstRank:secondRank<firstRank;
    if(!firstWon){assert.equal(first.state,'lost');assert.equal(sessionPayout(first),0n);continue;}
    assert.equal(first.state,'active');assert.equal(sessionPayout(first),BigInt(stake)*99n*13n/(100n*BigInt(firstCount)));
    for(const secondChoice of ['higher','lower'] as const){
      const secondCount=secondChoice==='higher'?13-secondRank:secondRank-1;
      if(!secondCount){assert.throws(()=>advanceSession(first,pick(secondChoice)));continue;}
      const final=advanceSession(first,pick(secondChoice)),won=secondChoice==='higher'?thirdRank>secondRank:thirdRank<secondRank,expected=won?BigInt(stake)*99n*169n/(100n*BigInt(firstCount*secondCount)):0n;
      assert.equal(final.state,won?'cashed_out':'lost');assert.equal(sessionPayout(final),expected);assert.equal(publicSession(final).cards!.length,3);
      assert(Number(expected)<=stake*maxSessionMultiplier('github-hilo',{}));assert.throws(()=>advanceSession(final,pick('higher')));
    }
  }
});

test('math audit: classic Mines rounds every 25-cell conditional probability correctly', () => {
  for(const stake of stakes) {
    let minRtp=Infinity,maxRtp=0,modes=0;
    for(let mines=1;mines<=24;mines++) for(let opened=1;opened<=25-mines;opened++) {
      const total=choose(25,mines),safe=choose(25-opened,mines),numerator=98n*total,denominator=safe;
      // Source Mines rounds to the nearest 0.01, then settles integer money downward.
      const fixedCents=(numerator*2n+denominator)/(denominator*2n),multiplier=Number(fixedCents)/100;
      assert.equal(minesOdds.getMultiplier(mines,opened),multiplier);
      const returned=Number(BigInt(stake)*fixedCents/100n),rtp=Number(safe)/Number(total)*returned/stake;
      assert(Number.isSafeInteger(returned));assert(returned<=stake*5096294);assert(rtp<1);
      minRtp=Math.min(minRtp,rtp);maxRtp=Math.max(maxRtp,rtp);modes++;
    }
    report.push({game:'royal-mines',mode:`all ${modes} mine/cashout configurations, min RTP`,stakeUnits:stake,rtp:minRtp,maxMultiplier:5096294,outcomes:25,method:`Exact safe-layout count and nearest 0.01 multiplier. Maximum RTP ${maxRtp}`});
  }
});

test('math audit: legacy Dice half boundary stays consistent with the displayed stake RTP and old receipts', () => {
  for(const [gameMode,sliderValue] of [['rollUnder',17.92],['rollOver',82.08]] as const) for(const stake of stakes) {
    const input={gameMode,sliderValue},game=prepareGame('royal-dice',1,input),round=game.play(BigInt(stake),()=>gameMode==='rollUnder'?0:9999);
    assert.equal(round.multiplier,5.4687);
    assert.equal(round.payoutUnits,String(BigInt(stake)*54687n/10000n));
    assert(verifyGameRound(round));
    close(getDiceRtpForStake(input,BigInt(stake)),.1792*Number(round.payoutUnits)/stake,'UI stake RTP matches the actual legacy payout');
    assert(!verifyGameRound({...round,multiplier:5.4688,payoutUnits:String(BigInt(stake)*54688n/10000n)}));
  }
});

test('math audit: classic Limbo advertised probability includes legacy double-floor boundaries', () => {
  const count=2n**32n;
  for(const target of [1.01,1.13,1.14,1.15,1.5,2.01,2.03,3.14,13.37,99.99,999.99,1000000]) {
    let minimumFirstFloorCents=Math.round(target*100);
    while(Math.floor(minimumFirstFloorCents/100*100)/100<target)minimumFirstFloorCents++;
    const predictedLast=Number(98n*count/BigInt(minimumFirstFloorCents)),game=prepareGame('royal-limbo',1,{targetMultiplier:target});
    let lastWin=-1;
    for(let integer=Math.max(0,predictedLast-2);integer<=Math.min(Number(count)-1,predictedLast+2);integer++) {
      const round=game.play(1000n,()=>integer);
      if(round.gameId!=='royal-limbo')throw Error('Wrong Limbo round');
      if(round.outcome.won)lastWin=integer;
      assert.equal(Number(round.payoutUnits),round.outcome.won?Math.round(target*100)*10:0);
    }
    assert(Math.abs(lastWin-predictedLast)<=1,'At most one 32-bit integer may differ from exact first-floor division');
    const winProbability=(lastWin+1)/Number(count);
    close(getLimboWinProbability(target),winProbability,'Limbo advertised win probability');
    close(getLimboRtp(target),winProbability*target,'Limbo advertised RTP');
    for(const stake of stakes) {
      const won=game.play(BigInt(stake),()=>0),lost=game.play(BigInt(stake),()=>Number(count)-1);
      assert.equal(Number(won.payoutUnits),Number(BigInt(stake)*BigInt(Math.round(target*100))/100n));assert.equal(lost.payoutUnits,'0');
      record('royal-limbo',String(target),stake,(lastWin+1)*Number(won.payoutUnits),Number(count),target,'Exact inverse first-floor cutoff and the source second-floor quantization, verified on adjacent RNG integers',winProbability);
    }
  }
});

test('math audit: classic Diamonds source pays its exact 77.61711034% table', () => {
  const tiers=[1,2,3,4,6,10],total=100n**5n;
  for(const stake of stakes) {
    let weightedReturned=0n;
    for(let mask=0;mask<6**5;mask++) {
      let number=mask,weight=1n;const hand:number[]=[];
      for(let position=0;position<5;position++){const symbol=number%6;number=Math.floor(number/6);hand.push(symbol);weight*=BigInt(gemWeights[symbol]);}
      const counts=gemWeights.map((_,symbol)=>hand.filter(value=>value===symbol).length),cluster=counts.findIndex(count=>count>=3);
      const multiplier=cluster<0?0:tiers[cluster]*(counts[cluster]-2),draws=sequence(hand.map(symbol=>gemStops[symbol]),100),result=dealClassicDiamonds(draws.draw);
      assert.equal(result.multiplier,multiplier);assert.deepEqual(result.hand,hand.map(symbol=>gems[symbol]));assert(multiplier<=30);
      weightedReturned+=weight*BigInt(stake*multiplier);
    }
    close(Number(weightedReturned)/Number(total)/stake,.7761711034,'Classic Diamonds source RTP');
    record('github-diamonds','source cluster paytable',stake,Number(weightedReturned),Number(total),30,'All 7776 weighted hands; this prototype table is not the calibrated 98% variant');
  }
});

test('math audit: source Sic Bo and single-deck Dragon/War probabilities', () => {
  for(const bet of ['small','big'] as const) {
    let wins=0;
    for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++) {
      const total=a+b+c;wins+=Number(!(a===b&&b===c)&&(bet==='small'?total>=4&&total<=10:total>=11&&total<=17));
    }
    assert.equal(wins,105);
    for(const stake of stakes)record('github-sic-bo',bet,stake,wins*stake*2,216,2,'Every roll, triplets lose',wins/216);
  }
  let wins=0,ties=0;for(let a=0;a<52;a++)for(let b=0;b<52;b++)if(a!==b){wins+=Number(a%13>b%13);ties+=Number(a%13===b%13);}
  assert.equal(wins,1248);assert.equal(ties,156);
  const halfRefundRtp=(2*wins+.5*ties)/2652;
  close(halfRefundRtp,16.5/17,'Single-deck half refund RTP');
  for(const stake of stakes)for(const game of ['github-dragon-tiger','github-war'])record(game,game==='github-war'?'surrender ties':'dragon or tiger',stake,stake*(2*wins+.5*ties),2652,game==='github-war'?3:2,'Native source uses one 52-card deck, comparison 2x wins and half stake refunded on tie');
  // Conditional on an initial tie, 50 cards remain: two of the tied rank and four of each other rank.
  const warTieChance=(2*1+12*4*3)/(50*49),warGross=16/17+(1/17)*3*(1+warTieChance)/2,warCost=1+1/17;
  const warRtp=warGross/warCost;assert(warRtp<1&&warRtp>halfRefundRtp);
  report.push({game:'github-war',mode:'always war on ties',stakeUnits:1000,rtp:warRtp,maxMultiplier:3,outcomes:2652,method:'Single-deck removal after initial tie; burn cards do not alter the marginal rank law; RTP denominator includes the extra stake'});
});

after(() => {
  const target=process.env.ROYAL_MATH_AUDIT_REPORT;
  if(target){mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify({createdAt:new Date().toISOString(),stakes,adapterCalls,records:report,sourceRoundingBoundaries},null,2)+'\n');}
});
