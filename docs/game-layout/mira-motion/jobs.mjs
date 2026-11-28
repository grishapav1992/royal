// Mira stage 2 frames: in-betweens and single-frame edits of the existing game sprites, via the local a6api gateway.
// node jobs.mjs [id ...]   (no ids: every job whose output is missing). Paid requests; never retried automatically.
import {execFile} from 'node:child_process';
import fs from 'node:fs';
const DIR=new URL('.',import.meta.url).pathname;
const KEEP='Keep EXACTLY the same canvas size, framing, scale and position as image 1: the head, hair mass, earrings, shoulders, torso, belt and apron stay in the same place unless the change below says otherwise. Same hand-painted 2D game style, outline weight, colours, shading, lighting and level of detail as the input. Same adult woman, same face. Genuine transparent background, no counter, no shelf, no furniture, no glow, no checkerboard, nothing else in the image.';
const who='Mira, the adult redheaded bartender, waist-up';
const between=(a,b,what,moves)=>({images:[a,b],prompt:`Image 1 and image 2 are two consecutive frames of the same hand-painted 2D game sprite animation: ${who}, ${what}. Paint the ONE in-between frame exactly halfway between image 1 and image 2. Only ${moves} move, to a pose halfway between the two images. ${KEEP}`});
const edit=(a,change)=>({images:[a],prompt:`Image 1 is one frame of a hand-painted 2D game sprite animation: ${who}, front three-quarter view, forearms resting near waist height on an invisible bar counter. Repaint this same frame with ONLY this change: ${change} ${KEEP}`});
const talk=(a,change)=>({images:[a],prompt:`Image 1 is one frame of a hand-painted 2D game sprite animation: ${who}, front three-quarter view, talking to a guest across an invisible bar counter. Repaint this same frame with ONLY this change: ${change} ${KEEP}`});
const stock='seen three-quarter from behind, placing a small green bottle on a shelf';
const polish='front three-quarter view, polishing a small clear glass with a cream cloth';
export const JOBS={
  // Stocking the shelf: 12 a 13 b 14 c 15 d e (a and b were the trial requests ib-12-13 and ib-13-14).
  'stock-14-15':between('work-14.png','work-15.png',stock,'the reaching arm and hand (the bottle stays placed where image 1 leaves it, so in this frame the hand is letting go of it)'),
  'stock-15-12a':{images:['work-15.png','work-12.png'],prompt:`Image 1 and image 2 are frames of the same hand-painted 2D game sprite animation: ${who}, ${stock}. In image 1 her empty hand has just left the shelf; in image 2 she holds the next bottle near her chest. Paint the frame one third of the way from image 1 to image 2: the empty hand comes down and back toward her body at shoulder height. Only that arm and hand move. ${KEEP}`},
  'stock-15-12b':{images:['work-15.png','work-12.png'],prompt:`Image 1 and image 2 are frames of the same hand-painted 2D game sprite animation: ${who}, ${stock}. In image 1 her empty hand has just left the shelf; in image 2 she holds the next bottle near her chest. Paint the frame two thirds of the way from image 1 to image 2: her hand is low near her waist and has just picked up the next small green bottle. Only that arm, hand and the bottle move. ${KEEP}`},
  // Glass polishing: 8 p 9 q 10 r 11 s.
  'polish-8-9':between('work-8.png','work-9.png',polish,'the wrists, hands, cloth and glass'),
  'polish-9-10':between('work-9.png','work-10.png',polish,'the wrists, hands, cloth and glass'),
  'polish-10-11':between('work-10.png','work-11.png',polish,'the wrists, hands, cloth and glass'),
  'polish-11-8':between('work-11.png','work-8.png',polish,'the wrists, hands, cloth and glass'),
  // Talking: more mouth shapes and gesture steps around frames 12 to 15 of the reaction sheet.
  'talk-15-13':between('react-15.png','react-13.png','front three-quarter view, talking to a guest','the right forearm and hand (rising into a small palm-up gesture) and the lips (starting to part)'),
  'talk-13-wide':talk('react-13.png','her mouth is open wider, as if saying a stressed "a" vowel, eyebrows lifted slightly. Everything else, including the hand gesture, stays as in image 1.'),
  'talk-13-o':talk('react-13.png','her lips form a small rounded "o" shape, as if saying "o". Everything else stays as in image 1.'),
  'talk-14-half':talk('react-14.png','her lips are slightly parted mid-word, a small amused smile. Everything else stays as in image 1.'),
  'talk-15-tilt':talk('react-15.png','her lips are slightly parted mid-sentence and her head tilts a little toward her right shoulder. Keep the hair volume and size the same.'),
  'talk-13-12':between('react-13.png','react-12.png','front three-quarter view, talking to a guest','the right forearm and hand (coming back in from the palm-up gesture) and the lips (closing)'),
  // Reactions to the mood of her reply, from the listening pose (reaction sheet frame 8).
  'laugh-1':edit('react-8.png','she starts to laugh: eyes squint happily, a wide open-mouthed smile showing upper teeth, shoulders lift a little.'),
  'laugh-2':edit('react-8.png','she laughs out loud: eyes closed in joy, mouth open in a big laugh, head tilted slightly back and to her right, shoulders raised, one hand lifted toward her mouth with relaxed fingers.'),
  'laugh-3':edit('react-8.png','she is settling after a laugh: a warm wide closed-mouth smile, eyes still a little squinted, head slightly tilted.'),
  'tease-1':edit('react-8.png','a teasing smirk: one corner of her mouth raised, one eyebrow raised, eyes narrowed playfully at the viewer.'),
  'tease-2':edit('react-8.png','she winks at the viewer: her left eye (on the viewer\'s right) is closed, a playful smirk, head tilted slightly.'),
  'tease-3':edit('react-8.png','a playful smirk while she twirls a lock of hair beside her cheek with the fingers of her right hand; the other forearm stays on the counter.'),
  'concern-1':edit('react-8.png','sympathetic concern: eyebrows drawn together and raised in the middle, a soft small frown, head tilted toward her right shoulder.'),
  'concern-2':edit('react-8.png','she leans slightly forward toward the viewer with a sympathetic look, eyebrows raised in the middle, and places her right hand flat on her chest.'),
  'concern-3':edit('react-8.png','a gentle reassuring small smile with soft kind eyes, head slightly tilted, forearms resting as before.'),
  // Pause between jobs: leaning on the counter and looking over the hall.
  'idle-left':edit('react-8.png','she leans a little more on both forearms and looks away to the viewer\'s left across the room, calm half-lidded eyes, a faint smile. Her head turns about 30 degrees to the viewer\'s left.'),
  'idle-right':edit('react-8.png','she leans a little more on both forearms and looks away to the viewer\'s right across the room, calm half-lidded eyes, a faint smile. Her head turns about 30 degrees to the viewer\'s right.'),
  'idle-chin':edit('react-8.png','she rests her chin on the back of her right hand, right elbow on the counter, and looks at the viewer with a relaxed bored half smile.'),
  'idle-hair':edit('react-8.png','she tucks a lock of hair behind her right ear with her right hand, eyes half-lidded, faint smile; the left forearm stays on the counter.'),
};
const run=(id,job)=>new Promise(done=>{
  const args=['-sS','-m','335','http://127.0.0.1:8766/v1/images/edits','-H','Authorization: Bearer royal-local','-F','model=gpt-image-2.6-flare','-F','size=1024x1024','-F','quality=high','-F','background=transparent','-F','output_format=png','-F','n=1'];
  for(const image of job.images)args.push('-F',`image[]=@${DIR}${image}`);
  args.push('--form-string','prompt='+job.prompt,'-o',`${DIR}raw/${id}.json`,'-w','%{http_code} %{time_total}');
  const start=Date.now();
  execFile('curl',args,{maxBuffer:1<<20},(error,stdout)=>{
    let note=error?String(error.message).slice(0,160):stdout;
    try{const j=JSON.parse(fs.readFileSync(`${DIR}raw/${id}.json`,'utf8'));const d=j.data?.[0];
      if(d?.b64_json){fs.writeFileSync(`${DIR}raw/${id}.png`,Buffer.from(d.b64_json,'base64'));note+=' b64';}
      else if(d?.url){fs.writeFileSync(`${DIR}raw/${id}.url`,d.url);note+=' url';}
      else note+=' '+JSON.stringify(j).slice(0,200);}catch(e){note+=' unreadable';}
    console.log(id,note,Math.round((Date.now()-start)/1000)+'s');done();
  });
});
fs.mkdirSync(DIR+'raw',{recursive:true});
const wanted=process.argv.slice(2), queue=Object.entries(JOBS).filter(([id])=>wanted.length?wanted.includes(id):!fs.existsSync(`${DIR}raw/${id}.json`));
console.log('jobs',queue.length);
const worker=async()=>{while(queue.length){const [id,job]=queue.shift();await run(id,job);}};
await Promise.all([worker(),worker(),worker(),worker()]);
