import { gameModuleContract, type IndependentGameId } from './GameModuleCatalog';

export const GIRLHUB_MODULE = 'studio-afterglow';
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
export interface GameModulePointer { format: 1; gameId: IndependentGameId; manifest: string; sha256: string }
export interface GameModuleManifest {
 format: 1; gameId: IndependentGameId; version: string; apiVersion: 1; rulesVersion: number; progressVersion: number;
 sourceSha256: string; entry: string; styles: string[]; files: Record<string, string>;
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function moduleRoot(version: string, gameId: IndependentGameId = GIRLHUB_MODULE): string {
 if (!versionPattern.test(version) || !gameModuleContract(gameId)) throw Error('Invalid game module identity');
 return `/game-modules/${gameId}/versions/${version}/`;
}
export function validModulePointer(value: unknown, expectedGameId: IndependentGameId = GIRLHUB_MODULE): value is GameModulePointer {
 if (!gameModuleContract(expectedGameId) || !object(value) || value.format !== 1 || value.gameId !== expectedGameId || typeof value.sha256 !== 'string' || !digestPattern.test(value.sha256) || typeof value.manifest !== 'string') return false;
 const parts = value.manifest.split('/');
 return parts.length === 6 && parts[4] !== '' && versionPattern.test(parts[4]) && value.manifest === moduleRoot(parts[4], expectedGameId) + 'manifest.json';
}
export function validModuleManifest(value: unknown, path: string, expectedGameId: IndependentGameId = GIRLHUB_MODULE): value is GameModuleManifest {
 const contract = gameModuleContract(expectedGameId);
 if (!contract || !object(value) || value.format !== 1 || value.gameId !== expectedGameId || value.apiVersion !== contract.apiVersion || value.rulesVersion !== contract.rulesVersion || value.progressVersion !== contract.progressVersion || typeof value.version !== 'string' || !versionPattern.test(value.version) || typeof value.sourceSha256 !== 'string' || !digestPattern.test(value.sourceSha256)) return false;
 const root = moduleRoot(value.version, expectedGameId);
 if (path !== root + 'manifest.json' || typeof value.entry !== 'string' || !/^entry-[a-f0-9]{16}\.js$/.test(value.entry) || !Array.isArray(value.styles) || value.styles.length !== 1 || !value.styles.every(x => typeof x === 'string' && /^style-[a-f0-9]{16}\.css$/.test(x)) || !object(value.files)) return false;
 const files = Object.entries(value.files);
 if (files.length < 2 || files.length > 256 || !files.every(([name, sha]) => /^(?:entry-[a-f0-9]{16}\.js|style-[a-f0-9]{16}\.css|media\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|avif|gif|svg|mp4|mp3|ogg|wav|m4a|json|woff2?|ttf|otf))$/.test(name) && !name.split('/').some(x => x === '..' || x === '.') && typeof sha === 'string' && digestPattern.test(sha))) return false;
 return Object.hasOwn(value.files, value.entry) && value.styles.every(x => Object.hasOwn(value.files as object, x));
}
export async function moduleDigest(bytes: BufferSource): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
