// ProgressiveBlur — podle motion-primitives (ibelick/motion-primitives,
// components/core/progressive-blur.tsx). Několik vrstev backdrop-filter,
// každá s posunutou maskou a silnějším rozostřením, takže se obsah na
// hraně rolovací plochy rozpustí plynule; jedna vrstva by udělala jen
// mléčný pruh. Bez závislosti na motion — vrstvy se nehýbou.
import { cn } from '../../lib/cn'

const UHEL = { top: 0, right: 90, bottom: 180, left: 270 } as const

export function ProgressiveBlur({
  direction = 'bottom',
  blurLayers = 6,
  blurIntensity = 0.8,
  className,
  style,
}: {
  direction?: keyof typeof UHEL
  blurLayers?: number
  blurIntensity?: number
  className?: string
  style?: React.CSSProperties
}) {
  const vrstev = Math.max(blurLayers, 2)
  const dil = 1 / (vrstev + 1)
  return (
    <div aria-hidden="true" className={cn('veil pointer-events-none', className)} style={style}>
      {Array.from({ length: vrstev }).map((_, i) => {
        const stops = [i * dil, (i + 1) * dil, (i + 2) * dil, (i + 3) * dil]
          .map((p, j) => `rgba(0, 0, 0, ${j === 1 || j === 2 ? 1 : 0}) ${p * 100}%`)
          .join(', ')
        const maska = `linear-gradient(${UHEL[direction]}deg, ${stops})`
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              maskImage: maska,
              WebkitMaskImage: maska,
              backdropFilter: `blur(${i * blurIntensity}px)`,
              WebkitBackdropFilter: `blur(${i * blurIntensity}px)`,
            }}
          />
        )
      })}
    </div>
  )
}
