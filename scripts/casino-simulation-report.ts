import type { SimulationReport, PlayerResult } from './simulate-casino';

const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));
const money = (cents: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(cents / 100);
const number = (value: number, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const percent = (value: number) => number(value * 100, 2) + '%';
const duration = (seconds: number) => Math.floor(seconds / 3600) + ' ч ' + Math.floor(seconds % 3600 / 60) + ' мин ' + Math.round(seconds % 60) + ' с';
const profitClass = (cents: number) => cents > 0 ? 'positive' : cents < 0 ? 'negative' : '';

export function renderCasinoReport(report: SimulationReport): string {
  const { example: e, ensemble: s } = report;
  const playerRow = (p: PlayerResult) => `<tr><th scope="row">${p.profile.id}</th>
    <td>${escape(p.profile.label)}<small>${p.games.map(game => escape(game.name)).join(', ')}</small></td>
    <td>${money(p.profile.depositCents)}</td><td>${money(p.withdrawnCents)}</td><td>${money(p.balanceCents)}</td>
    <td class="${profitClass(p.profitCents)}">${money(p.profitCents)}</td>
    <td>${money(p.peakWealthCents)}</td><td>${p.rounds}</td><td>${p.withdrawals.length}</td>
    <td>${duration(p.seconds)}</td><td>${escape(p.stopReason)}</td></tr>`;
  const gameRows = (games: typeof e.games) => games.map(game => `<tr><th scope="row">${escape(game.name)}</th>
    <td>${number(game.rounds)}</td><td>${money(game.stakesCents)}</td><td>${money(game.payoutsCents)}</td>
    <td class="${profitClass(game.stakesCents - game.payoutsCents)}">${money(game.stakesCents - game.payoutsCents)}</td>
    <td>${percent(game.payoutsCents / game.stakesCents)}</td><td>${number(game.freeSpins)}</td></tr>`).join('');
  const withdrawals = e.players.flatMap(player => player.withdrawals.map(row => ({ player: player.profile.id, ...row })))
    .sort((a, b) => a.second - b.second || a.player - b.player);
  const serial = JSON.stringify({ players: e.players, modes: report.modes.map(mode => ({ key: mode.key, name: mode.name })) })
    .replaceAll('<', String.fromCharCode(92) + 'u003c');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Казино: симуляция десяти игроков</title>
<style>
:root{color-scheme:light dark;--paper:light-dark(#faf9f6,#121719);--ink:light-dark(#172c30,#e9f0ee);--muted:light-dark(#526461,#abc0b9);--line:light-dark(#cbd5cf,#3b5149);--green:light-dark(#116b54,#76d6ac);--red:light-dark(#a23835,#ffaaa2);--wash:light-dark(#edf2ed,#1c2823)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1280px;margin:auto;padding:32px 24px 64px}h1{font-size:clamp(26px,4vw,42px);line-height:1.15;margin:12px 0 20px;font-weight:650}h2{font-size:24px;margin:40px 0 12px;font-weight:600}h3{font-size:18px;font-weight:600}p{max-width:90ch}a{color:var(--green)}small{display:block;color:var(--muted);font-size:13px}code{overflow-wrap:anywhere}.meta{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:24px 0}.metric{padding:16px 0;border-block:1px solid var(--line)}.metric b{display:block;font-size:30px;font-weight:600;font-variant-numeric:tabular-nums}.positive{color:var(--green)}.negative{color:var(--red)}.scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:11px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top;font-variant-numeric:tabular-nums}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}thead{background:var(--wash)}th{font-weight:600}td{min-width:70px}#players td:nth-child(2){min-width:235px}#players td:last-child{min-width:180px;text-align:left}.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 30px}.stats div{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:8px 0}.stats dt{color:var(--muted)}.stats dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}label{display:flex;gap:12px;align-items:center;flex-wrap:wrap}select{font:inherit;padding:8px;max-width:100%;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:4px}.chart{width:100%;height:auto;display:block;overflow:visible}.chart text{fill:var(--ink);font:13px system-ui,sans-serif}.chart .grid{stroke:var(--line);stroke-width:1}.chart .wealth{fill:none;stroke:var(--green);stroke-width:2}.chart .deposit{stroke:var(--muted);stroke-dasharray:6 5}.chart .peak{fill:var(--green)}details{margin:20px 0}summary{font-weight:600}li{margin:8px 0}footer{margin-top:40px;color:var(--muted);font-size:13px}#trajectory-detail{min-height:3em}.nowrap{white-space:nowrap}@media(max-width:650px){main{padding:22px 14px 40px}.metrics{grid-template-columns:1fr;gap:0}.metric b{font-size:28px}.stats{grid-template-columns:1fr}h2{font-size:21px}}
</style></head><body><main>
<div class="meta">Локальный расчёт от ${escape(report.createdAt)} · seed ${escape(report.seed)}</div>
<h1>Что заработало казино на десяти игроках</h1>
<p>Один заранее выбранный прогон: депозиты от $100 до $1000, разные ставки, цели, остановки и переходы между играми. Дополнительно выполнено ${number(s.cohorts)} независимых повторов тех же десяти профилей.</p>
<div class="metrics">
<div class="metric"><span>Игровой доход казино, GGR</span><b class="${profitClass(e.ggrCents)}">${money(e.ggrCents)}</b><small>До комиссий, бонусов, налогов и расходов</small></div>
<div class="metric"><span>Условно выплачено игрокам</span><b>${money(e.withdrawalsCents)}</b><small>${e.withdrawalCount} выводов у ${e.withdrawingPlayers} игроков</small></div>
<div class="metric"><span>Осталось на счетах игроков</span><b>${money(e.retainedBalanceCents)}</b><small>Эти деньги остаются обязательством казино</small></div>
</div>
<dl class="stats">
<div><dt>Депозиты</dt><dd>${money(e.depositsCents)}</dd></div>
<div><dt>Выиграли / проиграли / без изменения</dt><dd>${e.winners} / ${e.losers} / ${e.even}</dd></div>
<div><dt>Платные раунды / бесплатные спины</dt><dd>${number(e.rounds)} / ${number(e.freeSpins)}</dd></div>
<div><dt>Оборот ставок</dt><dd>${money(e.stakesCents)}</dd></div>
<div><dt>Игровые выплаты, включая возврат ставки</dt><dd>${money(e.payoutsCents)}</dd></div>
<div><dt>Фактический возврат в этом прогоне</dt><dd>${percent(e.observedRtp)}</dd></div>
<div><dt>Условное время при одновременном старте</dt><dd>${duration(e.parallelElapsedSeconds)}</dd></div>
<div><dt>Сумма времени всех игроков</dt><dd>${duration(e.aggregateSeconds)}</dd></div>
<div><dt>Кассовый приток: депозиты минус выводы</dt><dd>${money(e.cashInMinusOutCents)}</dd></div>
<div><dt>Полностью проиграли депозит</dt><dd>${e.exhaustedPlayers}</dd></div>
</dl>
<p>Сверка: ${money(e.depositsCents)} депозитов − ${money(e.withdrawalsCents)} выводов − ${money(e.retainedBalanceCents)} оставшихся балансов = <strong>${money(e.ggrCents)}</strong>. Выигрыш игрока считается по сумме выводов и остатка относительно депозита.</p>

<h2>Результат каждого игрока</h2>
<div class="scroll"><table id="players"><thead><tr><th>Игрок</th><th>Поведение и сыгранные игры</th><th>Депозит</th><th>Вывел</th><th>Остаток</th><th>Результат игрока</th><th>Пик средств</th><th>Раунды</th><th>Выводы</th><th>Время</th><th>Причина остановки</th></tr></thead>
<tbody>${e.players.map(playerRow).join('')}</tbody></table></div>

<h2>Как менялись средства игрока</h2>
<label for="player">Игрок <select id="player">${e.players.map(p => `<option value="${p.profile.id}">${p.profile.id}: депозит ${money(p.profile.depositCents)}</option>`).join('')}</select></label>
<p id="trajectory-detail" aria-live="polite"></p>
<svg id="trajectory" class="chart" role="img" aria-label="Средства выбранного игрока по времени: выводы плюс остаток. Пунктиром показан депозит."></svg>

<h2>Сколько было выводов</h2>
<p>Все ${e.withdrawalCount} запросов в модели считаются сразу выплаченными. Частичный вывод позволяет продолжить игру. Комиссии, задержки и отказы платёжной системы не моделировались.</p>
<div class="scroll"><table><thead><tr><th>Игрок</th><th>Время от старта</th><th>После раунда</th><th>Сумма</th><th>Причина</th></tr></thead><tbody>${withdrawals.map(w => `<tr><th scope="row">${w.player}</th><td>${duration(w.second)}</td><td>${w.round}</td><td>${money(w.amountCents)}</td><td>${escape(w.reason)}</td></tr>`).join('')}</tbody></table></div>

<h2>Результаты по играм</h2>
<div class="scroll"><table><thead><tr><th>Игра</th><th>Раунды</th><th>Ставки</th><th>Игровые выплаты</th><th>Доход казино</th><th>Возврат в прогоне</th><th>Бесплатные спины</th></tr></thead><tbody>${gameRows(e.games)}</tbody></table></div>

<h2>Разброс на ${number(s.cohorts)} группах по десять игроков</h2>
<p>Это ${number(s.simulatedPlayers)} условных сессий. Поведение и депозиты остаются теми же, меняются случайные исходы. Первый показанный прогон не входит в эту выборку.</p>
<dl class="stats">
<div><dt>Средний доход казино с группы</dt><dd>${money(s.ggrCents.mean)}</dd></div>
<div><dt>Медианный доход казино с группы</dt><dd>${money(s.ggrCents.median)}</dd></div>
<div><dt>5-й и 95-й процентили дохода</dt><dd>${money(s.ggrCents.p05)} … ${money(s.ggrCents.p95)}</dd></div>
<div><dt>Доля групп с убытком казино</dt><dd>${percent(s.casinoLossProbability)}</dd></div>
<div><dt>95% интервал погрешности среднего</dt><dd>${money(s.ggrCents.meanCi95[0])} … ${money(s.ggrCents.meanCi95[1])}</dd></div>
<div><dt>Среднее число победителей / проигравших</dt><dd>${number(s.averageWinners, 2)} / ${number(s.averageLosers, 2)}</dd></div>
<div><dt>Средние выводы с группы</dt><dd>${money(s.withdrawalsCents.mean)}</dd></div>
<div><dt>Среднее число выводов с группы</dt><dd>${number(s.averageWithdrawalCount, 2)}</dd></div>
<div><dt>Среднее число платных раундов</dt><dd>${number(s.rounds.mean, 1)}</dd></div>
<div><dt>Среднее условное время группы</dt><dd>${duration(s.parallelElapsedSeconds.mean)}</dd></div>
<div><dt>Возврат по всем ставкам выборки</dt><dd>${percent(s.weightedRtp)}</dd></div>
<div><dt>Срабатывания частичного / отложенного вывода</dt><dd>${number(s.partialCashouts)} / ${number(s.trailingCashouts)}</dd></div>
</dl>
<p>Интервал между 5-м и 95-м процентилями показывает разброс результата одной группы. Интервал среднего показывает погрешность оценки среднего в этой модели. Поведение реальных клиентов может дать другое распределение.</p>
<div class="scroll"><table><thead><tr><th>Профиль</th><th>Средний результат игрока</th><th>Доля сессий в плюсе</th><th>Средние раунды</th><th>Средние выводы, шт.</th></tr></thead><tbody>${s.players.map(p => `<tr><th scope="row">${p.id}</th><td class="${profitClass(p.meanProfitCents)}">${money(p.meanProfitCents)}</td><td>${percent(p.winProbability)}</td><td>${number(p.meanRounds, 1)}</td><td>${number(p.meanWithdrawalCount, 2)}</td></tr>`).join('')}</tbody></table></div>
<details><summary>Все игры в повторных прогонах</summary><div class="scroll"><table><thead><tr><th>Игра</th><th>Раунды</th><th>Ставки</th><th>Игровые выплаты</th><th>Доход казино</th><th>Возврат в выборке</th><th>Бесплатные спины</th></tr></thead><tbody>${gameRows(s.games)}</tbody></table></div></details>

<h2>Что именно проверено и какие приняты условия</h2>
<ul>
<li>Расчёт выполнен локально на существующих серверных движках выбранных игр. Выплаты округляются тем же кодом. Депозиты и выводы ведутся в отдельном условном журнале, без обращения к реальным кошелькам и платёжной системе.</li>
<li>Одна демомонета приравнена к одному условному доллару только для расчёта. Эксперимент использует общие разрешённые ставки $10, $50, $100 и $500. У Cosmic и Caramel есть и другие ставки, здесь они не используются. Игрок уменьшает ставку до доступной разрешённой. Остаток ниже $10 не считается полным проигрышем баланса.</li>
<li>Используется текущий выбор движков сервера: Caramel rules v2, Cosmic full-slot v2 с math profile 3, остальные выбранные Studio используют действующий общий движок v1. Один платный раунд включает все бесплатные бонусные этапы и завершение партии с выходом из риска. Начатая партия завершается даже при пересечении лимита условного времени. Выход из партии и вывод из кошелька считаются раздельно.</li>
<li>Для базовых игр заложено 4-8 секунд на раунд, дополнительно 0-4 секунды на решение, по 4 секунды на бесплатный спин и по 3 секунды на действие в партии. Переход в другую игру занимает 15-45 секунд. Это условный темп, фактическое время людей не измерялось.</li>
<li>Профили меняют игру каждые 5-15 раундов. При достижении лимита проигрыша, цели или времени они останавливаются. Игрок 9 сохраняет остаток на счёте, остальные выводят доступный остаток при выходе.</li>
<li>У игрока 10 вывод активируется после достижения $1500. Он уходит при снижении средств до большего из $1300 и $1000 плюс 60% максимального выигрыша сверх депозита. Отдельный раунд может перескочить порог. Достижение $1500 не гарантировано.</li>
<li>Генератор симуляции SFC32 получает независимые потоки для исходов и поведения каждого игрока из SHA-256 seed. Ограниченные целые выбираются с отбрасыванием смещённого остатка. Это воспроизводимая симуляция, не production RNG.</li>
<li>Показан первый прогон с seed ${escape(report.seed)}. Исходы не подбирались. Повторные прогоны используют новые seed при тех же профилях.</li>
<li>Все раунды подробного примера проверены штатными валидаторами выплат. В каждом прогоне сверяются деньги каждого игрока, сумма выводов и результат казино. Отпечатки исходников сверены до и после расчёта.</li>
<li>GGR рассчитан до расходов. Поведение и пропорции профилей придуманы для эксперимента. Выборка не охватывает весь каталог, внешних провайдеров и оптимальные или атакующие стратегии. Это не интеграционная проверка финансового сервиса и не прогноз дохода реального бизнеса.</li>
</ul>
<details><summary>Параметры игр и исходники расчёта</summary><div class="scroll"><table><thead><tr><th>Режим</th><th>Игра</th><th>Движок и правила</th><th>Параметры</th></tr></thead><tbody>${report.modes.map(m => `<tr><th scope="row">${escape(m.key)}</th><td>${escape(m.gameId)}</td><td>${escape(m.engine)} v${m.rulesVersion}</td><td><code>${escape(JSON.stringify({ settings: m.settings, strategy: m.strategy }))}</code></td></tr>`).join('')}</tbody></table></div>
<p>SHA-256 сохранены для ${report.sources.length} исходных файлов. Время вычисления: ${number(report.wallSeconds, 2)} с. <a href="results.json">Полные результаты и журнал каждого раунда</a> · <a href="source-manifest.json">Отпечатки исходников</a></p></details>
<footer>Повторить: <code>node --import tsx scripts/simulate-casino.ts --seed ${escape(report.seed)} --cohorts ${s.cohorts}</code>. При неизменных исходниках seed воспроизводит игровой результат. Время вычисления и дата могут отличаться.</footer>
<script id="simulation-data" type="application/json">${serial}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('simulation-data').textContent);
  const select = document.getElementById('player'), chart = document.getElementById('trajectory');
  const detail = document.getElementById('trajectory-detail');
  const usd = cents => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
  function draw() {
    const player = data.players.find(p => p.profile.id === Number(select.value));
    const width = Math.max(280, chart.getBoundingClientRect().width), height = width < 500 ? 290 : 330;
    const left = width < 500 ? 72 : 86, right = 18, top = 20, bottom = 58;
    const values = [{second:0,wealthCents:player.profile.depositCents}, ...player.trace];
    const maxX = Math.max(1, player.seconds), all = values.map(v => v.wealthCents);
    const low = Math.min(...all), high = Math.max(...all), range = Math.max(high-low, player.profile.depositCents*.1);
    const minY = Math.max(0, low-range*.1), maxY = high+range*.1;
    const x = value => left + value/maxX*(width-left-right);
    const y = value => height-bottom-(value-minY)/(maxY-minY)*(height-top-bottom);
    let svg = '<title>Средства игрока '+player.profile.id+' по времени</title>';
    for(let i=0;i<4;i++) {
      const value = minY+(maxY-minY)*i/3, py = y(value);
      svg += '<line class="grid" x1="'+left+'" x2="'+(width-right)+'" y1="'+py+'" y2="'+py+'"/>';
      svg += '<text x="'+(left-8)+'" y="'+(py+4)+'" text-anchor="end">'+Math.round(value/100).toLocaleString('ru-RU')+'</text>';
      const sec = maxX*i/3, px = x(sec);
      svg += '<text x="'+px+'" y="'+(height-bottom+24)+'" text-anchor="'+(i===0?'start':i===3?'end':'middle')+'">'+(sec/60).toFixed(1)+'</text>';
    }
    svg += '<line class="deposit" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(player.profile.depositCents)+'" y2="'+y(player.profile.depositCents)+'"/>';
    svg += '<polyline class="wealth" points="'+values.map(v=>x(v.second)+','+y(v.wealthCents)).join(' ')+'"/>';
    const peak = values.find(v=>v.wealthCents===player.peakWealthCents);
    svg += '<circle class="peak" cx="'+x(peak.second)+'" cy="'+y(peak.wealthCents)+'" r="4"/>';
    svg += '<text x="'+left+'" y="14">Средства, $</text><text x="'+((left+width-right)/2)+'" y="'+(height-9)+'" text-anchor="middle">Условное время, минуты</text>';
    chart.setAttribute('viewBox','0 0 '+width+' '+height);chart.innerHTML=svg;
    detail.textContent = 'Депозит '+usd(player.profile.depositCents)+'. Пик '+usd(player.peakWealthCents)+' после раунда '+player.peakRound+'. Результат '+usd(player.profitCents)+'. '+player.stopReason+'. Пунктир: депозит. Линия: выводы плюс остаток.';
  }
  select.value='10'; select.addEventListener('change',draw);
  new ResizeObserver(draw).observe(chart);draw();
})();
</script></main></body></html>\n`;
}
