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

  // Odškrtnutý úkol spadl do „hotovo" — a ta sekce stojí sbalená, protože
  // to není dnešní práce. Rozbalení se tu ověří rovnou: řádka s počtem
  // musí jít otevřít a úkol v ní být.
  const hotovo = page.getByRole('button', { name: /hotovo · \d+/ })
  T_(await hotovo.count() > 0, 'sekce hotovo stojí sbalená jako řádka s počtem')
  if (await hotovo.count()) { await hotovo.click(); await page.waitForTimeout(500) }
  T_(await page.getByText('první úkol').count() > 0, 'rozbalená sekce hotovo ukáže odškrtnutý úkol')

  // detail úkolu: uložení změny (úkol s termínem „dnes“ je na Dnes)
  await page.getByText('první úkol').first().click(); await page.waitForTimeout(700)
  await page.locator('#pole-ukol').fill('druhý úkol přejmenovaný')
  await page.getByRole('button',{name:'Uložit'}).click(); await page.waitForTimeout(700)
  T_(await page.getByText('přejmenovaný').count()>0,'přejmenování v detailu se uložilo')

  // přežije reload (IndexedDB) — a s ním i rozbalení sekce hotovo, protože
  // přejmenovaný úkol je právě v ní; kdyby se sbalila zpátky, text by chyběl.
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(900)
  T_(await page.getByText('přejmenovaný').count()>0,'data přežila znovunačtení (a rozbalení sekce si appka pamatuje)')

  T_(konzole.length===0,'nic nepadlo do konzole'+(konzole.length?' — '+konzole.slice(0,3).join(' | '):''))
  await ctx.close()
}

// --- 3. panel se zavírá stažením dolů (na iPhonu první instinkt) ---
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:true, isMobile:true})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  const cdp = await ctx.newCDPSession(page)
  // Tah prstem: pauza mezi kroky rozhoduje o rychlosti, a ta je součástí
  // gesta — švihnutí zavírá i po krátké dráze, pomalé lízmutí ne.
  const tah = async (x, y, dy, kroky, pauza) => {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
    for (let i=1;i<=kroky;i++) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(dy*i)/kroky}]})
      await page.waitForTimeout(pauza)
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await page.waitForTimeout(600)
  }
  // Escape napřed: kdyby gesto selhalo a panel zůstal otevřený, další
  // kontrola by čekala na tlačítko pod ním a celý audit by spadl na časový
  // limit místo toho, aby poctivě řekla, co nefunguje.
  const otevri = async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await page.locator('button[aria-label^="Synchronizace"]').first().click()
    await page.waitForTimeout(700)
  }
  const panelu = () => page.locator('.sheet-panel').count()

  // Nejdřív to podstatné: jde panel VIDĚT za prstem? Zavírací logika může
  // fungovat a panel se přitom nehne — pak to na telefonu vypadá jako
  // rozbité a člověk pustí dřív, než se práh vůbec překročí.
  await otevri()
  const y0 = (await page.locator('.sheet-panel').boundingBox()).y + 40
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: y0 }] })
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y0 + i * 15 }] })
    await page.waitForTimeout(60)
  }
  const posun = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.sheet-panel')).transform
    return t && t !== 'none' ? Math.round(parseFloat(t.split(',').pop())) : 0
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(600)
  T_(posun > 40, 'panel jde při tažení za prstem (posun ' + posun + ' px)')

  await otevri()
  await tah(195, y0, 40, 6, 120)
  T_(await panelu() > 0, 'krátké pomalé stažení panel nezavře')

  await tah(195, y0, 260, 8, 40)
  T_(await panelu() === 0, 'stažení panelu dolů ho zavře')

  // Odrolovaný panel patří scrollování — jinak by gesto sebralo obsah.
  await otevri()
  await page.evaluate(() => { document.querySelector('.sheet-panel').scrollTop = 200 })
  await page.waitForTimeout(200)
  const y1 = (await page.locator('.sheet-panel').boundingBox()).y + 200
  await tah(195, y1, 260, 8, 40)
  T_(await panelu() > 0, 'odrolovaný panel se tažením nezavírá, jen scrolluje')

  // A hlavně: obsah panelu musí jít pořád rolovat prstem. Tažení se kvůli
  // tomu chytá jen za úchyt nahoře — kdyby se `touch-action: none` dostalo
  // na celou plochu, rolování by přestalo fungovat úplně.
  await otevri()
  await page.evaluate(() => { document.querySelector('.sheet-panel').scrollTop = 0 })
  const yObsah = (await page.locator('.sheet-panel').boundingBox()).y + 260
  await tah(195, yObsah, -200, 8, 30)
  const odrolovano = await page.evaluate(() => document.querySelector('.sheet-panel').scrollTop)
  T_(odrolovano > 20, 'obsah panelu jde rolovat prstem (scrollTop ' + odrolovano + ')')
  T_(await panelu() > 0, 'rolování obsahu panel nezavře')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)

  await ctx.close()
}

