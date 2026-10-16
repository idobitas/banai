import { defineConfig, devices } from '@playwright/test';

// Dedicated ports so E2E never collides with a running dev server.
const API_PORT = 8010;
const WEB_PORT = 5183;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 },
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  }],
  webServer: [
    {
      command: `uv run uvicorn app.main:app --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/health`,
      // APP_ENV=e2e swaps OpenAI for a scripted agent (no cost, deterministic). The signing key
      // below is a test-only value, never used outside E2E.
      env: { APP_ENV: 'e2e', CORS_ORIGINS: `http://localhost:${WEB_PORT}`, PROPOSAL_SIGNING_KEY: 'e2e-only-signing-key' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
