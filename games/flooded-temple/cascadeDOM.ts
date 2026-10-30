/** Retain the cabinet, focused controls and owned canvas across transport updates. */
export function updateCascadeDOM(root:HTMLElement,markup:string){
  if(!root.firstChild){root.innerHTML=markup;return;}
  const template=root.ownerDocument.createElement('template');template.innerHTML=markup;
  const update=(current:Node,next:Node):void=>{
    if(next.nodeType===1&&(next as Element).hasAttribute('data-ft-character-slot'))return;
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.parentNode!.replaceChild(next.cloneNode(true),current);return;}
    if(current.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    if(current.nodeType!==1)return;
    const element=current as HTMLElement,target=next as HTMLElement;
    for(const attribute of Array.from(element.attributes))if(attribute.name!=='style'&&!target.hasAttribute(attribute.name))element.removeAttribute(attribute.name);
    for(const attribute of Array.from(target.attributes)){
      // Timeline transforms survive unrelated balance, sound and button updates.
      if(attribute.name==='style')for(const property of Array.from(target.style))element.style.setProperty(property,target.style.getPropertyValue(property));
      else if(element.getAttribute(attribute.name)!==attribute.value)element.setAttribute(attribute.name,attribute.value);
    }
    if(element.classList.contains('ft-cascade-fx'))return;
    children(element,target);
    if(element.tagName==='SELECT')(element as HTMLSelectElement).value=(target as HTMLSelectElement).value;
  };
  const children=(current:Node,next:Node)=>{
    const desired=Array.from(next.childNodes);
    desired.forEach((node,index)=>{const existing=current.childNodes[index];if(existing)update(existing,node);else current.appendChild(node.cloneNode(true));});
    while(current.childNodes.length>desired.length)current.removeChild(current.lastChild!);
  };
  children(root,template.content);
}
