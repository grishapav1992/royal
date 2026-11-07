import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatLanguageWindow } from '../server/chatLanguageWindow';
import {
  CHAT_MODERATION_RULES_VERSION, evaluateChatModeration, type ChatModerationState,
} from '../server/chatModerationRules';
import { ChatSpam } from '../server/chatSpam';

const empty: ChatModerationState = { spam: [], language: [] };
const evaluate = (state: ChatModerationState, text: string, receivedAt: number) =>
  evaluateChatModeration(CHAT_MODERATION_RULES_VERSION, state, text, receivedAt);

test('a fresh worker can continue the rolling language threshold from the serialized window', () => {
  const message = 'Fuck, Scheiße, putain, coño, cazzo, kurwa, caralho, klootzak, блять';
  const first = evaluate(empty, message, 1_000);
  assert.equal(first.outcome, 'publish');
  if (first.outcome !== 'publish') assert.fail('First message must be published');
  assert.equal(first.maskedText, 'F**k, S*****e, p****n, c**o, c***o, k***a, c*****o, k******k, б***ь');
  assert.deepEqual(empty, { spam: [], language: [] });
  const restored: ChatModerationState = JSON.parse(JSON.stringify(first.state));
  assert.deepEqual(restored, first.state);

  const within = evaluate(restored, 'идиот', 30_999);
  assert.equal(within.outcome, 'profanity');
  assert.deepEqual(within.state.language, [{ at: 1_000, words: 9 }, { at: 30_999, words: 1 }]);
  assert.deepEqual(evaluate(restored, 'идиот', 30_999), within);
  const expired = evaluate(restored, 'идиот', 31_000);
  assert.equal(expired.outcome, 'publish');
  assert.deepEqual(expired.state.language, [{ at: 31_000, words: 1 }]);
});

test('the worker and legacy wrapper agree on bursts and Telegram variants', () => {
  const bursts = Array.from({ length: 8 }, (_, i) => ({ text: 'идиот, реплика ' + i, time: 1_000 + i * 100 }));
  const telegram = [
    { text: 'Новый пост https://t.me/RoyalExample/12', time: 1_000 },
    { text: 'Telegram: @royalexample и https://t.me/another_example', time: 6_000 },
    { text: 'Подборка новостей t.me/another_example', time: 11_000 },
    { text: 'Смотрите архив https://telegram.me/s/royalexample?source=game', time: 16_000 },
  ];
  for (const [messages, expected] of [
    [bursts, ['publish', 'publish', 'publish', 'publish', 'rate_limited', 'rate_limited', 'rate_limited', 'spam']],
    [telegram, ['publish', 'publish', 'publish', 'spam']],
  ] as const) {
    const legacy = new ChatSpam();
    let state = empty;
    const decisions = messages.map(({ text, time }) => {
      const old = legacy.check('account', text, time);
      const decision = evaluate(state, text, time);
      assert.equal(decision.outcome, old === 'ok' ? 'publish' : old === 'slow' ? 'rate_limited' : 'spam');
      state = decision.state;
      return decision.outcome;
    });
    assert.deepEqual(decisions, expected);
    assert.equal(state.spam.length, messages.length, 'a worker retains the window until enforcement resolves');
    assert.equal(state.language.length, messages === bursts ? 4 : 0, 'spam and speed rejections skip the language window');
    assert.equal(legacy.check('account', messages[0].text, 16_001), 'ok', 'the legacy wrapper resets immediately');
  }
});

test('version, time and sample bounds fail closed', () => {
  let state = empty;
  for (let i = 0; i < 22; i++) {
    const decision = evaluate(state, 'unique entry ' + i, 1_000 + Math.floor(Math.min(i, 20) / 7) * 10_000);
    assert.equal(decision.outcome === 'spam', i === 21);
    state = decision.state;
  }
  assert.equal(state.spam.length, 22);
  assert.throws(() => evaluateChatModeration(2, empty, 'hello', 22_000), /Unsupported/);
  assert.throws(() => evaluate(state, 'hello', 20_000), /ordered/);
  assert.throws(() => evaluate({ ...state, spam: [...state.spam, state.spam[0]] }, 'hello', 22_000), /sample limits/);

  state = empty;
  for (let i = 0; i < 10; i++) {
    const decision = evaluate(state, 'идиот, реплика ' + i, 1_000 + i * 3_000);
    assert.equal(decision.outcome, i < 9 ? 'publish' : 'profanity');
    state = decision.state;
  }
  assert.equal(state.language.length, 10);
  assert.throws(() => evaluate({ ...state, language: [...state.language, state.language[0]] }, 'hello', 29_000), /sample limits/);
});

test('malformed persisted samples fail closed before a message can be published', () => {
  const decide = (state: unknown) => evaluateChatModeration(CHAT_MODERATION_RULES_VERSION, state, 'hello', 3);
  const sample = { at: 1, text: 'hello', telegram: [] };
  for (const state of [null, { spam: {}, language: [] }, { ...empty, rawText: 'unexpected' }]) {
    assert.throws(() => decide(state), /Invalid chat moderation state/);
  }
  for (const corrupt of [
    null,
    { ...sample, telegram: 'invalid' },
    { ...sample, telegram: [42] },
    { ...sample, telegram: ['bad name'] },
    { ...sample, telegram: ['invite:' + 'x'.repeat(10_000)] },
    { ...sample, text: 'x'.repeat(10_000) },
    { ...sample, rawText: 'unexpected' },
  ]) {
    assert.throws(() => decide({ ...empty, spam: [corrupt] }), /Invalid chat moderation sample/);
  }
  for (const words of [-1, 0, 1.5, 301, NaN, null, '1']) {
    assert.throws(() => decide({ ...empty, language: [{ at: 1, words }] }), /Invalid chat moderation sample/);
  }
  for (const at of [-1, 1.5, 4, Infinity, '1']) {
    assert.throws(() => decide({ ...empty, spam: [{ ...sample, at }] }), /ordered admission times/);
  }
  assert.throws(() => decide({ ...empty, spam: [{ ...sample, at: 2 }, sample] }), /ordered admission times/);
  assert.throws(() => evaluate(empty, 'x'.repeat(301), 3), /text length/);
});

test('serialized windows preserve full NFKC expansion and expanded invite tokens', () => {
  const expandedText = '\uFDFA'.repeat(300);
  const first = evaluate(empty, expandedText, 1_000);
  assert.equal(first.outcome, 'publish');
  assert.equal(first.state.spam[0].text.length, 4_500);
  const second = evaluate(JSON.parse(JSON.stringify(first.state)), expandedText, 6_000);
  assert.equal(second.outcome, 'publish');
  assert.equal(evaluate(JSON.parse(JSON.stringify(second.state)), expandedText, 11_000).outcome, 'spam');

  const invite = evaluate(empty, 't.me/+' + '\u2167'.repeat(294), 1_000);
  assert.deepEqual(invite.state.spam[0].telegram, ['invite:' + 'VIII'.repeat(294)]);
  assert.equal(evaluate(JSON.parse(JSON.stringify(invite.state)), 'another reply', 6_000).outcome, 'publish');
});

test('the legacy language window still deduplicates an unexpired request ID case-insensitively', () => {
  const language = new ChatLanguageWindow();
  assert.equal(language.check('account', 6, 1_000, 'DUPLICATE'), false);
  assert.equal(language.check('account', 6, 2_000, 'duplicate'), false);
  assert.equal(language.check('account', 4, 2_000, 'new'), true);
  assert.equal(language.check('account', 6, 32_000, 'duplicate'), false);
  assert.equal(language.check('account', 4, 32_000, 'new'), true);
});
