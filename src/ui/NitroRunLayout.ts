/** Size the cabinet from the space allocated by the host, including its chat. */
export class NitroRunLayout {
 private observer: ResizeObserver;
 constructor(private root: HTMLElement) {
  this.observer = new ResizeObserver(() => this.resize());
  this.observer.observe(root);
  this.resize();
 }
 private resize() {
  const {width,height} = this.root.getBoundingClientRect();
  this.root.dataset.slotPriority = width > height && height < 500 ? 'landscape'
   : width >= 780 && height >= 500 ? 'full' : 'portrait';
 }
 destroy() { this.observer.disconnect(); }
}
