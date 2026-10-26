import { CABINETS } from '../shared/cabinets';
import { blackjackScore, shuffledDeck, dealBaccarat, pokerHand, comparePoker, VIDEO_NAMES, VIDEO_PAYOUTS, videoRank, randomInt, type GithubGameId } from '../shared/githubGames';
import { Game, PlayerBet, DiceRoll, PassLineBet, FieldBet, AnySevenBet } from '../vendor/github/craps/engine';
import './github-games.css';
import { emitCardDealer } from './CardDealerStage';
import { isCardGame } from '../shared/cardTables';

const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const SOURCES: Record<GithubGameId, string> = {
  'github-blackjack': 'Kusnierewicz/Blackjack-game-in-JS',
  'github-poker': 'benjaminrathelot/javascript-poker-engine',
  'github-video-poker': 'BeFiveINFO/Lucky-Five-Video-Poker',
  'github-baccarat': 'open-baccarat/open-baccarat',
  'github-craps': 'wschmrdr/crapsengine',
};
const RULES: Record<GithubGameId, string> = {
  'github-blackjack': 'Набери до 21 очка. Туз даёт 1 или 11. Дилер берёт карты до 17, включая остановку на мягких 17. Блэкджек возвращает 2,5 ставки, обычный выигрыш 2 ставки, ничья возвращает ставку. Одна колода, без split и double.',
  'github-poker': 'Учебный холдем против бота. По две личные карты, пять общих. Сравниваются лучшие пять карт. Бот всегда уравнивает. На каждой улице можно продолжить, повысить ставку или сделать пас. При ничьей банк делится поровну.',
  'github-video-poker': 'Колода из 53 карт с одним джокером. Удержи нужные карты и один раз замени остальные. Джокер заменяет любую карту. Множители: две пары 1, тройка 2, стрит 4, флеш 5, фулл-хаус 8, каре 20, стрит-флеш 40, роял-флеш 100, пять одинаковых 250. Одна пара не оплачивается.',
  'github-baccarat': 'Выбери игрока, банкира или ничью. Очки считаются по последней цифре суммы: туз 1, десятки и картинки 0. Добор карт выполняется автоматически. Игрок возвращает 2 ставки, банкир 1,95, ничья 9. При ничьей ставки на игрока и банкира возвращаются.',
  'github-craps': 'Pass Line: первый бросок 7/11 выигрывает, 2/3/12 проигрывает. Иначе устанавливается цель: повтор цели выигрывает, 7 проигрывает. Field: один бросок, 3/4/9/10/11 дают полный возврат ×2, 2 даёт ×3, 12 даёт ×4. Any Seven: 7 даёт ×5, прочие числа проигрывают.',
};

