import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
