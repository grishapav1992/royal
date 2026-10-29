/** Persistent result hierarchy. A restored result stays still and never replays a ceremony. */
export const cascadeResultStyles=String.raw`
.ft-cascade .ft-net{display:block;margin-top:4px;font:600 13px/1.35 Arial,sans-serif;letter-spacing:.02em;color:#d7e2d9;overflow-wrap:anywhere}
.ft-cascade[data-outcome=win] .ft-net,.ft-cascade[data-outcome=big] .ft-net{color:#f0db9b}
.ft-cascade .ft-fall-award{font-size:14px;min-height:35px;line-height:1.45}
.ft-cascade .ft-status{font-size:12px;line-height:1.5;min-height:35px}
.ft-cascade .ft-status[data-error=false]{color:#d8e3d9}
.ft-cascade .ft-label{font-size:10px}
.ft-cascade .ft-cascade-detail{font-size:10px}
.ft-cascade .ft-bottom{font-size:8px;line-height:1.4}
.ft-cascade .ft-collected-total strong{font-variant-numeric:tabular-nums}
@media(max-width:520px){
 .ft-cascade .ft-collected-total{flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
 .ft-cascade .ft-net{font-size:12px}
 .ft-cascade .ft-fall-award{font-size:12px;min-height:35px}
 .ft-cascade .ft-playback button,.ft-cascade .ft-playback select{font-size:12px}
 .ft-cascade .ft-playback label{font-size:11px}
 .ft-cascade .ft-cascade-heading{font-size:9px}
}
`;
