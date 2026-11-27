import { locale, t, tr, translateMessage } from '../i18n/index';
import { AuthRequestError } from '../network/AccountClient';
import { showPasswordRecovery } from './PasswordRecovery';

type LoginCredentials = { email: string; password: string };

/** `dialog` keeps the club dialog markup; `entry` is the entry page card with an icon reveal, rule chips and an inline recovery link. */
export type LoginFormOptions = { variant?: 'dialog' | 'entry'; submitLabel?: string };

// Mirrors newPassword() in server/accounts.ts so the chips agree with the server.
const passwordRules: ReadonlyArray<[string, (value: string) => boolean]> = [
  ['8 символов и больше', value => [...value].length >= 8],
  ['Прописная и строчная', value => /\p{Lu}/u.test(value) && /\p{Ll}/u.test(value)],
  ['Цифра', value => /\p{Nd}/u.test(value)],
  ['Спецсимвол', value => /[\p{P}\p{S}]/u.test(value)],
];

const eyeIcon = `<svg class="reveal-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.6"/><path class="reveal-slash" d="M3 17L17 3"/></svg>`;
const checkIcon = `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>`;

export function loginFormMarkup({ variant = 'dialog', submitLabel = 'Продолжить' }: LoginFormOptions = {}) {
  if (variant === 'entry') {
    return `
    <form id="login-form" data-login-variant="entry">
      <label for="email">${t('Почта')}</label>
      <input id="email" type="email" name="email" maxlength="254" autocomplete="username" placeholder="you@example.com" required>
      <div class="login-password-label">
        <label for="password">${t('Пароль')}</label>
        <button type="button" class="login-recovery-link" hidden>${t('Забыли пароль?')}</button>
      </div>
      <div class="password-field">
        <input id="password" type="password" name="password" maxlength="128" autocomplete="current-password" aria-describedby="login-password-hint" required>
        <button id="reveal-password" type="button" aria-label="${t('Показать пароль')}" aria-pressed="false">${eyeIcon}</button>
      </div>
      <div id="login-password-hint" class="login-password-rules">
        <span>${t('Для нового аккаунта')}</span>
        <ul>${passwordRules.map(([label]) => `<li data-met="false">${checkIcon}${t(label)}</li>`).join('')}</ul>
      </div>
      <button id="login-button" class="primary-button" type="submit">${t(submitLabel)}</button>
    </form>`;
  }
  return t(`
    <form id="login-form">
      <label for="email">Почта</label>
      <input id="email" type="email" name="email" maxlength="254" autocomplete="username" placeholder="you@example.com" required>
      <label for="password">Пароль</label>
      <div class="password-field">
        <input id="password" type="password" name="password" maxlength="128" autocomplete="current-password" aria-describedby="login-password-hint" required>
        <button id="reveal-password" type="button" aria-label="Показать пароль" aria-pressed="false">Показать</button>
      </div>
      <small id="login-password-hint" class="login-password-hint">Для нового пароля нужны 8 символов или больше, прописная и строчная буквы, цифра и спецсимвол.</small>
      <button id="login-button" class="primary-button" type="submit">${submitLabel}</button>
    </form>
    <button type="button" class="login-recovery-link" hidden>Восстановить пароль</button>`);
}

export function bindLoginForm(host: HTMLElement, login: (credentials: LoginCredentials) => void) {
  const form = host.querySelector<HTMLFormElement>('#login-form')!;
  const entry = form.dataset.loginVariant === 'entry';
  const email = form.querySelector<HTMLInputElement>('#email')!;
  const password = form.querySelector<HTMLInputElement>('#password')!;
  const reveal = form.querySelector<HTMLButtonElement>('#reveal-password')!;
  const submit = form.querySelector<HTMLButtonElement>('#login-button')!;
  const feedback = host.querySelector<HTMLParagraphElement>('#join-error')!;
  const recover = host.querySelector<HTMLButtonElement>('.login-recovery-link')!;
  const rules = Array.from(form.querySelectorAll<HTMLLIElement>('.login-password-rules li'));
  let submitLabel = submit.textContent!;
  let busy = false;
  let lockedUntil = 0;
  let lockedAt = '';
  let unlockTimer: number | undefined;

  const showFeedback = (message: string, success = false) => {
    feedback.textContent = message;
    feedback.dataset.loginFeedback = success ? 'success' : 'error';
    feedback.hidden = false;
  };
  const refresh = () => {
    const locked = lockedUntil > Date.now();
    submit.disabled = busy || locked;
    email.disabled = busy;
    recover.disabled = busy;
    if (entry) {
      password.readOnly = busy;
      submit.textContent = busy ? t('Входим…') : locked ? tr`Вход откроется в ${lockedAt}` : submitLabel;
      form.toggleAttribute('data-locked', locked);
    }
  };
  const clearLock = () => {
    window.clearTimeout(unlockTimer);
    lockedUntil = 0;
    refresh();
  };
  const setBusy = (value: boolean) => {
    busy = value;
    refresh();
  };
  const showFailure = (error: unknown) => {
    recover.hidden = !(error instanceof AuthRequestError && error.canRecover);
    if (entry) password.toggleAttribute('aria-invalid', error instanceof AuthRequestError && error.status === 401);
    if (error instanceof AuthRequestError && error.code === 'login_locked' && error.retryIn > 0) {
      lockedUntil = Date.now() + error.retryIn * 1000;
      lockedAt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(lockedUntil);
      showFeedback(tr`Пять неверных попыток. Вход снова доступен в ${lockedAt}.`);
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(() => {
        clearLock();
        showFeedback(t('Снова можно попробовать войти.'), true);
      }, error.retryIn * 1000);
      refresh();
      return;
    }
    showFeedback(error instanceof AuthRequestError ? translateMessage(error.message) : t('Не удалось подключиться. Попробуй ещё раз.'));
  };
  const checkRules = () => {
    rules.forEach((rule, index) => { rule.dataset.met = String(passwordRules[index][1](password.value)); });
  };
  email.addEventListener('input', () => {
    clearLock();
    feedback.hidden = true;
    recover.hidden = true;
  });
  password.addEventListener('input', () => {
    password.removeAttribute('aria-invalid');
    checkRules();
  });
  recover.addEventListener('click', () => {
    showPasswordRecovery(email.value.trim(), () => {
      clearLock();
      password.value = '';
      checkRules();
      recover.hidden = true;
      showFeedback(t('Пароль изменён. Войди с новым паролем.'), true);
      password.focus();
    });
  });

  reveal.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    if (!entry) reveal.textContent = t(visible ? 'Скрыть' : 'Показать');
    reveal.setAttribute('aria-label', t(visible ? 'Скрыть пароль' : 'Показать пароль'));
    reveal.setAttribute('aria-pressed', String(visible));
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!submit.disabled) login({ email: email.value, password: password.value });
  });
  /** Changes the idle submit label, for example when the entry mode changes. */
  const setSubmitLabel = (label: string) => {
    submitLabel = label;
    refresh();
  };
  return { form, password, setBusy, showFailure, setSubmitLabel };
}
