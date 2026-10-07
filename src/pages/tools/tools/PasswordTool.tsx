import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, CopyButton } from '../../../components/ui'
import { Field, KV, Notice, Pane, ToolGrid, Toggle } from '../toolkit'

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
}
const AMBIGUOUS = /[O0oIl1|]/g

/** Uniform integer in [0, max) via rejection sampling — `random % n` would slightly favour low values. */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  do { crypto.getRandomValues(buf) } while (buf[0] >= limit)
  return buf[0] % max
}

function build(length: number, pools: string[]): string {
  const all = pools.join('')
  if (!all) return ''
  const chars = pools.map((p) => p[randomInt(p.length)]) // guarantee one from every selected set
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates so the guaranteed chars aren't always first
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.slice(0, length).join('')
}

export default function PasswordTool() {
  const [length, setLength] = useState(24)
  const [opts, setOpts] = useState({ lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false })
  const [nonce, setNonce] = useState(0)

  const pools = useMemo(
    () => (['lower', 'upper', 'digits', 'symbols'] as const).filter((k) => opts[k]).map((k) => (opts.noAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k])),
    [opts],
  )
  // `nonce` is an intentional dependency: bumping it is how "Generate new" forces a fresh draw.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const secret = useMemo(() => build(Math.max(length, pools.length), pools), [length, pools, nonce])
  const poolSize = new Set(pools.join('')).size
  const entropy = poolSize > 1 ? Math.floor(length * Math.log2(poolSize)) : 0
  const strength = entropy >= 100 ? 'Excellent' : entropy >= 75 ? 'Strong' : entropy >= 50 ? 'Fair' : 'Weak'

  return (
    <ToolGrid>
      <Pane title="Options">
        <Field label={`Length: ${length}`}>
          <input type="range" min={8} max={128} value={length} onChange={(e) => setLength(Number(e.target.value))} style={{ padding: 0 }} />
        </Field>
        <Toggle checked={opts.lower} onChange={(v) => setOpts({ ...opts, lower: v })}>Lowercase (a–z)</Toggle>
        <Toggle checked={opts.upper} onChange={(v) => setOpts({ ...opts, upper: v })}>Uppercase (A–Z)</Toggle>
        <Toggle checked={opts.digits} onChange={(v) => setOpts({ ...opts, digits: v })}>Digits (0–9)</Toggle>
        <Toggle checked={opts.symbols} onChange={(v) => setOpts({ ...opts, symbols: v })}>Symbols</Toggle>
        <Toggle checked={opts.noAmbiguous} onChange={(v) => setOpts({ ...opts, noAmbiguous: v })}>Avoid look-alikes (O, 0, l, 1, I)</Toggle>
      </Pane>
      <Pane title="Generated secret" actions={<CopyButton value={secret} />}>
        {pools.length === 0 ? (
          <Notice tone="warn">Select at least one character set.</Notice>
        ) : (
          <>
            <div className="mono" style={{ padding: 16, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border-default)', wordBreak: 'break-all', fontSize: 15, lineHeight: 1.7, color: 'var(--text-primary)' }} aria-live="polite">{secret}</div>
            <Button variant="primary" icon={<RefreshCw size={14} />} onClick={() => setNonce((n) => n + 1)}>Generate new</Button>
            <KV rows={[['Entropy', `≈ ${entropy} bits`], ['Strength', strength], ['Alphabet size', String(poolSize)]]} />
          </>
        )}
        <Notice>Generated locally with <span className="mono">crypto.getRandomValues</span>. Nothing is sent or stored.</Notice>
      </Pane>
    </ToolGrid>
  )
}
