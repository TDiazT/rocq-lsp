import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["views/goals/**/*.test.ts"],
    environment: "node",
  },
});
