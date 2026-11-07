const MASKED_WORDS = [
  /^(?:(?:mother)?fuck(?:s|ed|ing|ers?)?|(?:bull)?shit(?:s|ty|ting|ted|show)?|bitch(?:es|y)?|assholes?|dumbass(?:es)?|cunts?|idiots?|morons?)$/,
  /^(?:бля(?:ть|д(?:ь|и|ей|ям|ями|ью|ина))?|су(?:ка|ки|ку|ке|кой|кою|кам|ками|ках|чка|чки)|мудак(?:а|у|ом|е|и|ов|ам|ами|ах)?|мудил(?:а|о|ы|у|ой))$/,
  /^(?:(?:на|по|до|ни|за)?ху(?:й|я|ю|и|ем|е[вн][а-я]*|йн[а-я]*)|[ао]хуе[а-я]*|(?:за|раз|про|от|на|при|под|вы|с|рас|у|в)?пизд[а-я]*)$/,
  /^(?:долб[ао]еб[а-я]*|(?:вы|до|за|на|об|от|под|по|при|про|разъ|съ|у)?еб(?:а[лнтш][а-я]*|нут[а-я]*|уч[а-я]*|у|ут|ешь|ет|ем|ите))$/,
  /^(?:идиот(?:ка|ки|ок|у|ом|а|ы|ов|ам|ами|ах)?|дебил(?:ка|ки|ок|у|ом|а|ы|ов|ам|ами|ах)?|тупиц(?:а|ы|у|ей)|придур(?:ок|ка|ки|ков|ку|ком))$/,
];

/** Match whole words so a benign word containing a similar fragment stays readable. */
export function maskChatText(text: string): string {
  return text.replace(/[\p{L}\p{M}\p{N}\p{Cf}]+/gu, word => {
    const visible = word.replace(/\p{Cf}/gu, '');
    const normalized = visible.normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
    if (!MASKED_WORDS.some(pattern => pattern.test(normalized))) return word;
    const characters = Array.from(visible);
    return characters[0] + '*'.repeat(characters.length - 2) + characters.at(-1);
  });
}
