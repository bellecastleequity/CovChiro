import { defineConfig } from "vitest/config";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://cm:cm@localhost:5432/coverage_test";

export default defineConfig({
  test: {
    globalSetup: ["./globalSetup.ts"],
    setupFiles: ["./adapterSetup.ts"],
    // One shared test database: run files one at a time.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: url, NODE_ENV: "test", UPLOAD_DIR: ".uploads-test", APP_BASE_URL: "http://localhost:3000" },
  },
});
