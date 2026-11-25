import {Scene,zones,zoneOf,coast,cargo,heli,explosionAt} from './scene';
import type {Phase} from './kit';
const names=['coupe','patrol','explosion','helicopter','cargo-plane','coupe-yaw','patrol-ram','coupe-depth-roll','route-props','route-industrial','route-interchange','route-highway','route-last-exit'];
const ZN=['Промзона','Развязка','Шоссе','Последний съезд'];
const arrow='<svg viewBox="0 0 50 50" aria-hidden="true"><path d="M10 43 33 20H17V11h31v31h-9V26L16 49z" fill="currentColor" transform="translate(-4 -5)"/></svg>';
const dial=(cls:string,max:number,step:number,red:number,label:string)=>{const a=(v:number)=>(-220+260*v/max)*Math.PI/180;let t='';for(let v=0;v<=max;v+=step/2){const big=v%step===0,c=Math.cos(a(v)),s=Math.sin(a(v)),r=big?37:40;t+=`<line x1="${50+c*45}" y1="${50+s*45}" x2="${50+c*r}" y2="${50+s*r}" stroke="${v>=red?'#d9694a':'#eee8da'}" stroke-width="${big?2:1}"/>`;if(big)t+=`<text x="${50+c*29}" y="${50+s*29+3.2}" font-size="9" text-anchor="middle" fill="${v>=red?'#e58a6c':'#d9d7c6'}" font-family="Arial" font-weight="700">${v>=100?v/10:v}</text>`;}
 return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" fill="#8f8a78"/><circle cx="50" cy="50" r="47" fill="#0e110c"/>${t}<text x="50" y="80" font-size="9" text-anchor="middle" fill="#b9b8a6" font-family="Arial" font-weight="700">${label}</text><g data-needle style="transform-origin:50px 50px"><path d="M50 47.8 89 50 50 52.2 40 51.4 40 48.6z" fill="#e5b35e"/></g><circle cx="50" cy="50" r="6" fill="#2b2f27" stroke="#8f8a78" stroke-width="1.5"/></svg>`;};
const html=`<div class="le-grid"><div class="le-stage"><canvas></canvas><div class="le-grain"></div>
<div class="le-gantry"><div class="le-truss"></div><div class="le-boards"><div class="le-board le-logo"><h2>LAST <em>EXIT</em></h2><small>ПОСЛЕДНИЙ СЪЕЗД</small></div><div class="le-board le-mult" aria-live="off"><span data-cap></span><strong><span data-v>1.00</span><i data-f></i><u>×</u></strong><p data-st></p></div><div class="le-board le-next"><svg viewBox="0 0 26 40"><path d="M13 0 26 16h-8v24H8V16H0z" fill="#eee8da"/></svg><div><small data-nk></small><b data-nx></b></div></div></div></div>
<div class="le-card" hidden><span data-c1></span><b data-c2></b><strong data-c3></strong></div></div>
<div class="le-route"><div class="le-line"><div class="le-fill"></div>${[[1,0],[2,1],[4,2],[8,3],[100,4]].map(([v,i])=>`<div class="le-stop${i===4?' last':i===0?' first':''}" style="left:${pos(v)}%"><em>${v}×</em><span>${i<4?ZN[i]:'Финиш'}</span></div>`).join('')}<div class="le-car"><img alt="" src="a/coupe.webp"></div></div></div>
<div class="le-dash"><div class="le-gauges">${dial('small',8,2,6.5,'ОБ/МИН')}${dial('',280,40,260,'КМ/Ч')}</div><div class="le-wallet"><span class="le-k">Баланс, USDT</span><strong data-b></strong></div><label class="le-stake"><span class="le-k">Ставка</span><select data-s id="stake">${['0.10','0.20','0.50','1','2','5','10','20','50'].map(v=>`<option value="${v}">${Number(v).toFixed(2).replace('.',',')}</option>`).join('')}</select></label><button class="le-gear" type="button" aria-label="Настройки">⚙</button><button class="le-go" type="button" data-go><div><span data-g1></span><small data-g2></small></div>${arrow}</button><div class="le-tools"><button type="button">Звук: вкл.</button><button type="button">Правила</button></div><div class="le-foot"><p class="le-msg" data-m></p><div class="le-plates" data-h></div></div></div></div>`;
function pos(v:number){return v<=8?Math.log2(v)/3*72:72+Math.log(v/8)/Math.log(100/8)*28;}
const money=(n:number)=>n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const root=document.querySelector<HTMLElement>('.le')!;root.innerHTML=html;const $=<T extends HTMLElement=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
let phase:Phase='idle',run=1,t0=0,v0=1,value=1,paid=0,balance=1000,fast=1,quiet=matchMedia('(prefers-reduced-motion: reduce)').matches,net=0,lock=0,restored=false,shown=false,queued:null|{at:number;what:'win'|'loss'}=null,paused=false;
const hist:[number,boolean][]=[[4.02,false],[1.25,true],[2.86,true],[1.07,false]];
const stake=()=>Number($<HTMLSelectElement>('[data-s]').value);
const txt=(s:string,v:string)=>{const e=$(s);if(e.textContent!==v)e.textContent=v;};
function plates(){$('[data-h]').innerHTML=hist.slice(0,7).map(([v,w])=>`<span class="le-plate${w?'':' loss'}">${v.toFixed(2)}×</span>`).join('');}
function go(p:Phase){restored=false;phase=p;$('.le-card').hidden=true;shown=false;}
function start(now:number){run++;balance-=stake();v0=1;value=1;t0=now;go('waiting');queued=null;}
function finish(win:boolean,now:number){value=Math.floor(value*100)/100;const exact=Math.round(stake()*100*Math.round(value*100));paid=win?Math.floor(exact/100)/100:0;net=win?Math.round((paid-stake())*100)/100:-stake();lock=now+900;balance+=paid;hist.unshift([value,win]);plates();go(win?'escaped':'crashed');queued=null;$('.le-mult').classList.remove('bump');void $('.le-mult').offsetWidth;$('.le-mult').classList.add('bump');}
const V:Record<string,[string,number]>={helicopter:['вертолёт',heli.depart+1.4],'cargo-plane':['самолёт',cargo.departure+.7],coast:['тоннель',coast.slide+2.1]};
(async()=>{
 const img:Record<string,HTMLImageElement>={};await Promise.all(names.map(async n=>{const i=new Image();i.src='a/'+n+'.webp';await i.decode();img[n]=i;}));
 const scene=new Scene($('canvas') as unknown as HTMLCanvasElement,img);plates();
 const needles=root.querySelectorAll<SVGGElement>('[data-needle]');let car=0;
 $('[data-go]').onclick=()=>{const now=performance.now();if(phase==='racing')finish(true,now);else if(phase!=='waiting'&&now>=lock)start(now);};
 const ACT:Record<string,string>={swipe:'swipe',wall:'wall',block:'block',pincer:'pincer',traffic:'traffic',board:'board'};
 const scenario=(k:string)=>{const now=performance.now();document.querySelectorAll('[data-sc]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.sc===k)));
  const race=(v:number)=>{run++;scene.paint(now,'waiting',1,quiet,String(run),run);scene.jumpZone(v);run++;scene.prime(ACT[k]??'');v0=value=v;t0=now;go('racing');queued=null;};
  if(k==='idle'){run++;value=1;go('idle');scene.reset();scene.jumpZone(1);}
  if(k==='start')start(now);if(k==='race')race(1.32);if(ACT[k])race(k==='swipe'||k==='traffic'?1.3:k==='wall'||k==='board'?2.4:4.6);if(k==='b2'){race(1.9);}if(k==='b4'){race(3.8);}if(k==='b8'){race(7.6);}
  if(k==='saved'){run++;value=9.4;paid=Math.floor(stake()*940+1e-6)/100;net=paid-stake();go('escaped');restored=true;}if(k==='edge'){race(7.75);queued={at:now+700,what:'win'};}if(k==='back'){race(1.0);queued={at:now+900,what:'win'};}
  if(k==='crash'){race(4.6);queued={at:now+2300,what:'loss'};}if(k==='heli'){race(1.5);queued={at:now+2000,what:'win'};}if(k==='plane'){race(2.7);queued={at:now+2000,what:'win'};}if(k==='coast'){race(12.4);queued={at:now+2000,what:'win'};}};
 document.querySelectorAll<HTMLElement>('[data-sc]').forEach(b=>b.onclick=()=>scenario(b.dataset.sc!));
 const q=document.querySelector<HTMLInputElement>('#quiet');if(q){q.checked=quiet;q.onchange=()=>{quiet=q.checked;};}
 (window as any).mock={scenario,scene};
 function tick(now:number){
  requestAnimationFrame(tick);
  if(phase==='waiting'&&now-t0>=2000){phase='racing';t0=now;}
  if(phase==='racing'){value=Math.min(100,v0*Math.exp(.06*fast*(now-t0)/1000));if(queued&&now>=queued.at)finish(queued.what==='win',now);else if(value>=100)finish(true,now);}
  const stageBox=$('.le-stage');const mb=$('.le-mult');scene.top=mb.offsetTop+mb.offsetHeight;
  scene.paint(now,phase,value,quiet,phase+run,run,restored);void stageBox;
  root.dataset.phase=phase;const j=quiet?0:scene.jolt;root.style.setProperty('--j',j<.02?'0':j.toFixed(3));root.style.setProperty('--jd',(Math.sin(now*.05)*j).toFixed(3));const s=stake(),z=zoneOf(value);
  txt('[data-v]',phase==='waiting'?String(Math.max(1,Math.ceil((2000-(now-t0))/1000))):(Math.floor(value*100+1e-6)/100).toFixed(2));txt('[data-f]',phase==='racing'?String(Math.floor(value*1000)%10):'');$('.le-mult u').hidden=phase==='waiting';
  txt('[data-cap]',{idle:'ТВОЙ ЗАЕЗД',waiting:'ДО СТАРТА',racing:'МНОЖИТЕЛЬ ЗАЕЗДА',escaped:'ТЫ УШЁЛ ОТ ПОГОНИ',crashed:'ПЕРЕХВАТ'}[phase]);
  $('[data-st]').classList.toggle('calm',phase==='idle');txt('[data-st]',{idle:'У каждого заезда есть последний съезд',waiting:'Пристегнись',racing:'Успей уйти до аварии',escaped:net>0?'Выплата +'+money(paid):'Возврат '+money(paid),crashed:'Ставка '+money(s)+' проиграна'}[phase]);
  const n=phase==='idle'||phase==='waiting'?1:z+1;txt('[data-nk]',n>3?'ДО ФИНИША':'ДАЛЬШЕ');$('[data-nx]').innerHTML!==(n>3?'Финиш <em>100×</em>':`${ZN[n]} <em>${[1,2,4,8][n]}×</em>`)&&($('[data-nx]').innerHTML=n>3?'Финиш <em>100×</em>':`${ZN[n]} <em>${[1,2,4,8][n]}×</em>`);
  const go1=$<HTMLButtonElement>('[data-go]'),live=phase==='racing'||phase==='waiting';go1.classList.toggle('exit',live);go1.dataset.tab='СЪЕЗД '+(Math.min(3,z)+1);go1.disabled=phase==='waiting'||(phase==='escaped'||phase==='crashed')&&now<lock;
  txt('[data-g1]',live?'УЙТИ ОТ ПОГОНИ':phase==='idle'?'НАЧАТЬ ЗАЕЗД':'ЕЩЁ ОДИН ЗАЕЗД');txt('[data-g2]',live?'≈ '+money(Math.floor(s*value*100+1e-6)/100):'Ставка '+money(s));
  $<HTMLSelectElement>('[data-s]').disabled=live;txt('[data-b]',money(balance));
  const vn=V[scene.variant]?.[0];
  txt('[data-m]',{idle:'Выбери ставку. Множитель растёт до 100×.',waiting:'Ставка принята: '+money(s)+'.',racing:ZN[scene.zoneIndex]+'. Чем дальше, тем выше риск.',escaped:net>0?`Съезд на ${value.toFixed(2)}×, ${vn}. Зачислено ${money(paid)}.`:`Съезд на ${value.toFixed(2)}×. Ставка ${money(paid)} вернулась.`,crashed:`Авария на ${value.toFixed(2)}×. Выплата 0,00.`}[phase]);
  const target=pos(phase==='idle'||phase==='waiting'?1:value);car+=(target-car)*.12;if(Math.abs(target-car)>40)car=target;$('.le-car').style.left=car+'%';$('.le-fill').style.width=car+'%';
  root.querySelectorAll<HTMLElement>('.le-stop').forEach((e,i)=>{e.classList.toggle('on',i<=z&&phase!=='idle'&&phase!=='waiting'||i===0);e.classList.toggle('cur',i===z);});
  needles[0].style.transform=`rotate(${-220+260*Math.min(1,scene.rpm)}deg)`;needles[1].style.transform=`rotate(${-220+260*Math.min(1,scene.speed/280)}deg)`;
  if((phase==='escaped'||phase==='crashed')&&!shown){const wait=quiet||restored?0:phase==='crashed'?explosionAt+1.5:V[scene.variant]?.[1]??2;if(quiet||restored||scene.endingAge>wait){shown=true;const c=$('.le-card');c.dataset.tone=phase==='crashed'?'loss':net>=7*s?'big':net>0?'win':'flat';txt('[data-c1]',phase==='crashed'?'ПОГОНЯ ОКОНЧЕНА':'СЪЕЗД '+value.toFixed(2)+'× · '+(vn??'').toUpperCase());txt('[data-c2]',phase==='crashed'?'ПЕРЕХВАТ':net>0?'ТЫ УШЁЛ':'СТАВКА ВЕРНУЛАСЬ');txt('[data-c3]',phase==='crashed'?'Авария на '+value.toFixed(2)+'×. Ставка '+money(s)+' проиграна':net>0?'+'+money(paid)+' USDT':money(paid)+' USDT');c.hidden=false;}}
 }
 requestAnimationFrame(tick);document.documentElement.dataset.ready='1';
})();
// device frames
const dev=document.querySelector<HTMLElement>('.dev')!,wrap=document.querySelector<HTMLElement>('.devwrap')!;
const S:Record<string,[number,number]>={desktop:[1440,900],phone:[393,852],land:[852,393]};
function device(k:string){dev.dataset.k=k;const [w,h]=S[k];dev.style.width=w+'px';dev.style.height=h+'px';document.querySelectorAll<HTMLElement>('[data-dev]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dev===k)));const max=wrap.clientWidth,vh=Math.max(420,innerHeight-190),sc=Math.min(k==='desktop'?1.1:1,max/w,k==='phone'?Math.max(.62,vh/h):9);dev.style.transform=`scale(${sc})`;wrap.style.height=h*sc+'px';dev.style.left=Math.max(0,(max-w*sc)/2)+'px';}
document.querySelectorAll<HTMLElement>('[data-dev]').forEach(b=>b.onclick=()=>device(b.dataset.dev!));
let cur=innerWidth<720?'phone':'desktop';device(cur);addEventListener('resize',()=>device(dev.dataset.k!));(window as any).device=device;
