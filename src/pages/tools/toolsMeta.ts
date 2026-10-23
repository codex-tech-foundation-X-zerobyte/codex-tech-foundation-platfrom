import {
  Binary, Braces, Clock, Fingerprint, GitCompare, Globe, Hash, KeyRound, Link2, ListChecks, Palette, Regex, Send, Timer,
  type LucideIcon,
} from 'lucide-react'

export type ToolCategory = 'Data' | 'Encoding' | 'Security' | 'Web' | 'Text' | 'Time'

export interface ToolMeta {
  id: string
  name: string
  description: string
  category: ToolCategory
  icon: LucideIcon
  keywords: string[]
}

/**
 * Metadata only. The tool components themselves are lazy-loaded from DevTools.tsx so the
 * command palette and nav can list every tool without pulling any tool code into the bundle.
 */
export const TOOLS: ToolMeta[] = [
  { id: 'json', name: 'JSON formatter', description: 'Format, minify, sort and validate JSON with exact error positions.', category: 'Data', icon: Braces, keywords: ['pretty', 'beautify', 'validate', 'lint'] },
  { id: 'diff', name: 'Text diff', description: 'Compare two blocks of text line by line.', category: 'Text', icon: GitCompare, keywords: ['compare', 'changes', 'patch'] },
  { id: 'regex', name: 'Regex tester', description: 'Test patterns live with highlighted matches and capture groups.', category: 'Text', icon: Regex, keywords: ['regexp', 'pattern', 'match'] },
  { id: 'base64', name: 'Base64', description: 'Encode and decode Base64, including URL-safe and UTF-8 text.', category: 'Encoding', icon: Binary, keywords: ['encode', 'decode', 'b64'] },
  { id: 'url', name: 'URL encoder & parser', description: 'Percent-encode text and break a URL into parts and query params.', category: 'Encoding', icon: Link2, keywords: ['query', 'params', 'percent', 'uri'] },
  { id: 'jwt', name: 'JWT decoder', description: 'Inspect token headers and claims, with expiry checks. Never verifies or uploads.', category: 'Security', icon: KeyRound, keywords: ['token', 'bearer', 'claims', 'auth'] },
  { id: 'hash', name: 'Hash & HMAC', description: 'SHA-1, SHA-256, SHA-384 and SHA-512 digests, computed in your browser.', category: 'Security', icon: Hash, keywords: ['sha', 'digest', 'checksum', 'hmac'] },
  { id: 'password', name: 'Secret generator', description: 'Cryptographically random passwords and tokens with an entropy estimate.', category: 'Security', icon: Fingerprint, keywords: ['password', 'token', 'random', 'secret'] },
  { id: 'uuid', name: 'UUID generator', description: 'Generate v4 UUIDs in bulk, in the format you need.', category: 'Data', icon: ListChecks, keywords: ['guid', 'id', 'random'] },
  { id: 'time', name: 'Timestamp converter', description: 'Convert between Unix time, ISO 8601 and local time.', category: 'Time', icon: Clock, keywords: ['unix', 'epoch', 'date', 'iso'] },
  { id: 'cron', name: 'Cron explainer', description: 'Read a cron expression in plain English and preview its next runs.', category: 'Time', icon: Timer, keywords: ['schedule', 'crontab', 'job'] },
  { id: 'color', name: 'Color & contrast', description: 'Convert HEX, RGB and HSL and check WCAG contrast ratios.', category: 'Web', icon: Palette, keywords: ['hex', 'rgb', 'hsl', 'wcag', 'accessibility'] },
  { id: 'http', name: 'HTTP status codes', description: 'Searchable reference for every status code you will actually meet.', category: 'Web', icon: Globe, keywords: ['status', '404', '500', 'response'] },
  { id: 'api', name: 'API request tester', description: 'Send a request from your browser and inspect status, timing and headers.', category: 'Web', icon: Send, keywords: ['fetch', 'rest', 'curl', 'postman', 'endpoint'] },
]

export function findTool(id: string | undefined): ToolMeta | undefined {
  return TOOLS.find((t) => t.id === id)
}
