import { useEffect, useRef } from 'react'
import './AnimatedBackground.css'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

const PARTICLE_COUNT = 46
const LINK_DISTANCE = 130
const SPEED = 0.12

export function AnimatedBackground({ variant = 'public' }: { variant?: 'public' | 'workspace' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // Workspace variant skips the particle network entirely — dashboards
    // prioritize readability and information density over visual flourish;
    // this is meant to be a genuinely restrained version, not "the same
    // effect, dimmer." A few slow-drifting blobs (in the JSX below) is the
    // ceiling for this variant.
    if (variant === 'workspace') return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Respect prefers-reduced-motion fully — no canvas animation loop at
    // all, not just a slower one. The CSS blob layer (AnimatedBackground.css)
    // has its own matching media query to freeze those too.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    let width = 0
    let height = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2) // capped — no benefit past 2x for a background effect, real cost above it
    let particles: Particle[] = []
    let raf = 0

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const seed = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
      }))
    }

    const step = () => {
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
      }
      ctx.fillStyle = 'rgba(120, 145, 255, 0.45)'
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dist = Math.hypot(a.x - b.x, a.y - b.y)
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(120, 145, 255, ${0.16 * (1 - dist / LINK_DISTANCE)})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(step)
    }

    resize()
    seed()
    raf = requestAnimationFrame(step)
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="ctf-animated-bg" aria-hidden="true">
      <div className="ctf-animated-bg__blob ctf-animated-bg__blob--1" />
      <div className="ctf-animated-bg__blob ctf-animated-bg__blob--2" />
      <div className="ctf-animated-bg__blob ctf-animated-bg__blob--3" />
      <canvas ref={canvasRef} className="ctf-animated-bg__canvas" />
    </div>
  )
}
