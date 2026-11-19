import { t, tr, translateMessage } from '../i18n/index';
import { AuthRequestError, requestPasswordRecovery } from '../network/AccountClient';
import './password-recovery.css';

export function showPasswordRecovery(email: string, saved: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'password-recovery';
  dialog.setAttribute('aria-labelledby', 'recovery-title');
  dialog.innerHTML = t(`
    <h2 id="recovery-title">Восстановление пароля</h2>
    <p id="recovery-address"></p>
    <form id="recovery-code-form" hidden>
      <label for="recovery-code">Код из письма</label>
      <input id="recovery-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      <button type="submit" class="recovery-primary">Подтвердить код</button>
    </form>
    <form id="recovery-password-form" hidden>
      <label for="recovery-password">Новый пароль</label>
      <input id="recovery-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" aria-describedby="recovery-password-hint" required>
      <p id="recovery-password-hint">От 8 символов, с прописной и строчной буквами, цифрой и спецсимволом.</p>
      <label for="recovery-confirmation">Повтори новый пароль</label>
      <input id="recovery-confirmation" name="password-confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
      <button type="submit" class="recovery-primary">Сохранить новый пароль</button>
    </form>
    <p class="recovery-error" role="alert" hidden></p>
    <div class="recovery-actions">
      <button type="button" id="recovery-send">Запросить код</button>
      <button type="button" id="recovery-close">Отмена</button>
    </div>`);
  const address = dialog.querySelector<HTMLParagraphElement>('#recovery-address')!;
  const error = dialog.querySelector<HTMLParagraphElement>('.recovery-error')!;
  const codeForm = dialog.querySelector<HTMLFormElement>('#recovery-code-form')!;
  const passwordForm = dialog.querySelector<HTMLFormElement>('#recovery-password-form')!;
  const code = dialog.querySelector<HTMLInputElement>('#recovery-code')!;
  const password = dialog.querySelector<HTMLInputElement>('#recovery-password')!;
  const confirmation = dialog.querySelector<HTMLInputElement>('#recovery-confirmation')!;
  const send = dialog.querySelector<HTMLButtonElement>('#recovery-send')!;
  const close = dialog.querySelector<HTMLButtonElement>('#recovery-close')!;
  let resetToken = '';
  let busy = false;

  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    dialog.setAttribute('aria-busy', 'true');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    buttons.forEach(button => button.disabled = true);
    try { await action(); }
    catch (failure) {
      showError(failure instanceof AuthRequestError ? translateMessage(failure.message) : t('Не удалось подключиться. Попробуй ещё раз.'));
    } finally {
      busy = false;
      buttons.forEach(button => button.disabled = false);
      dialog.removeAttribute('aria-busy');
    }
  };

  const requestCode = () => run(async () => {
    await requestPasswordRecovery('/request', { email });
    address.textContent = tr`Если аккаунт есть, код отправлен на ${email}. Повторный запрос доступен через минуту.`;
    send.textContent = t('Запросить новый код');
    codeForm.hidden = false;
    code.focus();
  });
  send.addEventListener('click', () => void requestCode());
  codeForm.addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const result = await requestPasswordRecovery('/verify', { email, code: code.value.trim() });
      if (!result.resetToken) throw new Error('Missing password reset token');
      resetToken = result.resetToken;
      codeForm.reset();
      codeForm.hidden = true;
      passwordForm.hidden = false;
      send.hidden = true;
      address.textContent = t('Код подтверждён. Придумай новый пароль.');
      password.focus();
    });
  });
  passwordForm.addEventListener('submit', event => {
    event.preventDefault();
    if (password.value !== confirmation.value) {
      showError(t('Пароли не совпадают.'));
      confirmation.focus();
      return;
    }
    void run(async () => {
      try { await requestPasswordRecovery('/reset', { email, resetToken, password: password.value }); }
      catch (failure) {
        if (failure instanceof AuthRequestError && failure.code === 'reset_expired') {
          passwordForm.reset();
          passwordForm.hidden = true;
          send.hidden = false;
        }
        throw failure;
      }
      dialog.close();
      saved();
    });
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    resetToken = '';
    codeForm.reset();
    passwordForm.reset();
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  void requestCode();
}