// --- 4. mazání se nepotvrzuje, ale jde vrátit ---
// Tohle je pojistka proti nejhoršímu možnému výsledku téhle změny: když
// „Vrátit" nefunguje, appka bez ptaní maže data nenávratně.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(300)
  await page.locator('input[placeholder]').first().fill('dnes úkol na smazání')
  await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  const naObrazovce = () => page.locator('main button').filter({hasText:'úkol na smazání'}).count()
  T_(await naObrazovce() > 0, 'úkol k pokusu se založil')

  await page.getByText('úkol na smazání').first().click(); await page.waitForTimeout(700)
  await page.getByRole('button',{name:'Smazat',exact:true}).click(); await page.waitForTimeout(700)
  T_(await naObrazovce() === 0, 'smazání proběhne bez potvrzovacího dialogu')

  const vratit = page.getByRole('button',{name:'Vrátit'})
  T_(await vratit.count() > 0, 'po smazání se nabídne vrácení')
  if (await vratit.count()) { await vratit.click(); await page.waitForTimeout(700) }
  T_(await naObrazovce() > 0, 'vrácení úkol opravdu obnoví')

  // A přežije to synchronizaci s IndexedDB, ne jen stav v paměti.
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(900)
  T_(await naObrazovce() > 0, 'vrácený úkol přežije znovunačtení')

  // Nejrizikovější případ: klient bere s sebou projekty i úkoly, takže
  // vrácení musí obnovit celou kaskádu, ne jen řádek klienta.
  await page.getByRole('button',{name:'Klienti',exact:true}).click(); await page.waitForTimeout(500)
  await page.getByRole('button',{name:'+ Nový'}).first().click(); await page.waitForTimeout(400)
  await page.getByRole('textbox',{name:'Jméno klienta nebo oblasti'}).fill('Pokusný')
  await page.getByRole('button',{name:'Vytvořit'}).click(); await page.waitForTimeout(700)
  await page.locator('main button').filter({hasText:'Pokusný'}).first().click(); await page.waitForTimeout(600)
  await page.getByRole('textbox',{name:'Nový úkol pro klienta'}).fill('úkol pod klientem')
  await page.keyboard.press('Enter'); await page.waitForTimeout(700)
  const ukolKlienta = () => page.locator('main').getByText('úkol pod klientem').count()
  T_(await ukolKlienta() > 0, 'úkol pod klientem se založil')

  // mazání bydlí v panelu nastavení klienta, ne na obrazovce
  await page.getByRole('button',{name:'Upravit'}).click(); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Smazat klienta'}).click(); await page.waitForTimeout(900)
  T_(await page.locator('main button').filter({hasText:'Pokusný'}).count() === 0, 'klient se smazal bez potvrzování')
  const vratitKlienta = page.getByRole('button',{name:'Vrátit'})
  T_(await vratitKlienta.count() > 0, 'po smazání klienta se nabídne vrácení')
  if (await vratitKlienta.count()) { await vratitKlienta.click(); await page.waitForTimeout(800) }
  T_(await page.locator('main button').filter({hasText:'Pokusný'}).count() > 0, 'vrácený klient je zpátky v seznamu')
  await page.locator('main button').filter({hasText:'Pokusný'}).first().click(); await page.waitForTimeout(600)
  T_(await ukolKlienta() > 0, 'vrácení klienta obnoví i jeho úkoly')
  await ctx.close()
}

// --- 5. po startu neproblikne prázdný stav ---
// „Čistý stůl" na plném dni je první, co člověk po otevření vidí — a je
// to nepravda. `useLiveQuery` vrací undefined, dokud dotaz nedoběhne,
// takže se to nesmí setřít na prázdné pole.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  for (const t of ['dnes ranní kontrola', 'zítra fakturace']) {
    const novy = page.getByRole('button',{name:'Nový úkol'})
    if (await novy.count()) { await novy.click(); await page.waitForTimeout(200) }
    await page.locator('input[placeholder]').first().fill(t)
    await page.keyboard.press('Enter'); await page.waitForTimeout(350)
  }
  await page.waitForTimeout(800)

  // Vzorkuje se DOM hned po startu, ne až ustálený stav.
  await page.reload({waitUntil:'commit'})
  let blik = 0, videnUkol = false
  for (let i = 0; i < 45; i++) {
    const v = await page.evaluate(() => {
      const t = document.body.innerText || ''
      return { prazdny: t.includes('Čistý stůl'), ukol: t.includes('ranní kontrola') }
    }).catch(() => null)
    if (v) {
      if (v.prazdny && !v.ukol) blik++
      if (v.ukol) videnUkol = true
    }
    await page.waitForTimeout(16)
  }
  T_(videnUkol, 'úkoly se po startu vůbec objevily')
  T_(blik === 0, 'po startu neproblikne „Čistý stůl", když úkoly jsou (snímků: ' + blik + ')')
  await ctx.close()
}

