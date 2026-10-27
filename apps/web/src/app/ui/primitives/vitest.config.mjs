import { defineConfig } from "vitest/config";

// Next keeps JSX for its compiler. Vite needs a transform for this view-only acceptance test.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/app/ui/primitives/version-timeline.acceptance.tsx"] }
});
