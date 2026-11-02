import { useMemo, useState } from 'react'
import { CopyButton } from '../../../components/ui'
import { Field, KV, Notice, Pane, ToolGrid } from '../toolkit'

type RGB = [number, number, number]

function parseColor(input: string): RGB | null {
  const v = input.trim().toLowerCase()
  let m = /^#?([0-9a-f]{3})$/.exec(v)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as RGB
  m = /^#?([0-9a-f]{6})$/.exec(v)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(v)
  if (m) { const c = [Number(m[1]), Number(m[2]), Number(m[3])]; return c.every((n) => n <= 255) ? (c as RGB) : null }
  m = /^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%/.exec(v)
  if (m) return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const S = s / 100, L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, Math.round(l * 100)]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)]
}

const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const Verdict = ({ pass }: { pass: boolean }) => <span className={`tk-tag ${pass ? 'tk-tag--ok' : 'tk-tag--bad'}`}>{pass ? 'Pass' : 'Fail'}</span>

export default function ColorTool() {
  const [fg, setFg] = useState('#5170ff')
  const [bg, setBg] = useState('#06080d')
  const fgRgb = useMemo(() => parseColor(fg), [fg])
  const bgRgb = useMemo(() => parseColor(bg), [bg])
  const ratio = fgRgb && bgRgb ? contrast(fgRgb, bgRgb) : null
  const hsl = fgRgb ? rgbToHsl(fgRgb) : null

  return (
    <ToolGrid>
      <Pane title="Color">
        <div className="tk-row">
          <Field label="Foreground (HEX, rgb() or hsl())">
            <input className="mono" value={fg} onChange={(e) => setFg(e.target.value)} spellCheck={false} />
          </Field>
          <input type="color" aria-label="Pick foreground colour" value={fgRgb ? toHex(fgRgb) : '#000000'} onChange={(e) => setFg(e.target.value)} style={{ width: 44, height: 36, border: '1px solid var(--border-default)', borderRadius: 8, background: 'transparent', cursor: 'pointer', alignSelf: 'flex-end', padding: 2 }} />
        </div>
        {fg.trim() && !fgRgb && <Notice tone="error">Couldn't read that colour. Try <span className="mono">#5170ff</span>, <span className="mono">rgb(81,112,255)</span> or <span className="mono">hsl(230,100%,66%)</span>.</Notice>}
        {fgRgb && hsl && (
          <KV rows={[
            ['HEX', toHex(fgRgb)],
            ['RGB', `rgb(${fgRgb.join(', ')})`],
            ['HSL', `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`],
            ['CSS variable', `--color: ${toHex(fgRgb)};`],
          ]} />
        )}
        {fgRgb && <CopyButton value={toHex(fgRgb)} label="Copy HEX" />}
      </Pane>
      <Pane title="Contrast check (WCAG 2.2)">
        <div className="tk-row">
          <Field label="Background">
            <input className="mono" value={bg} onChange={(e) => setBg(e.target.value)} spellCheck={false} />
          </Field>
          <input type="color" aria-label="Pick background colour" value={bgRgb ? toHex(bgRgb) : '#000000'} onChange={(e) => setBg(e.target.value)} style={{ width: 44, height: 36, border: '1px solid var(--border-default)', borderRadius: 8, background: 'transparent', cursor: 'pointer', alignSelf: 'flex-end', padding: 2 }} />
        </div>
        <div style={{ padding: 20, borderRadius: 12, background: bgRgb ? toHex(bgRgb) : 'transparent', color: fgRgb ? toHex(fgRgb) : 'inherit', border: '1px solid var(--border-default)' }}>
          <strong style={{ fontSize: 22 }}>Ship it with confidence</strong>
          <p style={{ fontSize: 14, marginTop: 4 }}>The quick brown fox jumps over the lazy dog.</p>
        </div>
        {ratio !== null ? (
          <>
            <KV rows={[['Contrast ratio', `${ratio.toFixed(2)} : 1`]]} />
            <div className="tk-mono-list">
              <div><span>Normal text · AA (4.5)</span><Verdict pass={ratio >= 4.5} /></div>
              <div><span>Normal text · AAA (7)</span><Verdict pass={ratio >= 7} /></div>
              <div><span>Large text · AA (3)</span><Verdict pass={ratio >= 3} /></div>
              <div><span>UI components · AA (3)</span><Verdict pass={ratio >= 3} /></div>
            </div>
          </>
        ) : <p className="ctf-muted">Enter two valid colours to compare them.</p>}
      </Pane>
    </ToolGrid>
  )
}
