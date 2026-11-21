import { defineConfig } from "@playwright/test";

// End-to-end checks, run by e2e/run.mjs (which builds and starts the app for each backend and sets
// E2E_BASE_URL). Not part of `npm run check`; run with `npm run e2e`.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL, trace: "off" },
});
