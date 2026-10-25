import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from './Button'
import { copyToClipboard } from '../../lib/clipboard'

export function CopyButton({ value, label = 'Copy', size = 'sm', disabled }: { value: string; label?: string; size?: 'sm' | 'md'; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onClick = async () => {
    const ok = await copyToClipboard(value)
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1600)
  }

  return (
    <Button variant="secondary" size={size} disabled={disabled || !value} onClick={onClick} icon={state === 'copied' ? <Check size={13} /> : <Copy size={13} />}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  )
}
