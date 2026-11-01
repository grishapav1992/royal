export type FirstFloorTheme = {
  title: readonly [string, string];
  caption: readonly [string, string];
  location: readonly [string, string];
  palette: readonly [accent: string, secondary: string, ground: string, panel: string, muted: string];
  scene: string;
  emblem: string;
};

const stars = '<g fill="currentColor" opacity=".6"><circle cx="466" cy="34" r="1.5"/><circle cx="550" cy="64" r="2"/><circle cx="602" cy="22" r="1"/><circle cx="747" cy="34" r="2"/><circle cx="838" cy="72" r="1.5"/><circle cx="873" cy="23" r="1"/></g>';
const waves = '<g fill="none" stroke="currentColor" opacity=".3"><path d="M405 194q50-12 100 0t100 0t100 0t100 0t100 0m-440 22q50-12 100 0t100 0t100 0t100 0"/></g>';
const glass = 'fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="2"';

export const FIRST_FLOOR_GAME_THEMES = {
  'royal-fruits': 'cherry-express',
  'royal-dice': 'alchemist',
  'royal-limbo': 'andromeda',
  'royal-mines': 'eldorado',
  'royal-plinko': 'pearl-reef',
  'royal-keno': 'star-atlas',
  'github-craps': 'midnight-jazz',
  'github-diamonds': 'aurora-vault',
  'github-sic-bo': 'scarab-tomb',
} as const;

