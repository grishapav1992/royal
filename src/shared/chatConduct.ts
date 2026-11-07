const PROFANITY = [
  // English
  /^(?:(?:mother)?fuck(?:s|ed|ing|ers?)?|(?:bull)?shit(?:s|ty|ting|ted|show|heads?)?|bitch(?:es|y)?|arseholes?|assholes?|dickheads?|dumbass(?:es)?|cunts?|wankers?|twats?)$/,
  // German
  /^(?:schei(?:ß|ss)e?|arschloch(?:s|es)?|arschl[öo]cher(?:n)?|(?:ge|ver)?fick(?:en|st|t|e)?|hurens[öo]hn(?:e)?|wichser(?:in|innen)?)$/,
  // French
  /^(?:putains?|merdes?|connard(?:e|s|es)?|connasses?|salope(?:s)?|encul[ée](?:e|s|es|r)?)$/,
  // Spanish
  /^(?:jod(?:er|e|id[oa]s?)|coño|mierdas?|putas?|gilipollas)$/,
  // Italian and Portuguese
  /^(?:cazz[oi]|merd[ae]s?|stronz[oaie]|(?:vaf)?fanculo|caralhos?|fod(?:a|as|er|id[oa]s?))$/,
  // Polish
  /^(?:kurw(?:a|y|ą|o|ę|ie|om|ami|ach)|chuj(?:a|e|u|em|owi|[óo]w|nia)?|(?:s|wy)?pierdalaj(?:cie)?|pierdol(?:ić|ic|ę|isz|on[yae]s?)?|jeb(?:ać|ac|an[yae]))$/,
  // Dutch
  /^(?:klootzak(?:ken)?|godverdomme|kut|lul)$/,
  // Russian
  /^(?:бля(?:ть|д(?:ь|и|ей|ям|ями|ью|ина))?|су(?:ка|ки|ку|ке|кой|кою|кам|ками|ках|чка|чки)|мудак(?:а|у|ом|е|и|ов|ам|ами|ах)?|мудил(?:а|о|ы|у|ой))$/,
  /^(?:(?:на|по|до|ни|за)?ху(?:й|я|ю|и|ем|е[вн][а-я]*|йн[а-я]*)|[ао]хуе[а-я]*|(?:за|раз|про|от|на|при|под|вы|с|рас|у|в)?пизд[а-я]*)$/,
  /^(?:долб[ао]еб[а-я]*|(?:вы|до|за|на|об|от|под|по|при|про|разъ|съ|у)?еб(?:а[лнтш][а-я]*|нут[а-я]*|уч[а-я]*|у|ут|ешь|ет|ем|ите))$/,
];

