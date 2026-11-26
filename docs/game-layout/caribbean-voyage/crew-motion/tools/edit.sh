#!/bin/sh
# edit.sh <out.png> <size> <prompt-file> <image>   one paid request, no retries
out=$1; size=$2; prompt=$3; img=$4; d=$(dirname "$0")
start=$(date +%s)
curl -s -m 335 http://127.0.0.1:8766/v1/images/edits -H 'Authorization: Bearer royal-local' -F model=gpt-image-2.6-flare -F size=$size -F quality=high -F background=transparent -F n=1 -F output_format=png -F "image=@$img;type=image/png" -F "prompt=<$prompt" > "$out.json"
node -e "
const fs=require('fs');let d;try{d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'))}catch(e){console.log('ERROR bad reply',fs.readFileSync(process.argv[1],'utf8').slice(0,300));process.exit(1)}
if(!d.data){console.log('ERROR',JSON.stringify(d).slice(0,300));process.exit(1)}
if(d.data[0].b64_json)fs.writeFileSync(process.argv[2],Buffer.from(d.data[0].b64_json,'base64'));else{require('child_process').execFileSync('curl',['-s','-m','90','-o',process.argv[2],d.data[0].url]);}fs.appendFileSync(process.argv[3],process.argv[2]+' '+JSON.stringify(d.usage)+'\n');fs.unlinkSync(process.argv[1]);console.log(process.argv[2],'ok',d.usage&&d.usage.output_tokens)" "$out.json" "$out" "$d/gen/usage.log"
echo "$(( $(date +%s) - start ))s"
