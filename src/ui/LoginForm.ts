import { t } from '../i18n/index';

type LoginCredentials = { email: string; password: string };

export function loginFormMarkup() {
  return t(`
    <form id="login-form">
      <label for="email">Почта</label>
      <input id="email" type="email" name="email" maxlength="254" autocomplete="username" placeholder="you@example.com" required>
      <label for="password">Пароль</label>
      <div class="password-field">
        <input id="password" type="password" name="password" minlength="8" maxlength="128" autocomplete="current-password" placeholder="Не меньше 8 символов" required>
        <button id="reveal-password" type="button" aria-label="Показать пароль" aria-pressed="false">Показать</button>
      </div>
      <button id="login-button" class="primary-button" type="submit">Продолжить</button>
    </form>`);
}

export function bindLoginForm(host: HTMLElement, login: (credentials: LoginCredentials) => void) {
  const form = host.querySelector<HTMLFormElement>('#login-form')!;
  const email = form.querySelector<HTMLInputElement>('#email')!;
  const password = form.querySelector<HTMLInputElement>('#password')!;
  const reveal = form.querySelector<HTMLButtonElement>('#reveal-password')!;
  const submit = form.querySelector<HTMLButtonElement>('#login-button')!;

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
  return { form, password, submit };
}
