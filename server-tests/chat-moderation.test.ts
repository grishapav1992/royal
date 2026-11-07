import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskChatText } from '../src/shared/chatMask';

test('chat masks profanity and common insults while retaining case and punctuation', () => {
  assert.equal(maskChatText('Fuck! Ты идиот?'), 'F**k! Ты и***т?');
  assert.equal(maskChatText('Нахуй, ёбаный пиздец, блядь и сука.'), 'Н***й, ё****й п****ц, б***ь и с**а.');
  assert.equal(maskChatText('Fucking assholes, дебилы.'), 'F*****g a******s, д****ы.');
});

test('masking uses Unicode word boundaries and preserves innocent words, emoji and stickers', () => {
  const safe = 'Страхуй машину. Сукачёв, classic, Scunthorpe, cockpit. 👩‍💻 🦆 Уточка машет: привет!';
  assert.equal(maskChatText(safe), safe);
  assert.equal(maskChatText('слово«fuck», русский-идиот'), 'слово«f**k», русский-и***т');
});

test('word lookup handles compatible characters and hidden format controls', () => {
  const masked = maskChatText('f\u200buck, ｆｕｃｋ, д\u200bебил');
  assert.equal(masked, 'f**k, ｆ**ｋ, д***л');
  assert.equal(maskChatText(masked), masked);
});
