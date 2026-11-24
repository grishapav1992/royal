// Локальный просмотр: обёртка как у публикации. node build.mjs, затем открыть local.html через http-сервер.
import fs from 'fs';
fs.writeFileSync('local.html','<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'+fs.readFileSync('page.html','utf8')+'</body></html>');
