import { t, translateMessage } from '../i18n/index';
import { AuthRequestError, requestAuth } from '../network/AccountClient';
import clubPreview from './entry-previews/club.webp';
import catalogPreview from './entry-previews/catalog.webp';
import flagBattlePreview from './entry-previews/flag-battle.webp';
import { renderEntryPage, type EntryMode } from './EntryModes';
import { bindLoginForm, loginFormMarkup } from './LoginForm';

function loginError(error: unknown) {
  return error instanceof AuthRequestError
    ? translateMessage(error.message)
    : t('Не удалось подключиться. Попробуй ещё раз.');
}

const submitLabels: Record<EntryMode, string> = { casino: 'Войти и открыть игры', club: 'Войти в клуб' };

const modeOptions: ReadonlyArray<{ mode: EntryMode; title: string; description: string; thumb: string }> = [
  { mode: 'casino', title: 'Сразу к играм', description: 'Каталог игр и игровое окно. Общий чат будет рядом.', thumb: flagBattlePreview },
  { mode: 'club', title: 'В клуб с персонажем', description: 'Залы, бар и общение. Игры открываются прямо из клуба.', thumb: clubPreview },
];

function retrySessionCheck(error: unknown): Promise<boolean> {
  const app = renderEntryPage(`
    <section class="entry-login entry-login-check" aria-labelledby="join-title">
      <h1 id="join-title">${t('Проверка входа')}</h1>
      <p class="entry-login-hint" role="alert"></p>
      <button type="button" class="entry-login-retry">${t('Повторить')}</button>
      <button type="button" class="entry-login-back">${t('Сменить режим')}</button>
    </section>`);
  app.querySelector<HTMLElement>('[role="alert"]')!.textContent = loginError(error);
  const retry = app.querySelector<HTMLButtonElement>('.entry-login-retry')!;
  const back = app.querySelector<HTMLButtonElement>('.entry-login-back')!;
  retry.focus();
  return new Promise(resolve => {
    retry.onclick = () => {
      retry.disabled = true;
      back.disabled = true;
      retry.textContent = t('Проверяем вход…');
      resolve(true);
    };
    back.onclick = () => resolve(false);
  });
}

/**
 * Resolves with the mode to open once a session exists, or null when the player
 * goes back to the mode screen. The login card repeats the mode choice, prefilled
 * with `mode`, so a player without a session can change it in place.
 */
export async function requireEntryAccount(mode: EntryMode): Promise<EntryMode | null> {
  while (true) {
    try {
      if ((await requestAuth('/me')).account) return mode;
      break;
    } catch (error) {
      if (error instanceof AuthRequestError && error.status === 401) break;
      if (!(await retrySessionCheck(error))) return null;
    }
  }

  let selected = mode;
  const app = renderEntryPage(`
    <section class="entry-login entry-login-card" id="join-dialog" data-mode="${selected}" aria-labelledby="join-title">
      <div class="entry-login-side">
      <span class="entry-login-art" aria-hidden="true">
        <span class="entry-login-art-casino">
          <img class="entry-login-catalog" src="${catalogPreview}" alt="" width="550" height="340">
          <img class="entry-login-game" src="${flagBattlePreview}" alt="" width="568" height="350">
        </span>
        <img class="entry-login-art-club" src="${clubPreview}" alt="" width="640" height="336">
      </span>
      <fieldset class="entry-login-modes">
        <legend>${t('Как будешь играть?')}</legend>
        <span class="entry-login-options">${modeOptions.map(option => `
          <label class="entry-login-mode" data-option="${option.mode}">
            <span class="entry-login-thumb" aria-hidden="true"><img src="${option.thumb}" alt="" width="640" height="336"></span>
            <span class="entry-login-mode-copy">
              <input type="radio" name="entry-mode" value="${option.mode}" aria-describedby="entry-login-${option.mode}-description"${option.mode === selected ? ' checked' : ''}>
              <span>
                <strong>${t(option.title)}</strong>
                <span id="entry-login-${option.mode}-description" class="entry-login-mode-description">${t(option.description)}</span>
              </span>
            </span>
          </label>`).join('')}
        </span>
      </fieldset>
      </div>
      <div class="entry-login-form" id="login-step">
        <h1 id="join-title">${t('Вход в Рояль')}</h1>
        <p class="entry-login-hint">${t('Почта и пароль. Если почта новая, аккаунт создастся сам.')}</p>
        ${loginFormMarkup({ variant: 'entry', submitLabel: submitLabels[selected] })}
        <p id="join-error" role="alert" hidden></p>
      </div>
    </section>`);
  const panel = app.querySelector<HTMLElement>('.entry-login')!;
  const feedback = panel.querySelector<HTMLParagraphElement>('#join-error')!;
  const radios = Array.from(panel.querySelectorAll<HTMLInputElement>('input[name="entry-mode"]'));

  return new Promise(resolve => {
    const { form, password, setBusy, showFailure, setSubmitLabel } = bindLoginForm(panel, async credentials => {
      setBusy(true);
      for (const radio of radios) radio.disabled = true;
      form.setAttribute('aria-busy', 'true');
      feedback.hidden = true;
      try {
        const { account } = await requestAuth('/login', credentials);
        if (!account) throw new AuthRequestError(401, 'Не получилось войти. Попробуй ещё раз.');
        password.value = '';
        resolve(selected);
      } catch (error) {
        showFailure(error);
      } finally {
        form.removeAttribute('aria-busy');
        setBusy(false);
        for (const radio of radios) radio.disabled = false;
      }
    });
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        selected = radio.value as EntryMode;
        panel.dataset.mode = selected;
        setSubmitLabel(t(submitLabels[selected]));
      });
    }
    panel.querySelector<HTMLInputElement>('#email')!.focus({ preventScroll: true });
  });
}
