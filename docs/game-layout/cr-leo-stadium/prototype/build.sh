#!/bin/sh
cd "$(dirname "$0")"
../../../../node_modules/.bin/esbuild src/mock.ts --bundle --minify --target=es2022 --outfile=site/mock.js --log-level=warning || exit 1
node -e "const f=require('fs');f.writeFileSync('site/index.html',f.readFileSync('src/page.html','utf8').replace('/*HUD*/',()=>f.readFileSync('src/hud.css','utf8')))"
ls -la site | head
