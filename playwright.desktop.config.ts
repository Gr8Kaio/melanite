import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: 'tests/e2e-desktop', timeout: 60_000, reporter: 'list', workers: 1 });
