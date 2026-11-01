import { t, tr } from '../i18n';
import type { RoomScene } from '../game/RoomScene';
import { ElevatorAudio, type ElevatorCue } from '../game/ElevatorAudio';
import { HALLS, type HallId } from '../shared/world';
import { elevatorDock, elevatorFloors } from '../shared/elevator';
import './elevator.css';

export class ElevatorUI {
  private dialog = document.createElement('dialog');
  private status: HTMLElement;
  private floors: HTMLElement;
  private indicator: HTMLElement;
  private exit: HTMLButtonElement;
  private doors: HTMLElement[];
  private audio = new ElevatorAudio();
  private trip?: AbortController;
  private busy = false;
  private shortcut = document.createElement('button');
  private visibility = () => { if (document.hidden && this.busy) this.close(); };

  constructor(private scene: RoomScene, private restoreInput: () => void) {
    this.dialog.id = 'elevator-dialog';this.dialog.className = 'elevator-dialog';
    this.dialog.setAttribute('aria-labelledby', 'elevator-title');this.dialog.dataset.phase = 'choose';
    this.dialog.innerHTML = `<header class="elevator-heading"><div><span>ROYAL CLUB</span><h2 id="elevator-title">${t('Лифт')}</h2></div><button type="button" class="elevator-exit" aria-label="${t('Выйти из лифта')}">×</button></header>
      <div class="elevator-indicator" aria-hidden="true">01</div>
      <div class="elevator-cabin"><div class="elevator-controls"><p>${t('Выбери этаж')}</p><nav class="elevator-floors" aria-label="${t('Этажи')}"></nav></div><div class="elevator-door elevator-door-left" aria-hidden="true"></div><div class="elevator-door elevator-door-right" aria-hidden="true"></div></div>
      <p class="elevator-status" role="status" aria-live="polite"></p><span class="elevator-footnote">${t('Поездка без ожидания других игроков')}</span>`;
    this.status = this.dialog.querySelector('.elevator-status')!;
    this.floors = this.dialog.querySelector('.elevator-floors')!;
    this.indicator = this.dialog.querySelector('.elevator-indicator')!;
    this.exit = this.dialog.querySelector('.elevator-exit')!;
    this.doors = Array.from(this.dialog.querySelectorAll<HTMLElement>('.elevator-door'));
    document.body.append(this.dialog);
    this.shortcut.type = 'button';this.shortcut.id = 'elevator-shortcut';this.shortcut.className = 'elevator-shortcut';
    this.shortcut.hidden=this.scene.hall==='street';
    this.shortcut.textContent = `↕ ${t('Лифт')}`;this.shortcut.setAttribute('aria-label', t('Подойти к лифту'));
    document.querySelector('#floor-links')!.before(this.shortcut);
    this.shortcut.onclick = () => this.scene.approachElevator();
    this.scene.onElevator = () => this.open();
    this.scene.onElevatorCancel = () => this.close();
    this.exit.onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault();if (!this.busy) this.close(); });
    this.dialog.addEventListener('close', () => { this.reset();this.restoreInput();this.shortcut.focus({ preventScroll: true }); });
    document.addEventListener('visibilitychange', this.visibility);
    this.scene.events.once('shutdown', () => this.destroy());
  }
  private open() {
    if (this.dialog.open || document.querySelector('dialog[open]')) return;
    this.reset();this.renderFloors();this.scene.setLocked(true);this.dialog.showModal();
    this.floors.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  private renderFloors() {
    this.floors.replaceChildren();
    for (const hall of elevatorFloors()) {
      const definition = HALLS[hall], current = hall === this.scene.hall;
      const button = document.createElement('button');button.type = 'button';button.dataset.elevatorFloor = hall;
      const number = document.createElement('strong');number.textContent = String(definition.floor);
      const label = document.createElement('span');label.textContent = definition.name;
      const detail = document.createElement('small');detail.textContent = current ? t('Ты здесь') : tr`Этаж ${definition.floor}`;
      label.append(detail);button.append(number, label);button.disabled = current;
      if (current) button.setAttribute('aria-current', 'location');
      button.onclick = () => { void this.travel(hall); };
      this.floors.append(button);
    }
    this.indicator.textContent = String(HALLS[this.scene.hall].floor).padStart(2, '0');
    this.status.textContent = t('Можно сразу на любой этаж');
  }
  private async phase(name: string, cue: ElevatorCue, duration: number, signal: AbortSignal) {
    if (signal.aborted) return;
    this.dialog.dataset.phase = name;
    const delay = this.audio.play(cue), reduced = this.scene.getReducedMotion();
    const time = reduced ? Math.min(duration, 100) : duration;
    const animations = name === 'closing' || name === 'opening' ? this.doors.map((door, index) => {
      const open = `translateX(${index ? 101 : -101}%)`, closed = 'translateX(0)';
      return door.animate([{ transform: name === 'closing' ? open : closed }, { transform: name === 'closing' ? closed : open }],
        { duration: reduced ? 0 : time, delay, fill: 'forwards', easing: 'ease-in-out' });
    }) : [];
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer);signal.removeEventListener('abort', finish);resolve(); };
      const timer = setTimeout(finish, time + delay);
      signal.addEventListener('abort', finish, { once: true });
    });
    if (signal.aborted) for (const animation of animations) animation.cancel();
  }
  private async travel(target: HallId) {
    if (this.busy || target === this.scene.hall) return;
    const trip = new AbortController();this.trip = trip;this.busy = true;this.exit.disabled = true;
    this.floors.inert = true;this.dialog.setAttribute('aria-busy', 'true');
    this.status.textContent = t('Двери закрываются');
    try {
      await this.phase('closing', 'close', 280, trip.signal);
      if (trip.signal.aborted) return;
      this.status.textContent = tr`Едем на этаж ${HALLS[target].floor}`;
      this.dialog.dataset.phase = 'travelling';
      const [accepted] = await Promise.all([this.scene.travelByElevator(target), this.phase('travelling', 'ride', 300, trip.signal)]);
      if (trip.signal.aborted) return;
      this.indicator.textContent = String(HALLS[this.scene.hall].floor).padStart(2, '0');
      this.status.textContent = accepted ? tr`Этаж ${HALLS[target].floor}: ${HALLS[target].name}` : t('Поездка не подтверждена. Попробуй ещё раз.');
      // A failed trip reopens quietly; an arrival cue requires confirmed room state.
      if (accepted) await this.phase('opening', 'arrive', 320, trip.signal);
      else { this.audio.cancel();for (const door of this.doors) for (const animation of door.getAnimations()) animation.cancel(); }
      if (trip.signal.aborted) return;
      if (accepted) this.close();
      else { this.reset();this.renderFloors();this.status.textContent = t('Поездка не подтверждена. Попробуй ещё раз.');this.exit.focus(); }
    } catch {
      if (!trip.signal.aborted) { this.reset();this.renderFloors();this.status.textContent = t('Поездка не подтверждена. Попробуй ещё раз.'); }
    }
  }
  private reset() {
    this.trip?.abort();this.trip = undefined;this.audio.cancel();this.busy = false;
    this.exit.disabled = false;this.floors.inert = false;this.dialog.removeAttribute('aria-busy');this.dialog.dataset.phase = 'choose';
    for (const door of this.doors) for (const animation of door.getAnimations()) animation.cancel();
  }
  close() { this.reset();if (this.dialog.open) this.dialog.close(); }
  getState() { return { phase: this.dialog.open ? this.dialog.dataset.phase : 'closed', dock: elevatorDock(this.scene.hall), floors: elevatorFloors(), audio: this.audio.getState() }; }
  destroy() { this.close();document.removeEventListener('visibilitychange', this.visibility);this.audio.dispose();this.dialog.remove();this.shortcut.remove(); }
}
