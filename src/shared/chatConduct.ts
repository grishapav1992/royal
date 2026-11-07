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

// Whole-word insults count toward the same threshold as profanity.
// Skip ambiguous words that are common names or everyday words in another language.
const INSULTS = [
  /^(?:idiot(?:s|e|es|en|in|innen|a|as|i|ą|o|ami)?|idioci|morons?|idioot|idioten|stommeling(?:en)?)$/,
  /^(?:imb[ée]ci(?:l(?:es)?|s)|est[úu]pid[oa]s?|stupid[oaie]|debil(?:u|em|ami|e)?)$/,
  /^(?:идиот(?:ка|ки|ы)?|дебил(?:ка|ки|ы)?|тупиц[аы]|придур(?:ок|ки))$/,
];

function normalize(text: string): string {
  return text.replace(/\p{Cf}/gu, '').normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
}

/** Match whole words so a benign word containing a similar fragment stays readable. */
export function filterChatLanguage(text: string): { text: string; count: number } {
  let count = 0;
  const masked = text.replace(/[\p{L}\p{M}\p{N}\p{Cf}]+/gu, word => {
    const normalized = normalize(word);
    const profane = PROFANITY.some(pattern => pattern.test(normalized));
    if (profane || INSULTS.some(pattern => pattern.test(normalized))) count++;
    if (!profane) return word;
    const characters = Array.from(word.replace(/\p{Cf}/gu, ''));
    return characters[0] + '*'.repeat(characters.length - 2) + characters.at(-1);
  });
  return { text: masked, count };
}

export function maskChatText(text: string): string {
  return filterChatLanguage(text).text;
}
