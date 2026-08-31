// Náhled appky jako obrázky — aby šel vzhled posoudit, ne jen odhadnout.
//
// Postaví build, zvedne preview server, projede obrazovky v obou režimech
// na rozměru iPhonu a uloží PNG do .snimky/.
//
// Spuštění:  npm run nahled
//   --prazdne      nezakládat ukázkové úkoly (obrazovky zůstanou prázdné)
//   --jen=dnes     jen jedna obrazovka (dnes | plan | klienti)
//   --rezim=dark   jen jeden barevný režim (light | dark)
//
// POZOR na renderer: bez GPU (CI, kontejner) vykresluje Chromium
// backdrop-filter po dlaždicích — sklo doku pak vyjde rozmazané jen
// v pruhu uprostřed a zbytek ostrý, takže by screenshot lhal.
// Vynucený softwarový ANGLE/SwiftShader to spraví a rozmaže celou plochu
// stejně jako Safari na zařízení. Proto ty přepínače níž nejsou kosmetika.

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const OUT = '.snimky'
const PORT = 4319
const BASE = process.env.BASE_PATH ?? '/'
const URL = `http://127.0.0.1:${PORT}${BASE.endsWith('/') ? BASE : BASE + '/'}`

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const has = (n) => process.argv.includes(`--${n}`)

const SCREENS = [
  { id: 'dnes', tab: 'Dnes' },
  { id: 'plan', tab: 'Plán' },
  { id: 'klienti', tab: 'Klienti' },
]

// Přes rychlé zadávání, ne přímo do IndexedDB — projde tím český parser,
// takže úkoly vypadají jako doopravdy zadané (termíny, priority, klient).
// Dnešních je schválně tolik, aby seznam přetekl a při scrollu procházel
// POD dokem — jinak by sklo nemělo co lámat a snímek by o něm nic neřekl.
const UKOLY = [
  'dnes poslat report Alze !!',
  'dnes zavolat Pepovi do 14:00',
  'dnes dodělat bannery !',
  'dnes revize textů na web',
  'dnes kontrola kampaně Meta',
  'dnes odpovědět na maily',
  'dnes sesumírovat výsledky',
  'dnes návrh rozpočtu !',
  'dnes briefing týmu',
  'dnes korektura newsletteru',
  'dnes export podkladů pro tisk',
  'dnes schůzka k webu ve 16:00',
  'zítra fakturace za srpen',
  'zítra příprava podkladů na schůzku',
  'v pátek cenová nabídka',
]

const cekej = (ms) => new Promise((r) => setTimeout(r, ms))

async function spustPreview() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'ignore',
    env: process.env,
  })
  for (let i = 0; i < 40; i++) {
    await cekej(250)
    try {
      const r = await fetch(URL)
      if (r.ok) return p
    } catch {
      /* server ještě nenaběhl */
    }
  }
  p.kill()
  throw new Error(`preview server se nezvedl na ${URL}`)
}

async function zaloz(page) {
  for (const t of UKOLY) {
    await page.click('button[aria-label="Nový úkol"]')
    await cekej(200)
    const pole = page.locator('.dock input, .dock textarea').first()
    await pole.fill(t)
    await pole.press('Enter')
    await cekej(220)
    const zavrit = page.locator('button[aria-label="Zavřít zadávání"]')
    if (await zavrit.count()) {
      await zavrit.click()
      await cekej(160)
    }
  }
  await cekej(5500) // ať odejdou potvrzovací toasty
}

const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' })
await new Promise((r, j) =>
  build.on('exit', (c) => (c === 0 ? r() : j(new Error(`build skončil s kódem ${c}`)))),
)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const server = await spustPreview()
let pocet = 0

try {
  const rezimy = arg('rezim') ? [arg('rezim')] : ['light', 'dark']
  const obrazovky = arg('jen') ? SCREENS.filter((s) => s.id === arg('jen')) : SCREENS

  for (const rezim of rezimy) {
    const browser = await chromium.launch({
      // Cesta k prohlížeči: v tomhle kontejneru je předinstalovaný, jinde
      // si ho Playwright najde sám (`npx playwright install chromium`).
      ...(existsSync('/opt/pw-browsers/chromium')
        ? { executablePath: '/opt/pw-browsers/chromium' }
        : {}),
      args: [
        // viz poznámka o rendereru nahoře — bez tohohle sklo doku lže
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    })
    const page = await (
      await browser.newContext({
        viewport: { width: 390, height: 844 }, // iPhone 14/15/16
        deviceScaleFactor: 3,
        colorScheme: rezim,
        locale: 'cs-CZ',
        timezoneId: 'Europe/Prague',
      })
    ).newPage()

    await page.goto(URL, { waitUntil: 'networkidle' })
    await cekej(1000)
    if (!has('prazdne')) await zaloz(page)

    for (const s of obrazovky) {
      await page.click(`button:has-text("${s.tab}")`)
      await cekej(700)
      const soubor = path.join(OUT, `${s.id}-${rezim}.png`)
      await page.screenshot({ path: soubor })
      console.log(soubor)
      pocet++

      // Detail doku: sklo se pozná jen tam, kde pod ním něco prochází,
      // takže obsah odscrollujeme doprostřed a přiblížíme spodní pruh.
      if (s.id === 'dnes' && !has('prazdne')) {
        await page.evaluate(() => {
          const kandidati = [...document.querySelectorAll('*')].filter(
            (e) =>
              e.scrollHeight > e.clientHeight + 40 &&
              getComputedStyle(e).overflowY !== 'visible',
          )
          const sc = kandidati.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
          if (sc) sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * 0.45)
        })
        await cekej(600)
        const box = await (await page.$('.dock')).boundingBox()
        const detail = path.join(OUT, `dok-${rezim}.png`)
        await page.screenshot({
          path: detail,
          clip: { x: 0, y: box.y - 90, width: 390, height: box.height + 100 },
        })
        console.log(detail)
        pocet++
      }
    }
    await browser.close()
  }
} finally {
  server.kill()
}

console.log(`\nhotovo — ${pocet} snímků v ${OUT}/`)
