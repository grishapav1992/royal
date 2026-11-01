/** Keep the accepted stake visible while locked, then offer a valid shared stake for the next round. */
export function syncStakeSelect(select:HTMLSelectElement,current:string,values:readonly(string|number)[],locked:boolean,scale=100):string {
 const choices=values.map(String),value=!locked&&!choices.includes(current)?choices[0]:current;
 select.querySelector('[data-historical-stake]')?.remove();
 if(!choices.includes(value)){
  const option=select.ownerDocument.createElement('option');option.value=value;option.textContent=(Number(value)/scale).toFixed(2)+' USDT';option.disabled=true;option.dataset.historicalStake='true';select.append(option);
 }
 select.value=value;select.disabled=locked;return value;
}
