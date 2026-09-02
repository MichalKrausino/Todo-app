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
//
// Zbylý artefakt: nad otevřeným sheetem (scrolluje se uvnitř) softwarový
// kompozitor občas domaluje pruh jeho obsahu i na horní okraj stránky —
// vypadá to jako zdvojená tlačítka. Než takový nález opravíš, ověř ho
// proti DOM (page.getByText(...).count()), ať nehoníš přelud.

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// playwright-core, ne playwright: samotný balík `playwright` si při instalaci
// stahuje prohlížeče, což v uzavřeném prostředí neprojde a skript pak spadne
// na ERR_MODULE_NOT_FOUND. Core má stejné API a prohlížeč mu podstrčíme níž.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

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
  'dnes dodělat bannery !!',
  'dnes revize textů na web',
  'dnes kontrola kampaně Meta',
  'dnes odpovědět na maily',
  'dnes sesumírovat výsledky',
  'dnes návrh rozpočtu',
  'dnes briefing týmu',
  'dnes korektura newsletteru',
  'dnes export podkladů pro tisk',
  'dnes schůzka k webu ve 16:00',
  'zítra fakturace za srpen',
  'zítra příprava podkladů na schůzku',
  'v pátek cenová nabídka',
]

const cekej = (ms) => new Promise((r) => setTimeout(r, ms))

// Softwarový renderer (viz ANGLE/SwiftShader níž) jede pomalu a pevná pauza
// mu nestačí — snímek pak chytne panel v půlce výjezdu a na obrázku straší
// druhá patička. Čeká se proto na doběhnutí animací, ne na stopky.
// `.breathe` běží pořád dokola, ta by se nedočkala nikdy — vynechává se.
async function klid(page) {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .every((a) => a.effect?.getTiming().iterations === Infinity),
      null,
      { timeout: 5000 },
    )
    .catch(() => {})
  await cekej(120)
}

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

// Úklid jen u plného běhu. S --jen/--rezim by smazání složky vzalo
// i snímky, které tenhle běh nevyrobí — a člověk by přišel o půlku
// srovnání zrovna ve chvíli, kdy si dělá rychlou kontrolu jedné věci.
if (!arg('jen') && !arg('rezim')) await rm(OUT, { recursive: true, force: true })
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
        // <input type="date"> se formátuje podle jazyka prohlížeče, ne podle
        // locale stránky — bez tohohle by termíny na snímcích svítily jako
        // 08/31/2026, i když na českém iPhonu vypadají jinak.
        '--lang=cs-CZ',
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
      await page.getByRole('button', { name: s.tab, exact: true }).click()
      await cekej(700)
      await klid(page)
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
        await klid(page)
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
    // Sheety: půlka appky bydlí v nich, takže bez nich je audit slepý.
    if (!arg('jen') && !has('prazdne')) {
      await page.getByRole('button', { name: 'Dnes', exact: true }).click()
      await cekej(600)
      const prvni = page.locator('main button').filter({ hasText: 'poslat report' }).first()
      if (await prvni.count()) {
        await prvni.click()
        await cekej(700)
        await klid(page)
        await page.screenshot({ path: path.join(OUT, `sheet-detail-${rezim}.png`) })
        console.log(path.join(OUT, `sheet-detail-${rezim}.png`))
        pocet++
        await page.keyboard.press('Escape')
        await cekej(500)
      }
      for (const [label, jmeno] of [['Hledat', 'hledani'], ['Synchronizace', 'sync']]) {
        const b = page.locator(`button[aria-label^="${label}"]`).first()
        if (!(await b.count())) continue
        await b.click()
        await cekej(700)
        await klid(page)
        await page.screenshot({ path: path.join(OUT, `sheet-${jmeno}-${rezim}.png`) })
        console.log(path.join(OUT, `sheet-${jmeno}-${rezim}.png`))
        pocet++
        await page.keyboard.press('Escape')
        await cekej(500)
      }
    }

    await browser.close()
  }
} finally {
  server.kill()
}

console.log(`\nhotovo — ${pocet} snímků v ${OUT}/`)
