import { ExternalLink } from 'lucide-react'
import { FieldWrap, Select } from '../../components/ui'
import type { GithubRepo } from '../../lib/services'

export function RepoSelect({ repos, value, onChange }: { repos: GithubRepo[]; value: string; onChange: (v: string) => void }) {
  return <FieldWrap label="Repository" htmlFor="gh-repo"><Select id="gh-repo" value={value} onChange={(e) => onChange(e.target.value)}>{repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}</option>)}</Select></FieldWrap>
}
export const Open = ({ href }: { href: string }) => <a className="ctf-gh__open" href={href} target="_blank" rel="noopener noreferrer">Open in GitHub <ExternalLink size={12} aria-hidden="true" /></a>
