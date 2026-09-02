// Audit UI: prochází obrazovky i panely a měří, co jde změřit —
// odsazení zleva a zprava, hrany prvků nad sebou, okraje sekcí, kulatost
// ikon a velikost cílů pro prst. Oko tyhle rozdíly přehlédne, měřítko ne.
//
//   node scripts/audit-ui.mjs   (nebo npm run audit:ui)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url)); const { chromium } = require('playwright-core')
const ROOT = new URL('../dist', import.meta.url).pathname
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}
const server=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]).replace(/^\/Todo-app/,'');if(p===''||p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(200,{'Content-Type':'text/html'});return r.end(fs.readFileSync(path.join(ROOT,'index.html')))}r.writeHead(200,{'Content-Type':T[path.extname(f)]??'application/octet-stream'});r.end(fs.readFileSync(f))})
await new Promise(r=>server.listen(4192,r))
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'})
// Šířka jde nastavit z příkazové řádky: --sirka=320 je iPhone SE, na němž
// se rozsype to, co na 390 ještě projde. Bez ní se měří 390 (iPhone 15).
const SIRKA = Number(process.argv.find((a) => a.startsWith('--sirka='))?.split('=')[1] ?? 390)
const page=await b.newPage({viewport:{width:SIRKA,height:844}})
const konzole = []
page.on('pageerror', (e) => konzole.push('vyjimka: ' + e.message.split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') konzole.push('console.error: ' + m.text().slice(0, 120)) })
await page.goto('http://localhost:4192/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(500)

// --- data, ať je co měřit ---
await page.evaluate(async () => {
  const req = indexedDB.open('todo')
  const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
  const t = new Date().toISOString()
  const den = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const put = (store, rows) => new Promise((res) => {
    const tx = db.transaction(store, 'readwrite')
    rows.forEach((r) => tx.objectStore(store).put(r))
    tx.oncomplete = res
  })
  await put('clients', [
    { id:'c1', createdAt:t, updatedAt:t, name:'V Bílém', color:'#00C7BE', kind:'client', status:'active', templateIds:[] },
    { id:'c2', createdAt:t, updatedAt:t, name:'Ondra Fréhar', color:'#AF52DE', kind:'client', status:'active', templateIds:[] },
    { id:'c3', createdAt:t, updatedAt:t, name:'Panelora', color:'#3a6df0', kind:'client', status:'active', templateIds:[] },
  ])
  await put('projects', [
    { id:'p1', createdAt:t, updatedAt:t, clientId:'c1', name:'Google Ads', status:'active', order:0 },
    { id:'p2', createdAt:t, updatedAt:t, clientId:'c1', name:'Meta Ads', status:'active', order:1, goal:'Snížit PNO pod 12 %', dueDate: den(20) },
  ])
  await put('tasks', [
    { id:'t1', createdAt:t, updatedAt:t, title:'Optimalizovat kampaň', priority:'high', status:'active', order:0, clientId:'c1', projectId:'p1', dueDate:den(-1) },
    { id:'t2', createdAt:t, updatedAt:t, title:'Vyřešit problém s Meta Business účtem', priority:'normal', status:'active', order:0, clientId:'c1', projectId:'p2', dueDate:den(-2), subtasks:[{id:'s1',title:'Ověřit přístupy',done:false},{id:'s2',title:'Napsat podpoře',done:false}], todoistId:'9001' },
    { id:'t3', createdAt:t, updatedAt:t, title:'Zavolat Ondrovi', priority:'normal', status:'active', order:0, clientId:'c2', dueDate:den(0), dueTime:'14:00' },
    { id:'t4', createdAt:t, updatedAt:t, title:'Připravit report kampaní za srpen', priority:'critical', status:'active', order:0, clientId:'c3', scheduledFor:den(0), pinnedFor:den(0) },
    { id:'t5', createdAt:t, updatedAt:t, title:'Nachystat podklady pro fakturaci', priority:'low', status:'active', order:0, dueDate:den(2) },
    { id:'t6', createdAt:t, updatedAt:t, title:'Hotový úkol', priority:'normal', status:'done', order:0, clientId:'c1', completedAt:t, dueDate:den(0) },
  ])
})
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700)

const nalezy = []

// Tři měření, každé na jinou vadu:
//  A) prvek, který má vyplnit rodiče, má vlevo i vpravo stejnou mezeru
//  B) sekce na obrazovce mají všechny stejný okraj stránky
//  C) nic nepřetéká do stran
// V tmavém režimu se geometrie neměří znovu — je stejná. Projde se jen
// kontrast, protože tmavá paleta má vlastní hodnoty a vlastní podklady.
async function zmer(kde, root = 'main', jenKontrast = false) {
  const rows = await page.evaluate(({ root, jenKontrast, sirka }) => {
    const out = []
    const oblast = document.querySelector(root)
    if (!oblast) return out
    const popis = (el) => {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34)
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (t ? ' \u201e' + t + '\u201c' : '')
    }
    const videt = (el) => {
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 4
    }

    for (const el of jenKontrast ? [] : oblast.querySelectorAll('*')) {
      if (!videt(el)) continue
      const rodic = el.parentElement
      if (!rodic || rodic === oblast) continue
      const rs = getComputedStyle(rodic)
      if (rs.display.includes('flex') || rs.display.includes('grid')) continue
      const es = getComputedStyle(el)
      if (es.position === 'absolute') continue
      // Řádkový box je široký jako jeho text, ne jako místo, které dostal —
      // u kratší věty vyjde „mezera vpravo", která na obrazovce není vidět.
      if (es.display === 'inline') continue
      const r = el.getBoundingClientRect(), p = rodic.getBoundingClientRect()
      if (p.width === 0 || r.width < p.width * 0.7) continue
      const vlevo = Math.round(r.left - p.left), vpravo = Math.round(p.right - r.right)
      if (Math.abs(vlevo - vpravo) > 1) out.push({ typ: 'v ramecku', popis: popis(el), vlevo, vpravo })
    }

    for (const el of jenKontrast ? [] : oblast.querySelectorAll('button, a')) {
      if (!videt(el)) continue
      const s2 = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      // Kulaté MUSÍ být čtvercové jen u tlačítek bez textu (ikona) —
      // pilulka s popiskem je širší záměrně.
      const bezTextu = (el.textContent || '').trim() === ''
      const kulate = parseFloat(s2.borderRadius) >= Math.min(r.width, r.height) / 2 - 0.5
      if (bezTextu && kulate && r.width > 16 && Math.abs(r.width - r.height) > 1) {
        out.push({ typ: 'kulate', popis: popis(el) + ' ikona je ' + Math.round(r.width) + '×' + Math.round(r.height), vlevo: Math.round(r.width), vpravo: Math.round(r.height) })
      }
      // Cíl na prst: pod 30 px se to na telefonu trefuje mizerně.
      if (r.width > 0 && (r.width < 30 || r.height < 30)) {
        out.push({ typ: 'maly cil', popis: popis(el) + ' je ' + Math.round(r.width) + '×' + Math.round(r.height), vlevo: Math.round(r.width), vpravo: Math.round(r.height) })
      }
      const pl = parseFloat(s2.paddingLeft), pr = parseFloat(s2.paddingRight)
      if (Math.abs(pl - pr) > 1 && el.children.length === 0) {
        out.push({ typ: 'odsazeni', popis: popis(el), vlevo: Math.round(pl), vpravo: Math.round(pr) })
      }
    }

    // G) Prvky nad sebou musí sdílet levou i pravou hranu. Tohle je ta
    //    nesymetrie, kterou oko chytne jako první: panel odsazený jinak
    //    než řádka pod ním. Měření vůči rodiči ji neodhalí, protože každý
    //    prvek je ve svém rodiči vycentrovaný správně.
    for (const rodic of jenKontrast ? [] : oblast.querySelectorAll('*')) {
      const rs2 = getComputedStyle(rodic)
      if (rs2.display.includes('flex') || rs2.display.includes('grid')) continue
      const p = rodic.getBoundingClientRect()
      if (p.width < 120) continue
      const deti = [...rodic.children].filter((c) => {
        if (!videt(c)) return false
        const cs2 = getComputedStyle(c)
        if (cs2.position === 'absolute') return false
        if (cs2.display === 'inline') return false
        const r = c.getBoundingClientRect()
        return r.width > p.width * 0.5
      })
      if (deti.length < 2) continue
      // Porovnávají se hrany rámečku. Výjimka: vodorovně scrollující řádky
      // schválně přetékají k okraji zápornou marží, aby pilulky mohly dojet
      // až ke kraji — u nich se bere hrana obsahu, jinak by hlásily rozdíl,
      // který není vidět.
      const hrany = new Map()
      for (const c of deti) {
        const r = c.getBoundingClientRect()
        const cs = getComputedStyle(c)
        const ml = parseFloat(cs.marginLeft), mr = parseFloat(cs.marginRight)
        const vlevo = ml < 0 ? r.left + parseFloat(cs.paddingLeft) : r.left
        const vpravo = mr < 0 ? r.right - parseFloat(cs.paddingRight) : r.right
        const klic = Math.round(vlevo) + '/' + Math.round(vpravo)
        hrany.set(klic, [...(hrany.get(klic) || []), popis(c)])
      }
      if (hrany.size > 1) {
        const rozpis = [...hrany.entries()].map(([k, v]) => k + ' ' + v[0]).join('   |   ')
        out.push({ typ: 'hrany nad sebou', popis: popis(rodic) + '  ->  ' + rozpis, vlevo: 0, vpravo: 0 })
      }
    }

    // H) Ovládací prvek musí mít název, který přečte odečítač.
    for (const el of jenKontrast ? [] : oblast.querySelectorAll('button, a, input, select, textarea')) {
      if (!videt(el)) continue
      const jmeno = (el.getAttribute('aria-label') || el.getAttribute('title') ||
        (el.textContent || '').trim() ||
        (el.labels && el.labels.length ? el.labels[0].textContent : '') || '').trim()
      if (!jmeno) out.push({ typ: 'bez nazvu', popis: popis(el), vlevo: 0, vpravo: 0 })
    }

    // I) Kontrast textu vůči skutečnému podkladu (WCAG AA: 4.5, velké 3).
    //    Barvy se nečtou z řetězce: Tailwind zapisuje průhlednost přes
    //    color-mix() a prohlížeč ji vrací jako oklab(), z něhož by regulární
    //    výraz vytáhl čísla v úplně jiném rozsahu. Plátno to vykreslí a
    //    přečte se skutečný pixel — a rovnou i podložený, takže poloprů-
    //    hledný text se změří tak, jak ho oko vidí.
    const platno = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const naRGB = (css, pod) => {
      platno.clearRect(0, 0, 1, 1)
      if (pod) { platno.fillStyle = 'rgb(' + pod.join(',') + ')'; platno.fillRect(0, 0, 1, 1) }
      platno.fillStyle = '#000'
      platno.fillStyle = css
      platno.fillRect(0, 0, 1, 1)
      const d = platno.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2], d[3] / 255]
    }
    const kanal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    const jas = (c) => { const [r, g, b] = c; return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b) }
    const podklad = (el) => {
      const vrstvy = []
      let n = el
      while (n && n !== document.documentElement) {
        const c = naRGB(getComputedStyle(n).backgroundColor)
        if (c[3] > 0.99) {
          // od nejspodnější neprůhledné plochy nahoru se poloprůhledné
          // vrstvy nad ní postupně podloží
          let v = [c[0], c[1], c[2]]
          for (let i = vrstvy.length - 1; i >= 0; i--) v = naRGB(vrstvy[i], v)
          return [v[0], v[1], v[2]]
        }
        if (c[3] > 0.01) vrstvy.push(getComputedStyle(n).backgroundColor)
        n = n.parentElement
      }
      return [255, 255, 255]
    }
    for (const el of oblast.querySelectorAll('*')) {
      if (!videt(el)) continue
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      const cs = getComputedStyle(el)
      const pod = podklad(el)
      const barva = naRGB(cs.color, pod)
      if (barva[3] < 0.05) continue
      const velikost = parseFloat(cs.fontSize)
      const tucne = parseInt(cs.fontWeight, 10) >= 600
      const velky = velikost >= 24 || (velikost >= 18.66 && tucne)
      const l1 = jas(barva), l2 = jas(pod)
      const pomer = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const min = velky ? 3 : 4.5
      if (pomer < min - 0.05) {
        out.push({ typ: 'kontrast', popis: popis(el) + '  ' + pomer.toFixed(2) + ':1 (min ' + min + ', ' + Math.round(velikost) + 'px)', vlevo: 0, vpravo: 0 })
      }
    }

    const okraje = new Map()
    const sekce = jenKontrast || !oblast.children[0] ? [] : oblast.children[0].children
    for (const el of sekce) {
      if (!videt(el)) continue
      const r = el.getBoundingClientRect()
      const klic = Math.round(r.left) + '/' + Math.round(sirka - r.right)
      okraje.set(klic, [...(okraje.get(klic) || []), popis(el)])
    }
    if (okraje.size > 1) {
      for (const [klic, kdo] of okraje) {
        out.push({ typ: 'okraj sekce', popis: klic + '  ' + kdo.slice(0, 2).join(' | '), vlevo: 0, vpravo: 0 })
      }
    }
    return out
  }, { root, jenKontrast, sirka: SIRKA })
  for (const r of rows) nalezy.push({ kde, ...r })
}

