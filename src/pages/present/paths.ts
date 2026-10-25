/** The board's address for the current area: Main Admins and managers use /admin, everyone else /worker. */
export const presentBase = (pathname: string) => (pathname.startsWith('/admin') ? '/admin/present' : '/worker/present')
