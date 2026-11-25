#!/bin/sh
# Usage: node bake.mjs <output folder>; build.sh <output folder>
cd "$(dirname "$0")"
../../../../node_modules/.bin/esbuild mock.ts --bundle --minify --target=es2022 --outfile="$1/mock.js" --log-level=warning || exit 1
node -e "const f=require('fs');f.writeFileSync(process.argv[1]+'/index.html',f.readFileSync('page.html','utf8').replace('/*HUD*/',()=>f.readFileSync('hud.css','utf8')))" "$1"
