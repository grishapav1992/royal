/** Independent union-find scorer. Does not import the production model. */
export const REFERENCE_ROTORS=[1,3,5,7,9,11,13,15,17,19,21,23];
const terminal=[3,9,13,19,23];
export function referenceBoard(bits){
  const board=Array(25).fill(0);
  for(let r=0;r<5;r++)for(let c=0;c<5;c++){
    const pos=r*5+c,index=REFERENCE_ROTORS.indexOf(pos);
    if(index>=0){board[pos]=(bits>>index)&1?5:10;continue;}
    board[pos]=(r?1:0)|(c<4?2:0)|(r<4?4:0)|(c?8:0);
  }
  board[10]|=8;for(const pos of [4,14,24])board[pos]|=2;
  return board;
}
export function referenceFlow(board){
  const parent=Array.from({length:25},(_,i)=>i);
  const find=i=>{while(parent[i]!==i)i=parent[i];return i;};
  const join=(a,b)=>{parent[find(b)]=find(a);};
  for(let r=0;r<5;r++)for(let c=0;c<5;c++){
    const pos=r*5+c;
    if(c<4&&(board[pos]&2)&&(board[pos+1]&8))join(pos,pos+1);
    if(r<4&&(board[pos]&4)&&(board[pos+5]&1))join(pos,pos+5);
  }
  const powered=board[10]&8?Array.from({length:25},(_,i)=>find(i)===find(10)):Array(25).fill(false);
  let receiverMask=0,terminalRootMask=0;
  for(const [receiver,pos]of [4,14,24].entries()){
    if(!powered[pos]||!(board[pos]&2))continue;
    receiverMask|=1<<receiver;
    const options=[[pos-5,1,4],[pos+1,2,8],[pos+5,4,1],[pos-1,8,2]];
    for(const [next,out,into]of options){
      if(next<0||next>=25||Math.abs(next%5-pos%5)+Math.abs(Math.floor(next/5)-Math.floor(pos/5))!==1)continue;
      const index=REFERENCE_ROTORS.indexOf(next);
      if(index>=0&&powered[next]&&(board[pos]&out)&&(board[next]&into)){terminalRootMask|=1<<index;break;}
    }
  }
  return {receiverMask,terminalRootMask,reachedCells:powered.flatMap((on,pos)=>on?[pos]:[])};
}
export function referenceHeld(state){
  let mask=0,values=0;
  for(let i=0;i<5;i++){
    const digit=Math.floor(state/3**i)%3,bit=1<<REFERENCE_ROTORS.indexOf(terminal[i]);
    if(digit){mask|=bit;if(digit===2)values|=bit;}
  }
  return {mask,values};
}
export function referenceNextState(state,bits,terminalMask){
  let result=state;
  for(let i=0;i<5;i++){
    const digit=Math.floor(state/3**i)%3,bit=1<<REFERENCE_ROTORS.indexOf(terminal[i]);
    if(!digit&&(terminalMask&bit))result+=3**i*(bits&bit?2:1);
  }
  return result;
}
export const countFlowers=mask=>[1,2,4].reduce((sum,bit)=>sum+Number(Boolean(mask&bit)),0);
