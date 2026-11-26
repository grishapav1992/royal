interface Picture { type: string; data: string }
const embedded: Record<string, Picture> = JSON.parse(document.querySelector("#media")!.textContent!);
const urls = new Map<string, string>();
export function assetUrl(path: string) {
  if (!urls.has(path)) {
    const entry = embedded[path];
    if (!entry) throw new Error("Unknown preview asset: " + path);
    const data = Uint8Array.from(atob(entry.data), char => char.charCodeAt(0));
    urls.set(path, URL.createObjectURL(new Blob([data], { type: entry.type })));
  }
  return urls.get(path)!;
}
