import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const folder=resolve(process.argv[2]||'artifacts/work/flooded-temple-polish/audio-downloads'),output=resolve('games/flooded-temple/assets/audio-source');
const ffmpeg=process.env.TEMPLE_FFMPEG||'ffmpeg';
const rows=[
 ['stone','stone-door.ogg',1.4,'bonebrah','https://opengameart.org/content/stone-door'],
 ['step','footstep_concrete_000.ogg',1,'Kenney','https://kenney.nl/assets/impact-sounds'],
 ['bell','impactBell_heavy_000.ogg',2,'Kenney','https://kenney.nl/assets/impact-sounds'],
 ['metal','impactMetal_medium_000.ogg',1,'Kenney','https://kenney.nl/assets/impact-sounds'],
 ['wood','creak1.ogg',1.5,'Kenney','https://kenney.nl/assets/rpg-audio'],
 ['coins','handleCoins.ogg',1.5,'Kenney','https://kenney.nl/assets/rpg-audio'],
 ['latch','metalLatch.ogg',1,'Kenney','https://kenney.nl/assets/rpg-audio'],
 ['rope','rope.ogg',2.5,'Joseph SARDIN','https://bigsoundbank.com/rope-s0554.html'],
 ['chain','chain.ogg',2,'DenisChardonnet','https://bigsoundbank.com/medium-chain-1-s0360.html'],
 ['chimes','chimes.ogg',3,'Joseph SARDIN','https://bigsoundbank.com/chimes-dream-1-s2079.html'],
 ['splash','splash.ogg',2,'Joseph SARDIN','https://bigsoundbank.com/splash-small-6-s1534.html'],
 ['ambience','dungeon.ogg',8,'JaggedStone','https://opengameart.org/content/loopable-dungeon-ambience'],
];
await mkdir(output,{recursive:true});const provenance=[];
for(const [name,file,duration,author,page]of rows){
 const input=resolve(folder,file),bytes=await readFile(input);if(bytes.toString('ascii',0,4)!=='OggS')throw Error('Expected a licensed OGG recording: '+file);
 const filter=(name==='ambience'?'':'silenceremove=start_periods=1:start_duration=0.005:start_threshold=-45dB,')+`atrim=duration=${duration}`;
 const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',input,'-af',filter,'-ar','48000','-ac','2','-c:a','pcm_s16le','-map_metadata','-1',resolve(output,name+'.wav')],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error(result.stderr||'Decode failed');
 provenance.push({file:name+'.wav',input:file,inputSha256:createHash('sha256').update(bytes).digest('hex'),author,page,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',adaptation:'Selected opening excerpt, leading silence trimmed, decoded to stereo PCM16 at 48000 Hz; game mix rendered separately.'});
}
const music=await readFile(resolve(folder,'music.mp3'));
await writeFile(resolve(output,'sources.json'),JSON.stringify({retrieved:'2026-10-28',effects:provenance,music:{file:'public/assets/flooded-temple/audio/music.mp3',title:'Memories Of Stone',author:'Scott Buckley',page:'https://www.scottbuckley.com.au/library/memories-of-stone/',download:'https://www.scottbuckley.com.au/library/wp-content/uploads/2026/02/MemoriesOfStone.mp3',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',sha256:createHash('sha256').update(music).digest('hex'),bytes:music.length,adaptation:'Unchanged full MP3 master; streamed inside the game through Royal output. No standalone music preview redistributed.'},kenneyDownload:'Original public packs returned HTTP 403. Selected original OGG files and included Kenney licenses retrieved from the CC0 mirror https://github.com/GeorgeQLe/assets-sfx-combat .'},null,2)+'\n');
console.log(JSON.stringify({recordingSources:provenance.length,musicBytes:music.length}));
