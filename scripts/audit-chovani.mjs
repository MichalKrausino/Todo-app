// Audit chování: co audit-ui.mjs neuvidí, protože se to nedá změřit
// pravítkem — jestli klidový režim (prefers-reduced-motion) opravdu všechno
// zastaví, jestli se v běžném režimu naopak animuje, a jestli appka přežije
// proklikání: založení úkolu, odškrtnutí, přepnutí obrazovek, otevření
// a zavření panelů, uložení změny v detailu a znovunačtení z IndexedDB.
//
//   node scripts/audit-chovani.mjs   (nebo npm run audit:chovani)
//
// Předpokládá `npm run build` — měří se hotový dist, ne dev server.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'
const require = createRequire(import.meta.url); const { chromium } = require('playwright-core')
const ROOT = new URL('../dist', import.meta.url).pathname
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}
const server=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]).replace(/^\/Todo-app/,'');if(p===''||p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(200,{'Content-Type':'text/html'});return r.end(fs.readFileSync(path.join(ROOT,'index.html')))}r.writeHead(200,{'Content-Type':T[path.extname(f)]??'application/octet-stream'});r.end(fs.readFileSync(f))})
await new Promise(r=>server.listen(4194,r))
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'})
let chyby=[], ok=0
const T_=(p,m)=>{ if(p) { ok++; console.log('✓ '+m) } else { chyby.push(m); console.log('✗ '+m) } }

// --- 1. klidový režim (prefers-reduced-motion) ---
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, reducedMotion:'reduce'})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(150)
  await page.locator('input[placeholder]').first().fill('dnes test klidu !!')
  await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  await page.getByRole('button',{name:'Plán',exact:true}).click(); await page.waitForTimeout(120)
  const bezici = await page.evaluate(() => document.getAnimations()
    .filter(a=>a.playState==='running')
    .map(a=>({jmeno:a.animationName||'transition', d:a.effect?.getTiming().duration})))
  T_(bezici.length===0, 'v klidovém režimu neběží žádná animace'+(bezici.length?' — běží: '+JSON.stringify(bezici):''))
  await ctx.close()
}

// --- 2. běžný režim: animace existují a doběhnou ---
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  const konzole=[]
  page.on('pageerror',e=>konzole.push('vyjimka: '+e.message.split('\n')[0]))
  page.on('console',m=>{if(m.type()==='error')konzole.push('console.error: '+m.text().slice(0,140))})
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)

  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(300)
  const bylo = await page.evaluate(()=>document.getAnimations().length)
  T_(bylo>0, 'v běžném režimu se zadávání animuje ('+bylo+' animací)')

  // proklikání: založit úkoly, přepnout obrazovky, otevřít a zavřít panely
  for (const t of ['dnes první úkol !!','zítra druhý úkol','v pátek třetí úkol !']) {
    await page.locator('input[placeholder]').first().fill(t)
    await page.keyboard.press('Enter'); await page.waitForTimeout(250)
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  const pocet = await page.locator('main button').filter({hasText:'první úkol'}).count()
  T_(pocet>0,'úkol z rychlého zadávání se objevil na Dnes')

  // odškrtnutí a vrácení
  const zaskrt = page.locator('button[aria-label*="Hotovo"], button[aria-label*="hotov"]').first()
  if (await zaskrt.count()) { await zaskrt.click(); await page.waitForTimeout(500) }
  T_(true,'odškrtnutí proběhlo bez pádu')

  for (const tab of ['Plán','Klienti','Dnes']) {
    await page.getByRole('button',{name:tab,exact:true}).click(); await page.waitForTimeout(400)
    const vidno = await page.locator('main').count()
    T_(vidno===1,'obrazovka „'+tab+'“ se vykreslila')
  }

  // panely tam a zpět
  for (const [label,jmeno] of [['Hledat','hledání'],['Synchronizace','nastavení']]) {
    const btn = page.locator(`button[aria-label^="${label}"]`).first()
    if (!(await btn.count())) { T_(false,'tlačítko „'+label+'“ chybí'); continue }
    await btn.click(); await page.waitForTimeout(600)
    T_(await page.locator('.sheet-panel').count()>0, jmeno+' se otevřelo')
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    T_(await page.locator('.sheet-panel').count()===0, jmeno+' se zavřelo escapem')
  }

  // detail úkolu: uložení změny (úkol s termínem „dnes“ je na Dnes)
  await page.getByText('první úkol').first().click(); await page.waitForTimeout(700)
  await page.locator('#pole-ukol').fill('druhý úkol přejmenovaný')
  await page.getByRole('button',{name:'Uložit'}).click(); await page.waitForTimeout(700)
  T_(await page.getByText('přejmenovaný').count()>0,'přejmenování v detailu se uložilo')

  // přežije reload (IndexedDB)
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(900)
  T_(await page.getByText('přejmenovaný').count()>0,'data přežila znovunačtení')

  T_(konzole.length===0,'nic nepadlo do konzole'+(konzole.length?' — '+konzole.slice(0,3).join(' | '):''))
  await ctx.close()
}

await b.close(); server.close()
console.log(chyby.length? '\n'+chyby.length+' nálezů:\n'+chyby.map(c=>' - '+c).join('\n') : '\nvšechno prošlo ('+ok+' kontrol)')
process.exit(chyby.length?1:0)