export const FIRST_FLOOR_ART: Record<typeof FIRST_FLOOR_GAME_THEMES[keyof typeof FIRST_FLOOR_GAME_THEMES], FirstFloorTheme> = {
  'cherry-express': {
    title: ['Вишнёвый экспресс', 'Cherry Express'],
    caption: ['Ретро-поезд с ароматом вишни и летних приключений.', 'A vintage train, cherry soda and a summer adventure.'],
    location: ['ЛЕТНИЙ МАРШРУТ', 'THE SUMMER LINE'],
    palette: ['#b63b54', '#57988d', '#fff2df', '#f7dfc0', '#7c5960'],
    scene: `<path d="M403 213q92-73 188-21t155-8 154 10v46H403Z" fill="#bdd4bb"/><path d="M404 224h496m-440 8h416" stroke="#5b978c" stroke-width="3"/><g stroke="#91344a" stroke-width="2.5"><rect x="531" y="118" width="201" height="76" rx="13" fill="#c95668"/><path d="M549 101h142q22 0 29 17H531Z" fill="#91344a"/><path d="M548 143h167v28H548Z" fill="#ffe5b8"/><path d="M566 144v27m38-27v27m38-27v27m38-27v27"/><path d="M738 193v-69h56v-19h31v19h22l15 69Z" fill="#b73e55"/><path d="M742 112h55v-12h-55Zm78 12v-30h22v30" fill="#f6c77e"/><rect x="750" y="134" width="28" height="28" rx="3" fill="#a5d6cb"/><path d="M739 177h117" stroke="#ffe6bb" stroke-width="5"/><g fill="#634153"><circle cx="560" cy="198" r="15"/><circle cx="700" cy="198" r="15"/><circle cx="764" cy="198" r="15"/><circle cx="831" cy="198" r="19"/></g><g fill="#f2c883"><circle cx="560" cy="198" r="6"/><circle cx="700" cy="198" r="6"/><circle cx="764" cy="198" r="6"/><circle cx="831" cy="198" r="8"/></g></g><g fill="#fff8e9"><circle cx="835" cy="75" r="13"/><circle cx="809" cy="54" r="18"/><circle cx="774" cy="35" r="23"/></g><path d="M481 151q-14-40 13-67m-13 44q21-37 49-27" fill="none" stroke="#5b978c" stroke-width="4"/><g fill="#b63b54"><circle cx="469" cy="158" r="17"/><circle cx="499" cy="154" r="17"/></g>`,
    emblem: '<path d="M94 112q-14-38 13-68m-13 48q25-30 46-25"/><path d="M108 52q32-25 46-2-27 20-46 2Z" fill="currentColor"/><circle cx="77" cy="135" r="34"/><circle cx="131" cy="130" r="34"/><path d="M58 126q2-13 14-16m42 8q3-11 13-14" stroke-width="5"/>',
  },
  alchemist: {
    title: ['Мастерская алхимика', 'The Alchemist’s Workshop'],
    caption: ['Медь, светящиеся эликсиры и точность старых приборов.', 'Copper, luminous elixirs and finely calibrated instruments.'],
    location: ['ЛАБОРАТОРИЯ ЧИСЕЛ', 'THE NUMBER LAB'],
    palette: ['#dfbc7f', '#8ed9b7', '#172c2c', '#263e3b', '#b4c9bb'],
    scene: `<path d="M428 214h450" stroke="currentColor" stroke-width="6" opacity=".4"/><g fill="none" stroke="currentColor" stroke-width="2"><path d="M454 212V30h12v182m-12-160h86m-77 10h58v76"/><circle cx="568" cy="74" r="33"/><circle cx="568" cy="74" r="25" opacity=".4"/><path d="m568 74 14-15m-14-20v6m0 58v6m-35-35h6m58 0h6"/><path d="M643 51h49m-39 0v56l-41 71q-12 26 13 26h85q25 0 12-26l-41-71V51"/></g><path d="M634 154h67l20 34q5 12-10 12h-87q-12 0-7-12Z" fill="#8ed9b7" opacity=".75"/><g fill="#d9f8ba"><circle cx="657" cy="172" r="5"/><circle cx="684" cy="186" r="7"/><circle cx="676" cy="142" r="3"/></g><g ${glass}><path d="M772 104h29v53q29 11 29 31 0 17-43 17t-43-17q0-20 28-31Z"/><path d="M829 54h25v71h-25Z"/></g><path d="M779 184h35m-37-68h20m37-49h16m-16 14h16m-16 14h16" stroke="#8ed9b7" stroke-width="4"/><g fill="currentColor" opacity=".45"><circle cx="670" cy="27" r="4"/><circle cx="705" cy="90" r="3"/><circle cx="741" cy="41" r="2"/></g>`,
    emblem: '<path d="M81 35h44m-35 0v50l-36 64q-11 22 11 22h77q22 0 10-22l-36-64V35M72 126h63"/><circle cx="92" cy="145" r="6"/><circle cx="118" cy="114" r="4"/><path d="M153 49v20m-10-10h20M53 78v14m-7-7h14"/>',
  },
  andromeda: {
    title: ['Портал Андромеды', 'Andromeda Gate'],
    caption: ['Путь через звёздный разлом к далёкому горизонту.', 'A passage through a stellar rift towards a distant horizon.'],
    location: ['ДАЛЬНИЙ КОСМОС', 'DEEP SPACE'],
    palette: ['#bea5ff', '#6fe0ed', '#111126', '#26213d', '#bdb6d6'],
    scene: `${stars}<path d="m452 232 162-75h105l162 75m-245-75-33 75m94-75 36 75" fill="none" stroke="#6fe0ed" opacity=".35"/><ellipse cx="675" cy="107" rx="93" ry="95" fill="#504b8b" opacity=".12"/><g fill="none"><ellipse cx="675" cy="107" rx="76" ry="86" stroke="#bea5ff" stroke-width="13" opacity=".3"/><ellipse cx="675" cy="107" rx="69" ry="80" stroke="#e1d4ff" stroke-width="3"/><ellipse cx="675" cy="107" rx="54" ry="64" stroke="#6fe0ed" stroke-width="1.5"/><path d="M648 79q52-22 50 27t-45 10q-14-15 11-22t14 17" stroke="#d2b8ff" stroke-width="7"/></g><path d="m511 170 29-25 29 25-29-9Z" fill="#d9d0ff"/><path d="m539 163 1 34 7-33" fill="#6fe0ed"/><circle cx="830" cy="58" r="24" fill="#6fe0ed" opacity=".17"/><path d="m792 69 76-23" stroke="#bba8ff" stroke-width="3" opacity=".6"/>`,
    emblem: '<ellipse cx="105" cy="100" rx="57" ry="73"/><ellipse cx="105" cy="100" rx="43" ry="57"/><path d="M85 85q42-20 41 19t-34 9q-10-13 9-19m-69 66 31-16m87-100 22-12"/><circle cx="169" cy="162" r="6"/>',
  },
  eldorado: {
    title: ['Экспедиция в Эльдорадо', 'Expedition to El Dorado'],
    caption: ['Заросшие руины и каменные тайники древнего города.', 'Overgrown ruins and the stone vaults of an ancient city.'],
    location: ['ЗАТЕРЯННЫЕ ДЖУНГЛИ', 'THE LOST JUNGLE'],
    palette: ['#e4cb83', '#78cca0', '#142c24', '#284538', '#bdcdb4'],
    scene: `<circle cx="699" cy="74" r="54" fill="#d5c779" opacity=".12"/><path d="M548 215v-33h23v-31h25v-31h24V89h24V59h53v30h24v31h24v31h25v31h24v33Z" fill="#375b44" stroke="#91ac72" stroke-width="2"/><path d="M646 215v-80h48v80" fill="#112b25" stroke="#c5b671" stroke-width="2"/><path d="M663 214v-62m14 62v-62m-53-45h92m-115 30h29m80 0h28m-148 32h40m80 0h52" stroke="#91ac72" opacity=".6"/><g fill="#255a3b" stroke="#79b786" stroke-width="1.5"><path d="M435 240q42-77 38-181m0 34q-69-58-71-2 34-25 71 2m1 2q49-66 78-29-37 1-78 29m351 145q-26-87-4-183m0 28q-55-48-71-15 35-3 71 15m0 0q39-47 67-17-42 0-67 17"/></g><path d="M439 230q109-41 212-11t233-5" fill="#102a23"/><path d="M535 207q-5-31 11-41m263 41q21-34 9-71" stroke="#7cb08a" stroke-width="4" fill="none"/>`,
    emblem: '<path d="M42 169v-25h19v-24h19V96h17V70h25v26h18v24h19v24h18v25Zm50 0v-49h35v49M98 44l16-17 16 17-16 17Z"/><path d="M27 142q19-61 45-88m111 87q-16-50-35-69"/>',
  },
  'pearl-reef': {
    title: ['Жемчужный риф', 'Pearl Reef'],
    caption: ['Пузырьки света среди кораллов и раковин.', 'Bubbles of light among corals and pearl shells.'],
    location: ['ПОДВОДНЫЙ ЗАПОВЕДНИК', 'THE UNDERWATER SANCTUARY'],
    palette: ['#9de6df', '#f2b593', '#102e3b', '#1c4954', '#b1ced2'],
    scene: `<path d="m608 0-99 240h54L655 0m45 0-49 240h38L740 0" fill="#a9f1ed" opacity=".06"/><g fill="none" stroke="#a4e5df" opacity=".55"><circle cx="789" cy="36" r="9"/><circle cx="813" cy="73" r="5"/><circle cx="776" cy="114" r="12"/><circle cx="592" cy="58" r="6"/></g><path d="M625 198q-75-66-49-99 31-31 63 4 16-52 47-43 37 10 29 58 41-21 56 5 18 35-76 75Z" fill="#276b70" stroke="#9ee0d2" stroke-width="2"/><path d="m625 198-29-93m44 89-1-91m21 91 26-130m-6 134 58-71" stroke="#81c6bb" fill="none"/><ellipse cx="657" cy="193" rx="65" ry="13" fill="#123a48" stroke="#83cbc4"/><circle cx="657" cy="171" r="25" fill="#f9edce"/><circle cx="648" cy="164" r="7" fill="#fffdf2"/><path d="M478 230v-79m0 28-20-23v-28m20 67 25-26v-28m344 89v-98m0 34-24-27v-24m24 63 23-26v-22" fill="none" stroke="#e5a48d" stroke-width="7" stroke-linecap="round"/>${waves}`,
    emblem: '<path d="M103 163Q25 115 42 68q21-24 46 4 13-42 39-36 31 7 26 47 32-17 45 8 13 28-95 72ZM103 163 58 71m45 92-15-91m15 91 24-125m-24 125 70-73"/><circle cx="108" cy="150" r="23" fill="currentColor"/>',
  },
  'star-atlas': {
    title: ['Атлас созвездий', 'The Constellation Atlas'],
    caption: ['Старинная обсерватория и карта ночного неба.', 'An old observatory and a chart of the night sky.'],
    location: ['КОРОЛЕВСКАЯ ОБСЕРВАТОРИЯ', 'THE ROYAL OBSERVATORY'],
    palette: ['#e5cb8b', '#94bff5', '#172039', '#26324d', '#b9c5db'],
    scene: `${stars}<g fill="none" stroke="currentColor"><circle cx="686" cy="113" r="82" opacity=".4"/><circle cx="686" cy="113" r="68" opacity=".2"/><ellipse cx="686" cy="113" rx="82" ry="30" transform="rotate(-28 686 113)" opacity=".35"/><path d="M686 23v180m-90-90h180" opacity=".15"/><path d="m642 70 47 14 39-26 19 58-33 40-41-18-45 25" stroke="#94bff5" stroke-width="2"/></g><g fill="#e5cb8b"><circle cx="642" cy="70" r="4"/><circle cx="689" cy="84" r="5"/><circle cx="728" cy="58" r="3"/><circle cx="747" cy="116" r="5"/><circle cx="714" cy="156" r="4"/><circle cx="673" cy="138" r="3"/><circle cx="628" cy="163" r="4"/></g><path d="m493 161 67-49 19 24-69 50Z" fill="#7189a0" stroke="#dcc58f" stroke-width="2"/><path d="m552 106 31 37m-64 29 14 14m-3-16-18 63m20-61 32 61" stroke="#dcc58f" stroke-width="4"/><path d="M790 230v-61h67v61m-74-61q4-57 40-57t41 57Z" fill="#27384f" stroke="#8ba0b4"/><path d="M823 112v57" stroke="#dbc894"/>`,
    emblem: '<circle cx="110" cy="103" r="72"/><ellipse cx="110" cy="103" rx="72" ry="27" transform="rotate(-28 110 103)"/><path d="m64 78 36-21 43 35-18 49-39-21-28 28"/><g fill="currentColor"><circle cx="64" cy="78" r="5"/><circle cx="100" cy="57" r="5"/><circle cx="143" cy="92" r="5"/><circle cx="125" cy="141" r="5"/></g>',
  },
  'midnight-jazz': {
    title: ['Полуночный джаз', 'Midnight Jazz'],
    caption: ['Свет софитов, медные трубы и бархат ночного клуба.', 'Spotlights, brass instruments and a velvet jazz lounge.'],
    location: ['НОЧНОЙ ДЖАЗ-КЛУБ', 'THE AFTER-HOURS LOUNGE'],
    palette: ['#edbd75', '#db91b3', '#251b2f', '#402a42', '#d1bdce'],
    scene: `<path d="m590 0-94 229h174L638 0m136 0-68 229h142L814 0" fill="#f2ce98" opacity=".065"/><path d="M433 0h71v197q-26-35-71 0Zm396 0h71v197q-38-35-71 0Z" fill="#6c3852" opacity=".55"/><g fill="none" stroke="#f0bf77" stroke-width="5" stroke-linejoin="round"><path d="M628 50h34v91q0 37 30 37t30-37v-29l-13-8v-30q20 18 34 19v47q0 64-51 64t-51-63V67h-13Z" fill="#9b6b49"/><path d="m709 74 39-15v44l-39-1Zm-64 17h17m-17 17h17m-17 18h17"/></g><path d="M537 222V89m-16 12h32m-16-12q-16-24 0-24t0 24m-15 132h30" fill="none" stroke="#bca6b5" stroke-width="3"/><g fill="#d795b8"><path d="M795 93v41q-16-6-20 5t10 11 17-12V99l24-7v34q-16-6-20 5t10 11 17-12V73Z"/></g><path d="M434 231h466" stroke="#c09866" stroke-width="4"/>`,
    emblem: '<path d="M66 35h34v98q0 25 22 25t23-25V93l-12-10V56l37-12v50l-12-1v40q0 52-37 52t-37-52V51H66Zm67 21 37-12M86 76h14m-14 18h14m-14 18h14"/>',
  },
  'aurora-vault': {
    title: ['Северная сокровищница', 'The Aurora Vault'],
    caption: ['Огранённый лёд и сияние самоцветов полярной пещеры.', 'Faceted ice and the glow of a polar crystal cavern.'],
    location: ['ПОЛЯРНАЯ КРИСТАЛЬНАЯ ПЕЩЕРА', 'THE POLAR CRYSTAL CAVERN'],
    palette: ['#b1e7f5', '#baaafa', '#182737', '#293f53', '#bfd3e2'],
    scene: `${stars}<path d="M433 0q119 100 283 9m-179-3q111 116 293 23" fill="none" stroke="#94efdd" stroke-width="18" opacity=".11"/><path d="m460 239 44-108 44 16 18 92m252 0 23-133 28 24 31 109" fill="#3b6378"/><g stroke="#b6e7f5" stroke-width="1.5"><path d="m611 204-37-106 49-53 55 38 4 121Z" fill="#5b93b1"/><path d="m574 98 65 19 39-34m-55-38 16 72-28 87" fill="none"/><path d="m674 213-5-103 49-74 56 66-37 111Z" fill="#8892bf"/><path d="m669 110 64 15 41-23m-56-66 15 89 4 88" fill="none"/><path d="m558 222-23-58 40-32 35 56-11 34Z" fill="#72b0b7"/><path d="m535 164 47 24 28 0m-35-56 7 56 17 34" fill="none"/></g><path d="M441 237q109-28 227-8t232-2" fill="#152d3c"/><g fill="#dbf7ff"><path d="M798 137v16m-8-8h16m-199-123v12m-6-6h12m92 126v12m-6-6h12" stroke="currentColor"/></g>`,
    emblem: '<path d="m46 78 36-42h60l35 42-65 92Zm0 0h131M82 36 68 78l44 92 42-92-12-42m-60 0 30 42 30-42"/><path d="M35 132v19m-9-10h18m135-99v18m-9-9h18"/>',
  },
  'scarab-tomb': {
    title: ['Гробница скарабея', 'Tomb of the Scarab'],
    caption: ['Песчаник, лазурит и золотые печати фараона.', 'Sandstone, lapis lazuli and the golden seals of a pharaoh.'],
    location: ['ДОЛИНА ДРЕВНИХ ЦАРЕЙ', 'VALLEY OF THE ANCIENT KINGS'],
    palette: ['#edc27a', '#74bac5', '#202b36', '#3b3b3d', '#d3c6b0'],
    scene: `<circle cx="672" cy="57" r="28" fill="#eac078" opacity=".75"/><g fill="#776346" stroke="#bda06e"><path d="M460 238V30h49v208m281 0V30h49v208"/><path d="M448 30h74v18h-74Zm331 0h74v18h-74ZM448 218h74v20h-74Zm331 0h74v20h-74Z"/></g><path d="M482 60v138m324-138v138" stroke="#e9c98a" stroke-dasharray="7 6" opacity=".6"/><g fill="#3e7c83" stroke="#e7bd78" stroke-width="2"><path d="M668 124q-91-57-129-34 24 56 111 69m30-35q91-57 129-34-24 56-111 69"/><path d="M668 138q-70-19-109-40m107 48q-39 10-80-13m91 5q70-19 109-40m-106 48q39 10 80-13" fill="none"/><ellipse cx="674" cy="154" rx="29" ry="43" fill="#b08b51"/><path d="M674 115v80m-26-42h53"/><path d="m658 115-8-14m40 14 8-14"/></g><path d="M548 220h211m-193 9h173" stroke="#b49d72" opacity=".6"/>`,
    emblem: '<circle cx="111" cy="39" r="16"/><path d="M99 86Q32 42 21 72q17 42 74 48m29-34q67-44 78-14-17 42-74 48M32 76l59 25m100-25-59 25"/><ellipse cx="111" cy="125" rx="28" ry="44"/><path d="M111 82v87m-25-48h50m-41-37-8-15m40 15 8-15"/>',
  },
};
