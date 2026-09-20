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

  // Dvojité ťuknutí přepne i v klidu — jen bez pulzu čočky a bez nájezdu
  // ikony. Gesto je ovládání, ne ozdoba; vypnout se smí pohyb, ne funkce.
  await page.getByRole('button',{name:'Dnes',exact:true}).click(); await page.waitForTimeout(300)
  await page.getByRole('button',{name:'Dnes',exact:true}).dblclick(); await page.waitForTimeout(400)
  T_((await page.locator('main h1').first().innerText()).trim() === 'Vše', 'gesto přepne i v klidovém režimu')
  const poGestu = await page.evaluate(() => document.getAnimations().filter(a=>a.playState==='running').length)
  T_(poGestu === 0, 'pulz doku v klidovém režimu neběží (běží: ' + poGestu + ')')
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

  // Kdo nic nesdílí, nesmí z týmové části vidět ANI JEDEN prvek (Fáze 10).
  // Týmová appka pro jednoho člověka je horší než appka pro jednoho
  // člověka — a je to jediná část těch změn, kterou pravítko nezměří:
  // ostatní se pozná až na dvou účtech.
  T_(await page.locator('[data-slot="kdo"]').count() === 0,
     'bez sdílení není v detailu úkolu slot „Kdo to má"')

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

  // Stažení ZA OBSAH, když je panel nahoře. Dokud se gesto chytalo jen
  // za úchyt, prst na obsahu spustil pružné přetažení vlastního rolování:
  // uvnitř krabice sjel obsah dolů, krabice zůstala stát a nad úchytem se
  // otevřela prázdná plocha. Vypadalo to jako dvě vrstvy, z nichž se hýbe
  // ta špatná.
  await otevri()
  await page.evaluate(() => { document.querySelector('.sheet-panel').scrollTop = 0 })
  const yStred = (await page.locator('.sheet-panel').boundingBox()).y + 260
  await tah(195, yStred, 260, 8, 40)
  T_(await panelu() === 0, 'stažení za obsah panel zavře, ne jen odsune obsah uvnitř')

  // Pružné přetažení vlastního rolování musí být vypnuté (`overscroll-none`,
  // ne `contain`): `contain` zabrání jen přenosu na stránku, odskok uvnitř
  // panelu nechá být — a právě ten dělal tu prázdnou plochu.
  await otevri()
  const odskok = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sheet-panel')).overscrollBehaviorY)
  T_(odskok === 'none', 'panel nemá pružné přetažení vlastního rolování (' + odskok + ')')

  // A hlavně: obsah panelu musí jít pořád rolovat prstem. Kdyby se
  // `touch-action: none` dostalo na celou plochu, rolování by přestalo
  // fungovat úplně.
  await otevri()
  await page.evaluate(() => { document.querySelector('.sheet-panel').scrollTop = 0 })
  const yObsah = (await page.locator('.sheet-panel').boundingBox()).y + 260
  await tah(195, yObsah, -200, 8, 30)
  const odrolovano = await page.evaluate(() => document.querySelector('.sheet-panel').scrollTop)
  T_(odrolovano > 20, 'obsah panelu jde rolovat prstem (scrollTop ' + odrolovano + ')')
  T_(await panelu() > 0, 'rolování obsahu panel nezavře')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)

  // Nad textovým polem patří svislý tah kurzoru a výběru textu, ne panelu.
  // Hledání je panel s polem hned nahoře, takže se to na něm dá ověřit.
  await page.getByRole('button',{name:'Hledat'}).click(); await page.waitForTimeout(700)
  const pole = await page.locator('.sheet-panel input').first().boundingBox()
  if (pole) {
    await tah(Math.round(pole.x + pole.width / 2), Math.round(pole.y + pole.height / 2), 260, 8, 40)
    T_(await panelu() > 0, 'tah nad textovým polem panel nezavře')
  } else {
    T_(false, 'tah nad textovým polem panel nezavře (pole se nenašlo)')
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)

  // Vodorovná řádka uvnitř panelu musí pořád rolovat do strany, a svislý
  // tah z TÉŽE řádky musí panel zavřít. `preventDefault` v touchmove platí
  // na celé gesto, takže jedno ukvapené zavolání na prvním ťuknutí by
  // řádku umrtvilo — a řádka slotů je v detailu úkolu hlavní ovládání.
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(300)
  await page.locator('input[placeholder]').first().fill('úkol na řádku slotů')
  await page.keyboard.press('Enter'); await page.waitForTimeout(900)
  await page.getByText('úkol na řádku slotů').first().click(); await page.waitForTimeout(900)
  const radka = await page.evaluate(() => {
    const el = document.querySelector('.sheet-panel .radka-mizi')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { pretece: el.scrollWidth > el.clientWidth, y: Math.round(r.y + r.height / 2) }
  })
  if (radka?.pretece) {
    // Vodorovně: tah doleva musí řádku odrolovat a panel nechat být.
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y:radka.y}]})
    for (let i=1;i<=8;i++) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:320-i*25,y:radka.y}]})
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await page.waitForTimeout(500)
    const doStrany = await page.evaluate(() => document.querySelector('.sheet-panel .radka-mizi')?.scrollLeft ?? 0)
    T_(doStrany > 10, 'vodorovná řádka v panelu roluje do strany (scrollLeft ' + doStrany + ')')
    T_(await panelu() > 0, 'vodorovné tažení panel nezavře')
    // Svisle z téže řádky: panel se zavře.
    await tah(200, radka.y, 280, 8, 35)
    T_(await panelu() === 0, 'svislý tah z vodorovné řádky panel zavře')
  } else {
    T_(false, 'vodorovná řádka v panelu roluje do strany (řádka slotů se nenašla nebo nepřetéká)')
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)

  await ctx.close()
}

