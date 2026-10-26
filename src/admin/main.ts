import './style.css';
import { FINANCE_KINDS,FINANCE_SOURCES,FINANCE_STATUSES,type FinanceSource,type FinanceReport,type FinanceOperation,type FinanceFilters,type FinanceGroup } from '../shared/financeAdmin';
import {gameNames} from './gameNames';

const root=document.querySelector<HTMLDivElement>('#admin-app')!;
const gameTitle=(id:string)=>gameNames[id]??id;
const h=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(value:string|null|undefined)=>{
  if(value===null||value===undefined)return 'Не подтверждено';
  const n=BigInt(value),abs=n<0n?-n:n,fraction=(abs%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
  return(n<0n?'−':'')+(abs/1000000n).toLocaleString('ru-RU')+','+fraction;
};
const date=(at:number|null)=>at===null?'Дата не сохранена':new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'}).format(at);
const units=(raw:string)=>{
  const v=raw.trim().replace(',','.');if(!/^\d{1,7}(\.\d{1,6})?$/.test(v))throw new Error('Укажи сумму с точностью до шести знаков.');
  const[a,b='']=v.split('.');return(BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'))).toString();
};
type Account={id:string;name:string;email:string;blocked?:boolean;joinedAt?:number;blockReason?:string};
let account:Account|undefined,report:FinanceReport|undefined,source:FinanceSource='payments',tab='overview',page=1,busy=false,sequence=0;
let sources:Record<FinanceSource,boolean>={payments:false,nile:false,mainnet:false},coverage='',profile:Account|undefined;
let filters:FinanceFilters={page:1,size:25},playerQuery='',audit:{count:number;rows:any[]}|undefined;
let pendingAction:Record<string,any>|undefined;
const actionKey=()=>`royal-finance-action:${account?.id}`;

async function api(path:string,body?:unknown){
  let response:Response,result:any;
  try{
    response=await fetch('/api/admin/'+path,{credentials:'same-origin',cache:'no-store',method:body===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',...(account?{'x-royal-admin-account':account.id}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    result=await response.json();
  }catch{throw new Error('Ответ сервера не получен. Проверь соединение и повтори запрос.');}
  if(!response.ok){const error=new Error(result.error??'Запрос не выполнен.') as Error&{status:number;rejectedCommandId?:string};error.status=response.status;error.rejectedCommandId=result.rejectedCommandId;throw error;}return result;
}
function notice(message:string,error=false){
  let el=document.querySelector('#notice');if(!el){el=document.createElement('div');el.id='notice';el.setAttribute('role','status');document.body.append(el);}
  el.className=error?'notice error':'notice';el.textContent=message;window.setTimeout(()=>el?.remove(),7000);
}
function login(message=''){
  root.innerHTML=`<main class="login-wrap"><section class="login-card"><a class="brand" href="/">Р<span>Рояль</span></a><span class="eyebrow">КАБИНЕТ ВЛАДЕЛЬЦА</span><h1>Финансы под контролем</h1><p>Войди своим аккаунтом казино. Доступ открыт назначенным администраторам.</p><form id="login"><label>Почта<input name="email" type="email" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></label><p class="form-error" role="alert">${h(message)}</p><button class="primary" type="submit">Войти в кабинет <span>↗</span></button></form><a href="/" class="muted">Вернуться в казино</a></section><aside class="login-aside"><span>РОЯЛЬ / ФИНАНСЫ</span><div class="orbit"></div><h2>Каждая операция.<br>Каждый игрок.</h2><p>Реальные и тестовые средства.<br>Единая история движения денег.</p></aside></main>`;
  document.querySelector<HTMLFormElement>('#login')!.onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget as HTMLFormElement,button=form.querySelector('button')!;button.disabled=true;
    try{
      const values=new FormData(form),response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:values.get('email'),password:values.get('password')})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??'Не удалось войти.');
      await start();
    }catch(error){form.querySelector('.form-error')!.textContent=(error as Error).message;button.disabled=false;}
  };
}
function shell(){
  root.innerHTML=`<div class="layout"><aside class="sidebar"><a class="brand" href="/">Р<span>Рояль<small>ФИНАНСОВЫЙ КАБИНЕТ</small></span></a><span class="nav-label">РАБОЧЕЕ МЕСТО</span><nav>${[['overview','◫','Сводка'],['operations','⇄','Операции'],['players','♙','Игроки'],['games','◇','Игры'],['audit','☷','Действия']].map(([id,icon,title])=>`<button data-tab="${id}"><i>${icon}</i>${title}</button>`).join('')}</nav><div class="sidebar-note"><span class="lock-icon">◈</span><strong>Доступ владельца</strong><p>Денежные действия сохраняются в журнале.</p></div><div class="account"><span class="avatar">${h(account!.name.slice(0,1))}</span><div><strong>${h(account!.name)}</strong><small>${h(account!.email)}</small></div><button id="logout" aria-label="Выйти" title="Выйти">↗</button></div></aside>
  <main class="workspace"><header class="topbar"><div><span class="eyebrow">РОЯЛЬ / УПРАВЛЕНИЕ</span><h1>Финансы казино<span class="title-dot"></span></h1><p>Движение средств, игроки и результаты игр</p></div><div class="header-actions"><a href="/">Открыть казино ↗</a><button id="refresh" class="secondary">↻ Обновить</button><button id="mobile-logout" class="text-button mobile-only">Выйти</button></div></header>
  <section class="filters panel" aria-label="Фильтры"><div class="filter-top"><label class="source-label">Денежный контур<select id="source">${Object.entries(FINANCE_SOURCES).map(([id,name])=>`<option value="${id}">${h(name)}</option>`).join('')}</select></label><div class="range-buttons" aria-label="Быстрый период"><button data-range="1">Сегодня</button><button data-range="7">7 дней</button><button data-range="30">30 дней</button><button data-range="all" class="selected">Всё время</button></div><span class="timezone">Время: Москва</span></div>
  <form id="filters"><label>Игрок<input id="player-query" placeholder="Имя, почта или ID" maxlength="254" autocomplete="off"></label><label>Дата от<input id="from" type="date"></label><label>Дата до<input id="to" type="date"></label><label>Игра<input id="game" list="game-options" placeholder="Все игры" maxlength="80"><datalist id="game-options"></datalist></label><label>Противник<select id="mode"><option value="">Любой</option><option value="house">Казино</option><option value="pvp">Другой игрок</option></select></label><label>Операция<select id="kind"><option value="">Все операции</option>${Object.entries(FINANCE_KINDS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Статус<select id="status"><option value="">Любой статус</option>${Object.entries(FINANCE_STATUSES).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Сумма от, USDT<input id="min" inputmode="decimal" placeholder="0,00"></label><label>Сумма до, USDT<input id="max" inputmode="decimal" placeholder="Без лимита"></label><div class="filter-actions"><button class="primary">Применить</button><button id="reset-filters" type="button" class="text-button">Сбросить</button></div></form></section>
  <div id="source-state" role="status"></div><section id="content" aria-live="polite"></section><footer class="footer"><span id="updated"></span><span>Точный учёт USDT · Демо исключено</span></footer></main></div><dialog id="modal"></dialog><aside id="profile" class="profile" hidden aria-label="Карточка игрока"></aside><div id="shade" hidden></div>`;
  document.querySelector<HTMLSelectElement>('#source')!.value=source;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab!;page=1;void load();});
  document.querySelector<HTMLButtonElement>('#refresh')!.onclick=()=>void load();
  document.querySelector<HTMLButtonElement>('#logout')!.onclick=async()=>{await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});account=undefined;profile=undefined;document.querySelector('#shade')?.setAttribute('hidden','');login();};
  document.querySelector<HTMLButtonElement>('#mobile-logout')!.onclick=()=>document.querySelector<HTMLButtonElement>('#logout')!.click();
  document.querySelector<HTMLSelectElement>('#source')!.onchange=event=>{source=(event.target as HTMLSelectElement).value as FinanceSource;page=1;closeProfile();void load();};
  document.querySelector<HTMLFormElement>('#filters')!.onsubmit=event=>{event.preventDefault();applyFilters();};
  document.querySelector<HTMLButtonElement>('#reset-filters')!.onclick=()=>{document.querySelector<HTMLFormElement>('#filters')!.reset();playerQuery='';filters={page:1,size:25};page=1;void load();};
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button=>button.onclick=()=>{
    const now=new Date(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const end=document.querySelector<HTMLInputElement>('#to')!,start=document.querySelector<HTMLInputElement>('#from')!;
    if(button.dataset.range==='all'){end.value='';start.value='';}else{
      end.value=today;const startAt=new Date(Date.parse(today+'T00:00:00+03:00')-(Number(button.dataset.range)-1)*86400000);
      start.value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(startAt);
    }
    document.querySelectorAll('[data-range]').forEach(el=>el.classList.toggle('selected',el===button));applyFilters();
  });
  document.querySelector('#shade')!.addEventListener('click',closeProfile);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector<HTMLDialogElement>('#modal')?.open)closeProfile();});
}
function applyFilters(){
  try{
    const value=(id:string)=>document.querySelector<HTMLInputElement>('#'+id)!.value.trim();
    const f:FinanceFilters={page:1,size:25};
    if(value('from'))f.from=Date.parse(value('from')+'T00:00:00+03:00');
    if(value('to'))f.to=Date.parse(value('to')+'T00:00:00+03:00')+86400000;
    if(f.from!==undefined&&f.to!==undefined&&f.from>=f.to)throw new Error('Проверь границы периода.');
    for(const key of ['game','mode','kind','status'] as const)if(value(key))(f as any)[key]=key==='game'?(Object.entries(gameNames).find(([,title])=>title.toLowerCase()===value(key).toLowerCase())?.[0]??value(key)):value(key);
    if(value('min'))f.minUnits=units(value('min'));if(value('max'))f.maxUnits=units(value('max'));
    if(f.minUnits&&f.maxUnits&&BigInt(f.minUnits)>BigInt(f.maxUnits))throw new Error('Минимальная сумма больше максимальной.');
    filters=f;playerQuery=value('player-query');page=1;void load();
  }catch(error){notice((error as Error).message,true);}
}
async function load(){
  const run=++sequence;busy=true;report=undefined;audit=undefined;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
  document.querySelector('#content')!.innerHTML='<div class="loading"><span></span>Загружаем подтверждённые данные…</div>';
  document.querySelector('#source-state')!.innerHTML='';
  try{
    if(tab==='audit'){
      const ids=playerQuery?(await api('search',{query:playerQuery})).rows:[];
      if(playerQuery&&ids.length!==1)throw new Error('Для истории действий укажи точную почту или ID одного игрока.');
      const result=await api('audit',{page,from:filters.from,to:filters.to,...(ids.length?{playerId:ids[0].id}:{})});if(run!==sequence)return;audit=result;
    }else{
      if(!sources[source])throw new Error('Этот денежный контур сейчас не подключён. Выбери другой контур.');
      const result=await api('report',{source,filters:{...filters,page},playerQuery});if(run!==sequence)return;report=result;
    }
    busy=false;render();
  }catch(error){
    if(run!==sequence)return;busy=false;
    document.querySelector('#content')!.innerHTML=`<div class="empty panel"><span class="empty-icon">◈</span><h2>Данные пока недоступны</h2><p>${h((error as Error).message)}</p><button id="retry" class="primary">Повторить проверку</button></div>`;
    document.querySelector<HTMLButtonElement>('#retry')!.onclick=()=>void load();
  }
}
const badge=(r:FinanceOperation)=>`<span class="badge ${r.status}">${h(FINANCE_STATUSES[r.status])}</span>`;
const playerLink=(id:string,name?:string,email?:string)=>id?`<button class="player-link" data-player="${h(id)}"><span class="mini-avatar">${h((name??id).slice(0,1))}</span><span><strong>${h(name??id.slice(0,8))}</strong><small>${h(email??id.slice(0,8))}</small></span></button>`:'<span class="muted">Кошелёк резерва / без привязки</span>';
function rowsTable(rows:FinanceOperation[],compact=false){
  return `<div class="table-scroll"><table><thead><tr><th>Дата, МСК</th>${compact?'':'<th>Игрок</th>'}<th>Операция / игра</th><th class="number">Сумма, USDT</th><th class="number">Изменение баланса</th><th>Статус</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td class="date-cell">${h(date(r.createdAt))}</td>${compact?'':`<td>${playerLink(r.playerId,r.playerName,r.playerEmail)}</td>`}<td><strong>${h(FINANCE_KINDS[r.kind])}</strong><small>${h(gameTitle(r.game)||r.currency)}${r.mode?' · '+(r.mode==='pvp'?'против игрока':'против казино'):''}</small></td><td class="number">${money(r.amountUnits)}</td><td class="number ${BigInt(r.deltaUnits)>0n?'positive':BigInt(r.deltaUnits)<0n?'negative':''}">${BigInt(r.deltaUnits)>0n?'+':''}${money(r.deltaUnits)}</td><td>${badge(r)}</td><td><button class="row-button" data-operation="${h(r.id)}" aria-label="Открыть операцию">↗</button></td></tr>`).join(''):`<tr><td colspan="7"><div class="table-empty">Операций по этим фильтрам нет</div></td></tr>`}</tbody></table></div>`;
}
function pager(count:number){const pages=Math.max(1,Math.ceil(count/25));return`<div class="pagination"><span>Всего: ${count.toLocaleString('ru-RU')} · Страница ${page} из ${pages}</span><div><button data-page="${page-1}" ${page<=1?'disabled':''}>← Назад</button><button data-page="${page+1}" ${page>=pages?'disabled':''}>Далее →</button></div></div>`;}
function metric(title:string,value:string|null,note:string,color=''){return`<article class="metric ${color}"><span>${title}</span><strong>${money(value)}<small> USDT</small></strong><p>${note}</p></article>`;}
function chart(){
  const days=report!.days,max=days.reduce((n,d)=>[BigInt(d.deposits),BigInt(d.withdrawals),n].reduce((a,b)=>a>b?a:b),1n);
  return`<div class="chart-head"><div><span class="eyebrow">ДЕНЕЖНЫЙ ПОТОК</span><h2>Поступления и выводы</h2></div><span><i class="legend in"></i>Поступления <i class="legend out"></i>Выводы</span></div>${days.length?`<div class="chart" role="img" aria-label="Поступления и выводы по дням">${days.map(d=>`<div class="chart-day" tabindex="0" aria-label="${h(d.date)}, поступления ${money(d.deposits)}, выводы ${money(d.withdrawals)}"><div class="chart-tooltip">${h(d.date)}<br>Поступления ${money(d.deposits)}<br>Выводы ${money(d.withdrawals)}</div><i style="height:${Number(BigInt(d.deposits)*1000n/max)/10}%"></i><b style="height:${Number(BigInt(d.withdrawals)*1000n/max)/10}%"></b><small>${h(d.date.slice(5).split('-').reverse().join('.'))}</small></div>`).join('')}</div>`:'<div class="chart-empty">Пока нет операций с сохранённой датой</div>'}<p class="chart-caption">Последние 60 дней с операциями в выбранном периоде. Только фактически зачисленные поступления и завершённые выводы.</p>`;
}
function groupsTable(groups:FinanceGroup[],players:boolean){
  return`<div class="table-scroll"><table><thead><tr><th>${players?'Игрок':'Игра'}</th>${players?'<th>Доступно сейчас, USDT</th>':''}<th class="number">Партий</th><th class="number">Ставки, USDT</th><th class="number">Выплаты, USDT</th><th class="number">Результат казино</th>${players?'<th>Доступ</th>':''}</tr></thead><tbody>${groups.length?groups.map(g=>`<tr><td>${players?playerLink(g.id,g.name,g.email):`<button class="game-link" data-game="${h(g.id)}">${h(gameTitle(g.id))} ↗</button>`}</td>${players?`<td>${report!.wallets[g.id]?money(report!.wallets[g.id].available):'Нет кошелька'}</td>`:''}<td class="number">${g.rounds}</td><td class="number">${money(g.stakes)}</td><td class="number">${money(g.payouts)}</td><td class="number ${BigInt(g.ggr)<0n?'negative':'positive'}">${money(g.ggr)}</td>${players?`<td><span class="badge ${g.blocked?'review':'finished'}">${g.blocked?'Приостановлен':'Открыт'}</span></td>`:''}</tr>`).join(''):'<tr><td colspan="8"><div class="table-empty">Данных по этим фильтрам нет</div></td></tr>'}</tbody></table></div>`;
}
function render(){
  const content=document.querySelector('#content')!;
  if(tab==='audit'){
    content.innerHTML=`<section class="panel"><div class="section-head"><div><span class="eyebrow">КОНТРОЛЬ ИЗМЕНЕНИЙ</span><h2>Действия администратора</h2></div></div><p class="panel-copy">Автор, игрок, причина и результат каждого действия. «Повторить» означает, что итог нужно проверить тем же номером действия.</p><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Действие / контур</th><th>Игрок</th><th>Автор</th><th>Причина</th><th>Состояние</th></tr></thead><tbody>${audit!.rows.length?audit!.rows.map(r=>`<tr><td>${date(Number(r.created_at))}</td><td>${h(({adjust:'Корректировка',block:'Блокировка',unblock:'Разблокировка',refresh:'Проверка платежа'} as any)[r.action])}<small>${h(FINANCE_SOURCES[r.source as FinanceSource])}</small></td><td>${playerLink(r.player_id)}</td><td><code>${h(r.actor_id)}</code></td><td class="reason">${h(r.reason)}<small>${h(r.command_id)}</small></td><td><span class="badge ${r.state==='completed'?'finished':'review'}">${h(({completed:'Выполнено',pending:'Начато',retry:'Нужна проверка',rejected:'Отклонено'} as any)[r.state])}</span></td></tr>`).join(''):'<tr><td colspan="6"><div class="table-empty">Действий пока нет</div></td></tr>'}</tbody></table></div>${pager(audit!.count)}</section>`;
  }else{
    const r=report!,t=r.totals;
    document.querySelector('#source-state')!.innerHTML=`<div class="source-banner ${r.environment==='test'?'test':''}"><span class="environment">${r.environment==='test'?'ТЕСТОВЫЕ СРЕДСТВА':'РЕАЛЬНЫЕ СРЕДСТВА'}</span><span>${h(r.balances.note??'Подтверждённый денежный журнал')}</span>${!r.enabled?'<b>Приём платежей отключён</b>':''}</div>${t.undated?`<div class="undated">У ${t.undated} исторических операций дата не сохранена. При выборе периода они исключаются. Их можно увидеть за всё время.</div>`:''}`;
    document.querySelector('#game-options')!.innerHTML=r.games.map(g=>`<option value="${h(g.id)}" label="${h(gameTitle(g.id))}">`).join('');
    const heading=tab==='overview'?'Последние операции':tab==='operations'?'Журнал операций':tab==='players'?'Игроки с денежными операциями':'Результаты по играм';
    const top=tab==='overview'?`<div class="section-label"><span>ОПЕРАЦИИ ПО ВЫБРАННЫМ ФИЛЬТРАМ</span><span>${t.count.toLocaleString('ru-RU')} операций</span></div><div class="metrics">${metric('Зачисленные пополнения',t.deposits,'Фактически получено на балансы','green')}${metric('Завершённые выводы',t.withdrawals,'Списано по завершённым выплатам')}${metric('Результат казино в играх',t.ggr,'Включая комиссию PvP: '+money(t.fees)+' USDT','violet')}${metric('Корректировки',t.adjustments,`${t.pending} операций требуют завершения`)}</div><div class="overview-grid"><section class="panel flow-panel">${chart()}</section><section class="panel balance-panel"><span class="eyebrow">ОСТАТКИ ВСЕГО КОНТУРА СЕЙЧАС</span><h2>Распределение средств</h2><p>Остатки не зависят от фильтра периода.</p><dl><div><dt>На балансах игроков</dt><dd>${money(r.balances.players)}</dd></div><div><dt>Зарезервировано</dt><dd>${money(r.balances.reserved)}</dd></div><div><dt>Свободный резерв казино</dt><dd>${money(r.balances.house)}</dd></div><div class="balance-total"><dt>Подтверждённые средства</dt><dd>${money(r.balances.treasury)}</dd></div></dl><small>Сверка: ${r.balances.checkedAt?date(r.balances.checkedAt):'время не подтверждено'}</small></section></div>`:'';
    content.innerHTML=top+`<section class="panel"><div class="section-head"><div><span class="eyebrow">${tab==='games'?'СТАВКИ И ВЫПЛАТЫ':'ДЕНЕЖНЫЙ УЧЁТ'}</span><h2>${heading}</h2></div><div class="section-actions">${tab==='players'?'<button id="find-player" class="primary">Найти игрока</button>':''}${tab==='overview'||tab==='operations'?'<button id="export" class="secondary">CSV страницы ↓</button>':''}</div></div>${tab==='players'?groupsTable(r.players,true):tab==='games'?groupsTable(r.games,false):rowsTable(tab==='overview'?r.rows.slice(0,8):r.rows)}${tab==='overview'?'<div class="panel-bottom"><button data-tab="operations" class="text-button">Весь журнал операций →</button></div>':pager(tab==='players'?r.playerCount:tab==='games'?r.gameCount:t.count)}</section><div class="coverage panel"><span>◈</span><div><strong>Покрытие денежных игр</strong><p>${h(coverage)}</p><p>Результат казино: ставки минус выплаты в играх против казино плюс комиссия PvP. Покупки учитываются отдельно. Расходы бизнеса не включены.</p></div></div>`;
  }
  if(pendingAction)content.insertAdjacentHTML('afterbegin',`<div class="pending-action">Есть действие без подтверждённого ответа: ${h(pendingAction.id)}. <button id="resume-action">Проверить тем же номером</button></div>`);
  document.querySelector<HTMLButtonElement>('#resume-action')?.addEventListener('click',()=>actionModal(pendingAction!));
  bindLinks(content);
  content.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab!;page=1;void load();});
  content.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);void load();});
  content.querySelectorAll<HTMLButtonElement>('[data-game]').forEach(b=>b.onclick=()=>{document.querySelector<HTMLInputElement>('#game')!.value=b.dataset.game!;tab='operations';applyFilters();});
  document.querySelector<HTMLButtonElement>('#export')?.addEventListener('click',exportPage);
  document.querySelector<HTMLButtonElement>('#find-player')?.addEventListener('click',findPlayer);
  document.querySelector('#updated')!.textContent='Проверено: '+date(report?.generatedAt??Date.now());
}
function bindLinks(container:Element){
  container.querySelectorAll<HTMLButtonElement>('[data-player]').forEach(b=>b.onclick=()=>void openProfile(b.dataset.player!));
  container.querySelectorAll<HTMLButtonElement>('[data-operation]').forEach(b=>b.onclick=()=>{
    const op=report?.rows.find(r=>r.id===b.dataset.operation)||(profile as any)?.report?.rows.find((r:FinanceOperation)=>r.id===b.dataset.operation);if(op)operationModal(op);
  });
}
async function openProfile(id:string){
  const el=document.querySelector<HTMLElement>('#profile')!;el.hidden=false;document.querySelector<HTMLElement>('#shade')!.hidden=false;el.innerHTML='<div class="loading">Загружаем карточку…</div>';
  try{
    const person=await api('players/'+encodeURIComponent(id));profile=person;
    const r:FinanceReport=await api('report',{source,filters:{...filters,playerIds:[id],page:1,size:25}});
    if(profile?.id!==id||el.hidden)return;(profile as any).report=r;
    const wallet=r.wallets[id];
    el.innerHTML=`<button id="close-profile" class="close" aria-label="Закрыть карточку">×</button><span class="eyebrow">КАРТОЧКА ИГРОКА</span><div class="profile-person"><span class="avatar">${h(person.name.slice(0,1))}</span><h2>${h(person.name)}</h2><p>${h(person.email)}</p><code>${h(person.id)}</code><small>В казино с ${date(Number(person.joinedAt))}</small></div><span class="badge ${person.blocked?'review':'finished'}">${person.blocked?'Денежные операции приостановлены':'Денежные операции открыты'}</span>${person.blocked?`<p class="block-reason">${h(person.blockReason)}</p>`:''}<div class="profile-balance"><span>${h(FINANCE_SOURCES[source])}</span><strong>${wallet?money(wallet.available):'Кошелёк не создан'}${wallet?' USDT':''}</strong><small>Зарезервировано: ${wallet?money(wallet.reserved):'0,00'} USDT</small></div><div class="profile-actions"><button id="adjust-player" class="primary" ${wallet&&source==='payments'?'':'disabled'}>Корректировать баланс</button><button id="block-player" class="secondary">${person.blocked?'Открыть денежные операции':'Приостановить денежные операции'}</button></div><div class="profile-totals"><div><span>Пополнения</span><strong>${money(r.totals.deposits)}</strong></div><div><span>Выводы</span><strong>${money(r.totals.withdrawals)}</strong></div><div><span>Ставки</span><strong>${money(r.totals.stakes)}</strong></div><div><span>Выплаты в играх</span><strong>${money(r.totals.payouts)}</strong></div></div><h3>История по выбранным фильтрам</h3><p class="muted">Показаны последние 25 операций. Учитываются выбранные период, игра, тип и статус операции.</p>${rowsTable(r.rows,true)}<button id="all-player-ops" class="secondary">Все операции этого игрока →</button>`;
    el.querySelector<HTMLButtonElement>('#close-profile')!.onclick=closeProfile;
    el.querySelector<HTMLButtonElement>('#adjust-player')!.onclick=()=>actionModal({action:'adjust',playerId:id});
    el.querySelector<HTMLButtonElement>('#block-player')!.onclick=()=>actionModal({action:person.blocked?'unblock':'block',playerId:id});
    el.querySelector<HTMLButtonElement>('#all-player-ops')!.onclick=()=>{document.querySelector<HTMLInputElement>('#player-query')!.value=id;tab='operations';closeProfile();applyFilters();};bindLinks(el);
  }catch(error){el.innerHTML=`<button class="close" id="close-profile">×</button><h2>Карточка недоступна</h2><p>${h((error as Error).message)}</p>`;el.querySelector<HTMLButtonElement>('#close-profile')!.onclick=closeProfile;}
}
function closeProfile(){profile=undefined;const el=document.querySelector<HTMLElement>('#profile')!;el.hidden=true;el.innerHTML='';document.querySelector<HTMLElement>('#shade')!.hidden=true;}
function modal(html:string){const el=document.querySelector<HTMLDialogElement>('#modal')!;el.innerHTML='<button class="close" aria-label="Закрыть">×</button>'+html;el.querySelector<HTMLButtonElement>('.close')!.onclick=()=>el.close();if(!el.open)el.showModal();return el;}
function operationModal(op:FinanceOperation){
  const el=modal(`<span class="eyebrow">ОПЕРАЦИЯ</span><h2>${h(FINANCE_KINDS[op.kind])}</h2>${badge(op)}<strong class="operation-amount">${money(op.amountUnits)} USDT</strong><dl class="details">${[['Номер',op.id],['Игрок',op.playerName||op.playerId||'Без привязки'],['Контур',FINANCE_SOURCES[source]],['Дата',date(op.createdAt)],['Игра',gameTitle(op.game)],['Партия',op.roundId],['Противник',op.mode==='house'?'Казино':op.opponentName||op.opponentId],['Ставка, USDT',op.kind==='game'?money(op.stakeUnits):''],['Выплата, USDT',op.kind==='game'?money(op.payoutUnits):''],['Комиссия PvP, доля игрока',BigInt(op.feeUnits)>0n?money(op.feeUnits)+' USDT':''],['Изменение баланса, USDT',money(op.deltaUnits)],['Статус сервиса',op.providerStatus],['Транзакция',op.txId],['Валюта',op.currency],['Адрес',op.address],['Автор корректировки',op.actorId],['Причина',op.reason]].filter(([,v])=>v).map(([k,v])=>`<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>${source==='payments'&&['deposit','withdrawal'].includes(op.kind)?'<button id="refresh-op" class="primary">Проверить платёж у провайдера</button>':''}`);
  el.querySelector<HTMLButtonElement>('#refresh-op')?.addEventListener('click',()=>actionModal({action:'refresh',playerId:op.playerId,operationId:op.id,reason:'Повторная проверка статуса платежа'}));
}
function actionModal(data:Record<string,any>){
  const op:Record<string,any>={id:crypto.randomUUID(),source,...data},isAdjust=op.action==='adjust',existing=!!data.id;
  if(pendingAction&&!existing){notice('Сначала проверь действие, для которого ещё нет подтверждённого ответа.',true);return;}
  const title=({adjust:'Корректировка баланса',block:'Приостановить операции',unblock:'Открыть денежные операции',refresh:'Проверить и продолжить платёж'} as any)[op.action];
  const explanation=isAdjust?'Начисление перемещает средства из свободного резерва казино игроку. Списание возвращает средства в резерв. Прежние записи сохраняются.':op.action==='block'?'Новые денежные запросы игрока будут закрыты во всех контурах. Уже принятые платежи и завершение начатых партий продолжат обрабатываться.':op.action==='refresh'?'Сервис сверит платёж и продолжит ранее подтверждённый вывод, если он ожидает обработки. Это может отправить выплату. Действие сохранится в истории.':'Действие и его автор сохранятся в истории.';
  const el=modal(`<span class="eyebrow">ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ</span><h2>${h(title)}</h2><p>${h(FINANCE_SOURCES[op.source as FinanceSource])}</p><p class="action-explanation">${h(explanation)}</p><form id="action-form"><label>ID игрока<input name="playerId" value="${h(op.playerId)}" readonly></label>${isAdjust?`<label>Направление<select name="direction" ${existing?'disabled':''}><option value="credit" ${String(op.deltaUnits).startsWith('-')?'':'selected'}>Начислить из резерва казино</option><option value="debit" ${String(op.deltaUnits).startsWith('-')?'selected':''}>Списать в резерв казино</option></select></label><label>Сумма, USDT<input name="amount" inputmode="decimal" placeholder="0,00" required ${existing?'readonly':''} value="${existing?h(money(String(op.deltaUnits).replace('-','')).replaceAll(' ','').replaceAll(' ','')):''}"></label>`:''}<label>Причина<textarea name="reason" required minlength="5" maxlength="500" ${existing?'readonly':''}>${h(op.reason??'')}</textarea></label><label>Твой пароль для подтверждения<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">${existing?'Повторить то же действие':'Подтвердить действие'}</button></form><small class="muted">Номер: ${h(op.id)}</small>`);
  const form=el.querySelector<HTMLFormElement>('#action-form')!;
  let submitted=existing;
  const lock=()=>{
    form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[name="amount"],[name="reason"]').forEach(input=>input.readOnly=true);
    const direction=form.querySelector<HTMLSelectElement>('[name="direction"]');if(direction)direction.disabled=true;
    form.querySelector('button')!.textContent='Повторить то же действие';
  };
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector<HTMLButtonElement>('button')!,values=new FormData(form);button.disabled=true;
    try{
      if(!submitted){
        op.reason=String(values.get('reason')).trim();
        if(op.reason.length<5||op.reason.length>500||/[\x00-\x1f\x7f]/.test(op.reason))throw new Error('Укажи причину от 5 до 500 символов в одной строке.');
        if(isAdjust){const amount=units(String(values.get('amount')));if(BigInt(amount)===0n||BigInt(amount)>1000000000000n)throw new Error('Сумма должна быть больше нуля и не превышать 1 000 000 USDT.');op.deltaUnits=(values.get('direction')==='debit'?'-':'')+amount;}
      }
      localStorage.setItem(actionKey(),JSON.stringify(op));pendingAction=op;submitted=true;lock();
      const password=String(values.get('password'));(form.elements.namedItem('password') as HTMLInputElement).value='';
      await api('actions',{...op,password});pendingAction=undefined;localStorage.removeItem(actionKey());el.close();notice('Действие выполнено и сохранено в истории.');
      if(profile?.id===op.playerId)void openProfile(op.playerId);void load();
    }catch(error){
      if((error as any).rejectedCommandId===op.id){
        pendingAction=undefined;localStorage.removeItem(actionKey());el.close();notice((error as Error).message,true);void load();return;
      }
      form.querySelector('.form-error')!.textContent=(error as Error).message+(pendingAction?' Повтори действие с этим же номером.':'');button.disabled=false;
    }
  };
}
function findPlayer(){
  const el=modal('<span class="eyebrow">ПОИСК ИГРОКА</span><h2>Найти аккаунт</h2><form id="search-player"><label>Имя, почта или ID<input name="query" required minlength="2" maxlength="254" autofocus></label><button class="primary">Найти</button></form><div id="search-results"></div>');
  el.querySelector<HTMLFormElement>('form')!.onsubmit=async event=>{
    event.preventDefault();const values=new FormData(event.currentTarget as HTMLFormElement);
    try{const result=await api('search',{query:String(values.get('query'))});const box=el.querySelector('#search-results')!;
      box.innerHTML=result.rows.map((p:Account)=>`<div class="search-result">${playerLink(p.id,p.name,p.email)}</div>`).join('')+(result.more?'<p>Показаны первые 25 игроков. Уточни поиск.</p>':'')+(!result.rows.length?'<p>Игроки не найдены.</p>':'');
      box.querySelectorAll<HTMLButtonElement>('[data-player]').forEach(b=>b.onclick=()=>{el.close();void openProfile(b.dataset.player!);});
    }catch(error){notice((error as Error).message,true);}
  };
}
function exportPage(){
  if(!report||busy)return;
  const cell=(v:unknown)=>'"'+String(v??'').replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"';
  const rows=[['Дата МСК','ID операции','ID игрока','Имя','Почта','Тип','Игра','ID партии','Противник','Статус','Сумма USDT','Изменение баланса USDT','Ставка USDT','Выплата USDT','Транзакция','Автор','Причина'],
    ...report.rows.map(r=>[date(r.createdAt),r.id,r.playerId,r.playerName,r.playerEmail,FINANCE_KINDS[r.kind],r.game,r.roundId,r.mode==='house'?'Казино':r.opponentId,FINANCE_STATUSES[r.status],money(r.amountUnits),money(r.deltaUnits),money(r.stakeUnits),money(r.payoutUnits),r.txId,r.actorId,r.reason])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`royal-${source}-page-${page}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function start(){
  try{
    const session=await api('session');account=session.account;sources=session.sources;coverage=session.coverage.pvp;
    if(!sources[source]&&sources.nile)source='nile';
    try{const saved=JSON.parse(localStorage.getItem(actionKey())??'null');if(saved&&saved.id&&saved.playerId)pendingAction=saved;}catch{pendingAction=undefined;}
    shell();await load();
  }catch(error){login((error as any).status===401?'':(error as Error).message);}
}
void start();
