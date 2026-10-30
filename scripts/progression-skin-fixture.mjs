import sharp from 'sharp';
if(process.env.PROGRESSION_VERIFY_SKINS!=='1')throw Error('Local progression verification only');
const cells=Array.from({length:16},(_,i)=>'<g transform="translate('+i%4*256+','+Math.floor(i/4)*384+')"><circle cx="128" cy="105" r="65" fill="#f2c59a"/><rect x="80" y="150" width="96" height="170" fill="#bb4433"/><path d="M90 320V350H115V320M142 320V350H167V320" fill="#334466"/></g>').join('');
const image=await sharp(Buffer.from('<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">'+cells+'</svg>')).png().toBuffer();
const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(url.startsWith('https://codex.sale/')){
    if(url==='https://codex.sale/v1/images/generations')return Response.json({data:[{b64_json:image.toString('base64')}]});
    return Response.json({error:'No external provider calls on the local verification stand'},{status:503});
  }
  return original(input,options);
};
