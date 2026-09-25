export type ThemeChoice = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'ctf-theme'

export function getStoredTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
}

// 'system' removes the attribute entirely, letting the
// @media (prefers-color-scheme: light) rule in tokens.css decide — dark is
// the :root default, so an unset attribute with a dark OS preference needs
// no extra rule at all. 'dark'/'light' set the attribute explicitly, which
// locks the theme regardless of OS preference — see tokens.css's
// :root:not([data-theme='dark']) guard for why this combination is safe.
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', choice)
  }
  localStorage.setItem(STORAGE_KEY, choice)
}

// Called once, synchronously, before React mounts (see main.tsx) — applying
// the stored theme only after the app renders would cause a visible flash
// of the wrong theme on every load.
export function initTheme() {
  applyTheme(getStoredTheme())
}
