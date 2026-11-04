const fs=require('node:fs'),crypto=require('node:crypto'),{syncBuiltinESMExports}=require('node:module');
const original=crypto.randomInt,file=process.env.MANUAL_STAKE_ENTROPY;
crypto.randomInt=function(...args){
 if(file&&args.length===1&&Number.isSafeInteger(args[0])&&fs.existsSync(file)){
  const fixture=JSON.parse(fs.readFileSync(file,'utf8'));
  if(args[0]===64){if(!fixture.tickets.length)throw Error('Star Spin fixture exhausted');const value=fixture.tickets.shift();fixture.consumed++;fs.writeFileSync(file,JSON.stringify(fixture));return value;}
  if(fixture.tickets.length||fixture.consumed)return 0;
 }
 return original(...args);
};syncBuiltinESMExports();
