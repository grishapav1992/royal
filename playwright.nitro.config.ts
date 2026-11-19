import {defineConfig} from '@playwright/test';
import base from './playwright.game-layout-slots.config';
process.env.LAYOUT_GAMES='studio-nitro-run';
export default defineConfig({...base,grep:/studio-nitro-run|Nitro Run|natural bonuses/,expect:{timeout:20000}});
