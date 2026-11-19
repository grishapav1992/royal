import {defineConfig} from '@playwright/test';
import base from './playwright.game-layout-slots.config';
export default defineConfig({...base,grep:/studio-nitro-run|Nitro Run/,expect:{timeout:20000}});
