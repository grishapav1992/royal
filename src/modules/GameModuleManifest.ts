export const GIRLHUB_MODULE = 'studio-afterglow';
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
export interface GameModulePointer { format: 1; gameId: string; manifest: string; sha256: string }
export interface GameModuleManifest {
 format: 1; gameId: string; version: string; apiVersion: 1; rulesVersion: 2; progressVersion: 3;
 sourceSha256: string; entry: string; styles: string[]; files: Record<string, string>;
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function moduleRoot(version: string): string {
 if (!versionPattern.test(version)) throw Error('Invalid game module version');
 return `/game-modules/${GIRLHUB_MODULE}/versions/${version}/`;
}
export function validModulePointer(value: unknown): value is GameModulePointer {
 if (!object(value) || value.format !== 1 || value.gameId !== GIRLHUB_MODULE || typeof value.sha256 !== 'string' || !digestPattern.test(value.sha256) || typeof value.manifest !== 'string') return false;
 const parts = value.manifest.split('/');
 return parts.length === 6 && parts[4] !== '' && versionPattern.test(parts[4]) && value.manifest === moduleRoot(parts[4]) + 'manifest.json';
}
export function validModuleManifest(value: unknown, path: string): value is GameModuleManifest {
 if (!object(value) || value.format !== 1 || value.gameId !== GIRLHUB_MODULE || value.apiVersion !== 1 || value.rulesVersion !== 2 || value.progressVersion !== 3 || typeof value.version !== 'string' || !versionPattern.test(value.version) || typeof value.sourceSha256 !== 'string' || !digestPattern.test(value.sourceSha256)) return false;
 const root = moduleRoot(value.version);
 if (path !== root + 'manifest.json' || typeof value.entry !== 'string' || !/^entry-[a-f0-9]{16}\.js$/.test(value.entry) || !Array.isArray(value.styles) || value.styles.length !== 1 || !value.styles.every(x => typeof x === 'string' && /^style-[a-f0-9]{16}\.css$/.test(x)) || !object(value.files)) return false;
 const files = Object.entries(value.files);
 if (files.length < 3 || files.length > 100 || !files.every(([name, sha]) => /^(?:entry-[a-f0-9]{16}\.js|style-[a-f0-9]{16}\.css|media\/[a-zA-Z0-9_/-]+\.(?:webp|png|jpg|mp3|json))$/.test(name) && !name.split('/').some(x => x === '..' || x === '.') && typeof sha === 'string' && digestPattern.test(sha))) return false;
 return Object.hasOwn(value.files, value.entry) && value.styles.every(x => Object.hasOwn(value.files as object, x));
}
export async function moduleDigest(bytes: BufferSource): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
