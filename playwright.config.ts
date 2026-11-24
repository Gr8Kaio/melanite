import { defineConfig, devices } from '@playwright/test';

// PW_PORT permite correr varias copias en paralelo (un puerto por worktree)
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}/melanite/`, trace: 'retain-on-failure' },
  webServer: { command: `npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}/melanite/`, reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
});
