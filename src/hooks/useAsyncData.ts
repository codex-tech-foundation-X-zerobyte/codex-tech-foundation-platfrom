import { useEffect, useState } from 'react'

interface AsyncResult<T> {
  data: T
  error: Error | null
}

/**
 * Fetch-on-mount / fetch-on-key-change, without ever calling setState
 * synchronously at the top of the effect. Loading is derived during render
 * by comparing the key the current state was fetched for against the key
 * this render wants — the pattern the react-compiler lint's own guidance
 * recommends, instead of an imperative "reset to loading" setState call.
 *
 * `key` should change whenever the fetch should re-run (e.g. a route param).
 * Pass a stable literal like `'once'` for a plain fetch-on-mount.
 */
export function useAsyncData<T>(key: string, fetcher: () => Promise<AsyncResult<T>>) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ forKey: string; data: T | null; error: boolean; detail: Error | null }>({
    forKey: '',
    data: null,
    error: false,
    detail: null,
  })

  useEffect(() => {
    let cancelled = false
    fetcher()
      .then(({ data, error }) => {
        if (cancelled) return
        setState({ forKey: key, data: error ? null : data, error: Boolean(error), detail: error ?? null })
      })
      .catch((thrown: unknown) => {
        // A thrown exception used to vanish here. Keep it visible to developers and available to the UI.
        console.error('[useAsyncData] fetcher threw', thrown)
        if (!cancelled) setState({ forKey: key, data: null, error: true, detail: thrown instanceof Error ? thrown : new Error('Something went wrong loading this.') })
      })
    return () => {
      cancelled = true
    }
    // `fetcher` is intentionally excluded — callers pass a fresh closure each
    // render, and re-running on `key`/`nonce` alone is the intended behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  const loading = state.forKey !== key

  return {
    data: loading ? null : state.data,
    error: !loading && state.error,
    /** The underlying error (already worded for people when it came from a service), or null. */
    errorDetail: !loading ? state.detail : null,
    loading,
    reload: () => setNonce((n) => n + 1),
  }
}
