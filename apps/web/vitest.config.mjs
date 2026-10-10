import { defineConfig } from "vitest/config";

// Next preserves JSX for its compiler; these synchronous preview tests run in Vite.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.acceptance.tsx"]
  }
});
