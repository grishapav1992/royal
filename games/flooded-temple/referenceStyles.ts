/** Materials and proportions follow the approved temple illustration. */
export const referenceStyles=String.raw`
:root{--gold:#efc47b;--muted:#b3c4bb;--aqua:#72d5d2}
.ft-dialog a{color:#f3ce87;text-underline-offset:3px}.ft-dialog a:focus-visible{outline:2px solid #90e3d6;outline-offset:3px}
.ft{padding:0 3%;grid-template-rows:70px minmax(0,1fr) auto 22px;min-height:740px;background-position:58% center}
.ft:before{background:linear-gradient(180deg,#02131b55,transparent 18%,#03131b22 65%,#03131bc9),linear-gradient(90deg,#03131d38,transparent 80%)}
.ft-top{display:grid;grid-template-columns:74% 26%;gap:0;border:0;position:relative;z-index:4;padding-top:5px}
.ft-brand,.ft-title>span{display:none}
.ft-title{position:relative;margin:0 7px;padding:2px 15px;background:linear-gradient(180deg,#233d41ee,#071c22f2 47%,#142e32f2);border:10px solid #526e6a;border-image:url('/assets/flooded-temple/frame.webp') 48 / 10px stretch;box-shadow:0 3px 0 #06151c,0 5px 13px #0009,inset 0 0 0 4px #29434880}
.ft-title:before,.ft-title:after{content:none}
.ft-title h1{margin:0;font-size:clamp(24px,3.4vw,45px);line-height:1;letter-spacing:.045em;color:#fbd292;text-shadow:0 2px #412e1c,0 -1px #fff0bb80,0 3px 7px #000}
.ft-tools{justify-self:end;padding-right:3px;gap:7px}.ft-tools button{background:radial-gradient(ellipse at 35% 20%,#385051,#0b222b);border:2px solid #997d48;box-shadow:0 2px 4px #00121d,inset 0 0 0 2px #102a31;color:#edca88}
.ft-play{grid-template-columns:74% 26%;gap:0;padding:3px 0 5px;align-items:center;container-type:size}
.ft-board-area{width:min(100%,calc((100cqh - 128px)*1.25));min-width:270px;align-self:center;justify-self:center;z-index:2}
.ft[data-map=bonus] .ft-board-area{width:min(100%,calc((100cqh - 150px)*1.25))}
.ft-board-head{margin:0 5px 7px;min-height:27px}.ft-map-label{font-size:10px;letter-spacing:.13em;text-shadow:0 2px 4px #00121b;color:#e7c58c}
.ft-tabs button{border-color:#8e794b;background:linear-gradient(#233e42,#10272e);color:#bac6bb}.ft-tabs button[aria-pressed=true]{background:linear-gradient(#4a4b35,#1d393a);color:#ffdc9c}
.ft-cabinet{border:15px solid #536d68;border-image:url('/assets/flooded-temple/frame.webp') 48 / 15px stretch;padding:3px;background:#102b34;box-shadow:0 0 0 2px #88734c,0 0 0 4px #172e35,0 13px 24px #001018d9}
.ft-cabinet:before,.ft-cabinet:after{content:none}
.ft-map{border:2px solid #12272e;box-shadow:inset 0 0 15px #000;background:#15333c}
.ft-room{padding:0;background-image:linear-gradient(#09232e12,#09232e12),url('/assets/flooded-temple/rooms.webp');background-size:100% 100%,200% 200%;background-position:center,0 0;box-shadow:inset 0 0 15px #00121b8c}
.ft-room[data-surface='1']{background-position:center,100% 0}.ft-room[data-surface='2']{background-position:center,0 100%}.ft-room[data-surface='3']{background-position:center,100% 100%}
.ft-room:before{inset:0;border:0;background:linear-gradient(180deg,#0007,transparent 30%,transparent 75%,#0004);z-index:0;pointer-events:none}
.ft-room.visited,.ft-room.current{background-image:linear-gradient(#b77c2522,#d89b2e14),url('/assets/flooded-temple/rooms.webp');background-size:100% 100%,200% 200%;box-shadow:inset 0 0 13px #e4ac3e22}
.ft-room.reachable:after{inset:6px;border:1px solid #8bdbd5aa;box-shadow:inset 0 0 14px #28d7d72e,0 0 5px #76d8d129;border-radius:2px}
.ft-room.needs-rope:after{border:1px dashed #ffc878}
.ft-room[aria-pressed=true]{box-shadow:inset 0 0 0 3px #ffd998,inset 0 0 32px #f9bf4e55}
.ft-room-id{left:8px;top:7px;color:#e2dbc0;font-size:8px;text-shadow:0 1px 3px #00131e;opacity:.85;z-index:5}
.ft-room-art{inset:8% 7% 12%;filter:drop-shadow(1px 5px 3px #00121bd9);z-index:3;pointer-events:none}
.ft-room-art[data-prop=chest]{inset:18% 20% 21%}.ft-room-art[data-prop=lever]{inset:19% 20% 18%}
.ft-room-art[data-prop=relic]{inset:2% 4% 13%;filter:drop-shadow(0 0 5px #56bfc155)}
.ft-room-art .ft-prop{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;pointer-events:none}
.ft-prop-open,.ft-prop-pulled{opacity:0}.ft-room-art[data-open=true] .ft-prop-closed,.ft-room-art[data-open=true] .ft-prop-upright{opacity:0}.ft-room-art[data-open=true] .ft-prop-open,.ft-room-art[data-open=true] .ft-prop-pulled{opacity:1}
.ft-room.visited .ft-room-art{opacity:.85}.ft-room.current .ft-room-art{opacity:.68}
.ft-mult{bottom:5px;z-index:5;left:16%;right:16%;border-radius:12px;padding:1px 0;background:linear-gradient(90deg,transparent,#09212bd9,transparent);font:bold clamp(11px,1.5vw,19px) Georgia,serif;color:#ffe1a4;text-shadow:0 2px 3px #00121e,1px 0 #583916}
.ft-collected{z-index:5;color:#ead293;right:7px;top:7px;filter:drop-shadow(0 1px 2px #00121b)}
.ft-position,.ft-moving{color:#ffe1a0;border-radius:50%;background:radial-gradient(ellipse,#725229,#203334 70%);border:1px solid #ffe0a0;box-shadow:0 0 0 3px #d9a54a30,0 0 18px #ffb52e99;width:27px;height:27px;padding:3px;z-index:7}
.ft-position{left:calc(50% - 13.5px);top:calc(50% - 13.5px)}
.ft-wall-shadow{stroke:#05151d;stroke-width:12;stroke-linecap:square;filter:drop-shadow(1px 3px 1px #001018)}
.ft-wall{stroke-width:8;stroke-linecap:square;filter:none}
.ft-wall-engraving{display:none}
.ft-trail-shadow{stroke:#4b2e0c;stroke-width:8;fill:none;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 5px #ffa329)}
.ft-trail{stroke:#ffdc70;stroke-width:2.7;opacity:1;filter:drop-shadow(0 0 3px #ffad32)}
.ft-route-arrow{fill:none;stroke:#fff0a3;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 4px #ff9d26)}
.ft-travel-line{position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:visible}
.ft-travel-line path{stroke:#ffe49d;stroke-width:3;fill:none;filter:drop-shadow(0 0 6px #ffac2f)}
.ft-gate-body{transform-box:fill-box;transform-origin:center bottom}.ft-gate-body image{filter:drop-shadow(0 3px 2px #00121b)}
.ft-legend{padding:8px 0 3px;gap:12px;color:#d0c7a8;font-size:9px;text-shadow:0 1px 2px #001018}.ft-legend svg{color:#d3b883;width:14px;height:14px}
.ft-room-detail{background:linear-gradient(90deg,transparent,#09242be3 15%,#09242be3 85%,transparent);border:0;font-size:10px;padding:6px 4px;min-height:27px;color:#c8d9cf}
.ft-character{min-height:0;align-self:stretch;overflow:clip}.ft-character img{left:-20%;bottom:0;width:142%;height:100%;object-position:center bottom;filter:drop-shadow(8px 8px 10px #00111a88)}
.ft-character:before{content:'';position:absolute;left:-2%;right:-15%;bottom:0;height:24%;background:radial-gradient(ellipse,#dba24b38,transparent 65%);pointer-events:none}
.ft-character-caption{display:none}
.ft-lantern-light{position:absolute;left:8%;bottom:24%;width:85px;height:105px;border-radius:50%;background:radial-gradient(ellipse,#ffe4a94d,#ffad331a 35%,transparent 68%);mix-blend-mode:screen;pointer-events:none}
.ft-console{grid-template-columns:minmax(0,.9fr) minmax(0,1fr) minmax(220px,1.15fr);gap:10px;padding:11px 16px 6px;margin:4px 0 0;border:5px ridge #647467;outline:1px solid #b29053;background:linear-gradient(100deg,#142a32e8,#0a2029ed),url('/assets/flooded-temple/rooms.webp') 0 0/100% auto;box-shadow:inset 0 0 0 1px #b29251,0 5px 14px #0008}
.ft-money{gap:9px}.ft-money strong{font:bold 17px Georgia,serif}.ft-money>div+div strong{font-size:14px}.ft-label{color:#d9c59c;letter-spacing:.08em;font-size:9px;margin-bottom:4px}.ft-money small{font-size:8px}
.ft-bet-block{padding:0 12px;border-color:#a38b514d}.ft-collected-total strong{font-size:25px;line-height:1.2}.ft-collected-total small{font-size:8px}
.ft-stake select{min-height:38px;border-radius:18px;background:#081c24;border-color:#9f8553;color:#ffdf9c;text-align:center;box-shadow:inset 0 2px 5px #0008}
.ft-primary{min-height:58px;border:5px double #d1aa60;background:linear-gradient(180deg,#214a46,#08282d 52%,#123a36);font-size:clamp(15px,1.6vw,23px);color:#ffdf93;text-shadow:0 2px 3px #001016;box-shadow:inset 0 0 0 2px #10272b,inset 0 0 16px #3d9a6c24,0 3px 7px #001019;clip-path:polygon(11px 0,calc(100% - 11px) 0,100% 11px,100% calc(100% - 11px),calc(100% - 11px) 100%,11px 100%,0 calc(100% - 11px),0 11px)}
.ft-primary svg{width:34px;height:34px}.ft-primary:disabled{opacity:.64}.ft-finish{font-size:9px;min-height:24px;margin:2px auto 0;color:#bfcdbd}
.ft-status{min-height:25px;padding-top:5px;font-size:10px;border-color:#a28c4e22}.ft-bottom{font-size:7px;letter-spacing:.1em;color:#a7b9a8}
.ft-bonus-tools{margin:0 5px 7px}.ft-rope{min-height:36px;background:linear-gradient(#3b4434,#142f33);border-color:#a28a59}.ft-step-dots i{background:#d7b065;border-color:#e5c789}
.ft-rope>.ft-prop{position:static;width:23px;height:23px;object-fit:contain}
.ft-sealed{background:radial-gradient(ellipse,#061d28b8,transparent 75%);gap:12px}.ft-sealed>span{width:90px;height:90px;filter:drop-shadow(0 2px 4px #00121b)}.ft-sealed strong{color:#ffdda0;text-shadow:0 2px 4px #001019;font-size:clamp(20px,2.5vw,33px)}.ft-sealed p{background:#08232bd9;padding:6px 12px;border-block:1px solid #a08c5155;color:#d0dacd}
.ft-spark{position:absolute;left:50%;top:45%;width:3px;height:7px;border-radius:50%;background:#fff0ad;box-shadow:0 0 6px #ffb52b;z-index:8;pointer-events:none}
.ft-ripple{position:absolute;inset:18%;border:2px solid #efca76;border-radius:50%;z-index:6;pointer-events:none;box-shadow:0 0 10px #f6b43755}
.ft-treasure-glow{position:absolute;inset:8%;z-index:2;background:radial-gradient(ellipse,#ffe1a67d,transparent 70%);pointer-events:none}
.ft[data-event=collect] .ft-room[data-feedback=collect]{background-image:linear-gradient(#d49c303d,#b87b1d22),url('/assets/flooded-temple/rooms.webp')}
.ft[data-motion=full][data-paused=false] .ft-lantern-light{animation:ft-lantern 3.8s ease-in-out infinite alternate}
@keyframes ft-lantern{from{opacity:.65;scale:.94}to{opacity:1;scale:1.08}}
@media(min-width:761px){.ft[data-map=bonus] .ft-board-area{display:grid;grid-template-columns:.8fr 1.2fr;column-gap:8px;align-items:center}.ft[data-map=bonus] .ft-board-head{grid-column:1;grid-row:1;margin:0 0 8px}.ft[data-map=bonus] .ft-map-label{display:none}.ft[data-map=bonus] .ft-bonus-tools{grid-column:2;grid-row:1;margin:0 0 8px}.ft-cabinet,.ft-legend,.ft-room-detail{grid-column:1/-1}}
@media(min-width:761px) and (max-height:800px){.ft{min-height:700px;grid-template-rows:61px minmax(0,1fr) auto 20px}.ft-title h1{font-size:clamp(23px,3.4vw,38px)}.ft-console{padding:8px 12px 4px;gap:7px}.ft-primary{min-height:50px}}
@media(min-width:521px) and (max-width:760px){.ft{display:block;height:auto;min-height:100svh;padding:0 3%}.ft-top{height:65px;grid-template-columns:minmax(0,1fr) auto}.ft-title{padding:3px 12px;margin-left:0}.ft-title h1{font-size:clamp(22px,4vw,30px)}.ft-title:before,.ft-title:after{font-size:22px}.ft-tools{gap:4px}.ft-tools button{width:31px;min-width:31px;height:31px}.ft-play{grid-template-columns:76% 24%;padding-top:8px;container-type:normal}.ft-board-area,.ft[data-map=bonus] .ft-board-area{width:100%;min-width:0}.ft-character img{left:-36%;width:182%;height:108%}.ft-console{grid-template-columns:1fr 1fr}.ft-action{grid-column:1/-1;display:flex}.ft-action .ft-primary{flex:1}.ft-action .ft-finish{width:120px;min-height:44px}.ft-title>span{display:none}}
@media(max-width:520px){.ft{display:block;height:auto;min-height:100svh;padding:0 3%;overflow:hidden}.ft-top{height:91px;display:block;padding-top:5px}.ft-title{margin:0;padding:4px 12px;width:100%}.ft-title h1{font-size:clamp(21px,6.2vw,28px);line-height:1.03;max-width:none;text-align:center}.ft-title:before,.ft-title:after{font-size:19px}.ft-title:before{left:4px}.ft-title:after{right:4px}.ft-tools{position:absolute;right:0;top:60px;gap:6px;padding-right:0}.ft-tools button{height:29px;min-width:29px;width:29px;font-size:16px}.ft-play{display:block;padding:6px 0 3px;container-type:normal}.ft-board-area,.ft[data-map=bonus] .ft-board-area{width:100%;max-width:none;min-width:0}.ft-board-head{min-height:32px;margin:0 0 6px;gap:4px;flex-wrap:wrap;justify-content:flex-start}.ft-map-label{font-size:8px;letter-spacing:.05em;max-width:52%;min-height:17px}.ft-tabs{gap:3px}.ft-tabs button{font-size:9px;padding:4px 6px;min-height:30px}.ft-bonus-tools{margin:0 0 7px}.ft-step-count{font-size:8px;gap:5px}.ft-step-count strong{font-size:22px}.ft-rope{font-size:9px;min-height:44px;padding:5px 7px}.ft-rope svg{width:18px}.ft-cabinet{border-width:11px;border-image-width:11px;padding:2px;box-shadow:0 0 0 1px #bc9b60,0 0 0 3px #18353b,0 5px 15px #00121b}.ft-cabinet:before,.ft-cabinet:after{font-size:21px;top:-15px}.ft-cabinet:before{left:-13px}.ft-cabinet:after{right:-13px}.ft-map{border-width:1px}.ft-room-id{font-size:7px;left:6px;top:6px}.ft-mult{font-size:12px;bottom:3px;left:8%;right:8%}.ft-room-art{inset:5% 3% 13%}.ft-room-art[data-prop=relic]{inset:0 1% 12%}.ft-room.reachable:after{inset:4px}.ft-collected{right:5px;top:5px}.ft-position,.ft-moving{width:23px;height:23px;padding:2px}.ft-position{left:calc(50% - 11.5px);top:calc(50% - 11.5px)}.ft-legend{font-size:8px;gap:6px;padding-top:7px}.ft-legend svg{width:13px;height:13px}.ft-log{font-size:9px;padding:0 3px;min-height:32px}.ft-room-detail{font-size:10px;min-height:29px;padding:4px 0}.ft-character{display:none}.ft-console{grid-template-columns:1fr 1fr;gap:8px;padding:9px 10px 4px;margin-top:3px;border-width:4px}.ft-money{display:flex;gap:5px;align-items:flex-start;flex-direction:column;justify-content:center}.ft-money>div+div{margin-top:4px}.ft-money strong{font-size:17px}.ft-money>div+div strong{font-size:12px}.ft-money small{display:none}.ft-label{font-size:8px;margin-bottom:3px}.ft-bet-block{grid-template-columns:1fr;border-right:0;padding:0 0 0 9px;gap:6px}.ft-stake{display:flex;gap:8px;align-items:center}.ft-stake .ft-label{margin:0}.ft-stake select{font-size:16px;min-height:44px;padding:4px}.ft-collected-total{display:flex;align-items:center;justify-content:space-between;gap:5px}.ft-collected-total .ft-label{margin:0}.ft-collected-total strong{font-size:24px}.ft-collected-total small{display:none}.ft-action{grid-column:1/-1;display:block}.ft-primary{min-height:56px;font-size:20px}.ft-primary svg{width:30px;height:30px}.ft-finish{width:100%;max-width:none;min-height:44px;font-size:10px}.ft-status{font-size:10px;min-height:32px;padding-top:5px}.ft-bottom{min-height:25px;gap:7px;font-size:6px;letter-spacing:.04em}.ft-bottom span+span{padding-left:7px}.ft-sealed{gap:9px}.ft-sealed>span{width:65px;height:65px}.ft-sealed strong{font-size:23px}.ft-sealed p{font-size:11px;padding:5px 8px}}
@media(prefers-reduced-motion:reduce){.ft .ft-lantern-light{animation:none!important}.ft-spark,.ft-ripple,.ft-treasure-glow{display:none!important}}
`;
