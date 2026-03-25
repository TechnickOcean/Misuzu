import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    ignorePatterns: [],
    semi: false,
  },
  staged: {
    "*": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
})
