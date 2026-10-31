import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/electron', workers: 1, timeout: 120000, expect: { timeout: 15000 }, retries: 0,
  outputDir: 'work/electron-results', reporter: 'list', use: { trace: 'off', video: 'off' } });