// --- 6. dlouhé seznamy se nevykreslují celé ---
// Změřeno na 1200 úkolech: appka vykreslovala 760 řádků na Dnes a 1 080
// v Plánu, takže přepnutí obrazovky trvalo na pomalejším telefonu přes
// čtyři vteřiny (čtení z databáze na tom mělo podíl 37 ms — zbytek bylo
// vykreslování řádků, které stejně nikdo nepřečte).
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(700)
  const nasypano = await page.evaluate(async () => {
    const den = (p) => { const d = new Date(); d.setDate(d.getDate() + p); return d.toISOString().slice(0, 10) }
    const ted = new Date().toISOString()
    const db = await new Promise((res) => { const r = indexedDB.open('todo'); r.onsuccess = () => res(r.result) })
    const zapis = (t, rows) => new Promise((res) => {
      const tx = db.transaction(t, 'readwrite'); const st = tx.objectStore(t)
      for (const r of rows) st.put(r); tx.oncomplete = res
    })
    const ukoly = Array.from({ length: 400 }, (_, i) => ({
      id: 'zk' + i, createdAt: ted, updatedAt: ted, title: 'Zátěžový úkol ' + i,
      priority: 'normal', status: 'active', order: i,
      scheduledFor: den(i % 3 === 0 ? -2 : i % 10), // část po termínu, část dopředu
    }))
    await zapis('tasks', ukoly)
    return ukoly.length
  })
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1500)

  const radku = async () => await page.evaluate(() => document.querySelectorAll('main li').length)
  const naDnes = await radku()
  T_(naDnes > 0 && naDnes < 150, 'Dnes vykreslí jen část dlouhého seznamu (řádků: ' + naDnes + ' ze ' + nasypano + ')')

  // Hlavička ale musí říkat pravdu — počet je celkový, ne kolik se kreslí.
  const hlavicka = await page.evaluate(() => {
    const t = document.body.innerText || ''
    const m = t.match(/po termínu[^0-9]*(\d+)/i) || t.match(/dnes[^0-9]*(\d+)/i)
    return m ? m[1] : 'nenalezeno: ' + t.slice(0, 120).replace(/\n/g, ' | ')
  })
  T_(Number(hlavicka) > 100, 'počet v hlavičce sekce je celkový, ne jen vykreslený (' + hlavicka + ')')

  const vic = page.getByRole('button', { name: /Zobrazit \d+ dalš/ }).first()
  T_(await vic.count() > 0, 'nabídne se dobrání dalších')
  if (await vic.count()) {
    await vic.click(); await page.waitForTimeout(400)
    T_(await radku() > naDnes, 'dobrání opravdu přidá řádky')
  }

  await page.getByRole('button',{name:'Plán',exact:true}).click(); await page.waitForTimeout(1200)
  const vPlanu = await radku()
  T_(vPlanu > 0 && vPlanu < 200, 'Plán vykreslí jen část dlouhého seznamu (řádků: ' + vPlanu + ')')

  // --- triáž propadlých: odpověď musí úkol opravdu posunout a jít vzít zpět
  await page.getByRole('button',{name:'Dnes',exact:true}).click(); await page.waitForTimeout(900)
  const poTerminu = async () => Number((await page.evaluate(() => (document.body.innerText.match(/po termínu[^0-9]*(\d+)/i) || [])[1])) || 0)
  const pred = await poTerminu()
  T_(pred > 100, 'sekce po termínu je plná (' + pred + ')')

  await page.getByRole('button',{name:/Projít/}).click(); await page.waitForTimeout(800)
  T_(await page.locator('.sheet-panel').count() > 0, 'triáž se otevřela')
  // Celý žebřík odpovědí: každá musí úkol z propadlých opravdu odnést.
  const odpoved = (re) => page.locator('.sheet-panel').getByRole('button',{name:re})
  await odpoved(/^Dnes$/).click(); await page.waitForTimeout(500)
  await odpoved(/^Zítra/).click(); await page.waitForTimeout(500)
  await odpoved(/^Volnější den/).click(); await page.waitForTimeout(500)
  await odpoved(/Už neplatí/).click(); await page.waitForTimeout(700)
  await page.keyboard.press('Escape'); await page.waitForTimeout(700)
  const po = await poTerminu()
  T_(po === pred - 4, 'čtyři odpovědi ubraly čtyři úkoly z propadlých (' + pred + ' → ' + po + ')')

  // Zpět musí vrátit i „Už neplatí" — jinak by to bylo tiché mazání práce.
  await page.getByRole('button',{name:/Projít/}).click(); await page.waitForTimeout(800)
  await page.getByRole('button',{name:'Už neplatí'}).click(); await page.waitForTimeout(500)
  await page.getByRole('button',{name:'Zpět'}).click(); await page.waitForTimeout(500)
  await page.keyboard.press('Escape'); await page.waitForTimeout(700)
  T_(await poTerminu() === po, 'zpět v triáži vrátí i zahozený úkol')
  await ctx.close()
}

