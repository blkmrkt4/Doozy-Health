import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // RLS tests talk to the local Supabase stack; they are not unit-fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
  },
});
