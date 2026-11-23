/** Decorative light between the closed doors, without a predicted result or reward cue. */
export const requestStyles=String.raw`
body:not([data-request-paused=true]) .game[data-phase=waiting][data-shut=true] .seam{animation:dracona-request-seam .9s ease-in-out infinite}
@keyframes dracona-request-seam{50%{opacity:.45}}
@media(prefers-reduced-motion:reduce){body:not([data-request-paused=true]) .game[data-phase=waiting] .seam{animation:none}}
`;