async function sirka(kde) {
  const p = await page.evaluate(() => ({
    scroll: document.querySelector('main') ? document.querySelector('main').scrollWidth : 0,
    klient: document.querySelector('main') ? document.querySelector('main').clientWidth : 0,
  }))
  if (p.scroll > p.klient + 1) {
    nalezy.push({ kde, typ: 'preteka', popis: 'obsah pretece do stran (' + p.scroll + ' > ' + p.klient + ')', vlevo: 0, vpravo: 0 })
  }
}

const obrazovky = [
  ['Dnes', async () => {}],
  ['Plán', async () => { await page.getByRole('button', { name: 'Plán' }).click(); await page.waitForTimeout(500) }],
  ['Klienti', async () => { await page.getByRole('button', { name: 'Klienti' }).click(); await page.waitForTimeout(500) }],
  ['Detail klienta', async () => { await page.getByText('V Bílém').first().click(); await page.waitForTimeout(500) }],
]

const otevriNastaveni = () => page.getByRole('button', { name: /synchronizace|sync|nastaven/i }).first().click()
const panely = [
  ['Nastaveni', async () => { await otevriNastaveni() }, 1],
  ['Napoveda', async () => { await otevriNastaveni(); await page.waitForTimeout(450); await page.getByRole('button', { name: /Jak to funguje/ }).click() }, 2],
  ['Todoist', async () => { await otevriNastaveni(); await page.waitForTimeout(450); await page.getByRole('button', { name: /^Todoist/ }).click() }, 2],
  ['Hledani', async () => { await page.getByRole('button', { name: 'Hledat' }).click() }, 1],
  ['Detail ukolu', async () => { await page.getByText('Zavolat Ondrovi').first().click() }, 1],
  ['Sablony', async () => { await page.getByRole('button', { name: 'Klienti' }).click(); await page.waitForTimeout(450); await page.getByRole('button', { name: /Šablony/ }).click() }, 1],
]
// Celý průchod se pouští dvakrát: světlá paleta se měří celá, tmavá jen
// na kontrast. Tmavý režim má vlastní hodnoty tokenů a vlastní podklady,
// takže se v něm dá pokazit čitelnost, aniž by se ve světlém cokoli hnulo.
async function projdi(znacka, jenKontrast) {
  const jmeno = (kde) => (znacka ? znacka + ' ' + kde : kde)
  await page.getByRole('button', { name: 'Dnes' }).click(); await page.waitForTimeout(400)
  for (const [kde, jdi] of obrazovky) {
    await jdi()
    await zmer(jmeno(kde), 'main', jenKontrast)
    if (!jenKontrast) await sirka(jmeno(kde))
  }
  await page.getByRole('button', { name: 'Dnes' }).click(); await page.waitForTimeout(400)
  for (const [kde, otevri, kolikZavrit] of panely) {
    try {
      await otevri(); await page.waitForTimeout(600)
      await zmer(jmeno(kde), '.sheet-panel', jenKontrast)
      for (let i = 0; i < kolikZavrit; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
    } catch (e) { nalezy.push({ kde: jmeno(kde), typ: 'chyba', popis: 'neslo otevrit: ' + e.message.split('\n')[0], vlevo: 0, vpravo: 0 }) }
    await page.getByRole('button', { name: 'Dnes' }).click(); await page.waitForTimeout(400)
  }
  await page.getByRole('button', { name: 'Nový úkol' }).click(); await page.waitForTimeout(400)
  await zmer(jmeno('Dok'), 'footer', jenKontrast)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
}

await projdi('', false)
await page.evaluate(() => {
  localStorage.setItem('todo.theme', 'dark')
  document.documentElement.dataset.theme = 'dark'
})
await page.waitForTimeout(400)
await projdi('[tma]', true)

// Vědomé výjimky: hlavička detailu klienta se uhýbá plovoucím ikonám
// vpravo nahoře (header má pr-24), aby jméno neběželo pod lupu a obláček.
const povoleno = (n) => n.kde === 'Detail klienta' && n.typ === 'v ramecku' && n.vpravo === 96
for (const k of konzole) nalezy.push({ kde: 'Konzole', typ: 'konzole', popis: k, vlevo: 0, vpravo: 0 })
const zbyva = nalezy.filter((n) => !povoleno(n))
console.log(zbyva.length === 0 ? 'Vse symetricke a na prst dost velke.' : 'Nalezy (' + zbyva.length + '):')
nalezy.length = 0
nalezy.push(...zbyva)
const podle = {}
for (const n of nalezy) (podle[n.kde] ??= []).push(n)
for (const [kde, list] of Object.entries(podle)) {
  console.log(`\n— ${kde}`)
  for (const n of list) {
    const cislo = n.typ === 'maly cil' || n.typ === 'kulate' || n.typ === 'v ramecku' || n.typ === 'odsazeni'
    console.log('   ' + (cislo ? String(n.vlevo).padStart(3) + ' /' + String(n.vpravo).padStart(4) + ' ' : n.typ.padEnd(16)) + ' ' + n.popis)
  }
}
await b.close(); server.close()

process.exit(nalezy.length ? 1 : 0)
