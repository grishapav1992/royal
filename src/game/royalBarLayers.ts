import {BAR_POSITION} from '../shared/furniture';

// Countertop objects stay in front of staff contact poses and behind the cat.
export const ROYAL_BAR_DEPTH={
  back:BAR_POSITION.y+53,
  staff:BAR_POSITION.y+117,
  counter:BAR_POSITION.y+166,
  staffContact:BAR_POSITION.y+170,
  props:BAR_POSITION.y+170.5,
} as const;

// Coordinates refer to the original 1536 x 1024 assembly, including each base.
export const ROYAL_BAR_PROPS={
  glass:[[278,627],[311,627],[313,668],[326,671],[326,681],[265,682],[264,674],[276,667]],
  flowers:[[588,535],[627,549],[649,578],[632,611],[616,626],[619,668],[595,677],[570,668],[570,635],[539,624],[532,595],[548,561]],
  coffee:[[733,623],[769,625],[780,637],[797,638],[802,648],[793,661],[779,666],[800,672],[788,682],[719,680],[708,670],[721,662],[719,637]],
  lemons:[[870,636],[887,637],[899,646],[907,647],[919,658],[917,671],[903,678],[855,678],[841,668],[842,657],[856,652]],
  board:[[1006,525],[1118,525],[1138,683],[975,685]],
} as const;