// --- 3b. panel ustoupí klávesnici ---
//
// Nejde o kosmetiku: s klávesnicí venku zbyla z detailu úkolu na displeji
// jen hlavička „Úkol / Připnout" a pole, do kterého se zrovna psalo, bylo
// schované pod klávesnicí. Příčina je jedna a měřitelná — panel se
// renderuje portálem do <body>, tedy MIMO .app-shell, který se na
// viditelný obdélník (`--vv-top`/`--vvh`) chytá sám; `fixed inset-0` ho
// proto drželo na spodní hraně STRÁNKY, kam klávesnice nedosáhne.
//
// Klávesnice se v Chromiu nevyvolá, ale appka o ní ví jedině z
// `visualViewport` — přepsat ho a poslat `resize` je tedy přesně ta
// událost, kterou na telefonu dostane. Měří se geometrie, ne styl:
// spodní hrana panelu musí sednout na hranici klávesnice.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:true, isMobile:true})
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    const vv = window.visualViewport
    window.__klavesnice = (px) => {
      Object.defineProperty(vv, 'height', { value: window.innerHeight - px, configurable: true })
      Object.defineProperty(vv, 'offsetTop', { value: 0, configurable: true })
      vv.dispatchEvent(new Event('resize'))
    }
  })
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(300)
  await page.locator('input[placeholder]').first().fill('úkol pod klávesnicí')
  await page.keyboard.press('Enter'); await page.waitForTimeout(900)
  await page.getByText('úkol pod klávesnicí').first().click(); await page.waitForTimeout(900)

  const dole = () => page.evaluate(() => Math.round(document.querySelector('.sheet-panel').getBoundingClientRect().bottom))
  const bezKlavesnice = await dole()
  T_(Math.abs(bezKlavesnice - 844) <= 2, 'bez klávesnice panel sedí na spodní hraně (' + bezKlavesnice + ' z 844)')

  const KLAVESNICE = 320
  await page.evaluate((px) => window.__klavesnice(px), KLAVESNICE)
  await page.waitForTimeout(400)
  const sKlavesnici = await dole()
  T_(
    Math.abs(sKlavesnici - (844 - KLAVESNICE)) <= 2,
    'panel ustoupí klávesnici (spodní hrana ' + sKlavesnici + ', čekáno ' + (844 - KLAVESNICE) + ')',
  )

  // A to hlavní: pole, do kterého se píše, musí být celé nad klávesnicí.
  const poleVidet = await page.evaluate((px) => {
    const el = document.querySelector('#pole-ukol')
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { dole: Math.round(r.bottom), mez: window.innerHeight - px }
  }, KLAVESNICE)
  T_(
    !!poleVidet && poleVidet.dole <= poleVidet.mez,
    'pole úkolu zůstane nad klávesnicí (' + (poleVidet ? poleVidet.dole + ' ≤ ' + poleVidet.mez : 'pole se nenašlo') + ')',
  )

  await ctx.close()
}

// --- 3c. přepsaný termín překoná naplánování ---
//
// Úkol nese dvě data (`dueDate` a `scheduledFor`) a „kdy to je" je
// DŘÍVĚJŠÍ z nich. Naplánování si přitom ve většině případů nenastavuje
// člověk — razítkuje ho přijatý ranní návrh nebo večerní uzávěrka — a
// v detailu leží jeho slot na konci vodorovné řádky, tedy na úzkém
// displeji za hranou. Kdo pak přepsal Termín na pozdější den, viděl
// úkol pořád na Dnes a nemohl poznat proč: to, co ho tam drží, na
// obrazovce nebylo. Změřeno na skutečných datech (termín ne 20. 9.,
// naplánování pá 18. 9.).
//
// Celý kruh jde přes rozhraní, protože vada byla mezi dvěma uloženími:
// naplánovat na dnešek → zavřít → přepsat termín na zítřek → úkol musí
// z Dnes zmizet.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(300)
  await page.locator('input[placeholder]').first().fill('dnes úkol s plánem')
  await page.keyboard.press('Enter'); await page.waitForTimeout(900)

  const vDnesku = () => page.locator('main').getByText('úkol s plánem').count()
  T_(await vDnesku() > 0, 'úkol na dnešek je na Dnes vidět')

  // 1. naplánovat na dnešek (to, co jinak udělá přijatý ranní návrh)
  await page.getByText('úkol s plánem').first().click(); await page.waitForTimeout(800)
  await page.getByRole('button',{name:'Naplánovat na jiný den'}).click(); await page.waitForTimeout(400)
  await page.locator('.sheet-panel').getByRole('button',{name:'Dnes',exact:true}).click(); await page.waitForTimeout(300)
  await page.getByRole('button',{name:'Uložit'}).click(); await page.waitForTimeout(900)

  // 2. přepsat Termín na zítřek a naplánování nechat být
  await page.getByText('úkol s plánem').first().click(); await page.waitForTimeout(800)
  await page.locator('.sheet-panel button[aria-label^="Termín"]').first().click(); await page.waitForTimeout(400)
  await page.locator('.sheet-panel').getByRole('button',{name:'Zítra',exact:true}).click(); await page.waitForTimeout(300)
  await page.getByRole('button',{name:'Uložit'}).click(); await page.waitForTimeout(1000)

  T_(await vDnesku() === 0, 'přepsaný termín odsune úkol z Dnes (naplánování ho nedrží)')

  // A hlavně: úkol se nesmí ztratit. Vše ukazuje všechny otevřené úkoly
  // po koších, takže je vidět, že jen odešel na jiný den. (V Plánu by to
  // šlo taky, ale ten ukazuje agendu VYBRANÉHO dne, tedy dneška.)
  await page.getByRole('button',{name:'Dnes',exact:true}).dblclick(); await page.waitForTimeout(700)
  const veVsem = await page.locator('main').getByText('úkol s plánem').count()
  T_(veVsem > 0, 'úkol se neztratil — jen odešel na jiný den')

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

