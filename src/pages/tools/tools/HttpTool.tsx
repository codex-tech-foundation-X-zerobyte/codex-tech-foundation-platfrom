import { useMemo, useState } from 'react'
import { SearchInput } from '../../../components/ui'
import { Pane, Segmented } from '../toolkit'

const CODES: [number, string, string][] = [
  [100, 'Continue', 'The server received the request headers; the client should send the body.'],
  [101, 'Switching Protocols', 'The server agrees to switch protocols, e.g. upgrading to WebSocket.'],
  [200, 'OK', 'The request succeeded.'],
  [201, 'Created', 'A new resource was created. Usually returned by POST with a Location header.'],
  [202, 'Accepted', 'The request was accepted for processing, but is not finished yet.'],
  [204, 'No Content', 'Success with no body — typical for DELETE and some PUT/PATCH responses.'],
  [206, 'Partial Content', 'Only part of the resource is returned, in response to a Range request.'],
  [301, 'Moved Permanently', 'The resource has a new permanent URL. Clients and search engines should update links.'],
  [302, 'Found', 'Temporary redirect. The client should keep using the original URL next time.'],
  [304, 'Not Modified', 'The cached copy is still valid (conditional request via ETag / If-Modified-Since).'],
  [307, 'Temporary Redirect', 'Like 302, but the client must repeat the request with the same method and body.'],
  [308, 'Permanent Redirect', 'Like 301, but the client must repeat the request with the same method and body.'],
  [400, 'Bad Request', 'The request is malformed or fails validation. Fix the request; retrying will not help.'],
  [401, 'Unauthorized', 'Authentication is missing or invalid. (Despite the name, this is about who you are.)'],
  [403, 'Forbidden', 'You are authenticated but not allowed to do this. In this app, often a Row Level Security denial.'],
  [404, 'Not Found', 'No resource exists at this URL (or the server is hiding that it does).'],
  [405, 'Method Not Allowed', 'The URL exists but does not support this HTTP method.'],
  [408, 'Request Timeout', 'The server gave up waiting for the client to finish sending the request.'],
  [409, 'Conflict', 'The request conflicts with the current state, e.g. a duplicate unique value or version clash.'],
  [410, 'Gone', 'The resource existed but was permanently removed.'],
  [413, 'Content Too Large', 'The request body exceeds what the server will accept.'],
  [415, 'Unsupported Media Type', 'The Content-Type of the body is not one the endpoint understands.'],
  [422, 'Unprocessable Content', 'The body is well-formed but semantically invalid (common for validation errors).'],
  [429, 'Too Many Requests', 'Rate limit hit. Look for a Retry-After header and back off.'],
  [500, 'Internal Server Error', 'An unexpected server-side failure. Check the function or server logs.'],
  [501, 'Not Implemented', 'The server does not support the functionality the request needs.'],
  [502, 'Bad Gateway', 'A gateway or proxy received an invalid response from the upstream server.'],
  [503, 'Service Unavailable', 'The server is overloaded or down for maintenance. Often temporary; retry with backoff.'],
  [504, 'Gateway Timeout', 'A gateway or proxy timed out waiting for the upstream server.'],
]

const CLASS_LABEL: Record<string, string> = { all: 'All', '1': '1xx', '2': '2xx', '3': '3xx', '4': '4xx', '5': '5xx' }

export default function HttpTool() {
  const [query, setQuery] = useState('')
  const [cls, setCls] = useState('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CODES.filter(([code, name, desc]) => (cls === 'all' || String(code)[0] === cls) && (!q || String(code).includes(q) || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)))
  }, [query, cls])

  return (
    <Pane
      title={`${rows.length} status code${rows.length === 1 ? '' : 's'}`}
      actions={<Segmented label="Class" value={cls} onChange={setCls} options={Object.entries(CLASS_LABEL).map(([id, label]) => ({ id, label }))} />}
    >
      <SearchInput value={query} onChange={setQuery} placeholder="Search by code, name or meaning" style={{ maxWidth: 420 }} />
      <div className="tk-mono-list">
        {rows.map(([code, name, desc]) => (
          <div key={code} style={{ alignItems: 'flex-start', gap: 16 }}>
            <span className={`tk-tag ${code < 300 ? 'tk-tag--ok' : code < 400 ? '' : code < 500 ? 'tk-tag--warn' : 'tk-tag--bad'}`} style={{ minWidth: 44, justifyContent: 'center' }}>{code}</span>
            <div style={{ flex: 1, fontFamily: 'var(--font-sans)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{name}</strong>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 2 }}>{desc}</p>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="ctf-muted" style={{ padding: 12 }}>No status codes match “{query}”.</p>}
      </div>
    </Pane>
  )
}
