import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      STRIPE_SECRET_KEY: "sk_test_fake_key_for_testing",
      STRIPE_WEBHOOK_SECRET: "whsec_fake_secret_for_testing",
    },
  },
});