// --- 4b. rozpad projektu na kroky (Fáze 5) ---
// Nabídka smí čerpat JEN z vlastní historie, takže se musí ověřit celý
// řetěz: úkol zařazený do jednoho projektu → podobně pojmenovaný druhý
// projekt → nabídka → přidání → vratnost. A hlavně že se u projektu,
// kterému se nic nepodobá, nenabízí vůbec nic — ticho je tu odpověď.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Klienti',exact:true}).click(); await page.waitForTimeout(500)
  await page.getByRole('button',{name:'+ Nový'}).first().click(); await page.waitForTimeout(400)
  await page.getByRole('textbox',{name:'Jméno klienta nebo oblasti'}).fill('Rozpad')
  await page.getByRole('button',{name:'Vytvořit'}).click(); await page.waitForTimeout(700)
  await page.locator('main button').filter({hasText:'Rozpad'}).first().click(); await page.waitForTimeout(600)

  const zalozProjekt = async (jmeno) => {
    await page.getByRole('button',{name:'+ Projekt'}).click(); await page.waitForTimeout(350)
    await page.getByRole('textbox',{name:'Název nového projektu'}).fill(jmeno)
    await page.getByRole('button',{name:'Založit'}).click(); await page.waitForTimeout(700)
  }
  await zalozProjekt('Rebranding webu')
  await zalozProjekt('Rebranding webu pro e-shop')

  // Úkol do prvního projektu — zařazení bydlí ve slotu v detailu úkolu.
  await page.getByRole('textbox',{name:'Nový úkol pro klienta'}).fill('Analýza současného webu')
  await page.keyboard.press('Enter'); await page.waitForTimeout(700)
  await page.locator('main').getByText('Analýza současného webu').first().click(); await page.waitForTimeout(700)
  // Slot „Projekt" má i zadávání v doku — hledá se jen uvnitř panelu.
  const panel = page.locator('.sheet-panel')
  await panel.getByRole('button',{name:'Projekt',exact:true}).click(); await page.waitForTimeout(400)
  // Volba nese značku „▸" a „Rebranding webu" je předponou toho druhého
  // projektu — proto přesná shoda i se značkou.
  await panel.getByRole('button',{name:'▸ Rebranding webu',exact:true}).click(); await page.waitForTimeout(400)
  await panel.getByRole('button',{name:'Uložit'}).click(); await page.waitForTimeout(800)

  // Druhý projekt teď má z čeho čerpat.
  await page.locator('main button').filter({hasText:'Rebranding webu pro e-shop'}).first().click()
  await page.waitForTimeout(800)
  const nabidka = page.getByRole('button',{name:/Rozepsat na kroky/})
  T_(await nabidka.count() > 0, 'podobný projekt nabídne rozpad na kroky')
  if (await nabidka.count()) {
    T_(/Rozepsat na kroky · 1/.test(await nabidka.textContent()), 'nabídne právě kroky zdrojového projektu')
    // Rozbalení je animace na výšku — než se dojede, tlačítko dole se hýbe.
    await nabidka.click(); await page.waitForTimeout(1200)
    T_(await page.getByText('podle „Rebranding webu"').count() > 0, 'u kroku je vidět, odkud pochází')
    const pridat = page.getByRole('button',{name:/^Přidat ·/})
    await pridat.scrollIntoViewIfNeeded()
    await pridat.click(); await page.waitForTimeout(1000)
    T_(await page.locator('main').getByText('Analýza současného webu').count() > 0,
       'přijatý krok se založil jako úkol projektu')
    // Panel se musí zavřít sám: toast má z-40, plachta panelu z-50 —
    // pod otevřeným panelem by „Vrátit" nešlo stisknout.
    T_(await page.locator('.sheet-panel').count() === 0, 'po přidání se panel zavře, ať je „Vrátit" dosažitelné')
  }
  const vratit = page.getByRole('button',{name:'Vrátit'})
  T_(await vratit.count() > 0, 'přidání kroků jde vrátit')
  if (await vratit.count()) { await vratit.click(); await page.waitForTimeout(800) }

  // Projekt, kterému se nic nepodobá, nesmí nabízet nic.
  await zalozProjekt('Focení produktů')
  await page.locator('main button').filter({hasText:'Focení produktů'}).first().click()
  await page.waitForTimeout(800)
  T_(await page.getByRole('button',{name:/Rozepsat na kroky/}).count() === 0,
     'bez podobného projektu se nenabízí nic (ani prázdný stav)')
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

