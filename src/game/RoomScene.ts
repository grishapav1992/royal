import { t as translateText, tr } from '../i18n/index';
import { cabinetSeat, type GameReaction } from '../shared/cabinetSeating';
import { drawCabinetStool } from './cabinetStoolArt';
import { drawClubFloor } from './clubArt';
import { LUELON_NEW_ZONE, ARCADE_OVERVIEW_SIZE } from '../shared/clubLayout';
import { CatRoutine, catApproachPoint, canHearCat, type CatAction, type CatView, type CatPerson } from '../shared/cat';
import { CAT_HOME } from '../shared/catHome';
import { CatRenderer, CAT_TEXTURE } from './CatRenderer';
import { CAT_HABITS_TEXTURE, CAT_CLIMB_TEXTURE, CAT_SCRATCH_TEXTURE, CAT_WALK_TEXTURE } from './CatRenderer';
import { drawCatCare } from './catCareArt';
import { FLOOR, BOUNDS, HALL_WALL } from '../shared/clubGeometry';
import { ATELIER } from '../shared/atelier';
import { drawAtelier, ATELIER_TEXTURE, ATELIER_SPRITE } from './atelierArt';
import { TailorRenderer, ATELIER_EMPTY_TEXTURE, ATELIER_EMPTY_SPRITE, TAILOR_TEXTURE, TAILOR_SPRITE } from './TailorRenderer';
import { AmbientGuests, type AmbientGuestView } from '../shared/ambientGuests';
import type { MiraView } from '../shared/miraRoutine';
import { SecurityGuard } from './SecurityGuard';
import type { GuardView } from '../shared/security';
import { addDemoCabinetArt } from './demoCabinetArt';
import { gameAudio } from './GameAudio';
import Phaser from 'phaser';
import { COLORS } from './art';
import { createDetailedArt } from './materials';
import { preloadCabinetArtwork } from './cabinetArtwork';
import catImages from './catImages.json';
import { BackgroundImages } from './BackgroundImages';
import { CABINET_SCALE, CABINET_SIZE } from './cabinetArt';
import { plantTexture, drawHallIdentity } from './interiorArt';
import { FURNITURE, PLANTS } from '../shared/furniture';
import { createCharacters, createCharacterPortrait, characterTexture, characterScaleY, pruneCharacterTextures, CHARACTER_SCALE, type Facing } from './characters';
import { Bar } from './Bar';
import { drawActivities } from './activityArt';
import { ACTIVITIES, type ActivityId } from '../shared/activities';
import { movementFacing } from '../shared/movement';
import { addDrink, getIntoxication, intoxicatedMovement, MAX_SOBER_TIME_MS } from '../shared/intoxication';
import { MovementPrediction, advanceClickMovement } from '../network/MovementPrediction';
import { ClickTargetScheduler } from '../network/ClickTargetScheduler';
import { NpcMotion } from '../network/NpcMotion';
import { NpcTimeline } from '../network/NpcTimeline';
import { RoomDetails } from './roomDetails';
import { CardTablesRenderer } from './CardTablesRenderer';
import { isCardGame, type DealerAction } from '../shared/cardTables';
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, hallObstacles, HALLS, hallLinks, hallLinkAt, inHallDoor, type HallLink, activityHall, type HallId, SEATS, BAR_APPROACH, DRINKS, atBar, type PlayerAction, type PlayerView, type NetworkCommands } from '../shared/world';
import { findPath, walkable, WORLD, type Point, type Obstacle } from './navigation';