type AddressRules = { prefix: RegExp; insult: RegExp; attack?: RegExp };
const ADDRESS_RULES: AddressRules[] = [
  { // English
    prefix: /^you(?: all| guys| lot)?(?:(?: are|'re)(?: all)?)? (?:such )?(?:an? )?(?:fucking )?/,
    insult: /^(?:idiots?|morons?|arseholes?|assholes?|dicks?|dickheads?|shitheads?|dumbass(?:es)?|bitch(?:es)?|cunts?|wankers?|twats?|piece of shit|son of a bitch)$/,
    attack: /^(?:fuck you(?: all)?|(?:go )?fuck yoursel(?:f|ves)|fuck off)$/,
  },
  { // German
    prefix: /^(?:du(?: bist)?|ihr(?: seid)?|sie sind) (?:alle )?(?:ein(?:e)? )?/,
    insult: /^(?:idiot(?:en|in|innen)?|arschloch|arschl[öo]cher|hurens[öo]hn(?:e)?|wichser(?:in|innen)?)$/,
    attack: /^fick(?: dich|t euch)$/,
  },
  { // French
    prefix: /^(?:tu es|t'es|vous [êe]tes) (?:tous |toutes )?(?:un(?:e)? |des )?/,
    insult: /^(?:idiot(?:e|s|es)?|con(?:ne|s|nes)?|connard(?:e|s|es)?|connasses?|salope(?:s)?|encul[ée](?:e|s|es)?)$/,
    attack: /^(?:va te faire foutre|allez vous faire foutre)$/,
  },
  { // Spanish
    prefix: /^(?:(?:t[úu] )?eres|(?:vosotros |vosotras )?sois|ustedes son) (?:tod[oa]s )?(?:un[oa]?s? )?(?:put[oa]s? )?/,
    insult: /^(?:idiotas?|imb[ée]cil(?:es)?|est[úu]pid[oa]s?|gilipollas|hij[oa]s? de puta)$/,
    attack: /^(?:vete|idos) a la mierda$/,
  },
  { // Italian
    prefix: /^(?:(?:tu )?sei|(?:voi )?siete) (?:tutti |tutte )?(?:un(?:a)? |un'|degli |delle )?/,
    insult: /^(?:idiot[ai]|stupid[oaie]|stronz[oaie]|test[ae] di cazzo)$/,
    attack: /^(?:vai|andate) a (?:fanculo|fare in culo)$/,
  },
  { // Polish
    prefix: /^(?:(?:ty )?jeste[śs]|(?:wy )?jeste[śs]cie|ty|wy) (?:wszyscy )?(?:jeban[yae]m? )?/,
    insult: /^(?:idiot[ąao]|idiotami|idioci|debil(?:u|em|ami|e)?|chuj(?:u|em|e|ami)?|kurw[ąao])$/,
    attack: /^(?:spierdalaj(?:cie)?|pierdol si[ęe])$/,
  },
  { // Portuguese
    prefix: /^(?:(?:tu )?[ée]s|voc[êe] [ée]|voc[êe]s s[ãa]o) (?:tod[oa]s )?(?:um(?:a)? |uns |umas )?/,
    insult: /^(?:idiotas?|imb[ée]cil|imb[ée]cis|est[úu]pid[oa]s?|filh[oa]s? da puta)$/,
    attack: /^(?:vai[- ]te foder|vai se foder|v[ãa]o se foder)$/,
  },
  { // Dutch
    prefix: /^(?:(?:je|jij|u) (?:bent|ben)|jullie zijn) (?:allemaal )?(?:een )?/,
    insult: /^(?:idioot|idioten|stommeling(?:en)?|klootzak(?:ken)?|lul(?:len)?)$/,
  },
  { // Russian
    prefix: /^(?:ты|вы(?: все(?: тут)?| тут все)?|все (?:вы|тут|в этом чате)) (?:просто |полн(?:ый|ая|ые) |кончен(?:ый|ая|ые) )?/,
    insult: /^(?:идиот(?:ка|ки|ы)?|дебил(?:ка|ки|ы)?|тупиц[аы]|придур(?:ок|ки)|муда(?:к|ки)|сук[аи]|долб[ао]ебы?)$/,
    attack: /^(?:иди(?:те)?|пошел|пошла|пошли) на ?хуй$/,
  },
];

function normalize(text: string): string {
  return text.replace(/\p{Cf}/gu, '').normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
}

function isProfane(word: string): boolean {
  return PROFANITY.some(pattern => pattern.test(word));
}

/** Match whole words so a benign word containing a similar fragment stays readable. */
export function maskChatText(text: string): string {
  return text.replace(/[\p{L}\p{M}\p{N}\p{Cf}]+/gu, word => {
    if (!isProfane(normalize(word))) return word;
    const characters = Array.from(word.replace(/\p{Cf}/gu, ''));
    return characters[0] + '*'.repeat(characters.length - 2) + characters.at(-1);
  });
}

/** Sanction only explicit forms of address. A bare insult can be a quotation or self-commentary. */
export function isDirectedChatInsult(text: string): boolean {
  const normalized = normalize(text).replace(/[’‘]/gu, "'").replace(/\s+/gu, ' ').trim().replace(/[.!?…]+$/u, '').trimEnd();
  const opener = /^([\p{L}\p{M}]+)[,.!?…]+ /u.exec(normalized);
  const addressed = opener && isProfane(opener[1]) ? normalized.slice(opener[0].length) : normalized;
  const mention = /^@[\p{L}\p{N}_][\p{L}\p{M}\p{N}_.-]{0,47}(?:\s*[:,]\s*|\s+)/u.exec(addressed);
  const phrase = mention ? addressed.slice(mention[0].length) : addressed;
  return ADDRESS_RULES.some(({ prefix, insult, attack }) => {
    if (attack?.test(phrase) || (mention && insult.test(phrase))) return true;
    const address = prefix.exec(phrase);
    return address !== null && insult.test(phrase.slice(address[0].length));
  });
}
