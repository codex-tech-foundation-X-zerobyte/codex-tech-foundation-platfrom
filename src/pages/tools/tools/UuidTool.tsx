import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, CopyButton } from '../../../components/ui'
import { Field, Output, Pane, ToolGrid, Toggle } from '../toolkit'

function generate(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID())
}

export default function UuidTool() {
  const [count, setCount] = useState(5)
  const [upper, setUpper] = useState(false)
  const [hyphens, setHyphens] = useState(true)
  const [raw, setRaw] = useState(() => generate(5))

  const formatted = raw.map((u) => {
    const v = hyphens ? u : u.replace(/-/g, '')
    return upper ? v.toUpperCase() : v
  })
  const text = formatted.join('\n')

  const regenerate = (n = count) => setRaw(generate(n))
  const setCountSafe = (value: number) => {
    const n = Math.max(1, Math.min(100, Number.isFinite(value) ? Math.round(value) : 1))
    setCount(n)
    setRaw(generate(n))
  }

  return (
    <ToolGrid>
      <Pane title="Options">
        <Field label="How many (1–100)">
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCountSafe(Number(e.target.value))} />
        </Field>
        <Toggle checked={upper} onChange={setUpper}>Uppercase</Toggle>
        <Toggle checked={hyphens} onChange={setHyphens}>Include hyphens</Toggle>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" icon={<RefreshCw size={14} />} onClick={() => regenerate()}>Generate new</Button>
          <CopyButton value={text} label="Copy all" size="md" />
        </div>
        <p className="ctf-muted">Version 4 UUIDs from the browser's cryptographic random source. Collisions are astronomically unlikely.</p>
      </Pane>
      <Pane title={`${formatted.length} UUID${formatted.length === 1 ? '' : 's'}`}>
        <Output label="Generated UUIDs" value={text} rows={Math.min(14, Math.max(5, formatted.length))} />
      </Pane>
    </ToolGrid>
  )
}
