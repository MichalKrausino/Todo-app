// Ikony appky z jedné předlohy.
//
//   node scripts/ikony.mjs   (nebo npm run ikony)
//
// Značka je **pruh dne** — týž obrázek, kterým appka kreslí den v Plánu a
// na Dnes: délka je čas, barvy jsou klienti, světlá kolej je zbytek dne.
// Tři pruhy pod sebou jsou Plán v malém. Dřív tu byla bílá fajfka v modrém
// čtverci: to má na ploše každá druhá appka a neřeklo to nic o tom, co
// tahle umí navíc. Barvy jsou první tři, které appka sama rozdá novým
// klientům (`AUTO_ORDER` v `src/lib/labels.ts`) — modrá, oranžová, zelená.
//
// Dlaždice je `--color-paper`, ne akcentní modrá: splash z manifestu má
// touž barvu, takže ikona a startovní plocha jsou jedna souvislá plocha.
// Tři podoby, každá z jiného důvodu:
//   favicon.svg / icon-*.png  — zaoblená dlaždice (PWA si ji nekrouží)
//   apple-touch-icon.png      — bez zaoblení, iOS si maskuje sám
//   maskable-512.png          — obsah stažený do bezpečného kruhu (80 %)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { chromium } = require('playwright-core')

const PUBLIC = new URL('../public', import.meta.url).pathname
const PAPIR = '#f4f4f1'
const KOLEJ = '#dcdad4'
const [MODRA, ORANZ, ZELENA] = ['#007AFF', '#FF9500', '#34C759']

/** Tři dny pod sebou: kolej přes celou šířku, na ní díly v barvách klientů. */
function znacka({ rx = 14, inset = 0 } = {}) {
  const dny = [
    [MODRA, 20],
    [ZELENA, 12],
    [ORANZ, 14],
    [MODRA, 9],
    [ZELENA, 26],
  ]
  const rady = [dny.slice(0, 2), dny.slice(2, 4), dny.slice(4)]
  const m = 10 + inset // levý okraj
  const sirka = 44 - inset * 2
  const vyska = 6 - (inset > 0 ? 1 : 0)
  const stred = [18, 32, 46].map((y) => 32 + (y - 32) * (1 - inset / 18))
  const telo = rady
    .map((dily, i) => {
      const y = stred[i] - vyska / 2
      let x = m
      const celkem = dily.reduce((s, [, w]) => s + w, 0) + dily.length - 1
      const segmenty = dily
        .map(([barva, w]) => {
          const sirkaDilu = (w / celkem) * (sirka * (celkem / 44))
          const s = `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${sirkaDilu.toFixed(2)}" height="${vyska}" fill="${barva}"/>`
          x += sirkaDilu + 1
          return s
        })
        .join('')
      return (
        `<rect x="${m}" y="${y.toFixed(2)}" width="${sirka}" height="${vyska}" rx="${vyska / 2}" fill="${KOLEJ}"/>` +
        `<g clip-path="url(#k${i})">${segmenty}</g>` +
        `<clipPath id="k${i}"><rect x="${m}" y="${y.toFixed(2)}" width="${sirka}" height="${vyska}" rx="${vyska / 2}"/></clipPath>`
      )
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${PAPIR}"/>${telo}</svg>`
}

const predloha = znacka()
fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), predloha + '\n')

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const uloz = async (svg, jmeno, px) => {
  const page = await b.newPage({ viewport: { width: px, height: px } })
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`,
  )
  await page.screenshot({ path: path.join(PUBLIC, jmeno), omitBackground: true })
  await page.close()
  console.log(' ', jmeno, `${px}×${px}`)
}
await uloz(predloha, 'icon-192.png', 192)
await uloz(predloha, 'icon-512.png', 512)
await uloz(znacka({ rx: 0 }), 'apple-touch-icon.png', 180)
await uloz(znacka({ rx: 0, inset: 6 }), 'maskable-512.png', 512)
await b.close()
console.log('hotovo — předloha je public/favicon.svg')
