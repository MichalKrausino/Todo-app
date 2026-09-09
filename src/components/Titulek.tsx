// Velký titulek obrazovky. Písmena se vynořují jedno po druhém
// (třída .glyph-in v index.css); pro čtečku i pro testy zůstává text
// jeden kus — spany jsou aria-hidden a h1 nese aria-label.
export function Titulek({ text, className = '' }: { text: string; className?: string }) {
  return (
    <h1 className={`display text-[2.1rem] font-semibold leading-tight ${className}`} aria-label={text}>
      {[...text].map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="glyph-in"
          style={{ '--stagger': i } as React.CSSProperties}
        >
          {ch === ' ' ? '\u00a0' : ch}
        </span>
      ))}
    </h1>
  )
}
