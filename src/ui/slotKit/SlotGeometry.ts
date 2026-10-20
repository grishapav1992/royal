export type SlotLocalRect = {left:number;top:number;width:number;height:number};

const pixels = (value:string) => Number.parseFloat(value) || 0;

/** Convert screen geometry to the padding coordinates used by an absolute child. */
export function slotLocalRect(element:Element, origin:HTMLElement):SlotLocalRect {
  const rect=element.getBoundingClientRect(), bounds=origin.getBoundingClientRect(), style=getComputedStyle(origin);
  const borderX=pixels(style.borderLeftWidth)+pixels(style.borderRightWidth), borderY=pixels(style.borderTopWidth)+pixels(style.borderBottomWidth);
  const width=pixels(style.width)+(style.boxSizing==='border-box'?0:pixels(style.paddingLeft)+pixels(style.paddingRight)+borderX);
  const height=pixels(style.height)+(style.boxSizing==='border-box'?0:pixels(style.paddingTop)+pixels(style.paddingBottom)+borderY);
  const scaleX=width>0&&bounds.width>0?bounds.width/width:1, scaleY=height>0&&bounds.height>0?bounds.height/height:1;
  return {
    left:(rect.left-bounds.left)/scaleX-pixels(style.borderLeftWidth)+origin.scrollLeft,
    top:(rect.top-bounds.top)/scaleY-pixels(style.borderTopWidth)+origin.scrollTop,
    width:rect.width/scaleX,
    height:rect.height/scaleY,
  };
}
