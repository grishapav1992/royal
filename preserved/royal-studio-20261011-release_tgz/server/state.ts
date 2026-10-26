import { schema, t, type SchemaType } from '@colyseus/schema';
export const Player = schema({
  name: t.string().default('Гость'), x: t.number().default(540), y: t.number().default(570),
  skin: t.uint8().default(0), facing: t.string().default('down'), moving: t.boolean().default(false),
  hall: t.string().default('arcade'), hallRevision: t.number().default(0),
  inputSeq: t.number().default(0),
  connected: t.boolean().default(true), playing: t.boolean().default(false),
  activity: t.string().default(''), ears: t.boolean().default(false),
  security: t.string().default(''),
  seat: t.string().default(''), action: t.string().default('idle'), drink: t.string().default(''), actionUntil: t.number().default(0),
  soberAt: t.number().default(0), appearance: t.string().default(''),
}, 'RoyalPlayer');
export type Player = SchemaType<typeof Player>;
export const Guest = schema({
  id:t.string().default(''), name:t.string().default(''), hall:t.string().default('arcade'),
  x:t.number().default(0),y:t.number().default(0),skin:t.uint8().default(0),
  facing:t.string().default('down'),moving:t.boolean().default(false),mood:t.string().default('resting'),
  drink:t.string().default(''),seat:t.string().default(''),destination:t.string().default(''),
},'RoyalAmbientGuest');
export const Guard = schema({
  hall: t.string().default('arcade'), x: t.number().default(585), y: t.number().default(635),
  facing: t.string().default('down'), phase: t.string().default('idle'),
  target: t.string().default(''), progress: t.number().default(0), speech: t.string().default(''),
  routine: t.string().default(''), reply: t.string().default(''),
}, 'RoyalGuard');
export type Guard = SchemaType<typeof Guard>;
export const Mira = schema({ x: t.number().default(866), y: t.number().default(453), facing: t.string().default('down'), action: t.string().default('polish'), progress: t.number().default(0) }, 'RoyalMira');
export const LobbyState = schema({ players: t.map(Player), guests:t.map(Guest), guards: t.map(Guard), mira: t.ref(Mira).default(() => new Mira()), serverNow: t.number().default(0) }, 'RoyalLobby');
export type LobbyState = SchemaType<typeof LobbyState>;
