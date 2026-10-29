export const navigationStyles=String.raw`
.ft-route-panel{grid-column:1/-1;min-height:82px;border-top:1px solid #c4a36c55;padding:8px 0 6px;min-width:0}
.ft-route-caption{margin:0 0 6px;color:#e0d4ae;font-size:11px;line-height:1.4}
.ft-route-options{display:flex;gap:7px;flex-wrap:wrap}
.ft-route-option{display:flex;align-items:center;gap:9px;min-height:44px;min-width:135px;max-width:100%;padding:6px 10px;border:1px solid #74c9c0;border-radius:4px;background:linear-gradient(#20464b,#112e37);color:#e4f7e9;text-align:left}
.ft-route-option[aria-pressed=true]{border:2px solid #ffe4a1;padding:5px 9px;background:linear-gradient(#4a513a,#263e38);color:#fff0b3}
.ft-route-option[data-kind=rope]{border-color:#e9b56e}
.ft-route-option b{display:grid;place-items:center;flex:0 0 23px;width:23px;height:23px;border-radius:50%;background:#8fe4d7;color:#0b2a31;font-size:13px}
.ft-route-option[data-kind=rope] b{background:#edbd79}
.ft-route-option span{font-size:12px;font-weight:bold}.ft-route-option small{display:block;font-size:9px;font-weight:normal;line-height:1.35;color:#bdd1c2;max-width:210px}
.ft-route-option:disabled{opacity:.55}
.ft-route-option:focus-visible{outline:3px solid #d7fff0;outline-offset:2px}
.ft-choice-number{position:absolute;right:8%;top:8%;z-index:8;display:grid;place-items:center;width:23px;height:23px;border:1px solid #d4fff1;border-radius:50%;background:#83decd;color:#082b33;font:bold 14px Arial,sans-serif;box-shadow:0 1px 5px #00121d;pointer-events:none}
.ft-room.needs-rope .ft-choice-number{background:#ebbd78;border-color:#ffdfad;color:#332512}
.ft-room.reachable .ft-collected{top:auto;bottom:7px}
.ft[data-route-active=true] .ft-room.reachable{box-shadow:inset 0 0 0 3px #9ae8d4,inset 0 0 28px #61e1bd2e;z-index:3}
.ft[data-route-active=true] .ft-room.reachable[aria-pressed=true]{box-shadow:inset 0 0 0 4px #ffe8a8,inset 0 0 25px #fac45e40}
.ft[data-route-active=true] .ft-room:not(.reachable){cursor:help}
.ft-you-label{position:absolute;top:6px;left:7px;right:20px;z-index:8;color:#ffe6a6;font:bold 9px Arial,sans-serif;text-shadow:0 1px 3px #00111c;pointer-events:none}
.ft-room.current .ft-room-id{visibility:hidden}
.ft-choice-shadow{fill:none;stroke:#001923;stroke-width:8;stroke-linecap:round}
.ft-choice-line,.ft-choice-tip{fill:none;stroke:#baffeb;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.ft-choice-path[data-kind=rope] .ft-choice-line{stroke:#ffd18b;stroke-dasharray:7 4}
.ft-choice-path[data-kind=rope] .ft-choice-tip{stroke:#ffd18b}
.ft-choice-path[data-selected=true] .ft-choice-line,.ft-choice-path[data-selected=true] .ft-choice-tip{stroke:#fff0ac;stroke-width:4}
@media(min-width:761px){.ft[data-map=bonus]{min-height:840px}}
@media(max-width:520px){.ft-route-panel{min-height:125px;padding:8px 0}.ft-route-caption{font-size:10px}.ft-route-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.ft-route-option{min-width:0;width:100%;gap:5px;padding:6px}.ft-route-option[aria-pressed=true]{padding:5px}.ft-route-option span{font-size:11px}.ft-route-option small{font-size:8px}.ft-route-option b{flex-basis:20px;width:20px;height:20px;font-size:11px}.ft-choice-number{width:18px;height:18px;font-size:11px;right:6%;top:6%}.ft-you-label{font-size:7px;left:5px;top:6px;right:16px}}
`;