import { CABINETS, cabinetsInHall, type Cabinet } from '../shared/cabinets';
export { CABINETS, type Cabinet };
type Actor = { hall: HallId; sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; blush: Phaser.GameObjects.Graphics; label?: Phaser.GameObjects.Text; x: number; y: number; path: Point[]; phase: number; nextMove: number; facing: Facing; skin: number; appearance: string; soberAt: number; moving: boolean; lastStep: number; strideDistance: number; visualAt: number; visualX: number; visualY: number; seat: string; action: PlayerAction; drink: string; actionUntil: number; cabinet: string; gameReaction: string; gameReactionUntil: number; visualSeat: string; seatedAt: number };
export class RoomScene extends Phaser.Scene {
  player!: Actor;
  hall: HallId = 'arcade';
  obstacles: Obstacle[] = hallObstacles('arcade');
  private hallObjects = new Map<HallId, Phaser.GameObjects.GameObject[]>();
  private hallDetails = new Map<HallId, RoomDetails>();
  private cardTables?: CardTablesRenderer;
  private cabinetStools = new Map<string, ReturnType<typeof drawCabinetStool>>();
  private switching=false;
  private pianoEffects=new Set<Phaser.GameObjects.GameObject>();
  onHall: (hall: HallId) => void = () => {};
  private guestRoutine=new AmbientGuests();
  private catRoutine = new CatRoutine();
  private catView = this.catRoutine.snapshot();
  private catRenderer?: CatRenderer;
  private catArtwork?: BackgroundImages;
  private decorationResumeAt = 0;
  private catUiAt = 0;
  private approachingCat = false;
  private catApproachAt = 0;
  onCat: () => void = () => {};
  onCatOpen: () => void = () => {};
  private guestViews:AmbientGuestView[]=this.guestRoutine.snapshot();
  private guests=new Map<string,Actor>();
  private guestMotion=new Map<string,NpcMotion<AmbientGuestView>>();
  private npcTimeline=new NpcTimeline();
  private npcSimulationAt=0;
  private guestsAt=0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private marker!: Phaser.GameObjects.Arc;
  private halo!: Phaser.GameObjects.Ellipse;
  private near: Cabinet | null = null;
  private pendingCabinet: Cabinet | null = null;
  private lastNear = '';
  private locked = false;
  private securityLocked = false;
  private guard!: SecurityGuard;
  private selfId = "";
  private typing = false;
  private network?: NetworkCommands;
  private networkSelf?: PlayerView;
  private remotePlayers = new Map<string, { actor: Actor; target: PlayerView }>();
  private lastInput = '0,0';
  private lastInputAt = 0;
  private prediction = new MovementPrediction();
  private clickTargets = new ClickTargetScheduler();
  private afterMovement?: () => void;
  private cancelCabinetAdmission?: () => void;
  private predictionClock = performance.now();
  private correction = { x: 0, y: 0 };
  private details!: RoomDetails;
  private bar!: Bar;
  private atelier?: TailorRenderer;
  private pendingLounge: string | null = null;
  private overview=false;
  onBar: () => void = () => {};
  onAtelier: () => void = () => { this.onNotice('Войди в аккаунт, чтобы заказать образ в ателье.'); };
  onActivity: (id:ActivityId) => void = () => {};
  onApproach: (id: string) => void = () => {};
  onNotice: (text: string) => void = () => {};
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private nextTextureCleanup = 0;
  private portraitFrames = new Map<string, string>();
  private sobrietyBadgeAt = 0;
  private onNear: (cabinet: Cabinet | null) => void;
  private onPlay: (cabinet: Cabinet) => void;
  private onReady: () => void;
  constructor(options: { onNear: (cabinet: Cabinet | null) => void; onPlay: (cabinet: Cabinet) => void; onReady: () => void }) {
    super('room'); this.onNear = options.onNear; this.onPlay = options.onPlay; this.onReady = options.onReady;
  }
  preload() {
    this.load.image(ATELIER_TEXTURE, ATELIER_SPRITE);
    this.load.image(ATELIER_EMPTY_TEXTURE, ATELIER_EMPTY_SPRITE);
    this.load.spritesheet(TAILOR_TEXTURE, TAILOR_SPRITE, { frameWidth: 256, frameHeight: 384 });
    preloadCabinetArtwork(this);
  }
  private loadCatArtwork() {
    this.catArtwork = new BackgroundImages({ [CAT_TEXTURE]: catImages.body, [CAT_HABITS_TEXTURE]: catImages.habits,
      [CAT_CLIMB_TEXTURE]: catImages.climb, [CAT_SCRATCH_TEXTURE]: catImages.scratch, [CAT_WALK_TEXTURE]: catImages.walk },
      (key, image) => { this.textures.addImage(key, image); }, () => { this.catRenderer = new CatRenderer(this); });
    if (this.decorationResumeAt > performance.now()) this.catArtwork.pause(this.decorationResumeAt - performance.now());
    this.catArtwork.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.catArtwork?.destroy());
  }
  deferDecorations(ms = 12000) { this.decorationResumeAt = Math.max(this.decorationResumeAt, performance.now() + ms); this.catArtwork?.pause(ms); }
  create() {
    createDetailedArt(this);
    createCharacters(this);
    for(const hall of ['arcade','tables','github'] as const){
      const before=new Set(this.children.list);this.hall=hall;this.drawRoom();
      this.hallDetails.set(hall,new RoomDetails(this,cabinetsInHall(hall).filter(cabinet=>!isCardGame(cabinet.id)),hall));
      if(hall==='arcade'){this.bar=new Bar(this,id=>this.approachSeat(id),()=>this.approachBar());drawCatCare(this);this.atelier=drawAtelier(this,()=>this.approachAtelier());}
      drawActivities(this,id=>this.approachActivity(id),hall);
      for (const link of hallLinks(hall)) this.drawDoor(link);
      this.hallObjects.set(hall,this.children.list.filter(object=>!before.has(object)));
    }
    this.showHall('arcade');
    this.marker = this.add.circle(0, 0, 12, COLORS.lime, .08).setStrokeStyle(1.5, COLORS.lime, .8).setVisible(false).setDepth(1);
    this.halo = this.add.ellipse(540, 572, 48, 19, COLORS.lime, .11).setStrokeStyle(1, COLORS.lime, .7);
    this.player = this.actor(540, 570, 0, translateText('Вы'), true);
    this.cameras.main.setBounds(0,HALL_WALL.viewTop,WORLD.width,WORLD.height-HALL_WALL.viewTop).startFollow(this.player.sprite,false,1,1);
    this.scale.on(Phaser.Scale.Events.RESIZE,this.resizeView,this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{this.clickTargets.cancel();this.afterMovement=undefined;this.scale.off(Phaser.Scale.Events.RESIZE,this.resizeView,this);});
    this.resizeView();
    this.syncGuests(this.guestViews);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown-E', () => this.interact());
    this.input.keyboard!.on('keydown-SPACE', () => this.interact());
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (this.locked || this.typing || objects.length) return;
      this.pendingCabinet = null; this.pendingLounge = null;
      this.goTo({ x: pointer.worldX, y: pointer.worldY });
    });
    this.game.events.on(Phaser.Core.Events.BLUR, () => { this.input.keyboard?.resetKeys(); this.player.path = []; this.marker.setVisible(false); this.endPrediction(); this.network?.stop(); });
    if (this.reducedMotion) this.tweens.pauseAll();
    this.guard = new SecurityGuard(this);
    this.onReady();
    this.time.delayedCall(0, () => this.loadCatArtwork());
  }
  private changeHall(hall:HallId){
    if(this.network||this.locked||this.isHuggingCat()||this.switching||hall===this.hall||!inHallDoor(this.player))return;
    this.endPrediction();this.pendingCabinet=null;this.pendingLounge=null;this.player.path=[];this.marker.setVisible(false);
    const link=hallLinkAt(this.player);if(!link||link.target!==hall)return;
    const door=link.arrival;
    this.showHall(hall);Object.assign(this.player,door.arrival,{hall,seat:'',action:'idle',drink:'',actionUntil:0,moving:false,facing:door.facing});
    this.syncGuests(this.guestViews);
  }
  private drawDoor(link:HallLink){
    const destination=HALLS[link.target],doorLabel=destination.floor!==HALLS[this.hall].floor?translateText('ЭТАЖ ')+destination.floor:translateText('ЗАЛ ')+destination.number,g=this.add.graphics().setDepth(225);
    if(link.door.facing==='up') {
      // The near wall is cut away so the doorway stays readable from above.
      const offset=link.door.entry.y-640;g.setDepth(2).setPosition(0,offset);
      g.fillStyle(0x171a28).fillRect(844,635,112,48);
      g.fillStyle(0x315c64).fillRect(860,637,80,40);
      g.fillStyle(0x73d4ca,.14).fillTriangle(860,640,940,640,965,586).fillTriangle(860,640,965,586,835,586);
      g.lineStyle(2,0x68c7c1).lineBetween(860,641,940,641);
      g.fillStyle(0xb38a53).fillRect(839,632,12,49).fillRect(949,632,12,49);
      g.fillStyle(0xf5d369).fillRect(847,633,4,43).fillRect(949,633,4,43);
      g.fillStyle(0x65b8b2).fillRect(851,658,98,7);
      if(destination.floor!==HALLS[this.hall].floor)for(let y=643;y<=672;y+=7)g.lineStyle(2,0xb7cec0).lineBetween(862,y,938,y);
      this.add.text(900,612+offset,doorLabel,{fontFamily:'Arial',fontSize:'15px',fontStyle:'bold',color:'#342f2a',backgroundColor:'#f5d369',padding:{x:10,y:5}}).setOrigin(.5).setDepth(3);
      this.add.zone(link.door.click.x,link.door.click.y,122,70).setDepth(680).setInteractive({useHandCursor:true}).on('pointerdown',()=>{this.pendingCabinet=null;this.pendingLounge=null;this.goTo(link.door.entry);});
      return;
    }
    g.setPosition(link.door.entry.x-900,HALL_WALL.doorOffset);
    g.fillStyle(0x342f2a).fillRoundedRect(839,79,122,155,6);
    g.fillStyle(0xb38a53).fillRoundedRect(846,88,108,143,4);
    g.fillStyle(0x302637).fillRect(854,97,92,132);
    g.fillStyle(0x315c64).fillRect(860,105,80,118);
    g.lineStyle(2,0x68c7c1).strokeRect(865,110,70,107);
    g.fillStyle(0x6bc8c2).fillRect(858,98,4,127);g.fillRect(938,98,4,127);
    g.fillStyle(0xf5d369).fillRect(850,94,4,133);g.fillRect(946,94,4,133);g.fillRect(850,94,100,4);
    g.fillStyle(0x65b8b2).fillRect(846,227,108,7);
    if(destination.floor!==HALLS[this.hall].floor)for(let y=186;y<=220;y+=7)g.lineStyle(2,0xb7cec0).lineBetween(866,y,934,y);
    const floor=this.add.graphics().setDepth(1).setPosition(link.door.entry.x-900,HALL_WALL.doorOffset);
    floor.fillStyle(0x73d4ca,.12).fillTriangle(853,236,947,236,975,303);floor.fillTriangle(853,236,975,303,825,303);
    this.add.text(link.door.entry.x,68+HALL_WALL.doorOffset,doorLabel,{fontFamily:'Arial',fontSize:'19px',fontStyle:'bold',color:'#342f2a',backgroundColor:'#f5d369',padding:{x:12,y:6}}).setOrigin(.5).setDepth(226);
    this.add.text(link.door.entry.x,159+HALL_WALL.doorOffset,destination.name.replace(translateText(' и '),translateText('\nи ')).replace(translateText(' на '),translateText('\nна ')),{fontFamily:'Arial',fontSize:'13px',fontStyle:'bold',align:'center',color:'#ecf8dc',wordWrap:{width:80}}).setOrigin(.5).setDepth(226);
    this.add.zone(link.door.entry.x,166+HALL_WALL.doorOffset,116,158).setDepth(230).setInteractive({useHandCursor:true}).on('pointerdown',()=>{this.pendingCabinet=null;this.pendingLounge=null;this.goTo(link.door.entry);});
  }
  private showHall(hall:HallId){
    this.clickTargets.reset();
    for(const effect of this.pianoEffects){this.tweens.killTweensOf(effect);effect.destroy();}this.pianoEffects.clear();
    this.hall=hall;this.obstacles=hallObstacles(hall);this.details=this.hallDetails.get(hall)!;
    for(const [id,objects] of this.hallObjects)for(const object of objects){
      (object as Phaser.GameObjects.Image).setVisible(id===hall);object.setActive(id===hall);
      if(object.input)object.input.enabled=id===hall;
    }
    this.near=null;this.lastNear='';this.onNear(null);gameAudio.setHall(hall);this.onHall(hall);
    if(this.player)this.resizeView();
  }
  getTailorState() { return this.atelier?.getState() ?? null; }
  setOverview(value:boolean){this.overview=value;document.querySelector<HTMLElement>('.room-panel')!.dataset.overview=String(value);this.resizeView();}
  setDealerAction(gameId: string, action: DealerAction) { this.cardTables?.setAction(gameId, action); }
  private resizeView(){
    const width=this.scale.gameSize.width,height=this.scale.gameSize.height;
    const frame=this.overview&&this.hall==='arcade'?ARCADE_OVERVIEW_SIZE:WORLD;
    const fit=Math.min(width/(frame.width-40),height/(frame.height-HALL_WALL.viewTop-50));
    const zoom=this.overview?fit:Math.max(fit,Phaser.Math.Clamp(Math.min(width/1000,height/760),.8,1.3));
    const viewWidth=width/zoom,viewHeight=height/zoom;
    const camera=this.cameras.main.setSize(width,height).setZoom(zoom).setBounds(
      Math.min(0,(frame.width-viewWidth)/2),Math.min(HALL_WALL.viewTop,(frame.height+HALL_WALL.viewTop-viewHeight)/2),
      Math.max(frame.width,viewWidth),Math.max(frame.height-HALL_WALL.viewTop,viewHeight));
    if(this.overview){camera.stopFollow();camera.centerOn(frame.width/2,(frame.height+HALL_WALL.viewTop)/2);}
    else if(this.player)camera.startFollow(this.player.sprite,false,1,1);
  }
  private drawRoom() {
    const g = this.add.graphics();
    const r = (color: number, x: number, y: number, w: number, h: number, a = 1) => g.fillStyle(color, a).fillRect(x, y, w, h);
    // Night scenery and flat colored paper preserve the cartoon silhouette.
    r(0x191d35, 0, HALL_WALL.viewTop, WORLD.width, WORLD.height-HALL_WALL.viewTop);
    for(let n=0;n<31;n++){
      const x=25+(n*137)%1030,y=HALL_WALL.viewTop+9+(n*19)%46;
      r(n%3?0x8990b6:0xf2d69c,x,y,n%3?2:3,2);
    }
    g.fillStyle(0xf8df9e).fillCircle(1008,29,17);
    g.fillStyle(0x191d35).fillCircle(1016,23,15);
    g.fillStyle(0x35455a).fillTriangle(0,170,170,2,370,170);
    g.fillStyle(0x909eb6).fillTriangle(110,60,170,2,240,60);
    g.fillStyle(0x303e54).fillTriangle(700,175,895,0,1080,175);
    g.fillStyle(0x909eb6).fillTriangle(831,58,895,0,956,58);
    r(0x929bad,0,180,WORLD.width,WORLD.height-180);
    for(const x of [15,WORLD.width-18])for(const y of [120,370,600,950,1240]){
      r(0x503d40,x-3,y,6,34);
      g.fillStyle(0x294c4c).fillTriangle(x-22,y+18,x,y-43,x+22,y+18);
      g.fillStyle(0xbac1ce).fillTriangle(x-12,y-15,x,y-43,x+12,y-15);
    }
    r(0x211e2c,35,58,WORLD.width-70,WORLD.height-108);
    r(0x78523f,39,62,WORLD.width-78,WORLD.height-116);
    this.add.image(FLOOR.x,FLOOR.y,'club-floor-'+this.hall).setOrigin(0).setDisplaySize(FLOOR.width,FLOOR.height).setDepth(.01);
    this.add.image(55,HALL_WALL.top,'club-wall-'+this.hall).setOrigin(0).setDisplaySize(FLOOR.width,HALL_WALL.height).setDepth(.02);
    const casino=this.hall==='arcade';
    r(casino?0x3c1829:0x3a322a,40,HALL_WALL.top,14,WORLD.height-67-HALL_WALL.top);r(casino?0xf1c679:0x948269,49,HALL_WALL.top,3,WORLD.height-67-HALL_WALL.top);
    r(casino?0x3c1829:0x3a322a,WORLD.width-53,HALL_WALL.top,15,WORLD.height-67-HALL_WALL.top);r(casino?0xf1c679:0x948269,WORLD.width-50,HALL_WALL.top,3,WORLD.height-67-HALL_WALL.top);
    r(casino?0x271921:0x332e29,35,1320,WORLD.width-69,17);r(casino?0xd7aa58:0x8f7958,35,1320,WORLD.width-69,3);
    drawHallIdentity(this,this.hall);
    drawClubFloor(this,this.hall,id=>this.approachSeat(id),()=>this.approachLuelonZone());
    const cardTables = cabinetsInHall(this.hall).filter(cabinet=>isCardGame(cabinet.id));
    if (cardTables.length) {
      this.cardTables = new CardTablesRenderer(this, cardTables, id=>this.approach(id));
      for (const [id, stool] of this.cardTables.stools) this.cabinetStools.set(id, stool);
    }
    cabinetsInHall(this.hall).forEach(cabinet => {
      if (isCardGame(cabinet.id)) return;
      this.cabinetStools.set(cabinet.id, drawCabinetStool(this, cabinet, () => this.approach(cabinet.id)));
      const i = CABINETS.indexOf(cabinet);
      this.add.ellipse(cabinet.x, cabinet.y + 7, 121, 42, cabinet.color, .13);
      const glow = this.add.ellipse(cabinet.x, cabinet.y - 10, 72, 30, cabinet.color, .16);
      this.tweens.add({ targets: glow, alpha: .4, duration: 1600 + i * 210, yoyo: true, repeat: -1 });
      const machine = this.add.image(cabinet.x, cabinet.y, `cabinet-${i}`).setOrigin(.5, 1).setDisplaySize(CABINET_SIZE.width*CABINET_SCALE,CABINET_SIZE.height*CABINET_SCALE).setDepth(cabinet.y);
      if (cabinet.demo) addDemoCabinetArt(this, cabinet);
      machine.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.approach(cabinet.id));
      const lamp = this.add.rectangle(cabinet.x + 21, cabinet.y - 19, 3, 2, cabinet.color).setDepth(cabinet.y + 1);
      this.tweens.add({ targets: lamp, alpha: .25, duration: 500 + i * 330, yoyo: true, repeat: -1 });

    });
    for (const [key,item] of Object.entries(FURNITURE).filter(([key])=>this.hall==='tables'&&key!=='sofa')) this.prop(key,item.x,item.y,item.scale);
    if(this.hall==='tables')this.add.text(ACTIVITIES.chess.entry.x, ACTIVITIES.chess.entry.y+10, translateText('Ш А Х М А Т Ы'), { fontFamily: 'Arial', fontSize: '9px', color: '#d4b880' }).setOrigin(.5).setDepth(2);
    if(this.hall==='tables')this.add.text(562, 516, translateText('Б И Л Ь Я Р Д'), { fontFamily: 'Arial', fontSize: '9px', color: '#d4b880' }).setOrigin(.5).setDepth(2);
    if(this.hall==='tables')PLANTS.forEach((p,i) => this.prop(plantTexture(this.hall,i),p.x,p.y,p.scale));
    if(this.hall==='arcade')this.add.text(540,650,translateText('ВХОД В КЛУБ'),{fontFamily:'Arial',fontSize:'10px',color:'#cdb887'}).setOrigin(.5).setDepth(.04);
  }

  private prop(key: string, x: number, y: number, scale: number) {
    const size = key.startsWith('plant-') ? {width:62,height:95} : FURNITURE[key as keyof typeof FURNITURE];
    this.add.image(x, y, key).setOrigin(.5, 1).setDisplaySize(size.width*scale,size.height*scale).setDepth(y);
  }
  private actor(x: number, y: number, skin: number, name?: string, isPlayer = false, appearance = ''): Actor {
    const shadow = this.add.ellipse(x, y - 1, 30, 11, 0x171624, .3);
    const sprite = this.add.sprite(x, y, characterTexture(this, skin, appearance), 'down-6').setOrigin(.5, 1).setScale(CHARACTER_SCALE, characterScaleY(appearance));
    const blush = this.add.graphics().setVisible(false);
    const label = name ? this.add.text(x, y - 83, name, { fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#342f2a', backgroundColor: isPlayer ? '#f5d369' : '#fff4d9', padding: { x: 8, y: 4 } }).setOrigin(.5) : undefined;
    let soberAt = 0;
    if (isPlayer) try { soberAt = Math.min(Date.now() + MAX_SOBER_TIME_MS, Number(localStorage.getItem('royal-offline-sober-at')) || 0); } catch { /* The demo can run without browser storage. */ }
    return { hall:this.hall, x, y, sprite, shadow, blush, label, path: [], phase: (x * 7 + y * 11 + skin * 17 + Array.from(name ?? '').reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 997, 0)) % 100, nextMove: 0, facing: 'down', skin, appearance, soberAt, moving: false, lastStep: 0, strideDistance: 0, visualAt: 0, visualX: x, visualY: y, seat: '', action: 'idle', drink: '', actionUntil: 0, cabinet: '', gameReaction: '', gameReactionUntil: 0, visualSeat: '', seatedAt: 0 };
  }
  goTo(point: Point) {
    this.approachingCat = false;
    if (this.locked || this.isHuggingCat() || this.typing || this.switching || this.player.cabinet || this.networkSelf?.playing) return;
    if (this.network) {
      this.clickTargets.cancel(); this.afterMovement=undefined; this.endPrediction();
      if (!this.networkSelf) return;
      const origin = SEATS.find(seat => seat.id === this.player.seat)?.entry ?? this.player;
      this.player.path = findPath(origin, point, this.obstacles);
      this.marker.setPosition(point.x, point.y).setVisible(this.player.path.length > 0);
      return;
    }
    this.stand();
    const path = findPath(this.player, point, this.obstacles);
    if (!path.length) return;
    this.player.path = path; this.marker.setPosition(point.x, point.y).setVisible(true);
  }
  approach(id: string) {
    if (this.locked || this.isHuggingCat()) return;
    const occupant = this.cabinetOccupant(id);
    if (occupant) { this.onNotice(translateText('Это место уже занято: ') + occupant + translateText('. Выбери другую игру.')); return; }
    this.pendingLounge = null;
    const cabinet = cabinetsInHall(this.hall).find(c => c.id === id); if (!cabinet) return;
    this.onApproach(id);
    this.pendingCabinet = cabinet; this.goTo(cabinetSeat(cabinet).entry);
  }
  approachLuelonZone() {
    if(this.hall!=='arcade'||this.locked||this.typing||this.switching)return;
    this.pendingCabinet=null;this.pendingLounge=null;
    if(this.overview){
      this.setOverview(false);
      const overview=document.querySelector<HTMLButtonElement>('#room-overview');
      if(overview){overview.setAttribute('aria-pressed','false');overview.textContent=translateText('Весь этаж');}
    }
    this.goTo(LUELON_NEW_ZONE.entrance);
    this.onNotice(translateText('Идём к нашим игровым автоматам рядом с баром.'));
  }
  approachFloor(target: HallId) {
    if (this.locked || this.isHuggingCat() || this.typing || this.switching) return;
    const link = hallLinks(this.hall).find(candidate => candidate.target === target); if (!link) return;
    this.pendingCabinet = null; this.pendingLounge = null; this.goTo(link.door.entry);
  }
  interact() {
    if (this.locked || this.typing) return;
    if (this.hall==='arcade' && Math.hypot(this.player.x-ATELIER.entry.x,this.player.y-ATELIER.entry.y)<ATELIER.interactionRadius) { this.onAtelier(); return; }
    if (this.isHuggingCat()) { this.onCatOpen(); return; }
    const cat=this.catInfo();
    if (cat.near&&!cat.busy) { this.onCatOpen(); return; }
    const activity=(Object.keys(ACTIVITIES) as ActivityId[]).find(id=>activityHall(id)===this.hall&&Math.hypot(this.player.x-ACTIVITIES[id].entry.x,this.player.y-ACTIVITIES[id].entry.y)<45);
    if(activity){this.onActivity(activity);return;}
    if (this.near) { this.player.facing = 'up'; this.onPlay(this.near); }
    else if (this.hall==='arcade'&&atBar(this.player)) this.onBar();
    else if (this.player.seat) this.stand();
    else { const seat = SEATS.filter(s=>(s.hall??'arcade')===this.hall).find(s=>Math.hypot(s.entry.x-this.player.x,s.entry.y-this.player.y)<50); if(seat)this.approachSeat(seat.id); }
  }
  approachBar() {
    if(this.hall!=='arcade')return;
    if (this.locked || this.isHuggingCat() || this.typing) return;
    if (atBar(this.player)) { this.onBar(); return; }
    this.pendingCabinet = null; this.pendingLounge = 'bar'; this.goTo(BAR_APPROACH);
  }
  approachAtelier() {
    if (this.hall!=='arcade' || this.locked || this.isHuggingCat() || this.typing || this.switching) return;
    if (Math.hypot(this.player.x-ATELIER.entry.x,this.player.y-ATELIER.entry.y)<ATELIER.interactionRadius) { this.onAtelier(); return; }
    this.pendingCabinet=null; this.pendingLounge='atelier'; this.goTo(ATELIER.entry);
  }
  approachActivity(id:ActivityId){
    if(this.locked||this.isHuggingCat()||this.typing||this.switching||activityHall(id)!==this.hall)return;
    this.pendingCabinet=null;this.pendingLounge='activity:'+id;this.goTo(ACTIVITIES[id].entry);
  }
  pianoNote(note:number){
    if(this.reducedMotion||this.hall!=='arcade')return;
    const {x,y}=ACTIVITIES.piano.bounds;
    const glow=this.add.rectangle(x+9+(note-60)*5.4,y+51,4,9,0xc9f56b,.85).setDepth(y+63);
    this.tweens.add({targets:glow,alpha:0,duration:350,onComplete:()=>{glow.destroy();this.pianoEffects.delete(glow);}});
    const music=this.add.text(x+50,y+12,'♪',{fontFamily:'serif',fontSize:'18px',color:'#d6efac'}).setDepth(y+90);
    this.pianoEffects.add(glow);this.pianoEffects.add(music);
    this.tweens.add({targets:music,y:y-15,x:x+60,alpha:0,duration:700,onComplete:()=>{music.destroy();this.pianoEffects.delete(music);}});
  }
  approachSeat(id: string) {
    if (this.locked || this.isHuggingCat() || this.typing) return;
    const seat = SEATS.find(s=>s.id===id&&(s.hall??'arcade')===this.hall); if(!seat)return;
    this.pendingCabinet = null; this.pendingLounge = id; this.goTo(seat.entry);
  }
  sitAnywhere(kind: 'bar' | 'sofa') {
    const occupied = new Set([...this.remotePlayers.values()].map(p=>p.target.seat));
    const seat = SEATS.find(s=>s.kind===kind && (s.hall??'arcade')===this.hall && !occupied.has(s.id));
    if(seat)this.approachSeat(seat.id);else this.onNotice(translateText('Все места заняты. Попробуй чуть позже.'));
  }
  cabinetOccupant(id: string): string | undefined {
    return [...this.remotePlayers.values()].find(remote => remote.target.cabinet === id)?.target.name;
  }
  async beginCabinet(cabinet: Cabinet): Promise<boolean> {
    if (this.isHuggingCat()) return false;
    const occupant = this.cabinetOccupant(cabinet.id);
    if (occupant) { this.onNotice(translateText('Это место уже занято: ') + occupant + translateText('. Выбери другую игру.')); return false; }
    if (this.securityLocked || this.player.cabinet) return false;
    this.setLocked(true);
    if (this.network) {
      const accepted = await new Promise<boolean>(resolve => {
        let settled = false;
        const finish = (value: boolean) => { if (settled) return; settled = true; this.cancelCabinetAdmission = undefined; resolve(value); };
        this.cancelCabinetAdmission = () => finish(false);
        this.finishMovement(() => {
          if (settled) return;
          void (this.network!.cabinetPlay?.(cabinet.id) ?? Promise.resolve(false)).then(value => {
            if (settled) { if (value) this.network?.cabinetLeave?.(); }
            else finish(value);
          }, () => finish(false));
        });
      });
      if (this.securityLocked) { if (accepted) this.network.cabinetLeave?.(); return false; }
      return accepted;
    }
    const seat = cabinetSeat(cabinet);
    Object.assign(this.player, { x: seat.x, y: seat.y, seat: 'cabinet:' + cabinet.id, action: 'sit', facing: 'up', cabinet: cabinet.id, gameReaction: '', gameReactionUntil: 0, moving: false });
    this.cabinetStools.get(cabinet.id)?.setOccupied(true);
    return true;
  }
  endCabinet() {
    if (this.network) { this.network.cabinetLeave?.(); return; }
    const cabinet = CABINETS.find(c => c.id === this.player.cabinet);
    if (cabinet) { Object.assign(this.player, cabinetSeat(cabinet).entry); this.cabinetStools.get(cabinet.id)?.setOccupied(false); }
    Object.assign(this.player, { cabinet: '', seat: '', action: 'idle', gameReaction: '', gameReactionUntil: 0 });
  }
  reactToGame(reaction: GameReaction) {
    const id = this.networkSelf?.cabinet || this.player.cabinet;
    if (!id || this.securityLocked) return;
    if (this.network) this.network.cabinetReaction?.(id, reaction);
    else { this.player.gameReaction = reaction; this.player.gameReactionUntil = Date.now() + 2400; }
  }
  stand() {
    if (this.player.cabinet || this.isHuggingCat()) return;
    if(this.network) { this.endPrediction(); this.network.stand(); return; }
    const seat=SEATS.find(s=>s.id===this.player.seat);
    if(seat){this.player.x=seat.entry.x;this.player.y=seat.entry.y;}
    this.player.seat='';this.player.action='idle';this.player.drink='';this.player.actionUntil=0;
  }
  orderDrink(id: string): boolean {
    const drink = DRINKS.find(d=>d.id===id);
    if(!this.player || this.isHuggingCat() || !drink || this.hall!=='arcade' || !atBar(this.player) || this.player.action==='drink' || this.securityLocked)return false;
    if(this.network){
      if(!this.networkSelf?.connected || this.networkSelf.playing)return false;
      this.endPrediction();this.network.drink(id);return true;
    }
    this.player.path=[];this.player.action='drink';this.player.drink=id;this.player.actionUntil=Date.now()+3200;
    this.player.soberAt = addDrink(this.player.soberAt, drink.strength);
    try { localStorage.setItem('royal-offline-sober-at', String(this.player.soberAt)); } catch { /* Drinking does not require browser storage. */ }
    return true;
  }
  getDialoguePlayer() {
    return { skin: this.player?.skin ?? 0, appearance: this.player?.appearance ?? '', soberAt: this.player?.soberAt ?? 0, action: this.player?.action ?? 'idle', drink: this.player?.drink ?? '', name: this.networkSelf?.name ?? translateText('Ты') };
  }
  getPortraitFrame(action: 'idle' | 'drink', index: number) {
    if (!this.player) return '';
    const stage = getIntoxication(this.player.soberAt).stage;
    const frameIndex = action === 'drink' ? 11 + index % 6 : 6 + index % 4;
    const key = `${this.player.sprite.texture.key}:${stage}:${frameIndex}`;
    const cached = this.portraitFrames.get(key); if (cached) return cached;
    const canvas = createCharacterPortrait(this.player.skin, this.player.appearance, frameIndex, stage);
    const result = canvas.toDataURL(); this.portraitFrames.set(key, result); return result;
  }
  syncGuests(views:AmbientGuestView[]){
    this.guestViews=views;
    const active=new Set(views.filter(v=>v.hall===this.hall).map(v=>v.id));
    const counter=document.querySelector<HTMLElement>('.npc-count');
    if(counter){const label=(this.network?translateText('Игроки: ')+(counter.dataset.players??'0')+' · ':'')+translateText('НПС: ')+active.size;if(counter.textContent!==label)counter.textContent=label;}
    for(const [id,actor] of this.guests)if(!active.has(id)){actor.sprite.destroy();actor.shadow.destroy();actor.blush.destroy();actor.label?.destroy();this.guests.delete(id);this.guestMotion.delete(id);}
    for(const view of views){
      if(!active.has(view.id))continue;
      let actor=this.guests.get(view.id);
      if(!actor){actor=this.actor(view.x,view.y,view.skin);actor.label=this.add.text(view.x,view.y-83,'',{fontFamily:'Arial',fontSize:'10px',color:'#e4d6b9',backgroundColor:'#2a313ccc',padding:{x:5,y:3}}).setOrigin(.5);this.guests.set(view.id,actor);}
      if(this.network){
        let motion=this.guestMotion.get(view.id);
        if(!motion){motion=new NpcMotion<AmbientGuestView>({delayMs:0,isMoving:view=>view.moving});this.guestMotion.set(view.id,motion);}
        motion.push(view,this.guestsAt||this.npcSimulationAt||performance.now());
      }
    }
  }
  syncNpcTime(simulationAt: number, guestsAt: number) {
    if(simulationAt===0&&guestsAt===0){this.resetNpcMotion();return;}
    if(Number.isFinite(simulationAt)&&simulationAt>0){this.npcSimulationAt=simulationAt;this.npcTimeline.receive(simulationAt);}
    if(Number.isFinite(guestsAt)&&guestsAt>0)this.guestsAt=guestsAt;
  }
  syncMira(mira: MiraView) { this.bar?.sync(mira,this.npcSimulationAt||performance.now()); }
  syncGuards(guards: GuardView[]) { this.guard.sync(guards,this.npcSimulationAt||performance.now()); }
  private resetNpcMotion() {
    this.npcTimeline.reset();this.npcSimulationAt=0;this.guestsAt=0;this.guestMotion.clear();this.bar?.resetMotion();this.guard?.resetMotion();
  }
  isHuggingCat() { return this.catView.carriedBy === (this.selfId || 'local-player'); }
  private stopForCatHug() {
    this.approachingCat=false;this.pendingCabinet=null;this.pendingLounge=null;this.afterMovement=undefined;
    this.clickTargets.cancel();this.player.path=[];this.marker.setVisible(false);
    this.prediction.reset();this.correction={x:0,y:0};this.lastInput='0,0';
    this.input.keyboard?.resetKeys();this.player.facing='down';
    this.animateActor(this.player,this.time.now,false);
  }
  syncCat(cat: CatView) {
    const wasHugging=this.isHuggingCat();this.catView = cat;
    if(this.isHuggingCat()&&!wasHugging) {
      this.stopForCatHug();this.player.x=cat.x;this.player.y=cat.y;
    }
  }
  catInfo() {
    const cat = this.catView, player = this.player;
    const anchor = catApproachPoint(cat);
    const sameHall = cat.hall === this.hall, selfId = this.selfId || 'local-player';
    const near = Boolean(player && sameHall && Math.hypot(player.x-anchor.x,player.y-anchor.y) <= 100);
    return { cat: { ...cat }, near, sameHall, selfId, busy: this.locked || this.securityLocked || Boolean(player?.cabinet) || Boolean(player?.seat) || player?.action==='drink' || Boolean(this.networkSelf?.playing) || Boolean(this.networkSelf?.activity) };
  }
  approachCat() {
    if(this.isHuggingCat())return;
    if (this.catView.hall !== this.hall) {
      const link = hallLinks(this.hall).find(link => link.target === this.catView.hall) ?? hallLinks(this.hall)[0];
      this.approachFloor(link.target); this.approachingCat=true; return;
    }
    const anchor = catApproachPoint(this.catView);
    for (const [dx,dy] of [[0,30],[30,0],[-30,0],[0,-30],[0,0]]) {
      const point = { x: anchor.x+dx, y: anchor.y+dy };
      if (walkable(point.x,point.y,this.obstacles,18)) { this.pendingCabinet=null;this.pendingLounge=null;this.goTo(point);this.approachingCat=true;return; }
    }
  }
  catAction(action: CatAction) {
    if(action==='release'&&this.isHuggingCat()) {
      if(this.network)this.network.cat?.(action);
      else { const message=this.catRoutine.interact(action,this.catPerson());this.catView=this.catRoutine.snapshot();if(message)this.onNotice(message);this.onCat(); }
      return;
    }
    if (this.catInfo().busy || this.isHuggingCat() || this.typing || this.switching) return;
    if (action === 'pet' || action === 'feed' || action === 'hug') {
      this.approachingCat=false;this.player.path=[];this.network?.stop();this.marker.setVisible(false);
    }
    if (this.network) { this.finishMovement(()=>this.network?.cat?.(action)); return; }
    const person = this.catPerson();
    const message = this.catRoutine.interact(action,person);
    this.catView = this.catRoutine.snapshot();
    if(this.isHuggingCat())this.stopForCatHug();
    if (message) this.onNotice(message);
    this.onCat();
  }
  private catPerson(): CatPerson { return {id:'local-player',hall:this.hall,x:this.player.x,y:this.player.y,connected:true,playing:Boolean(this.player.cabinet),cabinet:this.player.cabinet,security:this.securityLocked?'locked':'',seat:this.player.seat,action:this.player.action}; }
  catPortrait() { return catImages.portrait; }
  setSecurity(locked: boolean) { this.securityLocked = locked; this.setLocked(locked || Boolean(document.querySelector('dialog[open]'))); }
  setLocked(locked: boolean) {
    locked ||= this.securityLocked;
    this.clickTargets.cancel();
    this.endPrediction();
    if(locked)this.switching=false;
    this.locked = locked; this.player.path = []; this.pendingCabinet = null; this.pendingLounge = null; this.marker.setVisible(false);
    this.input.keyboard?.resetKeys();
    this.network?.stop();
    if (this.input.keyboard) {
      this.input.keyboard.enabled = !locked && !this.typing;
      this.input.keyboard.manager.enabled = !locked && !this.typing;
    }
    this.animateActor(this.player, this.time.now, false);
  }
  setTyping(typing: boolean) {
    if (typing) { this.clickTargets.cancel(); this.endPrediction(); }
    this.typing = typing;
    this.input.keyboard?.resetKeys();
    if (this.input.keyboard) {
      this.input.keyboard.enabled = !typing && !this.locked;
      this.input.keyboard.manager.enabled = !typing && !this.locked;
    }
    if (typing) { this.marker.setVisible(false); this.player.path = []; this.pendingCabinet = null; this.pendingLounge = null; this.network?.stop(); this.lastInput = '0,0'; }
  }
  enableOnline(commands: NetworkCommands) {
    this.resetNpcMotion();
    this.clickTargets.reset();
    this.prediction = new MovementPrediction(); this.correction = { x: 0, y: 0 };
    this.afterMovement = undefined;
    this.network = {
      inputs: commands.inputs,
      move: (x,y) => { this.clickTargets.cancel(); this.finishMovement(() => commands.move(x,y)); },
      target: (x,y) => this.finishMovement(() => this.clickTargets.request(() => commands.target(x,y))),
      stop: () => { this.clickTargets.cancel(); this.finishMovement(commands.stop); },
      sit: seat => { this.clickTargets.cancel(); this.finishMovement(() => commands.sit(seat)); },
      stand: () => { this.clickTargets.cancel(); this.finishMovement(commands.stand); },
      drink: drink => { this.clickTargets.cancel(); this.finishMovement(() => commands.drink(drink)); },
      cat: commands.cat, cabinetPlay: commands.cabinetPlay, cabinetLeave: commands.cabinetLeave, cabinetReaction: commands.cabinetReaction,
    };
    this.networkSelf = undefined;
    this.player.path = []; this.lastInput = '0,0';

  }
  syncPlayers(players: PlayerView[], selfId: string) {
    this.selfId = selfId;
    const self = players.find(p => p.id === selfId);
    if (self) {
      if (Boolean(self.security) !== this.securityLocked) this.setSecurity(Boolean(self.security));
      if(self.hall!==this.hall||(this.networkSelf&&self.hallRevision!==this.networkSelf.hallRevision)){
        this.clickTargets.reset();
        this.prediction.reset();this.afterMovement=undefined;this.correction={x:0,y:0};this.showHall(self.hall);this.switching=false;
        Object.assign(this.player,{x:self.x,y:self.y,hall:self.hall,seat:self.seat,action:self.action,drink:self.drink,actionUntil:self.actionUntil});
        this.player.path=[];this.pendingCabinet=null;this.pendingLounge=null;
      }
      if (!this.networkSelf) { this.player.x = self.x; this.player.y = self.y; }
      this.networkSelf = self;
      this.player.soberAt = self.soberAt;
      this.player.cabinet = self.cabinet ?? ''; this.player.gameReaction = self.gameReaction ?? ''; this.player.gameReactionUntil = self.gameReactionUntil ?? 0;
      if (this.prediction.active) {
        const next = this.prediction.reconcile(self, self.inputSeq, this.guard.getState());
        const errorX = this.player.x-next.x, errorY = this.player.y-next.y;
        if (Math.hypot(errorX, errorY) < 60) { this.correction.x += errorX; this.correction.y += errorY; }
        else this.correction = { x: 0, y: 0 };
        this.player.x = next.x; this.player.y = next.y; this.player.facing = next.facing;
        this.player.seat = next.seat; this.player.action = next.action; this.player.drink = next.drink; this.player.actionUntil = next.actionUntil;
        // Refill the send window even when keys are released or a dialog has focus.
        this.flushPrediction();
        if (!this.prediction.active) {
          const action = this.afterMovement; this.afterMovement = undefined; action?.();
        }
      }
      if (this.player.skin !== self.skin || this.player.appearance !== (self.appearance ?? '')) {
        this.player.sprite.anims.stop(); this.player.sprite.setTexture(characterTexture(this, self.skin, self.appearance), `${self.facing}-6`).setScale(CHARACTER_SCALE, characterScaleY(self.appearance));
        this.portraitFrames.clear();
      }
      this.player.appearance = self.appearance ?? '';
      this.player.skin = self.skin;
      this.player.label?.setText(tr`${self.name} · вы${self.ears?' 🙉':''}`);
    }
    const occupied = new Set(players.map(p => p.cabinet).filter(Boolean));
    for (const [id, stool] of this.cabinetStools) stool.setOccupied(occupied.has(id));
    players=players.filter(p=>p.hall===this.hall);
    const active = new Set(players.map(p => p.id));
    for (const [id, remote] of this.remotePlayers) if (!active.has(id)) {
      remote.actor.sprite.destroy(); remote.actor.shadow.destroy(); remote.actor.blush.destroy(); remote.actor.label?.destroy(); this.remotePlayers.delete(id);
    }
    for (const p of players) if (p.id !== selfId) {
      const remote = this.remotePlayers.get(p.id);
      if (remote) remote.target = p;
      else this.remotePlayers.set(p.id, { actor: this.actor(p.x, p.y, p.skin, p.name, false, p.appearance), target: p });
    }
  }
  private interpolate(actor: Actor, target: PlayerView, dt: number, time: number) {
    if (actor.skin !== target.skin || actor.appearance !== (target.appearance ?? '')) {
      actor.sprite.anims.stop(); actor.sprite.setTexture(characterTexture(this, target.skin, target.appearance), `${target.facing}-6`).setScale(CHARACTER_SCALE, characterScaleY(target.appearance));
      actor.appearance = target.appearance ?? '';
      actor.skin = target.skin;
    }
    const factor = Math.min(1, dt * 18);
    actor.x += (target.x - actor.x) * factor; actor.y += (target.y - actor.y) * factor;
    actor.facing = target.facing; actor.seat = target.seat; actor.action = target.action; actor.drink = target.drink; actor.actionUntil = target.actionUntil; actor.soberAt = target.soberAt;
    actor.cabinet = target.cabinet ?? ''; actor.gameReaction = target.gameReaction ?? ''; actor.gameReactionUntil = target.gameReactionUntil ?? 0;
    this.animateActor(actor, time, target.moving && target.connected);
    actor.sprite.setAlpha(target.connected ? 1 : .4);
    if (actor !== this.player) actor.label?.setText(target.name + (target.ears?' 🙉':'') + (!target.connected ? translateText(' · нет связи') : target.activity==='piano' ? ' · ♫' : target.playing ? (target.gameReactionUntil && target.gameReactionUntil > Date.now() && target.gameReaction === 'win' ? translateText(' · радуется') : target.gameReactionUntil && target.gameReactionUntil > Date.now() && target.gameReaction === 'lose' ? translateText(' · негодует') : translateText(' · играет')) : target.action === 'drink' ? translateText(' · пьёт') : target.seat ? translateText(' · сидит') : ''));
  }
  private flushPrediction() { if (this.network) this.prediction.flush(inputs => this.network!.inputs(inputs)); }
  cancelMovement() {
    this.marker?.setVisible(false);
    this.cancelCabinetAdmission?.();
    this.clickTargets.cancel();
    this.player.path = []; this.marker?.setVisible(false);
    this.prediction.reset(); this.afterMovement = undefined; this.lastInput = '0,0'; this.correction = { x: 0, y: 0 };
  }
  private endPrediction() {
    if (this.player) this.player.path = [];
    if (this.securityLocked || !this.network) {
      this.cancelMovement();
    } else {
      this.prediction.finish(this.player); this.flushPrediction();
    }
    this.lastInput = '0,0';
  }
  finishMovement(action: () => void) {
    this.endPrediction();
    if (this.prediction.active) this.afterMovement = action;
    else { this.afterMovement = undefined; action(); }
  }
  getState() { const c=this.cameras.main;return { cat: this.catView, world:{...WORLD,bounds:BOUNDS},guests:this.guestViews.filter(v=>v.hall===this.hall).map(v=>({...v})), playing:this.networkSelf?.playing??Boolean(this.player.cabinet), cabinet:this.player.cabinet, gameReaction:this.player.gameReactionUntil>Date.now()?this.player.gameReaction:'', gameReactionUntil:this.player.gameReactionUntil, stools:[...this.cabinetStools.keys()], mira:this.bar?.getState(), guards:this.guard?.getState(), security:this.networkSelf?.security, hall:this.hall,switching:this.switching, view:{width:c.width,height:c.height,zoom:c.zoom,x:c.worldView.x,y:c.worldView.y,overview:this.overview}, x: this.player.x, y: this.player.y, moving: this.player.moving, seat: this.player.seat, action: this.player.action, drink: this.player.drink, actionUntil: this.player.actionUntil, soberAt: this.player.soberAt, intoxication: getIntoxication(this.player.soberAt), near: this.near?.id ?? null, locked: this.locked, online: !!this.network, npcTiming:this.npcTimeline.getState(), guestRenderPositions:[...this.guests].map(([id,actor])=>({id,x:actor.x,y:actor.y,spriteX:actor.sprite.x,spriteY:actor.sprite.y,moving:actor.moving})), predicted: this.prediction.active, pendingInputs: this.prediction.pendingCount, serverX: this.networkSelf?.x, serverY: this.networkSelf?.y, renderX: this.player.sprite.x, renderY: this.player.sprite.y, skin: this.player.skin, appearance: this.player.appearance, texture: this.player.sprite.texture.key, remotes: this.remotePlayers.size, remotePositions: [...this.remotePlayers].map(([id, { actor }]) => ({ id, skin: actor.skin, appearance: actor.appearance, texture: actor.sprite.texture.key, x: actor.x, y: actor.y, seat: actor.seat, cabinet: actor.cabinet, gameReaction:actor.gameReactionUntil>Date.now()?actor.gameReaction:'', gameReactionUntil:actor.gameReactionUntil, action: actor.action, soberAt: actor.soberAt, angle: actor.sprite.angle, frame: actor.sprite.frame.name })), facing: this.player.facing, animation: this.player.sprite.anims.currentAnim?.key, frame: this.player.sprite.frame.name, reducedMotion: this.reducedMotion }; }
  update(time: number, delta: number) {
    if (!this.player) return;
    const npcRenderAt=this.npcTimeline.renderTime(performance.now(),this.guestsAt||this.npcSimulationAt||undefined)??performance.now()-300;
    this.atelier?.update(delta, this.hall==='arcade',
      this.hall==='arcade' && Math.hypot(this.player.x-ATELIER.entry.x,this.player.y-ATELIER.entry.y)<90,
      Boolean(document.getElementById('skin-studio-dialog')?.hasAttribute('open')));
    if (time >= this.sobrietyBadgeAt) {
      this.sobrietyBadgeAt = time + 1000;
      const badge = document.getElementById('room-intoxication'), drunk = getIntoxication(this.player.soberAt);
      if (badge) {
        badge.hidden = drunk.stage === 0; badge.dataset.stage = String(drunk.stage);
        const seconds = Math.ceil(drunk.remainingMs / 1000);
        badge.textContent = `${drunk.label} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        badge.title = translateText('Время до полного отрезвления');
      }
    }
    if(!this.network&&!this.locked&&!this.isHuggingCat()&&!this.typing&&inHallDoor(this.player))this.changeHall(hallLinkAt(this.player)!.target);
    this.details.update(time);
    if (this.hall === 'github') this.cardTables?.update(time);
    if(this.hall==='arcade')this.bar.update(this.player.action==='drink'||[...this.remotePlayers.values()].some(p=>p.target.action==='drink'),this.reducedMotion,this.guard.barConversation(),delta/1000,Boolean(this.network),npcRenderAt);
    if(!this.network && this.player.action==='drink' && Date.now()>=this.player.actionUntil){this.player.action=this.player.seat?'sit':'idle';this.player.drink='';}
    const standButton = document.querySelector<HTMLButtonElement>('#stand-up'); if(standButton)standButton.hidden = Boolean(this.player.cabinet) || (!this.player.seat && this.player.action!=='drink');
    const dt = Math.min(delta, 40) / 1000;
    if (!this.network) { this.catRoutine.tick(dt,[this.catPerson()]); this.catView=this.catRoutine.snapshot(); }
    const carrier = this.catView.carriedBy === (this.selfId || 'local-player') ? this.player : this.remotePlayers.get(this.catView.carriedBy)?.actor;
    const catAudible = canHearCat(this.catView,{hall:this.hall,x:this.player.x,y:this.player.y});
    this.catRenderer?.update(this.catView,this.hall,time,dt,this.reducedMotion,carrier,catAudible);
    if (time >= this.catUiAt) { this.catUiAt=time+200;this.onCat(); }
    const now = performance.now(), inputMs = Math.min(50, now-this.predictionClock); this.predictionClock = now;
    this.correction.x *= Math.exp(-dt*18); this.correction.y *= Math.exp(-dt*18);
    if (!this.locked && !this.isHuggingCat() && !this.typing && !this.switching && !this.player.cabinet && !this.networkSelf?.playing) {
      const dx = Number(this.keys.D!.isDown || this.keys.RIGHT!.isDown) - Number(this.keys.A!.isDown || this.keys.LEFT!.isDown);
      const dy = Number(this.keys.S!.isDown || this.keys.DOWN!.isDown) - Number(this.keys.W!.isDown || this.keys.UP!.isDown);
      const sprint = this.keys.SHIFT!.isDown;
      if (dx || dy) this.approachingCat=false;
      if (this.approachingCat && time >= this.catApproachAt) {
        this.catApproachAt=time+750;
        const anchor=catApproachPoint(this.catView);
        if (this.catView.hall===this.hall && Math.hypot(this.player.x-anchor.x,this.player.y-anchor.y)<60) { this.approachingCat=false;this.player.path=[];this.network?.stop();this.marker.setVisible(false); }
        else this.approachCat();
      }
      let moving = false;
      if (this.network) {
        const input = String(dx) + ',' + String(dy) + (sprint && (dx || dy) ? ',sprint' : '');
        const previousInput = this.lastInput;
        if (this.networkSelf && !dx && !dy && this.player.path.length) {
          advanceClickMovement(this.player, this.player.path, inputMs, this.prediction, this.guard.getState());
          this.lastInput = 'route';
          if (!this.player.path.length) this.endPrediction();
        } else if (this.networkSelf && (dx || dy || input !== this.lastInput)) {
          if (dx || dy) { this.clickTargets.cancel(); this.afterMovement = undefined; }
          this.prediction.step(this.player, dx, dy, dx || dy ? inputMs : 0, sprint, this.guard.getState());
          this.lastInput = input;
          if (dx || dy) { this.pendingCabinet = null; this.pendingLounge = null; this.player.path = []; this.marker.setVisible(false); }
        }
        if (this.prediction.active && (previousInput !== this.lastInput || now-this.lastInputAt >= 50)) { this.flushPrediction(); this.lastInputAt = now; }
        if (this.prediction.active) { if (!dx && !dy && !this.player.path.length) this.player.moving = false; this.animateActor(this.player, time, this.player.moving); }
      } else if (dx || dy) {
        this.stand(); this.pendingLounge = null;
        this.player.path = []; this.pendingCabinet = null; this.marker.setVisible(false);
        const impaired = intoxicatedMovement(this.player.soberAt, { x: dx, y: dy, ms: dt * 1000 }, Math.floor(time / 50));
        const speed = (sprint ? PLAYER_SPRINT_SPEED : PLAYER_SPEED) * impaired.speedMultiplier * dt;
        moving = this.move(this.player, impaired.x * speed, impaired.y * speed);
      } else if (!this.player.seat && this.player.action!=='drink') moving = this.follow(this.player, dt, PLAYER_SPRINT_SPEED);
      if (!this.network) this.animateActor(this.player, time, moving);
      this.halo.setPosition(this.player.x, this.player.y).setDepth(this.player.y - 2);
      if(this.pendingLounge) {
        if(this.pendingLounge.startsWith('activity:')){
          const id=this.pendingLounge.slice(9) as ActivityId,entry=ACTIVITIES[id].entry;
          if(Math.hypot(this.player.x-entry.x,this.player.y-entry.y)<20){this.pendingLounge=null;this.player.path=[];this.network?.stop();this.onActivity(id);}
        }
        else if(this.pendingLounge==='atelier') {
          if(Math.hypot(this.player.x-ATELIER.entry.x,this.player.y-ATELIER.entry.y)<20){this.pendingLounge=null;this.player.path=[];this.player.facing='up';this.network?.stop();this.onAtelier();}
        }
        else if(this.pendingLounge==='bar' && atBar(this.player)) {this.pendingLounge=null;this.player.path=[];this.network?.stop();this.onBar();}
        else {
          const seat=SEATS.find(s=>s.id===this.pendingLounge);
          if(seat && Math.hypot(seat.entry.x-this.player.x,seat.entry.y-this.player.y)<22){
            this.pendingLounge=null;this.player.path=[];
            if(this.network)this.network.sit(seat.id);
            else {this.player.x=seat.x;this.player.y=seat.y;this.player.seat=seat.id;this.player.action='sit';this.player.facing=seat.facing;}
          }
        }
      }
      const near = cabinetsInHall(this.hall).find(c => Math.hypot(cabinetSeat(c).entry.x - this.player.x, cabinetSeat(c).entry.y - this.player.y) < 77) ?? null;
      this.near = near;
      const nearKey = near ? near.id + ':' + (this.cabinetOccupant(near.id) ?? '') : '';
      if (nearKey !== this.lastNear) { this.lastNear = nearKey; this.onNear(near); }
      if (!this.player.path.length) {
        this.marker.setVisible(false);
        if (this.pendingCabinet && near?.id === this.pendingCabinet.id) { this.pendingCabinet = null; this.player.facing = 'up'; this.onPlay(near); }
      }
    }
    if (this.prediction.active && (this.locked || this.typing || this.switching)) this.animateActor(this.player, time, false);
    if (!this.network && (this.locked || this.isHuggingCat() || this.typing || this.switching)) this.animateActor(this.player, time, false);
    if (this.networkSelf && !this.prediction.active) this.interpolate(this.player, this.networkSelf, dt, time);
    for (const { actor, target } of this.remotePlayers.values()) this.interpolate(actor, target, dt, time);
    if (time >= this.nextTextureCleanup) {
      this.nextTextureCleanup = time + 1000;
      pruneCharacterTextures(this, new Set([this.player.sprite.texture.key, ...[...this.remotePlayers.values()].map(remote => remote.actor.sprite.texture.key)]));
    }
    this.halo.setPosition(this.player.x, this.player.y).setDepth(this.player.y - 2);
    this.guard.update(this.hall, time, dt, id => id===this.selfId ? this.player : this.remotePlayers.get(id)?.actor,npcRenderAt);
    if(!this.network){this.guestRoutine.setOccupiedCabinets([this.player.cabinet]);this.guestRoutine.tick(dt);this.syncGuests(this.guestRoutine.snapshot());}
    for(const latest of this.guestViews){
      const actor=this.guests.get(latest.id);if(!actor||latest.hall!==this.hall)continue;
      const view=this.network?this.guestMotion.get(latest.id)?.sample(npcRenderAt)??latest:latest;
      const moved=Math.hypot(view.x-actor.x,view.y-actor.y)>.001;
      actor.x=view.x;actor.y=view.y;
      actor.facing=view.facing;actor.seat=view.seat;actor.action=view.mood==='drinking'?'drink':view.seat?'sit':'idle';actor.drink=view.drink;
      const status=view.mood==='playing'?translateText('играет'):view.mood==='drinking'?translateText('пьёт'):view.mood==='resting'?translateText('отдыхает'):translateText('гуляет');
      const label=translateText('НПС · ')+status;if(actor.label?.text!==label)actor.label?.setText(label);
      this.animateActor(actor,time,view.moving&&moved);
      if(view.mood==='playing'&&!view.moving&&!this.reducedMotion)actor.sprite.setAngle(Math.sin(time/400+actor.phase)*1.5);
    }
  }
  private move(actor: Actor, dx: number, dy: number) {
    const before = { x: actor.x, y: actor.y };
    if (walkable(actor.x + dx, actor.y, this.obstacles)) actor.x += dx;
    if (walkable(actor.x, actor.y + dy, this.obstacles)) actor.y += dy;
    const movedX = actor.x - before.x, movedY = actor.y - before.y;
    const moved = Math.hypot(movedX, movedY) > .05;
    if (moved) actor.facing = movementFacing(movedX, movedY, actor.facing);
    return moved;
  }
  private follow(actor: Actor, dt: number, speed: number) {
    const impairment = intoxicatedMovement(actor.soberAt, { x: 1, y: 0, ms: dt * 1000 }, Math.floor(this.time.now / 50));
    let remaining = speed * impairment.speedMultiplier * dt, moved = false;
    while (actor.path.length && remaining > 0) {
      const target = actor.path[0];
      const dx = target.x - actor.x, dy = target.y - actor.y, distance = Math.hypot(dx, dy);
      if (distance < .05) { actor.path.shift(); continue; }
      const step = Math.min(remaining, distance);
      const beforeX = actor.x, beforeY = actor.y;
      this.move(actor, dx / distance * step, dy / distance * step);
      // A tiny remainder between path segments is still progress, even below the animation threshold.
      if (Math.hypot(actor.x-beforeX, actor.y-beforeY) < .000001) { actor.path = []; break; }
      moved = true; remaining -= step;
      if (Math.hypot(target.x - actor.x, target.y - actor.y) < .05) actor.path.shift();
    }
    return moved;
  }
  private animateActor(actor: Actor, time: number, moving: boolean) {
    actor.sprite.setAngle(0); actor.label?.setVisible(true); actor.shadow.setScale(1);
    const wasMoving = actor.moving;
    actor.moving = moving;
    const gameReaction = actor.gameReactionUntil > Date.now() ? actor.gameReaction : '';
    const gameMode = actor.cabinet ? gameReaction === 'win' ? 'win' : gameReaction === 'lose' ? 'lose' : 'game' : '';
    const mode = gameMode || (actor.action==='drink' ? (actor.seat?'sitdrink':'drink') : actor.seat ? 'sit' : moving ? 'walk' : 'idle');
    const key = `${actor.sprite.texture.key}-${mode}-${actor.facing}`;
    const distance = Math.hypot(actor.x - actor.visualX, actor.y - actor.visualY);
    const elapsed = time - actor.visualAt;
    const travel = distance < 24 && elapsed > 0 && elapsed < 150 ? distance : 0;
    const anim = actor.sprite.anims;
    if (this.reducedMotion && !moving) {
      anim.stop(); actor.sprite.setFrame(`${actor.facing}-${gameMode === 'win' ? 36 : gameMode === 'lose' ? 42 : gameMode ? 30 : actor.action==='drink'?(actor.seat?19:13):actor.seat?10:6}`);
    } else {
      // A turn swaps the paper view while preserving the current step in the cycle.
      const changed = anim.currentAnim?.key !== key || !anim.isPlaying;
      if (changed) {
        const walkingBefore = anim.currentAnim?.key.includes('-walk-') && mode === 'walk';
        const startFrame = walkingBefore ? Math.max(0, (anim.currentFrame?.index ?? 1) - 1) : 0;
        actor.sprite.play({key, startFrame, delay: mode === 'idle' ? actor.phase * 13 : 0});
      }
      const speed = elapsed > 0 ? travel / elapsed * 1000 : PLAYER_SPEED;
      anim.timeScale = mode === 'walk' ? Phaser.Math.Clamp(speed / PLAYER_SPEED, .3, PLAYER_SPRINT_SPEED / PLAYER_SPEED) : 1;
    }
    actor.visualX = actor.x; actor.visualY = actor.y; actor.visualAt = time;
    if (!wasMoving || !moving) actor.strideDistance = 0;
    else actor.strideDistance += travel;
    const x = actor.x + (actor === this.player ? this.correction.x : 0), y = actor.y + (actor === this.player ? this.correction.y : 0);
    if (actor.visualSeat !== actor.seat) { actor.visualSeat = actor.seat; actor.seatedAt = time; }
    const sitting = actor.cabinet && !this.reducedMotion ? Math.max(0, 1 - (time - actor.seatedAt) / 360) : 0;
    actor.sprite.setPosition(x, y - Math.sin(sitting * Math.PI) * 5).setDepth(y);
    const drunk = getIntoxication(actor.soberAt);
    const sway = this.reducedMotion ? 0 : Math.sin(time / (moving ? 190 : 650) + actor.phase) * drunk.level * (moving ? 7 : 3);
    actor.sprite.setAngle(sway);
    actor.blush.clear().setPosition(x, y).setDepth(y + .1).setAngle(sway).setVisible(drunk.stage > 0 && actor.facing !== 'up');
    if (drunk.stage && actor.facing !== 'up') {
      actor.blush.fillStyle(0xd34140, .12 + drunk.stage * .1);
      for (const cheek of actor.facing === 'down' ? [-9, 9] : actor.facing === 'left' ? [-5] : [5]) actor.blush.fillEllipse(cheek, -38, 8, 4);
    }
    actor.shadow.setPosition(x, y - 1).setDepth(y - 1).setScale(moving && !this.reducedMotion && /-[1245]$/.test(String(actor.sprite.frame.name)) ? .94 : 1);
    actor.label?.setPosition(x, y - (actor.seat?72:83)).setDepth(y + 1);
    if (moving && actor.strideDistance >= 38) {
      actor.strideDistance %= 38;
      actor.lastStep = time;gameAudio.effect('step',Math.max(.08,1-Math.hypot(actor.x-this.player.x,actor.y-this.player.y)/650));
      if(this.reducedMotion)return;
      const foot = this.add.ellipse(actor.x + (Math.floor(time / 230) % 2 ? -6 : 6), actor.y - 2, 6, 3, 0xb8c5b0, .13).setDepth(2);
      this.tweens.add({ targets: foot, alpha: 0, scaleX: 1.6, duration: 480, onComplete: () => foot.destroy() });
    }
  }
}
