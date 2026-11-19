import { locale, t, tr, translateMessage } from '../i18n/index';
import { AuthRequestError } from '../network/AccountClient';
import { showPasswordRecovery } from './PasswordRecovery';

type LoginCredentials = { email: string; password: string };

export function loginFormMarkup() {
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
      <button id="login-button" class="primary-button" type="submit">Продолжить</button>
    </form>
    <button type="button" class="login-recovery-link" hidden>Восстановить пароль</button>`);
}

export function bindLoginForm(host: HTMLElement, login: (credentials: LoginCredentials) => void) {
  const form = host.querySelector<HTMLFormElement>('#login-form')!;
  const email = form.querySelector<HTMLInputElement>('#email')!;
  const password = form.querySelector<HTMLInputElement>('#password')!;
  const reveal = form.querySelector<HTMLButtonElement>('#reveal-password')!;
  const submit = form.querySelector<HTMLButtonElement>('#login-button')!;
  const feedback = host.querySelector<HTMLParagraphElement>('#join-error')!;
  const recover = host.querySelector<HTMLButtonElement>('.login-recovery-link')!;
  let busy = false;
  let lockedUntil = 0;
  let unlockTimer: number | undefined;

  const showFeedback = (message: string, success = false) => {
    feedback.textContent = message;
    feedback.dataset.loginFeedback = success ? 'success' : 'error';
    feedback.hidden = false;
  };
  const refresh = () => {
    submit.disabled = busy || lockedUntil > Date.now();
    email.disabled = busy;
    recover.disabled = busy;
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
    if (error instanceof AuthRequestError && error.code === 'login_locked' && error.retryIn > 0) {
      lockedUntil = Date.now() + error.retryIn * 1000;
      const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(lockedUntil);
      showFeedback(tr`Пять неверных попыток. Вход снова доступен в ${time}.`);
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
  email.addEventListener('input', () => {
    clearLock();
    feedback.hidden = true;
    recover.hidden = true;
  });
  recover.addEventListener('click', () => {
    showPasswordRecovery(email.value.trim(), () => {
      clearLock();
      password.value = '';
      recover.hidden = true;
      showFeedback(t('Пароль изменён. Войди с новым паролем.'), true);
      password.focus();
    });
  });

  reveal.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    reveal.textContent = t(visible ? 'Скрыть' : 'Показать');
    reveal.setAttribute('aria-label', t(visible ? 'Скрыть пароль' : 'Показать пароль'));
    reveal.setAttribute('aria-pressed', String(visible));
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!submit.disabled) login({ email: email.value, password: password.value });
  });
  return { form, password, setBusy, showFailure };
}
