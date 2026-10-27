export const feedbackStyles=String.raw`
.ft-room[data-revealed=false]{visibility:hidden}
.ft[data-event=travel] .ft-position{opacity:0}
.ft-moving{position:absolute;z-index:5;width:25px;height:32px;padding:3px;border:1px solid #b9ffe5;border-radius:6px;background:#17474ae8;color:#dcffec;box-shadow:0 0 10px #83e8cc55;transform:translate(-50%,-50%);pointer-events:none}
.ft-moving svg{width:100%;height:100%}
.ft-room[data-feedback=collect] .ft-room-art,.ft-room[data-feedback=relic] .ft-room-art{opacity:1}
.ft-room[data-feedback=collect]{background:radial-gradient(ellipse,#88673355,#224547)}
.ft-room[data-feedback=relic]{background:radial-gradient(ellipse,#64e3d455,#16353f)}
.ft-award{position:absolute;left:0;right:0;top:22%;z-index:6;text-align:center;font:bold clamp(14px,2vw,24px) Georgia,serif;color:#fff1b5;text-shadow:0 2px 4px #001119;pointer-events:none}
.ft-gate{transform-box:fill-box}
.ft-chest-lid{transform-box:fill-box;transform-origin:50% 90%}
.ft[data-waiting=true] .ft-room-art,.ft[data-waiting=true] .ft-mult,.ft[data-waiting=true] .ft-collected,.ft[data-waiting=true] .ft-position,.ft[data-waiting=true] .ft-map-lines{visibility:hidden}
.ft-waiting{position:absolute;inset:0;z-index:7;display:grid;place-items:center;color:#dfc68b;background:#09232bdb;font:18px Georgia,serif;text-align:center;padding:25px;pointer-events:none}
.ft[data-waiting=true][data-motion=full] .ft-room{animation:ft-stone-turn 1.4s ease-in-out infinite alternate}
.ft[data-motion=full][data-paused=false] .ft-character img{animation:ft-explorer-idle 5.6s ease-in-out infinite}
.ft[data-motion=full][data-paused=false]:after{content:'';position:absolute;z-index:-1;pointer-events:none;left:0;right:0;bottom:12%;height:20%;opacity:.12;background:repeating-linear-gradient(177deg,transparent 0 22px,#9be4c533 23px,transparent 25px 44px);animation:ft-water 9s ease-in-out infinite alternate}
.ft[data-paused=true] *{animation-play-state:paused!important}
.ft-sound svg{width:18px;height:18px}
.ft-sound[aria-pressed=false]{color:#89a7a7}
.ft-log{color:#b2d3c8;background:none;border:0;padding:0 8px;font-size:10px;min-width:44px;min-height:28px;text-decoration:underline;text-underline-offset:3px}
.ft[data-event=outcome][data-outcome=partial] .ft-collected-total strong,.ft[data-event=outcome][data-outcome=loss] .ft-collected-total strong{color:#c4d5d0}
.ft[data-outcome=partial] .ft-collected-total strong,.ft[data-outcome=loss] .ft-collected-total strong,.ft[data-outcome=partial] .ft-status,.ft[data-outcome=loss] .ft-status{color:#c4d5d0}
.ft[data-event=outcome][data-outcome=big] .ft-collected-total strong{color:#fff0a9}
.ft-log-list{max-height:52svh;overflow:auto;padding:0;list-style:none}.ft-log-list li{border-bottom:1px solid #41635e;padding:8px 0;font-size:12px}
@keyframes ft-stone-turn{from{filter:brightness(.7);transform:rotateX(-4deg)}to{filter:brightness(1);transform:rotateX(4deg)}}
@keyframes ft-explorer-idle{0%,100%{translate:0 0}50%{translate:0 -2px}}
@keyframes ft-water{from{translate:-2% 0;opacity:.08}to{translate:2% 6px;opacity:.14}}
@media(min-width:761px){.ft{min-height:720px}.ft-board-area{min-width:256px;width:min(100%,calc((100cqh - 155px)*1.25))}.ft[data-map=bonus] .ft-board-area{width:min(100%,calc((100cqh - 230px)*1.25))}}
@media(max-width:520px){.ft-tools{gap:4px}.ft-title h1{font-size:23px;max-width:205px}.ft-log{min-height:32px}.ft-legend{gap:4px}}
@media(prefers-reduced-motion:reduce){.ft .ft-character img,.ft .ft-room{animation:none!important}.ft:after{display:none!important}}
`;
