/** Final cascade layout, sized against the actual host stage inside the iframe. */
export const cascadeLayoutStyles=String.raw`
.ft-cascade {
  height:100svh; min-height:540px; padding:0 clamp(10px,2vw,32px);
  display:grid; grid-template-rows:56px minmax(0,1fr) auto 22px;
}
.ft-cascade .ft-top {height:auto; padding-top:4px; gap:12px}
.ft-cascade .ft-title {margin:0; padding:4px 12px; border-width:5px; border-image-width:5px}
.ft-cascade .ft-title h1 {font-size:clamp(21px,2.5vw,34px); line-height:1.1}
.ft-cascade .ft-tools {position:static; gap:6px; padding:0}
.ft-cascade .ft-tools button {width:40px; min-width:40px; height:40px; min-height:40px}
.ft-cascade .ft-play {
  display:grid; grid-template-columns:minmax(130px,1fr) minmax(0,3fr);
  column-gap:clamp(12px,2vw,26px); padding:8px 0; container-type:size;
}
.ft-cascade .ft-board-area {
  grid-column:2; grid-row:1; min-width:0; max-width:none;
  width:min(100%,calc((100cqh - 142px)*1.6667));
  display:flex; flex-direction:column; justify-content:center; align-self:center;
}
.ft-cascade .ft-character {grid-column:1; grid-row:1; min-height:0}
.ft-cascade .ft-cascade-heading {min-height:20px; padding:0 4px 4px; font-size:10px}
.ft-cascade .ft-multiplier {width:76%; margin:0 auto 7px}
.ft-cascade .ft-multiplier span {font-size:clamp(20px,2.3vw,30px); padding:4px; line-height:1}
.ft-cascade .ft-cabinet {border-width:13px; border-image-width:13px; padding:3px}
.ft-cascade .ft-cascade-detail {margin:5px 0 0; min-height:14px; font-size:10px}
.ft-cascade .ft-fall-award {
  min-height:34px; padding:3px 0 0; font-size:clamp(11px,1.2vw,15px); line-height:1.35;
}
.ft-cascade .ft-console {
  grid-template-columns:minmax(0,.85fr) minmax(0,1.65fr) minmax(180px,1fr);
  gap:8px 12px; margin:0; padding:9px 14px 7px; border-width:3px;
}
.ft-cascade .ft-money {flex-direction:row; align-items:center}
.ft-cascade .ft-money strong {font-size:clamp(18px,2vw,25px)}
.ft-cascade .ft-label {font-size:10px; margin-bottom:3px; letter-spacing:.04em}
.ft-cascade .ft-bet-block {grid-template-columns:minmax(90px,1fr) minmax(0,1fr); padding:0 12px; gap:12px}
.ft-cascade .ft-stake {display:block}
.ft-cascade .ft-stake select {width:100%; min-height:44px; font-size:18px}
.ft-cascade .ft-collected-total {display:block; text-align:center}
.ft-cascade .ft-collected-total strong {font-size:28px}
.ft-cascade .ft-net {min-height:16px; margin-top:0; font-size:12px; line-height:1.3}
.ft-cascade .ft-action {grid-column:auto; display:block}
.ft-cascade .ft-primary {min-height:60px; font-size:clamp(19px,2vw,27px)}
.ft-cascade .ft-primary svg {width:30px; height:30px}
.ft-cascade .ft-playback {
  grid-column:1/3; justify-content:flex-start; flex-wrap:wrap;
  gap:6px; padding-top:6px; align-self:stretch;
}
.ft-cascade .ft-playback button,.ft-cascade .ft-playback select {min-height:40px; padding:5px 10px; font-size:12px}
.ft-cascade .ft-playback label {font-size:11px; gap:6px}
.ft-cascade .ft-auto-note {width:auto; max-width:none; margin:0; min-height:0; line-height:1.35; text-align:left}
.ft-cascade .ft-auto-note:empty {display:none}
.ft-cascade .ft-status {
  grid-column:3; align-self:stretch; padding:6px 0 0; min-height:0;
  font-size:11px; line-height:1.4; text-align:right; justify-content:flex-end;
}
.ft-cascade .ft-bottom {min-height:22px; font-size:8px; letter-spacing:.03em; gap:10px; flex-wrap:wrap}
@media (max-width:760px) {
  .ft-cascade {min-height:100svh; height:auto; align-content:start; grid-template-rows:auto auto auto auto}
  .ft-cascade .ft-top {min-height:54px; grid-template-columns:minmax(0,1fr) auto; gap:8px}
  .ft-cascade .ft-title {padding:5px 8px}
  .ft-cascade .ft-title h1 {font-size:clamp(17px,3.8vw,25px)}
  .ft-cascade .ft-tools {gap:4px}
  .ft-cascade .ft-tools button {width:44px; min-width:44px; height:44px; min-height:44px}
  .ft-cascade .ft-play {container-type:normal; grid-template-columns:minmax(90px,1fr) minmax(0,3fr); gap:12px}
  .ft-cascade .ft-board-area {width:100%}
  .ft-cascade .ft-console {grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr); padding:8px 10px; gap:8px}
  .ft-cascade .ft-bet-block {border-right:0; padding:0 0 0 8px; gap:8px}
  .ft-cascade .ft-action {grid-column:1/-1}
  .ft-cascade .ft-primary {min-height:52px; font-size:23px}
  .ft-cascade .ft-playback {grid-column:1/-1; justify-content:center; padding-top:7px}
  .ft-cascade .ft-status {grid-column:1/-1; justify-content:center; text-align:center; padding-top:5px; min-height:32px}
  .ft-cascade .ft-bottom {padding:5px 0; gap:5px; font-size:7px}
}
@media (max-width:520px) {
  .ft-cascade .ft-top {display:grid; position:relative; min-height:102px; padding-bottom:49px; gap:0}
  .ft-cascade .ft-title {grid-column:1/-1; width:100%; padding:5px 8px}
  .ft-cascade .ft-title h1 {font-size:clamp(19px,5.5vw,27px)}
  .ft-cascade .ft-tools {position:absolute; top:auto; bottom:0; right:0}
  .ft-cascade .ft-play {display:block; padding:7px 0 3px}
  .ft-cascade .ft-character {top:-47px; width:48px; height:44px}
  .ft-cascade .ft-character .ft-portrait {left:-33px; width:114px; height:171px}
  .ft-cascade .ft-cascade-heading {min-height:18px; padding:0 2px 4px; font-size:9px; letter-spacing:.02em}
  .ft-cascade .ft-multiplier {width:80%; margin-bottom:6px}
  .ft-cascade .ft-multiplier span {font-size:23px; padding:4px}
  .ft-cascade .ft-cabinet {border-width:9px; border-image-width:9px; padding:2px}
  .ft-cascade .ft-fall-award {font-size:11px; min-height:32px; padding-top:3px}
  .ft-cascade .ft-cascade-detail {font-size:9px; margin-top:4px}
  .ft-cascade .ft-money {align-items:center}
  .ft-cascade .ft-money strong {font-size:18px}
  .ft-cascade .ft-label {font-size:9px; letter-spacing:0}
  .ft-cascade .ft-bet-block {grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px}
  .ft-cascade .ft-collected-total {text-align:right}
  .ft-cascade .ft-collected-total strong {font-size:21px}
  .ft-cascade .ft-stake select {font-size:16px; padding:4px}
  .ft-cascade .ft-net {font-size:10px; min-height:26px}
  .ft-cascade .ft-playback {justify-content:space-between; gap:5px}
  .ft-cascade .ft-playback button,.ft-cascade .ft-playback select {min-height:44px; padding:5px 7px; font-size:11px}
  .ft-cascade .ft-playback label {font-size:10px; gap:4px}
  .ft-cascade .ft-auto-note {width:100%; text-align:center; font-size:10px}
  .ft-cascade .ft-status {font-size:10px; min-height:34px}
}

/* The connected phone chat can leave only 460-550px for the game stage. */
@media (max-width:520px) and (max-height:650px) {
  .ft-cascade {height:100svh; min-height:516px; grid-template-rows:58px minmax(0,1fr) auto 20px}
  .ft-cascade .ft-top {min-height:0; padding:4px 0; grid-template-columns:minmax(0,1fr) auto; gap:6px}
  .ft-cascade .ft-title {grid-column:1; width:calc(100% - 40px); margin-left:40px; padding:3px; border-width:3px; border-image-width:3px}
  .ft-cascade .ft-title h1 {font-size:15px; line-height:1.1}
  .ft-cascade .ft-tools {position:static; gap:3px}
  .ft-cascade .ft-play {display:grid; grid-template-columns:1fr; container-type:size; padding:4px 0}
  .ft-cascade .ft-character {top:-50px; left:0; width:34px; height:44px}
  .ft-cascade .ft-character .ft-portrait {left:-35px; width:104px; height:156px}
  .ft-cascade .ft-board-area {grid-column:1; width:min(100%,max(266px,calc((100cqh - 112px)*1.6667)))}
  .ft-cascade .ft-cascade-heading {min-height:16px; font-size:8px; padding-bottom:2px}
  .ft-cascade .ft-multiplier {margin-bottom:4px}
  .ft-cascade .ft-multiplier span {font-size:20px; padding:3px}
  .ft-cascade .ft-cascade-detail {font-size:8px; min-height:12px; margin-top:3px}
  .ft-cascade .ft-fall-award {min-height:27px; font-size:10px; line-height:1.2}
  .ft-cascade .ft-console {grid-template-columns:minmax(0,.95fr) minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr); gap:5px; padding:6px}
  .ft-cascade .ft-bet-block {display:contents}
  .ft-cascade .ft-label {font-size:8px; margin-bottom:2px}
  .ft-cascade .ft-money strong,.ft-cascade .ft-collected-total strong {font-size:16px}
  .ft-cascade .ft-collected-total {text-align:center}
  .ft-cascade .ft-net {font-size:9px; min-height:24px; line-height:1.2}
  .ft-cascade .ft-action {grid-column:auto}
  .ft-cascade .ft-primary {min-height:52px; font-size:16px; border-width:3px; padding:4px; clip-path:none}
  .ft-cascade .ft-primary svg {display:none}
  .ft-cascade .ft-stake select {font-size:14px; min-height:44px}
  .ft-cascade .ft-playback {grid-column:1/-1; padding-top:4px; gap:4px}
  .ft-cascade .ft-playback button,.ft-cascade .ft-playback select {font-size:10px; padding:4px 6px}
  .ft-cascade .ft-status {min-height:25px; padding-top:3px; font-size:9px; line-height:1.25}
  .ft-cascade .ft-bottom {min-height:20px; font-size:6px; padding:3px 0; gap:4px}
}

`;
