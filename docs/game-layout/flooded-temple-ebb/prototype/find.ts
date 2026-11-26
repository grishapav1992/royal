/** Finds seeds of real rounds for the review buttons. Run: node --import tsx find.ts */
import {playRound,xor,outcome,pay} from './rounds';
const want:Record<string,number[]>={loss:[],partial:[],win:[],chain:[],big:[],huge:[],bonus:[],relics2:[]};
for(let s=1;s<900000;s++){const seed=(s*2654435761)>>>0||1,r=playRound(xor(seed)),o=outcome(100,pay(r.points,100)),free=r.frames.filter(f=>f.mode==='free').length,base=r.frames.length-free,top=Math.max(...r.frames.map(f=>f.mode==='base'?f.multiplier:0));
 const add=(k:string)=>{if(want[k].length<4)want[k].push(seed);};
 if(!free){if(o==='loss')add('loss');if(o==='partial')add('partial');if(o==='win'&&base===3)add('win');if(top===5&&base>=5&&o!=='loss'&&o!=='partial')add('chain');if(o==='big'&&base<=5)add('big');if(o==='huge'&&base<=7)add('huge');}
 else{const added=r.frames.reduce((a,f)=>a+f.addedFreeSpins,0);if(added===10&&r.frames.length<40&&(o==='big'||o==='huge'))add('bonus');}
}
console.log(JSON.stringify(want));
