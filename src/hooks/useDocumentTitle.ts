import { useEffect } from 'react'

/** Sets the browser tab title for this page, restoring the previous title on unmount. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = `${title} — Codex Tech Foundation`
    return () => { document.title = previous }
  }, [title])
}