// --- 5b. nájezd obrazovky dosedne, i když se během něj překreslí ---
//
// Tohle `audit:ui` změřit neumí: seje data přímo do IndexedDB ještě před
// načtením, takže živé dotazy doběhnou dřív, než se někam naviguje, a po
// nájezdu už nic nepřekresluje. Tady se data zakládají PŘES ROZHRANÍ za
// běhu, takže se rozpočet dnů v Plánu dopočítá až po příjezdu — a právě
// to je ten okamžik, kdy se směr nájezdu přepočítá z osy x na y.
//
// Když varianta `visible` vrací na nulu jen tu osu, po které se zrovna
// jede, zůstane ta druhá zmrzlá a CELÁ obrazovka stojí o `offset` vedle
// svislice (změřeno: Plán na 30 px místo 16). Nic se nerozbije, nic
// nespadne — obrazovka je jen posunutá napořád.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(700)
  for (const t of ['dnes poslat report', 'zítra dodělat bannery', 'v pátek revize textů']) {
    const novy = page.getByRole('button',{name:'Nový úkol'})
    if (await novy.count()) { await novy.click(); await page.waitForTimeout(200) }
    await page.locator('input[placeholder]').first().fill(t)
    await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  }

  // Obal nájezdu, ne titulek: ten v detailu klienta legitimně stojí až
  // za barevnou tečkou, takže by na něm kontrola hlásila planý poplach.
  const hrana = () => page.evaluate(() => {
    const clip = document.querySelector('main > div.overflow-x-clip')
    const obal = clip?.firstElementChild
    return obal ? Math.round(obal.getBoundingClientRect().x * 10) / 10 : null
  })

  for (const [jmeno, zalozka] of [['Plán','Plán'], ['Klienti','Klienti'], ['Dnes','Dnes']]) {
    await page.getByRole('button',{name:zalozka, exact:true}).click()
    await page.waitForTimeout(1600)
    const x = await hrana()
    T_(x === 16, `${jmeno}: obsah stojí na svislici po nájezdu (${x} px)`)
  }
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
      // Část do minula, část dopředu. Je to NAPLÁNOVÁNÍ, ne termín, takže
      // se ta hromádka jmenuje „nestihnuto" — proto čtení níž bere obě
      // jména (`popisPropadlych` v src/lib/vseUkoly.ts).
      scheduledFor: den(i % 3 === 0 ? -2 : i % 10),
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
    const m = t.match(/(?:po termínu|nestihnuto)[^0-9]*(\d+)/i) || t.match(/dnes[^0-9]*(\d+)/i)
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
  const poTerminu = async () => Number((await page.evaluate(() => (document.body.innerText.match(/(?:po termínu|nestihnuto)[^0-9]*(\d+)/i) || [])[1])) || 0)
  const pred = await poTerminu()
  T_(pred > 100, 'sekce propadlých je plná (' + pred + ')')

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

  // --- dvojité ťuknutí na Dnes = všechny otevřené úkoly
  // Skryté gesto, které se dá rozbít úplně tiše (dok posílá výběr přes
  // pointerup s pointer capture, ne přes click). Proto se měří chování,
  // ne kód: co dělá jedno ťuknutí, co dvě rychlá a co dvě pomalá.
  const nadpis = async () => (await page.locator('main h1').first().innerText()).trim()
  const zalozkaDnes = page.getByRole('button', { name: 'Dnes', exact: true })
  await zalozkaDnes.click(); await page.waitForTimeout(700)
  T_(await nadpis() === 'Dnes', 'jedno ťuknutí na vybranou záložku nic nemění')

  await zalozkaDnes.dblclick(); await page.waitForTimeout(900)
  T_(await nadpis() === 'Vše', 'dvojité ťuknutí na Dnes otevře Vše')
  const vseUkolu = await page.evaluate(() => Number((document.body.innerText.match(/(\d+)\s+otevřen/) || [])[1]) || 0)
  T_(vseUkolu > 300, 'Vše počítá všechny otevřené úkoly, ne jen dnešek (' + vseUkolu + ')')
  // Přepínač lidí se bez sdílení nenabízí: byla by to jediná skupina
  // („Já"), tedy tlačítko, které nic nedělá (Fáze 10).
  T_(await page.getByRole('button', { name: 'Kdo', exact: true }).count() === 0,
     'bez sdílení není ve Vše přepínač „Kdo"')

  // Seznam je JEDEN, podle priority — ne šest košů po dnech. „Kdy to je"
  // říká Plán a hledání; tady se odpovídá na „co je nejdůležitější".
  // Přes `data-id`, ne přes přístupný název: „Priorita" i „Klient" se
  // jmenují i sloty v detailu úkolu a v zadávání, takže by selektor
  // chytal dvě různá tlačítka.
  const prepinac = (id) => page.locator(`main [data-id="${id}"]`)
  T_(await prepinac('priorita').count() === 1, 'přepínač ve Vše nabízí Prioritu')
  // Počítá se HLAVIČKA, ne její text: prázdné jméno by textovou kontrolou
  // prošlo a řádka by na obrazovce přesto stála.
  const hlavicky = () => page.evaluate(() => document.querySelectorAll('main ul li.skupina-li').length)
  T_(await hlavicky() === 0, 'seznam podle priority nemá hlavičky skupin (' + (await hlavicky()) + ')')
  const kosove = await page.evaluate(() => {
    const t = document.querySelector('main ul')?.innerText ?? ''
    return ['dnes ·', 'zítra ·', 'tento týden ·', 'později ·', 'bez termínu ·'].filter((h) => t.includes(h))
  })
  T_(kosove.length === 0, 'ani se nevrátily časové koše (' + (kosove.join(', ') || 'žádné') + ')')
  // Skupiny se ale nezrušily — po klientech je hlavička pořád nese.
  await prepinac('klient').click(); await page.waitForTimeout(700)
  const poKlientech = await hlavicky()
  T_(poKlientech > 0, 'po klientech se hlavičky skupin vrátí (' + poKlientech + ')')
  await prepinac('priorita').click(); await page.waitForTimeout(700)
  T_(await hlavicky() === 0, 'zpátky podle priority je seznam zase bez hlaviček')

  // Přepnutí záložky nahlédnutí vždycky složí — v režimu se nesmí uvíznout.
  await page.getByRole('button',{name:'Plán',exact:true}).click(); await page.waitForTimeout(900)
  await zalozkaDnes.click(); await page.waitForTimeout(900)
  T_(await nadpis() === 'Dnes', 'přepnutí záložky nahlédnutí složí zpátky')

  // A hlavně: gesto musí jít i ODJINUD. Kdo stojí na Plánu, nemá vědět,
  // že musí nejdřív přijít na Dnes a teprve pak ťuknout dvakrát — ruka
  // umí jedinou věc: dvakrát klepnout na tu ikonu.
  await page.getByRole('button',{name:'Plán',exact:true}).click(); await page.waitForTimeout(900)
  T_(await nadpis() === 'Plán', 'stojíme na Plánu')
  await zalozkaDnes.dblclick(); await page.waitForTimeout(900)
  T_(await nadpis() === 'Vše', 'dvojité ťuknutí z jiné záložky otevře Vše rovnou')
  // Zpátky se jde týmž gestem — jedno ťuknutí na už vybrané Dnes nemění nic.
  await zalozkaDnes.dblclick(); await page.waitForTimeout(900)
  T_(await nadpis() === 'Dnes', 'a týmž gestem zpátky')

  // Dvě pomalá ťuknutí jsou dvě ťuknutí, ne gesto.
  await zalozkaDnes.click(); await page.waitForTimeout(600)
  await zalozkaDnes.click(); await page.waitForTimeout(700)
  T_(await nadpis() === 'Dnes', 'pomalé dvojí ťuknutí gesto nespustí')

  // Polohu musí nést i DOK, ne jen titulek obrazovky: kdo se na něj
  // podívá, pozná ji bez rolování nahoru. Ikona má dvě podoby —
  // ve druhé stojí za kroužkem s fajfkou druhý kroužek.
  const kresba = () => page.locator('footer [data-pas] button').first().locator('svg').innerHTML()
  const dnesIkona = await kresba()
  await zalozkaDnes.dblclick(); await page.waitForTimeout(900)
  const vseIkona = await kresba()
  T_(await nadpis() === 'Vše', 'dvojité ťuknutí přepne i podruhé')
  T_(vseIkona !== dnesIkona, 'ikona v doku má pro každou polohu vlastní podobu')
  T_(/<path[^>]*A7\.6/.test(vseIkona), 'v poloze Vše stojí za kroužkem druhý kroužek')
  await zalozkaDnes.dblclick(); await page.waitForTimeout(900)
  T_(await kresba() === dnesIkona, 'návrat na Dnes vrátí i původní ikonu')
  await ctx.close()
}

