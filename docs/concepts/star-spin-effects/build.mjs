// npm ci, then node docs/concepts/star-spin-effects/build.mjs from the Royal checkout.
// The review uses Lovable project ab528218-b259-482d-8c28-4ef960f1c958, edit f0ed2aefc464af4076ff502b01ae65dc1a94eda7.
// Runtime media correspond to studio-wild-nudge 1.6.0-62f793156f10. No server or wallet is used.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const source = path.dirname(fileURLToPath(import.meta.url));
const royal = path.resolve(process.argv[2] || ".");
const output = path.resolve(process.argv[3] || "artifacts/previews/star-spin-effects.html");
const projectRequire = createRequire(path.join(royal, "package.json"));
const { build } = projectRequire("esbuild");
const mediaDir = path.join(royal, "public/assets/wild-nudge");
const files = ["background.webp", ...Array.from({length:8}, (_, i) => "symbol-" + i + ".webp"), "characters/rive-runtime.json"];
for (const name of ["lyra","aeliri","vespera","nyxara"]) files.push("characters/" + name + ".webp", "characters/" + name + "-rive.json");
const media = {};
for (const file of files) {
  const data = await readFile(path.join(mediaDir, file));
  media[file] = { type: file.endsWith("json") ? "application/json" : "image/webp", data: data.toString("base64") };
}
const result = await build({entryPoints:[path.join(source,"studio.ts")],bundle:true,format:"iife",platform:"browser",target:"es2022",minify:true,write:false,nodePaths:[path.join(royal,"node_modules")]});
const originalCSS = (await readFile(path.join(royal, "games/wild-nudge/reactor.css"), "utf8")).replaceAll("url('/assets/wild-nudge/background.webp')", "var(--hangar)");
const replacements = { GAME_CSS: originalCSS, STUDIO_CSS: await readFile(path.join(source,"studio.css"),"utf8"), MEDIA_DATA: JSON.stringify(media), APP_JS: result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script") };
let html = await readFile(path.join(source,"preview.html"),"utf8");
for (const [key, value] of Object.entries(replacements)) html = html.replace("/*" + key + "*/", () => value);
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,html);
console.log(output);