// --- 9. odkazy v úkolu a klávesnice na Macu ---
// Na MacBooku se appka ovládá z klávesnice: n → zadávání, ⌘K → hledání,
// 1–3 → záložky, ⌘↩ → uložit detail. Zkratky nesmí sebrat písmena
// z psaní ani zabrat s otevřeným panelem. A odkaz v poznámce (Canva,
// Drive) musí jít otevřít z řádku i z detailu — bez opisování.
{
  const ctx = await b.newContext({viewport:{width:1100,height:800}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  const aktivni = () => page.evaluate(() => {
    const el = document.activeElement
    return el ? (el.tagName + '|' + (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')) : ''
  })
  await page.keyboard.press('n'); await page.waitForTimeout(400)
  T_((await aktivni()).startsWith('INPUT|'), 'n otevře zadávání a zaostří pole (' + await aktivni() + ')')
  // písmena zkratek se při psaní neztrácejí
  await page.keyboard.type('nový banner // https://www.canva.com/design/abc/edit, pak 1 a 2')
  const napsano = await page.locator('input[placeholder]').first().inputValue()
  T_(napsano.startsWith('nový banner') && napsano.endsWith('1 a 2'), 'při psaní se n, 1 a 2 berou jako písmena')
  await page.keyboard.press('Enter'); await page.waitForTimeout(500)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  T_(await page.getByRole('button',{name:'Nový úkol'}).count() === 1, 'Esc složí zadávání')

  const naRadku = page.locator('main a[aria-label^="Otevřít odkaz"]').first()
  T_(await naRadku.count() === 1 && (await naRadku.getAttribute('href')) === 'https://www.canva.com/design/abc/edit', 'odkaz z poznámky je na řádku úkolu jako ťuknutí (čárka za ním nepatří do adresy)')
  T_((await naRadku.getAttribute('aria-label')) === 'Otevřít odkaz canva.com', 'řádek odkaz popisuje doménou')

  await page.getByText('nový banner').first().click(); await page.waitForTimeout(700)
  const vDetailu = page.locator('[data-odkazy] a')
  T_(await vDetailu.count() === 1 && (await vDetailu.textContent()).trim() === 'canva.com', 'detail ukazuje odkaz jako čip s doménou')
  // panel je otevřený: „2" nesmí přepnout záložku
  await page.locator('#pole-ukol').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 2'); await page.waitForTimeout(150)
  T_(await page.locator('h1').first().textContent() === 'Dnes', 's otevřeným panelem zkratky mlčí')
  await page.keyboard.press('Control+Enter'); await page.waitForTimeout(800)
  T_(await page.locator('.sheet-panel').count() === 0 && await page.getByText('nový banner 2').count() === 1, '⌘↩ v detailu uloží a zavře')

  await page.keyboard.press('2'); await page.waitForTimeout(500)
  T_(await page.locator('h1').first().textContent() === 'Plán', '2 přepne na Plán')
  await page.keyboard.press('3'); await page.waitForTimeout(500)
  T_(await page.locator('h1').first().textContent() === 'Klienti', '3 přepne na Klienty')
  await page.keyboard.press('1'); await page.waitForTimeout(500)
  T_(await page.locator('h1').first().textContent() === 'Dnes', '1 vrátí na Dnes')

  await page.keyboard.press('Control+k'); await page.waitForTimeout(700)
  T_((await aktivni()).includes('Hledat'), '⌘K otevře hledání a zaostří pole (' + await aktivni() + ')')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  T_(await page.locator('.sheet-panel').count() === 0, 'Esc hledání zavře')
  await ctx.close()
}

await b.close(); server.close()
console.log(chyby.length? '\n'+chyby.length+' nálezů:\n'+chyby.map(c=>' - '+c).join('\n') : '\nvšechno prošlo ('+ok+' kontrol)')
process.exit(chyby.length?1:0)