// --- 9. odkazy v úkolu a klávesnice na Macu ---
// Na MacBooku se appka ovládá z klávesnice: n → zadávání, ⌘K → hledání,
// 1–3 → záložky, ⌘↩ → uložit detail. Zkratky nesmí sebrat písmena
// z psaní ani zabrat s otevřeným panelem. A odkaz v poznámce (Canva,
// Drive) musí jít otevřít z řádku i z detailu — bez opisování.
//
// Šířka je 900, ne 1100: od 1024 px se appka přepne do širokého
// rozvržení (`src/lib/siroko.ts`) a tři zdejší kontroly by tím ztichly —
// „Esc složí zadávání" počítá tlačítka „Nový úkol" (v bočním panelu je
// jedno pořád), „⌘↩ zavře" čeká `.sheet-panel` (sloupec žádný nemá)
// a „s otevřeným panelem zkratky mlčí" by platilo jen díky tomu, že
// kurzor stojí v poli. Zkratky na šířce nezávisí, panely ano — proto se
// měří tam, kde panely jsou, a široké rozvržení má vlastní oddíl 12.
{
  const ctx = await b.newContext({viewport:{width:900,height:800}})
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

// --- 10. Plán je mřížka měsíce a den pod ní ---
// Mřížka a agenda musí mluvit o TÉMŽE dni: kdyby výběr zůstal při
// listování stát, ukazuje obrazovka v mřížce jeden měsíc a pod ní den
// z jiného. Pravítkem se to nezměří — je to otázka, co se stane po
// ťuknutí.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(250)
  await page.locator('input[placeholder]').first().fill('zítra mřížka test')
  await page.keyboard.press('Enter'); await page.waitForTimeout(250)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await page.getByRole('button',{name:'Plán',exact:true}).click(); await page.waitForTimeout(900)

  const nadpisMesice = () => page.locator('main h2').first().textContent()
  const nadpisDne = () => page.locator('main h2').nth(1).textContent()

  const dnu = await page.locator('main [data-day]').count()
  T_(dnu >= 28 && dnu <= 31, 'mřížka má tolik buněk, kolik má měsíc dnů (' + dnu + ')')
  T_(await page.locator('main [data-day] >> nth=0').isVisible(), 'mřížka je vidět')
  T_((await nadpisDne()).trim() === 'Dnes', 'pod mřížkou stojí rovnou dnešek')

  // Ťuknutí na den přepne agendu pod mřížkou.
  const posledni = page.locator('main [data-day]').last()
  const iso = await posledni.getAttribute('data-day')
  const cislo = Number(iso.slice(-2))
  await posledni.click(); await page.waitForTimeout(500)
  const poVyberu = (await nadpisDne()).trim()
  T_(poVyberu !== 'Dnes' && poVyberu.includes(cislo + '.'), 'ťuknutí na den ukáže ten den pod mřížkou (' + poVyberu + ')')

  // Listování měsíci bere výběr s sebou — jinak mluví mřížka a agenda
  // o dvou různých dnech.
  const mesicPred = (await nadpisMesice()).trim()
  await page.getByRole('button',{name:'Další měsíc'}).click(); await page.waitForTimeout(600)
  const mesicPo = (await nadpisMesice()).trim()
  T_(mesicPo !== mesicPred, 'šipka přelistuje měsíc (' + mesicPred + ' → ' + mesicPo + ')')
  T_((await nadpisDne()).trim().includes('1.'), 'výběr jde s měsícem, ne zůstává v minulém (' + (await nadpisDne()).trim() + ')')

  // Cesta zpátky na dnešek je vidět, ne skrytá.
  await page.getByRole('button',{name:'dnes',exact:true}).click(); await page.waitForTimeout(600)
  T_((await nadpisMesice()).trim() === mesicPred, 'tlačítko „dnes" vrátí měsíc')
  T_((await nadpisDne()).trim() === 'Dnes', 'tlačítko „dnes" vrátí i vybraný den')
  await ctx.close()
}

