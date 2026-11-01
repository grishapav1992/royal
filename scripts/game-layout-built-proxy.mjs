import http from 'node:http';
import net from 'node:net';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const port=Number(process.env.LAYOUT_BUILT_PORT||5469),api=Number(process.env.LAYOUT_API_PORT||2968),fixture=Number(process.env.LAYOUT_WEB_PORT||5468);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(req.method==='GET'||req.method==='HEAD')for(const base of ['dist','public']){
   const root=resolve(base),file=resolve(root,pathname==='/'?'index.html':pathname.slice(1));
   if(!file.startsWith(root+sep))continue;
   try{if(!(await stat(file)).isFile())continue;const bytes=await readFile(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:bytes);return;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const upstream=http.request({hostname:'127.0.0.1',port:pathname.startsWith('/__test/')?fixture:api,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
  upstream.on('error',()=>{res.statusCode=502;res.end('Local backend unavailable');});req.pipe(upstream);
 }catch{res.statusCode=500;res.end('Local preview error');}
});
server.on('upgrade',(req,socket,head)=>{
 const upstream=net.connect(api,'127.0.0.1',()=>{
  upstream.write(req.method+' '+req.url+' HTTP/1.1\r\n'+req.rawHeaders.reduce((s,v,i)=>s+(i%2?v+'\r\n':v+': '),'')+'\r\n');
  if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
 });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(port,'127.0.0.1',()=>console.log('Exact built-client proxy ready on '+port));
process.on('SIGINT',()=>server.close(()=>process.exit()));
