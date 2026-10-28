export const characterStyles=String.raw`
.ft .ft-character{pointer-events:none;isolation:isolate;width:136%;margin-left:-36%}
.ft .ft-character .ft-portrait{position:absolute;left:0;bottom:0;top:auto;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(6px 8px 9px #00101977);animation:none!important;transform:none;translate:none}
.ft .ft-character .ft-portrait[hidden]{display:none!important}
.ft .ft-character:after{content:'';position:absolute;z-index:-1;inset:10% -5% 6%;background:radial-gradient(ellipse at 50% 60%,#53d3c411,transparent 68%);opacity:.55;transition:opacity .3s}
.ft .ft-character[data-pose=discover]:after{background:radial-gradient(ellipse at 50% 45%,#e8c66d2b,transparent 62%);opacity:.85}
.ft .ft-character[data-pose=celebrate]:after{background:radial-gradient(ellipse at 50% 55%,#efc77230,transparent 68%);opacity:1}
.ft .ft-character[data-pose=reflect]:after{opacity:.15}
@media(min-width:521px) and (max-width:760px){.ft .ft-character{width:160%;margin-left:-60%}}
@media(max-width:520px){
 .ft .ft-top{height:108px}
 .ft .ft-character{display:block;position:absolute;top:-48px;left:1px;right:auto;bottom:auto;width:57px;height:52px;min-height:0;margin-left:0;overflow:hidden;opacity:1;mask-image:none;border-radius:28px 28px 9px 9px;border:1px solid #c09a5e8c;background:radial-gradient(ellipse at 50% 25%,#496365,#0a252e);z-index:4}
 .ft .ft-character .ft-portrait{left:-37px;top:0;bottom:auto;width:130px;height:195px;object-position:center top;filter:none}
 .ft .ft-character:before,.ft .ft-character:after{display:none}
 .ft .ft-tools{top:66px}
}
@media(prefers-reduced-motion:reduce){.ft .ft-character:after{transition:none}}
`;
