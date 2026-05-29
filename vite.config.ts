import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Shared by Vitest and vite-node (the drug-sync script runner). The alias
// mirrors tsconfig's "@/*" -> "./*" so both resolve absolute @/ imports.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root.replace(/\/$/, "") },
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
  },
});