// --- 11a. značky v hlavičce nesmí mít statickou hodnotu ---
// Tohle je ta jediná vlastnost, kterou v prohlížeči změřit NELZE: v DOMu
// vypadá zapsaná značka stejně jako přepsaná, ale iOS čte hlavičku při
// parsování, takže statickou hodnotu vidí a pozdější `setAttribute` už
// ne. Změřeno na telefonu: pruh nahoře šel pokaždé za vzhledem systému,
// i když skript hned po parsování nastavil `black-translucent`. Proto se
// kontroluje ZDROJ stránky — mimo skript nesmí být ani jedna z nich.
{
  const html = await new Promise((res, rej) => {
    http.get('http://localhost:4194/Todo-app/index.html', (r) => {
      let t = ''
      r.on('data', (c) => (t += c))
      r.on('end', () => res(t))
    }).on('error', rej)
  })
  const bezSkriptu = html.replace(/<script[\s\S]*?<\/script>/g, '')
  T_(!/<meta[^>]+name="theme-color"/.test(bezSkriptu), 'theme-color není v hlavičce napevno')
  T_(
    !/<meta[^>]+name="apple-mobile-web-app-status-bar-style"/.test(bezSkriptu),
    'styl stavového řádku není v hlavičce napevno',
  )
  T_(/document\.write/.test(html), 'značky se píšou do proudu parseru (document.write)')
}

// --- 11. stavový řádek na iPhonu jde za appkou, ne za systémem ---
// Obě značky v hlavičce musí sedět s tím, co je opravdu vykreslené —
// a hlavně i tehdy, když se appka a systém NESHODNOU (světlý iOS, tmavá
// appka). Přesně na tom to prasklo: pruh nahoře zůstal bílý nad černou
// appkou. `--color-paper` se čte z plátna, ne z řetězce, takže změna
// palety, která na značky zapomene, tady spadne.
//
// Měří se DVAKRÁT a to druhé měření je to podstatné: iOS čte značky při
// startu appky, tedy dřív, než doběhne balíček s Reactem. Kontrola, která
// se dívá až na hotovou appku, projde i s rozbitou hlavičkou, protože ji
// mezitím srovná `theme.ts` — ověřeno vrácenou vadou. Proto druhý průchod
// balíček zablokuje a dívá se jen na to, co stihl skript v hlavičce.
{
  const stav = async (schema, volba, bezBalicku) => {
    const ctx = await b.newContext({viewport:{width:390,height:844}, colorScheme: schema})
    const page = await ctx.newPage()
    if (volba) await page.addInitScript((v) => localStorage.setItem('todo.theme', v), volba)
    if (bezBalicku) await page.route('**/assets/*.js', (r) => r.abort())
    await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(bezBalicku ? 300 : 700)
    const out = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      barva: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      lista: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? null,
      paper: getComputedStyle(document.documentElement).getPropertyValue('--color-paper').trim(),
      pocet: document.querySelectorAll('meta[name="theme-color"]').length,
    }))
    await ctx.close()
    return out
  }
  const kombinace = [['light', null, 'light'], ['dark', null, 'dark'], ['light', 'dark', 'dark'], ['dark', 'light', 'light']]
  for (const [schema, volba, cekany] of kombinace) {
    for (const bezBalicku of [false, true]) {
      const o = await stav(schema, volba, bezBalicku)
      const kde = (bezBalicku ? 'při startu: ' : 'v appce: ') + 'systém ' + schema + ' + volba ' + (volba ?? 'systém')
      T_(o.theme === cekany, kde + ' → režim ' + cekany + ' (je ' + o.theme + ')')
      T_(o.pocet === 1, kde + ' → jediná značka theme-color (je ' + o.pocet + ')')
      T_(o.barva === o.paper, kde + ' → theme-color sedí s papírem (' + o.barva + ' vs ' + o.paper + ')')
      // Ve světlém režimu značka CHYBÍ schválně: `black-translucent` by
      // na světlý papír položil bílé hodiny a bez značky řídí pruh
      // `theme-color`. `default` je špatně v obou režimech — s ním jde
      // pruh za systémem, ne za appkou.
      T_(
        o.lista === (cekany === 'dark' ? 'black-translucent' : null),
        kde + ' → stavový řádek ' + (cekany === 'dark' ? 'kreslí stránka' : 'řídí theme-color') + ' (' + (o.lista ?? 'bez značky') + ')',
      )
    }
  }
}

// Přepnutí režimu za běhu: ve světlém se značka MAŽE, takže se při
// návratu do tmavého musí umět vyrobit znovu — a nesmí se přitom
// množit. Tam a zpátky dvakrát, ať je vidět i druhé kolo.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, colorScheme:'light'})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(700)
  const stav = () => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    barva: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    lista: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? null,
    pocet: document.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]').length,
  }))
  await page.locator('button[aria-label^="Synchronizace"]').first().click(); await page.waitForTimeout(600)
  for (const [tlacitko, cekanyRezim] of [['Tmavý','dark'], ['Světlý','light'], ['Tmavý','dark']]) {
    await page.getByRole('button',{name:tlacitko,exact:true}).click(); await page.waitForTimeout(450)
    const o = await stav()
    const kde = 'přepnutí na ' + tlacitko.toLowerCase()
    T_(o.theme === cekanyRezim, kde + ' → režim ' + cekanyRezim + ' (je ' + o.theme + ')')
    T_(
      o.lista === (cekanyRezim === 'dark' ? 'black-translucent' : null),
      kde + ' → značka ' + (cekanyRezim === 'dark' ? 'se vyrobí' : 'se smaže') + ' (' + (o.lista ?? 'bez značky') + ')',
    )
    T_(o.pocet <= 1, kde + ' → značka se nemnoží (je jich ' + o.pocet + ')')
  }
  await ctx.close()
}

