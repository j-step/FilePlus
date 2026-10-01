// frontend/playwright.config.js
//
// `npx playwright test` (or `npm run test:e2e`) is self-contained: the
// global setup builds a fresh fixture tree in a temp folder, starts the
// backend on 9877 with FILEPLUS_ENV=test and FILEPLUS_ROOT pointing at it, and
// the teardown stops the backend and deletes the temp folder
// (test/harness/). `npm run test:smoke` runs only the fast launch check.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testIgnore: ['**/harness/**'],
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../artifacts/test-results',
  globalSetup: require.resolve('./test/harness/global-setup.js'),
  globalTeardown: require.resolve('./test/harness/global-teardown.js'),
});
