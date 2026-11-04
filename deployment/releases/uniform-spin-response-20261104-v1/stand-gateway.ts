import http from 'node:http';
import net from 'node:net';
await import('../../../scripts/game-layout-preview.ts');
// The published SDK uses root matchmake/socket routes; the current dev client uses /multiplayer.
const gateway=http.createServer((req,res)=>{
 const target=req.url?.startsWith('/matchmake/')?2984:5484;
 const out=http.request({host:'127.0.0.1',port:target,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});
 out.on('error',()=>res.destroy());req.pipe(out);
});
gateway.on('upgrade',(req,socket,head)=>{
 const out=net.connect(2984,'127.0.0.1',()=>{
  out.write(req.method+' '+req.url!.replace(/^\/multiplayer/,'')+' HTTP/'+req.httpVersion+'\r\n'+req.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n');
  if(head.length)out.write(head);socket.pipe(out);out.pipe(socket);
 });
 out.on('error',()=>socket.destroy());socket.on('error',()=>out.destroy());
});
await new Promise<void>(resolve=>gateway.listen(5485,'127.0.0.1',resolve));
process.prependOnceListener('SIGTERM',()=>gateway.close());
process.prependOnceListener('SIGINT',()=>gateway.close());
console.log('Published-host test gateway ready on 5485');
