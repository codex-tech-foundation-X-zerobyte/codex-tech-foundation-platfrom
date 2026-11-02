/** Statuses that end access (the database already denies them everything; this also ends the session so the person is told why). */
export const BLOCKED_STATUSES = ['suspended', 'banned', 'inactive', 'review', 'offboarded'] as const
export const isBlockedStatus = (status: string | null | undefined) => !!status && (BLOCKED_STATUSES as readonly string[]).includes(status)
export const NOTICE_KEY = 'ctf-account-notice'
export const BLOCKED_MESSAGE = 'Your account is not active. Please contact your administrator.'
/** Read once, then forget: the sign-in page shows why a session was ended. */
export function takeAccountNotice(): string {
  try { const m = sessionStorage.getItem(NOTICE_KEY) ?? ''; sessionStorage.removeItem(NOTICE_KEY); return m } catch { return '' }
}

