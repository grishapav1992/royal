/** Decorative motion of the previous grid, without a predicted result or reward cue. */
export const requestStyles=String.raw`
body:not([data-request-paused=true]) .game[data-phase=waiting] .cell img{animation:dracona-request-fall .6s linear infinite;filter:blur(1px)}
.game[data-phase=waiting] .cell{overflow:hidden}
.game[data-phase=waiting] .rune,.game[data-phase=waiting] .special-label{visibility:hidden}
@keyframes dracona-request-fall{0%{transform:translateY(-105%);opacity:.15}35%,65%{opacity:.65}100%{transform:translateY(105%);opacity:.15}}
@media(prefers-reduced-motion:reduce){body:not([data-request-paused=true]) .game[data-phase=waiting] .cell img{animation:none;filter:none}}
`;
