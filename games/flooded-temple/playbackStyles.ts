export const playbackStyles=String.raw`
.ft-playback{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding-top:7px;border-top:1px solid #a8a26b38;min-width:0}
.ft-playback button,.ft-playback select{min-height:44px;border:1px solid #9d8e57;border-radius:4px;background:linear-gradient(#254348,#102c35);color:#e8d39e;font:600 12px Arial,sans-serif;padding:6px 14px}
.ft-playback button:focus-visible,.ft-playback select:focus-visible{outline:2px solid #9fedd9;outline-offset:2px}
.ft-playback button[aria-pressed=true]{border-color:#efc573;color:#fff1bb;background:linear-gradient(#4d5940,#203b39)}
.ft-playback [data-ft=auto][aria-pressed=true]{border-color:#e6b279;color:#ffe1c4}
.ft-playback button:disabled,.ft-playback select:disabled{opacity:.45;cursor:default}
.ft-auto-count{display:flex;align-items:center;gap:8px;font-size:10px;color:#c5cfbc}
.ft-auto-count select{min-width:65px;padding:6px 8px}
.ft-auto-note{margin-left:auto;color:#bccfc7;font-size:10px;line-height:1.4;text-align:right;max-width:40%}
@media(max-width:520px){.ft-playback{flex-wrap:wrap;gap:6px;padding-top:9px}.ft-playback button{padding:6px 12px;font-size:11px}.ft-auto-count{gap:5px;font-size:9px}.ft-auto-count select{min-width:57px}.ft-auto-note{width:100%;max-width:none;margin:0;text-align:left;min-height:14px}}
`;
