import { t, translateMessage } from '../i18n/index';
import { AuthRequestError, requestAuth } from '../network/AccountClient';
import { renderEntryPage } from './EntryModes';
import { bindLoginForm, loginFormMarkup } from './LoginForm';

function loginError(error: unknown) {
  return error instanceof AuthRequestError
    ? translateMessage(error.message)
    : t('Не удалось подключиться. Попробуй ещё раз.');
}

const backButton = () => `<button type="button" class="entry-login-back"><span aria-hidden="true">←</span> ${t('К выбору режима')}</button>`;

function retrySessionCheck(error: unknown): Promise<boolean> {
  const app = renderEntryPage(`
    <section class="entry-login" aria-labelledby="join-title">
      <h1 id="join-title">${t('Проверка входа')}</h1>
      <p class="entry-login-hint" role="alert"></p>
      <button type="button" class="entry-login-retry">${t('Повторить')}</button>
      ${backButton()}
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

export async function requireEntryAccount(): Promise<boolean> {
  while (true) {
    try {
      if ((await requestAuth('/me')).account) return true;
      break;
    } catch (error) {
      if (error instanceof AuthRequestError && error.status === 401) break;
      if (!(await retrySessionCheck(error))) return false;
    }
  }

  const app = renderEntryPage(`
    <section class="entry-login" id="join-dialog" aria-labelledby="join-title">
      <h1 id="join-title">${t('Вход в Royal')}</h1>
      <div id="login-step">
        <p class="entry-login-hint">${t('Первый вход создаст аккаунт.')}</p>
        ${loginFormMarkup()}
        <p id="join-error" role="alert" hidden></p>
      </div>
      ${backButton()}
    </section>`);
  const panel = app.querySelector<HTMLElement>('.entry-login')!;
  const feedback = panel.querySelector<HTMLParagraphElement>('#join-error')!;
  const back = panel.querySelector<HTMLButtonElement>('.entry-login-back')!;

  return new Promise(resolve => {
    back.onclick = () => resolve(false);
    const { form, password, submit } = bindLoginForm(panel, async credentials => {
      submit.disabled = true;
      back.disabled = true;
      form.setAttribute('aria-busy', 'true');
      feedback.hidden = true;
      try {
        const { account } = await requestAuth('/login', credentials);
        if (!account) throw new AuthRequestError(401, 'Не получилось войти. Попробуй ещё раз.');
        password.value = '';
        resolve(true);
      } catch (error) {
        feedback.textContent = loginError(error);
        feedback.hidden = false;
      } finally {
        form.removeAttribute('aria-busy');
        submit.disabled = false;
        back.disabled = false;
      }
    });
    panel.querySelector<HTMLInputElement>('#email')!.focus({ preventScroll: true });
  });
}