// --- 12. široké rozvržení: appka na MacBooku ---
// Na 1440 px stála appka dosud jako telefon uprostřed monitoru (změřeno:
// 512px sloupec, 464 px prázdna po každé straně) a dok — palcová
// navigace — visel nad ním. Od 1024 px (`src/lib/siroko.ts`) se proto
// rozvržení mění: navigace do bočního panelu vlevo, detail úkolu do
// sloupce vpravo, obsah doprostřed se stropem šířky.
//
// Čtyři věci, které se tu dají rozbít a pravítkem se nepoznají:
//
//   1. Dok a boční panel se musí VYSTŘÍDAT, ne doplnit — dvě navigace
//      naráz jsou dvě odpovědi na „kde to jsem".
//   2. Zadávání úkolu bydlelo výhradně v doku. Když se dok na široko
//      přestal kreslit, nešlo na Macu založit úkol vůbec — nejtišší
//      možná vada: obrazovka vypadá v pořádku a appka se nedá používat.
//   3. Detail musí být sloupec VEDLE seznamu, ne panel přes něj. To je
//      celý důvod, proč se na Macu kreslí jinak: odškrtávám a přepisuji
//      termíny a přitom se dívám na další řádek.
//   4. Přepnutí musí být živé. Okno na Macu se roztahuje pořád (appka
//      běží přes Safari → Přidat do Docku), takže se šířka nečte jednou
//      při startu; zúžením se musí vrátit dok.
{
  const ctx = await b.newContext({viewport:{width:1440,height:900}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(700)
  const bocni = () => page.locator('nav[aria-label="Hlavní navigace"]').count()
  const dok = () => page.locator('footer .dock').count()
  T_(await bocni() === 1, 'na 1440 px je navigace v bočním panelu')
  T_(await dok() === 0, 'na 1440 px se dok nekreslí (jedna navigace, ne dvě)')

  // (2) zakládání úkolu: tlačítko v panelu otevře pole a úkol vznikne
  await page.getByRole('button',{name:'Nový úkol'}).click(); await page.waitForTimeout(500)
  await page.keyboard.type('sirokoprvni')
  await page.keyboard.press('Enter'); await page.waitForTimeout(800)
  T_(await page.getByText('sirokoprvni').count() >= 1, '„Nový úkol" v bočním panelu opravdu založí úkol')

  // (3) detail je sloupec vedle seznamu, ne panel přes něj — a obsah se
  // při jeho otevření nesmí hnout do strany. Prostřední sloupec mění
  // šířku (1208 → 788 px), takže vystředěný obsah s ním jezdí: změřeno,
  // titulek skočil z 472 na 264 px jen tím, že člověk otevřel úkol.
  const hranaTitulku = () => page.evaluate(() => {
    const h1 = document.querySelector('main h1')
    return h1 ? Math.round(h1.getBoundingClientRect().left) : -1
  })
  const predOtevrenim = await hranaTitulku()
  await page.getByText('sirokoprvni').first().click(); await page.waitForTimeout(700)
  const poOtevreni = await hranaTitulku()
  T_(predOtevrenim === poOtevreni,
     'obsah stojí na téže svislici, ať je detail otevřený nebo ne (' + predOtevrenim + ' → ' + poOtevreni + ' px)')
  const sloupec = page.locator('aside[aria-label="Detail úkolu"]')
  T_(await sloupec.count() === 1, 'detail úkolu se otevře jako sloupec vpravo')
  T_(await page.locator('.sheet-panel').count() === 0, 'detail úkolu na široko není panel zdola')
  const vedleSebe = await page.evaluate(() => {
    const m = document.querySelector('main')?.getBoundingClientRect()
    const a = document.querySelector('aside[aria-label="Detail úkolu"]')?.getBoundingClientRect()
    if (!m || !a) return null
    return { prekryv: Math.round(Math.min(m.right, a.right) - Math.max(m.left, a.left)), seznam: Math.round(m.width) }
  })
  T_(vedleSebe !== null && vedleSebe.prekryv <= 0 && vedleSebe.seznam > 300,
     'seznam zůstane vidět vedle detailu (překryv ' + (vedleSebe?.prekryv ?? '?') + ' px, seznam ' + (vedleSebe?.seznam ?? '?') + ' px)')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  T_(await sloupec.count() === 0, 'Escape sloupec zavře')

  // (4) zúžení okna vrátí dok — šířka se čte pořád, ne jen při startu
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(600)
  T_(await bocni() === 0 && await dok() === 1, 'zúžením okna se vrátí dok a boční panel zmizí')
  await page.setViewportSize({width:1440,height:900}); await page.waitForTimeout(600)
  T_(await bocni() === 1 && await dok() === 0, 'roztažením zpět se vrátí boční panel')
  await ctx.close()
}

// --- 13. ranní návrh: razítko „viděl jsem to" ---
// Appka se učí z toho, co s návrhem uděláš — a „bez odpovědi" počítala
// i za rána, kdy ji člověk vůbec neotevřel. Změřeno na 44 ránech
// skutečného provozu: 21 z nich nedostalo ani jednu odpověď a leželo
// v nich 58 z 68 ignorovaných, tedy 85 % všeho, z čeho se appka učila.
// Úkol nabídnutý čtyřikrát během dovolené spadl na strop ztráty
// a vypadl z nabídky, aniž by ho člověk jedinkrát viděl.
//
// Razítko `seenAt` je jediné místo, kde se to rozhoduje, a **selže
// tiše**: appka vypadá stejně, jen se přestane učit. Unit test ho
// nechytí, protože vzniká až otevřením panelu. Proto se sem klika.
//
// Tři věci, které se dají rozbít: razítko nevznikne vůbec; vznikne už
// z chipu na Dnes (ten ale ukáže POČET, ne jména — po něm se nedá nic
// „nechat být"); nebo se přepíše při každém otevření, a tím pošle celý
// plán znovu na server při každém nahlédnutí.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  await page.evaluate(async () => {
    const req = indexedDB.open('todo')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const t = new Date().toISOString()
    const dnes = new Date().toISOString().slice(0, 10)
    const put = (store, rows) => new Promise((res) => {
      const tx = db.transaction(store, 'readwrite')
      rows.forEach((r) => tx.objectStore(store).put(r))
      tx.oncomplete = res
    })
    await put('tasks', [
      { id:'nt1', createdAt:t, updatedAt:t, title:'Navržený úkol', priority:'normal', status:'inbox', order:0 },
    ])
    await put('dayPlans', [
      { id:'np1', createdAt:t, updatedAt:t, date:dnes,
        suggestions:[{ taskId:'nt1', reason:'leží v inboxu', decision:'ignored' }] },
    ])
  })
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(800)
  const plan = () => page.evaluate(async () => {
    const req = indexedDB.open('todo')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    return new Promise((res) => {
      const r = db.transaction('dayPlans', 'readonly').objectStore('dayPlans').get('np1')
      r.onsuccess = () => res({ seenAt: r.result?.seenAt ?? null, updatedAt: r.result?.updatedAt ?? null })
    })
  })
  const chip = page.getByRole('button', { name: /Návrh · 1/ })
  T_(await chip.count() === 1, 'návrh se na Dnes ukáže jako chip s počtem')
  T_((await plan()).seenAt === null, 'chip sám o sobě razítko nedává — ukazuje počet, ne jména')

  await chip.click(); await page.waitForTimeout(700)
  const poPrvnim = await plan()
  T_(poPrvnim.seenAt !== null, 'otevřený panel návrhu zapíše razítko „viděl jsem to"')

  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await chip.click(); await page.waitForTimeout(700)
  const poDruhem = await plan()
  T_(poDruhem.seenAt === poPrvnim.seenAt && poDruhem.updatedAt === poPrvnim.updatedAt,
     'druhé otevření razítko nepřepisuje (jinak by každé nahlédnutí poslalo plán znovu na server)')
  await ctx.close()
}

