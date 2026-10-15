import { DEMO_CATEGORIES, getCabinetDemoGame, getDemoGame, getDemoGames, selectCabinetDemoGame, type DemoGame } from '../game/demoGames';
import '../demo-library.css';

export class DemoSlot {
  private root = document.createElement('div');
  private stage = document.createElement('div');
  private frame?: HTMLIFrameElement;
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private status: HTMLElement;
  private message: HTMLElement;
  private retry: HTMLButtonElement;
  private library: HTMLElement;
  private grid: HTMLElement;
  private search: HTMLInputElement;
  private category: HTMLSelectElement;
  private count: HTMLElement;
  private games: DemoGame[] = [];
  private selectedId?: string;
  private catalogue = false;

  constructor(container: HTMLElement, private setTitle: (name: string) => void) {
    this.root.className = 'demo-slot';
    this.root.innerHTML = '<div class="demo-library-toolbar"><button type="button" class="primary-button" id="all-demo-games">Все демоигры</button><span>Кредиты Luelon</span></div>';
    this.stage.className = 'demo-slot-stage';
    this.stage.innerHTML = '<div class="demo-slot-status" role="status"><p></p><button type="button" class="primary-button">Повторить загрузку</button></div><section class="demo-library" aria-label="Каталог демоигр" hidden><div class="demo-library-intro"><h3>Выбери демоигру</h3><p>У каждой новой сессии свои 2 500 виртуальных кредитов Luelon.</p></div><div class="demo-library-filters"><label>Поиск<input type="search" placeholder="Название игры" aria-label="Поиск демоигр"></label><label>Категория<select aria-label="Категория демоигр"><option value="">Все категории</option></select></label></div><p class="demo-library-count" role="status"></p><div class="demo-library-grid"></div></section>';
    this.status = this.stage.querySelector('.demo-slot-status')!;
    this.message = this.status.querySelector('p')!;
    this.retry = this.status.querySelector('button')!;
    this.library = this.stage.querySelector('.demo-library')!;
    this.grid = this.library.querySelector('.demo-library-grid')!;
    this.search = this.library.querySelector('input')!;
    this.category = this.library.querySelector('select')!;
    this.count = this.library.querySelector('.demo-library-count')!;
    this.search.addEventListener('input', () => this.renderGames());
    this.category.addEventListener('change', () => this.renderGames());
    this.retry.onclick = () => this.catalogue ? void this.showLibrary() : void this.load();
    this.root.querySelector<HTMLButtonElement>('#all-demo-games')!.onclick = () => { void this.showLibrary(); };
    this.root.append(this.stage);
    container.replaceChildren(this.root);
    void this.load();
  }

  private begin(catalogue: boolean) {
    this.catalogue = catalogue;
    const version = ++this.version;
    clearTimeout(this.timer);
    this.frame?.remove(); this.frame = undefined;
    this.root.classList.toggle('is-catalogue', catalogue);
    this.library.hidden = true;
    this.status.hidden = false; this.retry.hidden = true;
    this.message.textContent = catalogue ? 'Загружаем каталог демоигр…' : 'Загружаем демоигру…';
    return version;
  }

  private fail(version: number) {
    if (version !== this.version) return;
    clearTimeout(this.timer);
    this.frame?.remove(); this.frame = undefined;
    this.status.hidden = false; this.retry.hidden = false;
    this.message.textContent = this.catalogue
      ? 'Каталог сейчас недоступен. Попробуй загрузить его ещё раз.'
      : 'Игра сейчас недоступна. Попробуй ещё раз или выбери другую демоигру.';
  }

  async showLibrary() {
    const version = this.begin(true);
    this.setTitle('Демоигры Luelon');
    try {
      const games = await getDemoGames();
      if (version !== this.version) return;
      this.games = games;
      const selected = this.category.value;
      this.category.replaceChildren(new Option('Все категории', ''));
      for (const [category, label] of Object.entries(DEMO_CATEGORIES)) {
        if (games.some(game => game.category === category)) this.category.add(new Option(label, category));
      }
      this.category.value = selected;
      this.renderGames();
      this.status.hidden = true; this.library.hidden = false;
      this.library.scrollTop = 0;
    } catch { this.fail(version); }
  }

  private renderGames() {
    const query = this.search.value.trim().toLocaleLowerCase();
    const games = this.games.filter(game => (!this.category.value || game.category === this.category.value) && game.name.toLocaleLowerCase().includes(query));
    this.count.textContent = `Показано ${games.length} из ${this.games.length}`;
    this.grid.replaceChildren();
    for (const game of games) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'demo-library-card'; button.dataset.demoGame = game.id;
      button.setAttribute('aria-label', `Играть в ${game.name}`);
      const art = document.createElement('span'); art.className = 'demo-library-art';
      const placeholder = document.createElement('span'); placeholder.className = 'demo-library-placeholder'; placeholder.textContent = '✦'; placeholder.setAttribute('aria-hidden', 'true'); art.append(placeholder);
      if (game.artworkUrl) {
        const image = document.createElement('img'); image.alt = `Обложка ${game.name}`;
        image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = game.artworkUrl;
        image.onerror = () => image.remove(); art.append(image);
      }
      const name = document.createElement('strong'); name.textContent = game.name;
      const detail = document.createElement('small'); detail.textContent = `${DEMO_CATEGORIES[game.category]} · Демо`;
      button.append(art, name, detail);
      button.onclick = () => { void this.load(game.id); };
      this.grid.append(button);
    }
    if (!games.length) {
      const empty = document.createElement('p'); empty.className = 'demo-library-empty'; empty.textContent = 'Ничего не найдено. Измени название или категорию.'; this.grid.append(empty);
    }
  }

  async load(id = this.selectedId) {
    const version = this.begin(false);
    this.selectedId = id;
    try {
      const game = id ? await getDemoGame(id) : await getCabinetDemoGame();
      if (version !== this.version) return;
      this.selectedId = game.id;
      selectCabinetDemoGame(game);
      this.setTitle(game.name);
      const frame = document.createElement('iframe');
      frame.title = `${game.name}: демоигра Luelon Play`;
      frame.allow = 'autoplay; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.onload = () => {
        if (version !== this.version) return;
        clearTimeout(this.timer); this.status.hidden = true;
      };
      frame.onerror = () => this.fail(version);
      frame.src = game.embedUrl;
      this.frame = frame;
      this.timer = setTimeout(() => this.fail(version), 90000);
      this.stage.prepend(frame);
    } catch { this.fail(version); }
  }

  destroy() {
    this.version++; clearTimeout(this.timer);
    this.frame?.remove(); this.root.remove();
  }
}
