import { computed, ref } from "vue"

type ThemeMode = "light" | "dark"

const STORAGE_KEY = "misuzu-web-theme"

const currentTheme = ref<ThemeMode>("light")
let initialized = false

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

function initTheme() {
  if (initialized || typeof window === "undefined") {
    return
  }

  initialized = true

  const persisted = window.localStorage.getItem(STORAGE_KEY)
  if (persisted === "light" || persisted === "dark") {
    currentTheme.value = persisted
    applyTheme(currentTheme.value)
    return
  }

  currentTheme.value = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  applyTheme(currentTheme.value)
}

function setTheme(theme: ThemeMode) {
  currentTheme.value = theme
  applyTheme(theme)

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, theme)
  }
}

export function useThemeMode() {
  initTheme()

  return {
    theme: computed(() => currentTheme.value),
    isDark: computed(() => currentTheme.value === "dark"),
    setTheme,
    toggleTheme: () => setTheme(currentTheme.value === "dark" ? "light" : "dark"),
  }
}
