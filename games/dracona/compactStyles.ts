export const compactStyles = String.raw`@media (max-width:700px),(max-height:700px) {
 html,body { width:100%; height:100%; min-height:0; margin:0; overflow:hidden; }
 .game { box-sizing:border-box; width:100%; height:100dvh; min-height:0; padding:0; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:36px 40px minmax(0,1fr) 110px 18px; grid-template-areas:"bar" "title" "play" "controls" "footer"; overflow:hidden; }
 .topbar { grid-area:bar; position:relative; min-height:0; height:36px; margin:0; padding:3px 8px; }
 .topbar .icon-button { width:30px; height:30px; min-width:30px; min-height:30px; }
 .title-block { grid-area:title; margin:0; padding:0 8px; align-self:center; }
 .title-block .eyebrow { font-size:7px; margin:0; }
 .title-block h1 { font-size:27px; line-height:30px; margin:0; }
 .title-block>p { font-size:7px; margin:0; }
 .play-area { grid-area:play; width:100%; min-height:0; margin:0; padding:2px 6px; display:grid; grid-template-columns:minmax(0,1fr) 74px; gap:5px; align-items:center; overflow:auto; }
 .character-area { display:none; }
 .cabinet-area { min-width:0; min-height:0; margin:0; }
 .cabinet { width:min(100%,max(180px,calc((100dvh - 280px)*1.25))); max-width:100%; min-height:0; margin:0 auto; }
 .cabinet-crown { height:12px; min-height:0; margin:0; }
 .cabinet-crown img { width:18px; height:18px; }
 .board-frame { padding:5px; }
 .board { width:100%; height:auto; min-height:0; aspect-ratio:5/4; gap:3px; }
 .cabinet-foot { height:10px; min-height:0; margin:0; }
 .status-strip { height:26px; min-height:0; margin:0; padding:2px; gap:3px; }
 .status-strip p { font-size:9px; line-height:11px; }
 .portal-area { display:flex; flex-direction:column; width:74px; min-height:0; gap:5px; padding:0; margin:0; }
 .game .portal-area .portal-card { box-sizing:border-box; width:100%; max-width:100%; min-width:0; min-height:0; padding:5px 3px; overflow:hidden; }
 .portal-card>.eyebrow { font-size:6px; letter-spacing:0; }
 .portal-card h2 { margin:3px 0; font-size:12px; line-height:14px; }
 .portal-card p { margin:3px 0; font-size:8px; line-height:10px; }
 .reserve-frame { width:60px; padding:3px; margin:4px auto; }
 .reserve { width:100%; gap:2px; }
 .game .portal-area .bonus-card { box-sizing:border-box; width:100%; max-width:100%; min-width:0; min-height:0; padding:5px 2px; gap:3px; overflow:hidden; }
 .bonus-card img { width:20px; height:20px; }
 .bonus-card strong { font-size:8px; line-height:10px; }
 .bonus-card p { font-size:7px; line-height:9px; margin:2px 0; }
 .controls { grid-area:controls; width:100%; min-height:0; height:110px; margin:0; padding:5px 6px; display:grid; grid-template-columns:minmax(0,1fr) 112px minmax(0,1fr) 84px; grid-template-rows:48px 42px; gap:4px; align-items:center; }
 .controls .control-label { font-size:8px; line-height:10px; letter-spacing:0; }
 .controls :is(.balance-value,.win-value) { min-width:0; }
 .controls :is(.balance-value,.win-value)>strong { font-size:16px; line-height:22px; }
 .controls :is(.balance-value,.win-value)>small { font-size:7px; }
 .bet-control { min-width:0; }
 .bet-control>div { display:flex; align-items:center; justify-content:space-between; gap:2px; }
 .bet-control strong { font-size:16px; min-width:24px; }
 .bet-step { width:32px; height:32px; min-width:32px; min-height:32px; font-size:19px; }
 .spin-button { width:84px; min-width:0; height:44px; min-height:44px; padding:5px; gap:3px; }
 .spin-label { font-size:11px; }
 .spin-button svg { width:16px; height:16px; }
 .playback-controls { grid-column:1/-1; grid-row:2; display:flex; align-items:center; justify-content:center; gap:7px; min-height:0; margin:0; padding:0; }
 .speed-control,.auto-control { min-width:0; display:flex; align-items:center; gap:3px; }
 .playback-controls select,.playback-controls button { height:36px; min-height:36px; font-size:11px; padding:3px; }
 .auto-control select { width:44px; }
 .autoplay-progress { font-size:9px; }
 .bottom-line { grid-area:footer; min-height:0; margin:0; padding:2px 6px; gap:6px; font-size:7px; }
}
@media (min-width:500px) and (max-height:400px) {
 .game { grid-template-columns:minmax(0,1fr) 230px; grid-template-rows:36px 30px minmax(0,1fr) 18px; grid-template-areas:"bar bar" "title controls" "play controls" "footer footer"; }
 .title-block h1 { font-size:22px; line-height:24px; }
 .title-block .eyebrow,.title-block>p { display:none; }
 .play-area { grid-template-columns:minmax(0,1fr) 66px; padding:2px 5px; }
 .cabinet { width:min(100%,max(160px,calc((100dvh - 156px)*1.25))); }
 .portal-area { width:66px; }
 .controls { height:100%; align-content:center; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:40px 44px 44px 44px; }
 .balance-value { grid-column:1; grid-row:1; }
 .win-value { grid-column:2; grid-row:1; }
 .bet-control { grid-column:1; grid-row:2; }
 .spin-button { grid-column:2; grid-row:2; }
 .playback-controls { grid-row:3/5; flex-direction:column; gap:4px; }
}
@media (min-width:701px) and (min-height:401px) and (max-height:700px) {
 .play-area { grid-template-columns:minmax(120px,.65fr) minmax(0,1.35fr) 110px; }
 .character-area { display:flex; flex-direction:column; min-width:0; min-height:0; width:100%; height:100%; margin:0; }
 .hero { flex:1; min-height:0; width:100%; height:auto; }
 .hero-layer { width:100%; height:100%; object-fit:contain; }
 .hero-caption { flex:none; font-size:9px; padding:3px; }
 .portal-area { width:110px; }
 .portal-card h2 { font-size:14px; line-height:16px; }
 .portal-card p { font-size:10px; line-height:12px; }
}
`;
