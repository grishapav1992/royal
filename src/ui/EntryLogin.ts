import { language, t, translateMessage } from '../i18n/index';
import { AuthRequestError, requestAuth } from '../network/AccountClient';
import { renderEntryPage } from './EntryModes';
import { bindLoginForm, loginFormMarkup } from './LoginForm';

function loginError(error: unknown) {
  return error instanceof AuthRequestError
    ? translateMessage(error.message)
    : t('Не удалось подключиться. Попробуй ещё раз.');
}

export async function requireEntryAccount(): Promise<void> {
  const app = renderEntryPage(`
    <section class="entry-login" id="join-dialog" aria-labelledby="join-title">
      <h1 id="join-title">${t('Вход в Royal')}</h1>
      <p class="entry-login-check" role="status">${t('Проверяем вход…')}</p>
    </section>`);
  let sessionError = '';
  try {
    if ((await requestAuth('/me')).account) return;
  } catch (error) {
    sessionError = loginError(error);
  }

  const panel = app.querySelector<HTMLElement>('.entry-login')!;
  panel.querySelector('.entry-login-check')!.remove();
  panel.insertAdjacentHTML('beforeend', `
    <div id="login-step">
      <p class="entry-login-hint">${t('Первый вход создаст аккаунт.')}</p>
      ${loginFormMarkup()}
      <p id="join-error" role="alert" hidden></p>
    </div>
    <a class="entry-login-offline" href="/?offline=1&amp;lang=${language}">${t('Осмотреться одному')}</a>`);

  const feedback = panel.querySelector<HTMLParagraphElement>('#join-error')!;
  feedback.textContent = sessionError;
  feedback.hidden = !sessionError;

  return new Promise<void>(resolve => {
    const { form, password, submit } = bindLoginForm(panel, async credentials => {
      submit.disabled = true;
      form.setAttribute('aria-busy', 'true');
      feedback.hidden = true;
      try {
        const { account } = await requestAuth('/login', credentials);
        if (!account) throw new AuthRequestError(401, 'Не получилось войти. Попробуй ещё раз.');
        password.value = '';
        resolve();
      } catch (error) {
        feedback.textContent = loginError(error);
        feedback.hidden = false;
      } finally {
        form.removeAttribute('aria-busy');
        submit.disabled = false;
      }
    });
  });
}
