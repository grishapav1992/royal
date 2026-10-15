const { chromium } = require('../../node_modules/playwright');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const publicRoot = path.resolve(__dirname, '../public');
const origin = 'https://auth-test.invalid';
const ownerEmail = 'owner@example.test';
const ownerPassword = 'Synthetic-password-123';
const wrongCredentials = 'Неверная почта или пароль.';
const setupToken = 'synthetic-setup-token';

(async () => {
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH || existsSync(systemChrome)
      ? { executablePath: process.env.CHROME_PATH || systemChrome }
      : {})
  });
  let checks = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let authenticated = false;
    const sessionCalls = [];
    const setupCalls = [];
    let logoutCalls = 0;
    await page.route(`${origin}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({
        status, contentType: 'application/json', body: JSON.stringify(body)
      });
      if (url.pathname === '/team/api/state') {
        if (!authenticated) return json({ error: 'Требуется вход.' }, 401);
        return json({ tasks: [], projects: [], settings: {}, runtime: { available: true, authenticated: true, release_enabled: false }, usage: null });
      }
      if (url.pathname === '/team/api/session') {
        assert.equal(request.method(), 'POST');
        assert.equal(request.headers()['content-type'], 'application/json');
        const body = request.postDataJSON();
        sessionCalls.push(body);
        assert.deepEqual(Object.keys(body).sort(), ['email', 'password']);
        if (body.email !== ownerEmail || body.password !== ownerPassword) return json({ error: wrongCredentials }, 401);
        authenticated = true;
        return json({ ok: true });
      }
      if (url.pathname === '/team/api/setup') {
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON();
        setupCalls.push(body);
        assert.deepEqual(Object.keys(body).sort(), ['email', 'password', 'token']);
        assert.deepEqual(body, { token: setupToken, email: ownerEmail, password: ownerPassword });
        authenticated = true;
        return json({ ok: true });
      }
      if (url.pathname === '/team/api/session/logout') {
        assert.equal(request.method(), 'POST');
        logoutCalls += 1;
        authenticated = false;
        return json({ ok: true });
      }
      const file = url.pathname === '/team/' ? 'index.html' : url.pathname.split('/').at(-1);
      if (['index.html', 'app.js', 'styles.css', 'favicon.svg'].includes(file)) return route.fulfill({
        contentType: { 'index.html': 'text/html', 'app.js': 'text/javascript', 'styles.css': 'text/css', 'favicon.svg': 'image/svg+xml' }[file],
        headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        body: readFileSync(path.join(publicRoot, file), 'utf8')
      });
      return route.abort();
    });

    const email = page.locator('#login-email');
    const password = page.locator('#login-password');
    const submit = page.locator('#login-form button[type="submit"]');
    const login = page.locator('#login-screen');
    const workspace = page.locator('#workspace');
    const error = page.locator('#login-error');
    const readyForLogin = async url => {
      authenticated = false;
      await page.goto(url);
      await login.waitFor({ state: 'visible' });
      assert.equal(await workspace.isVisible(), false);
      await email.waitFor();
    };
    const fillCredentials = async (emailValue = ownerEmail, passwordValue = ownerPassword) => {
      await email.fill(emailValue);
      await password.fill(passwordValue);
    };
    const expectNoRequest = async (calls, before, invalidField) => {
      await submit.click();
      assert.equal(await invalidField.evaluate(node => node.validity.valid), false);
      assert.equal(calls.length, before, 'Native form validation prevents a credential request.');
      checks += 1;
    };
    const enterWorkspace = async () => {
      await submit.click();
      await workspace.waitFor({ state: 'visible' });
      assert.equal(await login.isVisible(), false);
      assert.equal(await password.inputValue(), '', 'Passwords are cleared after a successful login.');
      assert.equal(await email.inputValue(), ownerEmail);
      checks += 1;
    };

    await readyForLogin(`${origin}/team/`);
    assert.equal(await email.getAttribute('type'), 'email');
    assert.equal(await email.getAttribute('autocomplete'), 'username');
    assert.equal(await email.getAttribute('maxlength'), '254');
    assert.equal(await email.evaluate(node => node.required), true);
    assert.equal(await password.getAttribute('autocomplete'), 'current-password');
    assert.equal(await password.evaluate(node => node.required), true);
    assert.equal(await password.getAttribute('minlength'), null, 'Existing owner passwords remain usable.');
    await email.focus();
    await page.keyboard.press('Tab');
    assert.equal(await password.evaluate(node => node === document.activeElement), true, 'The password follows email in keyboard navigation.');
    checks += 1;

    await fillCredentials('', ownerPassword);
    await expectNoRequest(sessionCalls, 0, email);
    await fillCredentials('invalid-address', ownerPassword);
    await expectNoRequest(sessionCalls, 0, email);
    await fillCredentials(ownerEmail, '');
    await expectNoRequest(sessionCalls, 0, password);

    await fillCredentials('other@example.test', ownerPassword);
    await submit.click();
    await error.waitFor({ state: 'visible' });
    assert.equal(await error.innerText(), wrongCredentials);
    assert.equal(await email.inputValue(), 'other@example.test', 'A rejected login retains the entered email.');
    assert.equal(await workspace.isVisible(), false);
    const wrongEmailMessage = await error.innerText();
    await fillCredentials(ownerEmail, 'Wrong-synthetic-password');
    await submit.click();
    await page.waitForFunction(() => !document.querySelector('#login-form button[type="submit"]').disabled);
    assert.equal(await error.innerText(), wrongEmailMessage, 'Wrong email and wrong password have the same visible failure.');
    assert.equal(await email.inputValue(), ownerEmail);
    assert.equal(await workspace.isVisible(), false);
    assert.equal(sessionCalls.length, 2);
    checks += 1;

    await fillCredentials();
    await enterWorkspace();
    assert.deepEqual(sessionCalls.at(-1), { email: ownerEmail, password: ownerPassword });
    await page.locator('#logout-button').click();
    await login.waitFor({ state: 'visible' });
    assert.equal(logoutCalls, 1);
    assert.equal(await workspace.isVisible(), false);
    assert.equal(await email.inputValue(), ownerEmail, 'Logout retains email for the next login.');
    assert.equal(await password.inputValue(), '', 'Logout cannot expose a previous password.');
    checks += 1;

    await fillCredentials();
    await enterWorkspace();
    await page.locator('#settings-button').click();
    await page.locator('#settings-dialog[open]').waitFor();
    authenticated = false;
    await login.waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await workspace.isVisible(), false);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'An expired session closes private dialogs.');
    assert.equal(await email.inputValue(), ownerEmail);
    assert.equal(await password.inputValue(), '');
    checks += 1;

    await readyForLogin(`${origin}/team/?setup=${setupToken}&view=compact#auth`);
    assert.equal(await password.getAttribute('autocomplete'), 'new-password');
    assert.equal(await password.getAttribute('minlength'), '12');
    await fillCredentials('', ownerPassword);
    await expectNoRequest(setupCalls, 0, email);
    await fillCredentials('invalid-address', ownerPassword);
    await expectNoRequest(setupCalls, 0, email);
    await fillCredentials(ownerEmail, 'Short-pass1');
    await expectNoRequest(setupCalls, 0, password);
    await fillCredentials();
    await enterWorkspace();
    assert.equal(setupCalls.length, 1);
    const cleanedUrl = new URL(page.url());
    assert.equal(cleanedUrl.searchParams.has('setup'), false, 'The one-time setup token is removed from the address after success.');
    assert.equal(cleanedUrl.searchParams.get('view'), 'compact');
    assert.equal(cleanedUrl.hash, '#auth');
    await page.locator('#logout-button').click();
    await login.waitFor({ state: 'visible' });
    assert.equal(await password.getAttribute('autocomplete'), 'current-password');
    assert.equal(await password.getAttribute('minlength'), null);
    checks += 1;

    await page.setViewportSize({ width: 390, height: 844 });
    await readyForLogin(`${origin}/team/`);
    const loginBox = await page.locator('#login-form').boundingBox();
    assert.ok(loginBox && loginBox.width > 0 && loginBox.x >= 0 && loginBox.x + loginBox.width <= 391, 'Email and password form fits a narrow mobile viewport.');
    const emailBox = await email.boundingBox();
    const passwordBox = await password.boundingBox();
    assert.ok(emailBox && passwordBox && emailBox.y < passwordBox.y);
    await fillCredentials();
    await password.press('Enter');
    await workspace.waitFor({ state: 'visible' });
    assert.equal(await password.inputValue(), '');
    assert.deepEqual(sessionCalls.at(-1), { email: ownerEmail, password: ownerPassword });
    checks += 1;

    assert.deepEqual(errors, [], 'Authentication has no browser runtime errors.');
    console.log(JSON.stringify({ ok: true, checks, session_requests: sessionCalls.length, setup_requests: setupCalls.length, logout_requests: logoutCalls }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