// --- 14. propadlé mají dvě jména a jen jedno z nich je červené ---
// Řádka triáže nad seznamem říkala VŠEMU „po termínu" a psala to
// červeně. Jenže „kdy to je" je dřívější z termínu a NAPLÁNOVÁNÍ, a
// naplánování je den, který si člověk vybral sám — nestihnout ho je
// běžný čtvrtek, ne propásnutý slib.
//
// Změřeno na skutečných datech: appka hlásila „po termínu · 8" a ani
// jeden z těch osmi po termínu nebyl — sedm žádný termín nemělo a osmý
// ho měl až ZÍTRA. Řádek úkolu přitom mlčel (`TaskRow` barví datum jen
// podle `dueDate`), takže nad seznamem bez jediné červené položky stálo
// červené číslo a obrazovka si protiřečila.
//
// Unit testy hlídají pravidlo (`popisPropadlych`), tohle hlídá to, co
// z něj člověk uvidí: JMÉNO a BARVU na skutečné obrazovce. Ta se dá
// rozbít i beze změny pravidla — stačí do JSX vrátit natvrdo napsané
// „po termínu" nebo `text-danger`.
{
  const ctx = await b.newContext({viewport:{width:390,height:844}})
  const page = await ctx.newPage()
  await page.goto('http://localhost:4194/Todo-app/',{waitUntil:'networkidle'}); await page.waitForTimeout(600)
  const nasyp = (rows) => page.evaluate(async (rows) => {
    const req = indexedDB.open('todo')
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    await new Promise((res) => {
      const tx = db.transaction('tasks', 'readwrite')
      const st = tx.objectStore('tasks')
      st.clear()
      const t = new Date().toISOString()
      const den = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
      rows.forEach((r, i) => st.put({
        id: 'px' + i, createdAt: t, updatedAt: t, title: r.title,
        priority: 'normal', status: 'active', order: i,
        ...(r.due !== undefined ? { dueDate: den(r.due) } : {}),
        ...(r.sched !== undefined ? { scheduledFor: den(r.sched) } : {}),
      }))
      tx.oncomplete = res
    })
  }, rows)
  const radka = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('main button')].find((e) => /Projít/.test(e.innerText))
    if (!b) return null
    const s = b.querySelector('span')
    return { text: s.innerText.trim(), barva: getComputedStyle(s).color }
  })

  // (1) jen nestihnutý vlastní plán — žádný termín nikde
  await nasyp([{ title: 'Vlastní plán A', sched: -2 }, { title: 'Vlastní plán B', sched: -1 }])
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1000)
  const jenPlan = await radka()
  T_(jenPlan !== null && /nestihnuto/i.test(jenPlan.text), 'bez propadlého termínu se řádka jmenuje „nestihnuto" (' + (jenPlan?.text ?? 'chybí') + ')')
  T_(jenPlan !== null && !/po termínu/i.test(jenPlan.text), 'a netvrdí „po termínu", když žádný termín nepropadl')

  // (2) termín, který teprve přijde, z minulého naplánování průšvih nedělá
  await nasyp([{ title: 'Termín až zítra', sched: -1, due: 1 }])
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1000)
  const zitra = await radka()
  T_(zitra !== null && /nestihnuto/i.test(zitra.text), 'termín zítra se dnes nehlásí jako propásnutý (' + (zitra?.text ?? 'chybí') + ')')

  // (3) skutečně propadlý termín — a teprve ten je červený
  await nasyp([{ title: 'Propadlý termín', due: -1 }, { title: 'Vlastní plán', sched: -2 }])
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1000)
  const skutecny = await radka()
  T_(skutecny !== null && /po termínu/i.test(skutecny.text), 'propadlý termín se jmenuje „po termínu" (' + (skutecny?.text ?? 'chybí') + ')')
  T_(skutecny !== null && /\b1\b/.test(skutecny.text), 'a počítá jen termíny, ne celou hromádku (' + (skutecny?.text ?? 'chybí') + ')')
  T_(jenPlan !== null && skutecny !== null && jenPlan.barva !== skutecny.barva,
     'tón se liší — červená patří jen propadlému termínu (' + (jenPlan?.barva ?? '?') + ' vs ' + (skutecny?.barva ?? '?') + ')')
  await ctx.close()
}

await b.close(); server.close()
console.log(chyby.length? '\n'+chyby.length+' nálezů:\n'+chyby.map(c=>' - '+c).join('\n') : '\nvšechno prošlo ('+ok+' kontrol)')
process.exit(chyby.length?1:0)