export class GithubGames {
  private root = document.createElement('section');
  private phase: 'idle' | 'active' | 'done' = 'idle';
  private credits = 1000;
  private bet = 10;
  private roundStake = 10;
  private message = 'Выбери ставку и начни игру.';
  private deck: string[] = [];
  private player: string[] = [];
  private opponent: string[] = [];
  private board: string[] = [];
  private held = new Set<number>();
  private choice = 'player_win';
  private dice: number[] = [];
  private craps: any;
  private history: string[] = [];
  private lastAction = 0;
  private roundNumber = 0;
  private roundPayout = 0;
  private alive = true;
  constructor(container: HTMLElement, private id: GithubGameId) {
    this.root.className = 'github-game';
    this.root.dataset.game = id;
    container.replaceChildren(this.root);
    this.render();
  }
  destroy() { this.alive = false; this.root.remove(); }
  private card(card: string | null, index?: number): string {
    const name = card ?? 'cardBack';
    const red = card && 'DH'.includes(card[1]);
    const content = `<img src="/assets/github-cards/${name}.svg" alt="${card ? card === 'JJ' ? 'Джокер' : card[0] + ({ C: ' треф', D: ' бубен', H: ' червей', S: ' пик' }[card[1]] ?? '') : 'Закрытая карта'}" draggable="false">`;
    if (index !== undefined) return `<button type="button" class="github-card ${red ? 'red' : ''} ${this.held.has(index) ? 'held' : ''}" data-hold="${index}" aria-label="${this.held.has(index) ? 'Отпустить' : 'Удержать'} карту ${index + 1}" aria-pressed="${this.held.has(index)}" ${this.phase !== 'active' ? 'disabled' : ''}>${content}<span>${this.held.has(index) ? 'ДЕРЖУ' : 'ЗАМЕНА'}</span></button>`;
    return `<span class="github-card ${red ? 'red' : ''}">${content}</span>`;
  }
  private cards(cards: readonly (string | null)[], hold = false): string {
    return `<div class="github-cards">${cards.map((card, index) => this.card(card, hold ? index : undefined)).join('')}</div>`;
  }
  private button(action: string, label: string, disabled = false) {
    return `<button type="button" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  }
  private render() {
    if (!this.alive) return;
    const detail = CABINETS.find(c => c.id === this.id)!;
    const active = this.phase === 'active';
    let table = '', controls = '';
    if (this.id === 'github-video-poker') {
      table = `<p class="github-table-label">ТВОИ КАРТЫ</p>${this.cards(this.player.length ? this.player : Array(5).fill(null), true)}`;
      controls = this.button(active ? 'draw' : 'start', active ? 'Заменить карты' : 'Раздать карты', !active && this.credits < this.bet);
    } else if (this.id === 'github-blackjack') {
      table = `<p class="github-table-label">ДИЛЕР ${this.phase === 'done' ? '· ' + blackjackScore(this.opponent) : ''}</p>${this.cards(this.opponent.length ? this.opponent.map((c, i) => active && i === 1 ? null : c) : [null, null])}<p class="github-table-label">ТЫ ${this.player.length ? '· ' + blackjackScore(this.player) : ''}</p>${this.cards(this.player.length ? this.player : [null, null])}`;
      controls = active ? this.button('hit', 'Ещё карту') + this.button('stand', 'Хватит') : this.button('start', 'Раздать карты', this.credits < this.bet);
    } else if (this.id === 'github-poker') {
      table = `<p class="github-table-label">БОТ</p>${this.cards(this.opponent.length ? this.opponent.map(card => active ? null : card) : [null, null])}<p class="github-table-label">ОБЩИЕ КАРТЫ · БАНК ${active ? format(2 * this.roundStake) : '0'}</p>${this.cards([...this.board, ...Array(5 - this.board.length).fill(null)])}<p class="github-table-label">ТВОЯ РУКА</p>${this.cards(this.player.length ? this.player : [null, null])}`;
      const street = this.board.length === 0 ? 'Открыть флоп' : this.board.length === 3 ? 'Открыть тёрн' : this.board.length === 4 ? 'Открыть ривер' : 'Сравнить руки';
      controls = active ? this.button('call', street) + this.button('raise', 'Повысить на ' + format(this.bet), this.credits < this.bet) + this.button('fold', 'Пас') : this.button('start', 'Новая раздача', this.credits < this.bet);
    } else if (this.id === 'github-baccarat') {
      table = `<p class="github-table-label">БАНКИР</p>${this.cards(this.opponent.length ? this.opponent : [null, null])}<p class="github-table-label">ИГРОК</p>${this.cards(this.player.length ? this.player : [null, null])}`;
      controls = `<label class="github-choice">На кого ставим<select id="github-choice"><option value="player_win" ${this.choice === 'player_win' ? 'selected' : ''}>Игрок</option><option value="banker_win" ${this.choice === 'banker_win' ? 'selected' : ''}>Банкир</option><option value="tie" ${this.choice === 'tie' ? 'selected' : ''}>Ничья</option></select></label>` + this.button('start', 'Открыть карты', this.credits < this.bet);
    } else {
      table = `<p class="github-table-label">ДВЕ КОСТИ</p><div class="github-dice" role="img" aria-label="${this.dice.length ? this.dice.join(' и ') : 'Кости ещё не брошены'}">${(this.dice.length ? this.dice : [0, 0]).map(value => `<span>${value ? '⚀⚁⚂⚃⚄⚅'[value - 1] : '?'}</span>`).join('')}</div><p class="github-point">${active ? 'Цель: ' + this.craps.pointValue + ' · повтори её раньше семёрки' : 'Бросай кости и следи за суммой'}</p>`;
      controls = `<label class="github-choice">Ставка на<select id="github-choice" ${active ? 'disabled' : ''}><option value="pass" ${this.choice === 'pass' ? 'selected' : ''}>Pass Line</option><option value="field" ${this.choice === 'field' ? 'selected' : ''}>Field</option><option value="seven" ${this.choice === 'seven' ? 'selected' : ''}>Any Seven</option></select></label>` + this.button(active ? 'roll' : 'start', active ? 'Бросить ещё' : 'Бросить кости', !active && this.credits < this.bet);
    }
    this.root.innerHTML = `<header class="github-header"><div><span>${isCardGame(this.id)?'ЭТАЖ 3':'ЭТАЖ 1'} · УЧЕБНЫЙ СТОЛ</span><h3>${detail.name}</h3></div><div class="github-balance"><small>Учебные фишки</small><strong>${format(this.credits)}</strong></div></header><div class="github-table">${table}</div><p class="github-result" role="status" aria-live="polite">${this.message}</p><div class="github-controls"><label>Ставка<select id="github-bet" ${active ? 'disabled' : ''}>${[10, 25, 50, 100].map(value => `<option ${this.bet === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>${controls}</div><div class="github-history" aria-label="Последние раунды">${this.history.map(line => `<span>${line}</span>`).join('')}</div><details class="github-rules"><summary>Правила игры</summary><p>${RULES[this.id]}</p></details><footer class="github-footer"><p>Бесплатная тренировка. Учебные фишки действуют только за этим столом и сбрасываются при открытии. Их нельзя пополнить, перевести или вывести.</p><a href="https://github.com/${SOURCES[this.id]}" target="_blank" rel="noopener noreferrer">Исходный проект · MIT</a>${this.button('reset', 'Начать заново')}</footer>`;
    if(isCardGame(this.id))emitCardDealer(this.root,{gameId:this.id,account:'practice',sessionId:this.phase==='idle'?'':'practice-'+this.roundNumber,phase:this.board.length+this.player.length,cards:JSON.stringify([this.player,this.opponent.map((card,index)=>active&&(this.id==='github-poker'||this.id==='github-blackjack'&&index===1)?'?':card),this.board]),active,busy:false,pending:false,spentUnits:String(Math.round(this.roundStake*100)),returnedUnits:String(Math.round(this.roundPayout*100))});
    this.root.querySelector<HTMLSelectElement>('#github-bet')!.onchange = event => { this.bet = Number((event.target as HTMLSelectElement).value); this.render(); };
    const choice = this.root.querySelector<HTMLSelectElement>('#github-choice');
    if (choice) { if (this.id === 'github-craps' && !['pass', 'field', 'seven'].includes(this.choice)) this.choice = 'pass'; choice.value = this.choice; choice.onchange = event => { this.choice = (event.target as HTMLSelectElement).value; }; }
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => { button.onclick = () => {
      if (Date.now() - this.lastAction < 220) return;
      this.lastAction = Date.now(); this.action(button.dataset.action!); this.render();
    }; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => { button.onclick = () => {
      if (this.phase !== 'active') return;
      const index = Number(button.dataset.hold); this.held.has(index) ? this.held.delete(index) : this.held.add(index); this.render();
    }; });
  }
  private finish(payout: number, message: string) {
    this.roundPayout = payout;
    this.credits = Math.round((this.credits + payout) * 100) / 100;
    this.phase = 'done';
    this.message = message + ' Начислено ' + format(payout) + ' фишек.';
    this.history.unshift(message + ' · ' + format(payout)); this.history.length = Math.min(4, this.history.length);
  }
  private action(action: string) {
    if (action === 'reset') { this.credits = 1000; this.phase = 'idle'; this.player = []; this.opponent = []; this.board = []; this.dice = []; this.held.clear(); this.history = []; this.message = 'Новый учебный стол: 1000 фишек.'; return; }
    if (action === 'start') {
      if (this.phase === 'active' || this.credits < this.bet) return;
      this.credits -= this.bet; this.roundStake = this.bet; this.phase = 'active';
      this.roundNumber++;this.roundPayout=0;
      this.deck = shuffledDeck(this.id === 'github-video-poker', this.id === 'github-baccarat' ? 8 : 1);
      this.player = []; this.opponent = []; this.board = []; this.held.clear();
      if (this.id === 'github-video-poker') { this.player = this.deck.splice(0, 5); this.message = 'Нажми на карты, которые хочешь удержать, затем замени остальные.'; }
      if (this.id === 'github-blackjack') {
        this.player = this.deck.splice(0, 2); this.opponent = this.deck.splice(0, 2); this.message = 'Ещё карту или хватит?';
        const p = blackjackScore(this.player), d = blackjackScore(this.opponent);
        if (p === 21 || d === 21) this.finish(p === d ? this.roundStake : p === 21 ? this.roundStake * 2.5 : 0, p === d ? 'Ничья.' : p === 21 ? 'Блэкджек!' : 'Блэкджек у дилера.');
      }
      if (this.id === 'github-poker') { this.player = this.deck.splice(0, 2); this.opponent = this.deck.splice(0, 2); this.message = 'Бот уравнял ставку. Открой флоп или сделай пас.'; }
      if (this.id === 'github-baccarat') {
        const result = dealBaccarat(this.deck); this.player = result.player; this.opponent = result.banker;
        const payout = result.result === this.choice ? this.roundStake * (this.choice === 'banker_win' ? 1.95 : this.choice === 'tie' ? 9 : 2) : result.result === 'tie' && this.choice !== 'tie' ? this.roundStake : 0;
        this.finish(payout, `Игрок ${result.playerTotal}, банкир ${result.bankerTotal}. ${result.result === 'tie' ? 'Ничья.' : result.result === 'player_win' ? 'Выиграл игрок.' : 'Выиграл банкир.'}`);
      }
      if (this.id === 'github-craps') {
        this.craps = new Game(1, 10000, 10000);
        if (this.choice !== 'pass') this.craps.makeBet(new PlayerBet(0, new PassLineBet(), 10));
        const betType = this.choice === 'field' ? FieldBet : this.choice === 'seven' ? AnySevenBet : PassLineBet;
        this.craps.makeBet(new PlayerBet(1, new betType(), this.roundStake)); this.roll();
      }
      return;
    }
    if (this.phase !== 'active') return;
    if (action === 'draw' && this.id === 'github-video-poker') {
      this.player = this.player.map((card, index) => this.held.has(index) ? card : this.deck.pop()!);
      const rank = videoRank(this.player); this.finish(this.roundStake * VIDEO_PAYOUTS[rank], VIDEO_NAMES[rank] + '.');
    }
    if (action === 'hit' && this.id === 'github-blackjack') {
      this.player.push(this.deck.pop()!);
      if (blackjackScore(this.player) > 21) this.finish(0, 'Перебор.');
      else if (blackjackScore(this.player) === 21) this.stand();
      else this.message = 'У тебя ' + blackjackScore(this.player) + '. Ещё карту или хватит?';
    }
    if (action === 'stand' && this.id === 'github-blackjack') this.stand();
    if (this.id === 'github-poker') {
      if (action === 'fold') { this.finish(0, 'Пас. Банк у бота.'); return; }
      if (action === 'raise') { if (this.credits < this.bet) return; this.credits -= this.bet; this.roundStake += this.bet; }
      if (action === 'call' || action === 'raise') {
        if (this.board.length < 5) { this.deck.pop(); this.board.push(...this.deck.splice(0, this.board.length ? 1 : 3)); this.message = 'Бот уравнял. Продолжай или сделай пас.'; }
        else { const yours = pokerHand([...this.player, ...this.board]), bot = pokerHand([...this.opponent, ...this.board]); const comparison = comparePoker(yours, bot); this.finish(comparison > 0 ? this.roundStake * 2 : comparison === 0 ? this.roundStake : 0, comparison > 0 ? 'Ты выиграл: ' + VIDEO_NAMES[yours.rank] + '.' : comparison === 0 ? 'Ничья.' : 'Бот выиграл: ' + VIDEO_NAMES[bot.rank] + '.'); }
      }
    }
    if (action === 'roll' && this.id === 'github-craps') this.roll();
  }
  private stand() {
    while (blackjackScore(this.opponent) < 17) this.opponent.push(this.deck.pop()!);
    const p = blackjackScore(this.player), d = blackjackScore(this.opponent);
    this.finish(d > 21 || p > d ? this.roundStake * 2 : p === d ? this.roundStake : 0, d > 21 ? 'Перебор у дилера.' : p > d ? 'Ты выиграл.' : p === d ? 'Ничья.' : 'Дилер выиграл.');
  }
  private roll() {
    this.dice = [randomInt(6) + 1, randomInt(6) + 1];
    this.craps.rollComplete(new DiceRoll(...this.dice), (bet: { pid: number } | null, pay: number) => {
      if (bet?.pid === 1) this.finish(Math.max(0, this.roundStake + pay), 'Сумма ' + this.dice.reduce((a, b) => a + b, 0) + (pay > 0 ? ': выигрыш.' : pay < 0 ? ': проигрыш.' : ': возврат.'));
    });
    if (this.phase === 'active') this.message = 'Сумма ' + this.dice.reduce((a, b) => a + b, 0) + '. Цель ' + this.craps.pointValue + ': повтори её раньше семёрки.';
  }
}
