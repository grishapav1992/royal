import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterChatLanguage, maskChatText } from '../src/shared/chatConduct';

test('chat masks profanity and preserves standalone non-obscene insults', () => {
  assert.equal(maskChatText('Fuck! Я идиот.'), 'F**k! Я идиот.');
  assert.equal(maskChatText('Нахуй, ёбаный пиздец, блядь и сука.'), 'Н***й, ё****й п****ц, б***ь и с**а.');
  assert.equal(maskChatText('Fucking assholes, дебилы.'), 'F*****g a******s, дебилы.');
});

test('masking uses Unicode word boundaries and preserves innocent words, emoji and stickers', () => {
  const safe = 'Страхуй машину. Сукачёв, classic, Scunthorpe, cockpit, con amigos, la porra del partido. 👩‍💻 🦆 Уточка машет: привет!';
  assert.equal(maskChatText(safe), safe);
  assert.equal(maskChatText('слово«fuck», русский-идиот'), 'слово«f**k», русский-идиот');
});

test('word lookup handles compatible characters and hidden format controls', () => {
  const masked = maskChatText('f\u200buck, ｆｕｃｋ, б\u200bлять');
  assert.equal(masked, 'f**k, ｆ**ｋ, б***ь');
  assert.equal(maskChatText(masked), masked);
});

test('European profanity is masked in the same message regardless of language', () => {
  assert.equal(
    maskChatText('Fuck, Scheiße, putain, coño, cazzo, kurwa, caralho, klootzak, блять'),
    'F**k, S*****e, p****n, c**o, c***o, k***a, c*****o, k******k, б***ь',
  );
  assert.equal(maskChatText('foda-se, hijo de puta, vai a fanculo'), 'f**a-se, hijo de p**a, vai a f*****o');
});

test('the shared count includes both masked profanity and visible insults', () => {
  assert.deepEqual(filterChatLanguage('Fuck, fuck, f**k, идиот, kurwa'), {
    text: 'F**k, f**k, f**k, идиот, k***a',
    count: 4,
  });
});

test('insults count equally when standalone, addressed, self-directed or quoted', () => {
  for (const text of [
    'идиот', 'Я идиот', 'Ты идиот', 'Грифа, ты идиот!', '«ты идиот»',
    'You are an idiot. Leave the room.', 'Du bist ein Idiot', 'Vous êtes tous des idiots',
    'Sois todos idiotas', 'Sei un’idiota', 'Jesteś idiotą', 'És um idiota', 'Je bent een idioot',
  ]) assert.deepEqual(filterChatLanguage(text), { text, count: 1 });
});

test('ambiguous words and ordinary criticism do not increase the count', () => {
  const text = 'Let’s play con amigos, Dick. Твой ход был плохим.';
  assert.deepEqual(filterChatLanguage(text), { text, count: 0 });
});
