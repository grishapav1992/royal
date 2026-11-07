import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterChatProfanity, isDirectedChatInsult, maskChatText } from '../src/shared/chatConduct';

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

test('the profanity count matches masked occurrences and includes repeats', () => {
  assert.deepEqual(filterChatProfanity('Fuck, fuck, f**k, идиот, kurwa'), {
    text: 'F**k, f**k, f**k, идиот, k***a',
    count: 3,
  });
});

test('explicit insults target people even when the insult is not profanity', () => {
  for (const text of [
    'You are an idiot', 'YOU’RE ALL IDIOTS!', 'You are a fucking moron', 'You are a piece of shit',
    'fuck you all', '@Alice, idiot!', 'Du bist ein Idiot', 'Ihr seid alle Arschlöcher',
    'T’es un con', 'Vous êtes tous des idiots', 'Eres un gilipollas', 'Sois todos idiotas',
    'Sei un’idiota', 'Siete degli stronzi', 'Jesteś idiotą', 'Jesteście idiotami',
    'És um idiota', 'Vocês são todos idiotas', 'Je bent een idioot', 'Jullie zijn allemaal klootzakken',
    'ты идиот', 'вы все тут конченые идиоты', 'Fuck, ты идиот!', 'ты д\u200bебил',
  ]) assert.equal(isDirectedChatInsult(text), true, text);
});

test('swearing about a game, self-criticism, neutral quotes and ordinary criticism carry no offense', () => {
  for (const text of [
    'idiot', 'идиот', 'I am an idiot', 'Я идиот', 'Kurwa, przegrałem', 'Scheiße, schon wieder verloren',
    'Joder, perdí', 'Cazzo, ho perso', 'foda-se', 'fuck, I lost', 'this game is fucking hard',
    'let’s play con amigos', 'Are you ready?', 'You are not an idiot', 'Твой ход был плохим',
    '"You are an idiot"', 'What does "you are an idiot" mean?', 'Фраза «ты идиот» считается оскорблением?',
  ]) assert.equal(isDirectedChatInsult(text), false, text);
});
