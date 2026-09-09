// ClickSpark — podle react-bits (src/ts-tailwind/Animations/ClickSpark):
// z místa ťuknutí vyletí pár čárek na plátně nad obsahem. V appce kolem
// doku: ťuknutí na záložku nebo plusko má hmatovou odezvu bez haptiky.
import { useCallback, useEffect, useRef } from 'react'

type Jiskra = { x: number; y: number; angle: number; start: number }

export function ClickSpark({
  sparkColor = 'var(--color-accent)',
  sparkSize = 8,
  sparkRadius = 14,
  sparkCount = 8,
  duration = 380,
  extraScale = 1,
  className,
  children,
}: {
  sparkColor?: string
  sparkSize?: number
  sparkRadius?: number
  sparkCount?: number
  duration?: number
  extraScale?: number
  className?: string
  children?: React.ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const jiskry = useRef<Jiskra[]>([])
  const bezi = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const dpr = window.devicePixelRatio || 1
    const prizpusob = () => {
      const { width, height } = parent.getBoundingClientRect()
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    const ro = new ResizeObserver(prizpusob)
    ro.observe(parent)
    prizpusob()
    return () => ro.disconnect()
  }, [])

  const kresli = useCallback(
    (cas: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const barva = getComputedStyle(canvas).getPropertyValue('color') || sparkColor
      jiskry.current = jiskry.current.filter((j) => {
        const t = (cas - j.start) / duration
        if (t >= 1) return false
        const ease = t * (2 - t)
        const dist = ease * sparkRadius * extraScale
        const delka = sparkSize * (1 - ease)
        const x1 = j.x + dist * Math.cos(j.angle)
        const y1 = j.y + dist * Math.sin(j.angle)
        const x2 = j.x + (dist + delka) * Math.cos(j.angle)
        const y2 = j.y + (dist + delka) * Math.sin(j.angle)
        ctx.strokeStyle = barva
        ctx.lineWidth = 2 * dpr
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1 * dpr, y1 * dpr)
        ctx.lineTo(x2 * dpr, y2 * dpr)
        ctx.stroke()
        return true
      })
      bezi.current = jiskry.current.length ? requestAnimationFrame(kresli) : null
    },
    [duration, extraScale, sparkColor, sparkRadius, sparkSize],
  )

  const klik = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const start = performance.now()
    for (let i = 0; i < sparkCount; i++) {
      jiskry.current.push({ x, y, angle: (2 * Math.PI * i) / sparkCount, start })
    }
    if (bezi.current === null) bezi.current = requestAnimationFrame(kresli)
    // Pojistka: když prohlížeč rAF přiškrtí (karta v pozadí, snímek bez
    // GPU), poslední snímek by na plátně zůstal viset.
    window.setTimeout(() => {
      if (jiskry.current.every((j) => performance.now() - j.start >= duration)) {
        jiskry.current = []
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      }
    }, duration + 80)
  }

  return (
    <div className={className} onClickCapture={klik}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{ color: sparkColor }}
      />
      {children}
    </div>
  )
}
