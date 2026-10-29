const symbols=['map','compass','pistol','cutlass','ruby','parrot'] as const;
/** Ordinary cells and continuous giant symbols use the same high resolution master. */
export function caribbeanIcon(symbol:number){
 return '<img class="ct-symbol" src="/assets/caribbean-treasures/symbol-'+symbols[symbol] +'.webp" alt="" draggable="false">';
}
