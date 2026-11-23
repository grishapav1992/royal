import {language} from '../../src/i18n/index';
import {afterText} from '../../src/ui/AfterglowText';

// Studio cabinet labels added with the 1.4 layout. The installed host dictionary can predate them.
const english:Record<string,string>={
 'Героиня':'Heroine','Альбом':'Album','Игровое поле':'Game field','14 линий':'14 lines','Камеры':'Cameras','WILD в кадре':'WILD in frame',
 'Выигрыш':'Win','Пробел':'Space','Скорость':'Speed','Обычно':'Normal','Быстро':'Fast','Автовращений':'Auto spins','Правила':'Rules',
 'История':'History','Музыка':'Music','Звуки':'Sounds','Бонусная фотосессия':'Bonus photo shoot','бесплатно':'free',
};
export const girlhubText=(source:string)=>language==='en'&&Object.hasOwn(english,source)?english[source]:afterText(source);
