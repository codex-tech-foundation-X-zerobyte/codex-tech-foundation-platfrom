/**
 * An honest, explainable password check — not a magic score. The hard rule matches the server (at least 10 characters);
 * everything else is advice, so people understand WHY a password is weak instead of fighting arbitrary rules.
 */
export const MIN_PASSWORD_LENGTH = 10

const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'football', 'abc123', '123456', '111111', 'codex', 'foundation', 'portal']

export interface Strength { level: 0 | 1 | 2 | 3 | 4; label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong'; meetsMinimum: boolean; advice: string[] }

export function assessPassword(password: string, context: string[] = []): Strength {
  const advice: string[] = []
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { level: 0, label: 'Too short', meetsMinimum: false, advice: [`Use at least ${MIN_PASSWORD_LENGTH} characters (${MIN_PASSWORD_LENGTH - password.length} more).`] }
  }
  const lower = password.toLowerCase()
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  const unique = new Set(password).size
  let points = 0
  points += password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1
  points += classes >= 3 ? 1 : 0
  if (/(.)\1{2,}/.test(password)) { advice.push('Avoid repeating the same character.'); points -= 1 }
  // Only genuinely repetitive strings ('abababababab'). Real passphrases repeat letters naturally and must not be penalised.
  if (unique <= 4 || unique < password.length * 0.3) { advice.push('Use more varied characters.'); points -= 1 }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf|zxcv)/i.test(password)) { advice.push('Avoid keyboard and number sequences.'); points -= 1 }
  const guessable = [...COMMON, ...context.map((c) => c.toLowerCase()).filter((c) => c.length >= 4)].find((w) => lower.includes(w))
  if (guessable) { advice.push(`Avoid common or personal words (like "${guessable}").`); points -= 2 }
  if (classes < 3 && password.length < 16) advice.push('Mix letters, numbers and symbols — or make it longer.')
  if (password.length < 16 && !advice.length) advice.push('A longer passphrase (16+ characters) is stronger than a complicated short one.')

  const level = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4
  const label = (['Weak', 'Weak', 'Fair', 'Good', 'Strong'] as const)[level]
  return { level, label, meetsMinimum: true, advice: level === 4 ? [] : advice }
}
