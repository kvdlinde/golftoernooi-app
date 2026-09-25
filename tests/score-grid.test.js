// Regressietest voor de gedeelde scorekaart (score_holes_log / scoreGridHtml /
// scCelStatus / scOfficieleWaarde / scGridCommit / scGridBlur) uit index.html.
// Draait in GitHub Actions bij elke push/PR — zie .github/workflows/test.yml.
//
// Aanpak: het <script>-blok uit index.html wordt in een geïsoleerde Node vm-
// context geladen met een nep-DOM en een nep-Supabase-backend (in-memory
// arrays), zodat de echte app-functies tegen realistische scenario's getest
// kunnen worden zonder een browser of een echte database nodig te hebben.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if(!match) throw new Error('Kon geen <script>-blok vinden in index.html');
const src = match[1];

// ---------- nep-Supabase-backend ----------
let fakeLog = [];
let fakeScores = [];
let idCounter = 1;
function newId(){ return 'id'+(idCounter++); }

function fakeFetch(url, opts){
  const path_ = url.split('/rest/v1/')[1];
  const [table, qs] = path_.split('?');
  const params = new URLSearchParams(qs||'');
  const method = (opts&&opts.method)||'GET';
  let body = null;
  if(opts && opts.body) body = JSON.parse(opts.body);

  function respond(data, status){
    return Promise.resolve({ ok: status < 400, status, text: async()=>JSON.stringify(data) });
  }

  const store = table==='score_holes_log' ? fakeLog : table==='scores' ? fakeScores : null;
  if(!store) return respond([], 200);

  if(method==='GET'){
    let rows = store;
    for(const [k,v] of params.entries()){
      if(k==='order') continue;
      const m = v.match(/^eq\.(.*)$/);
      if(m) rows = rows.filter(r=>String(r[k])===m[1]);
      const inM = v.match(/^in\.\((.*)\)$/);
      if(inM){ const ids = inM[1].split(','); rows = rows.filter(r=>ids.includes(String(r[k]))); }
    }
    return respond(rows, 200);
  }
  if(method==='POST'){
    const rows = Array.isArray(body) ? body : [body];
    const inserted = rows.map(r=>({id:newId(), created_at:new Date().toISOString(), ...r}));
    store.push(...inserted);
    return respond(inserted, 201);
  }
  if(method==='PATCH'){
    const idMatch = (params.get('id')||'').match(/^eq\.(.*)$/);
    const id = idMatch && idMatch[1];
    const rows = store.filter(r=>r.id===id);
    rows.forEach(r=>Object.assign(r, body));
    return respond(rows, 200);
  }
  if(method==='DELETE'){
    const idMatch = (params.get('id')||'').match(/^eq\.(.*)$/);
    const id = idMatch && idMatch[1];
    for(let i=store.length-1;i>=0;i--){ if(store[i].id===id) store.splice(i,1); }
    return respond(null, 204);
  }
  return respond([], 200);
}

// ---------- DOM-stub ----------
function makeElements(){
  const elements = {};
  function makeEl(id){
    const el = {
      _id: id, innerHTML:'', value:'', textContent:'', style:{}, _attr:{},
      classList: {
        _set: new Set(),
        add(c){ this._set.add(c); },
        remove(c){ this._set.delete(c); },
        toggle(c,f){ if(f===undefined){ if(this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if(f) this._set.add(c); else this._set.delete(c); },
        contains(c){ return this._set.has(c); }
      },
      setAttribute(k,v){ this._attr[k]=v; },
      getAttribute(k){ return this._attr[k]; },
      removeAttribute(k){ delete this._attr[k]; },
      appendChild(){}, focus(){ this._focused = true; }, select(){}, remove(){},
      get id(){ return this._id; },
      set id(v){ this._id = v; elements[v] = this; },
      get className(){ return this._className||''; },
      set className(v){ this._className = v; }
    };
    if(id!=null) elements[id] = el;
    return el;
  }
  return {elements, makeEl};
}

function buildSandbox(){
  const {elements, makeEl} = makeElements();
  ['tc','scBody','scGrid','scTee','scPHInfo','scNoTeeMsg','scEntryArea','scBruto','scNetto','scStbl','scOpslaanBtn','moScore','modals'].forEach(makeEl);
  elements['moScore'].classList.add('open');

  const documentStub = {
    getElementById(id){ return elements[id] || null; },
    activeElement: null,
    createElement(){ return makeEl(null); },
  };

  const sandbox = {
    console, document: documentStub, window: {}, fetch: fakeFetch,
    crypto: { getRandomValues(arr){ for(let i=0;i<arr.length;i++) arr[i]=Math.floor(Math.random()*256); }, subtle: {} },
    localStorage: {
      _s: {},
      getItem(k){ return (k in this._s) ? this._s[k] : null; },
      setItem(k,v){ this._s[k] = String(v); },
      removeItem(k){ delete this._s[k]; },
    },
    setTimeout, clearTimeout, Promise, URLSearchParams,
    Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return {sandbox, elements, makeEl};
}

async function run(){
  const {sandbox, elements, makeEl} = buildSandbox();
  vm.runInContext(src, sandbox, {filename:'index.html<script>'});

  vm.runInContext(`
    ingelogdAdmin = null;
    allSpelers = [
      {id:'p1', naam:'Piet Jansen', exact_hcp:18},
      {id:'p2', naam:'Anna Bakker', exact_hcp:12},
      {id:'p3', naam:'Kay Linde', exact_hcp:20},
      {id:'p4', naam:'Hans Stroeve', exact_hcp:22}
    ];
    ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18};
  `, sandbox);

  const ctx = {
    rondeId: 'r1',
    holes: Array.from({length:18},(_,i)=>({par: i%4===0?5:4, si:i+1})),
    tees: [{id:'t1', kleur:'Geel', course_rating:70, slope_rating:120, par:72}],
    toernooi: {allowance_pct:100}, readOnly: false, currentPH: 18, existingScore: null,
    spelerId: 'p1',
    flights: [{id:'f1', ronde_id:'r1', volgorde:1}],
    fSpelers: [
      {flight_id:'f1', speler_id:'p1', volgorde:1},
      {flight_id:'f1', speler_id:'p2', volgorde:2},
      {flight_id:'f1', speler_id:'p3', volgorde:3},
      {flight_id:'f1', speler_id:'p4', volgorde:4},
    ],
    log: [], kolomScores: [],
  };
  sandbox.window._scCtx = ctx;

  // 1. Kolomopbouw: zelf eerst, dan flight-genoten
  const kolom = vm.runInContext('scKolomSpelers(window._scCtx)', sandbox);
  assert.strictEqual(JSON.stringify(kolom), JSON.stringify(['p1','p2','p3','p4']));
  ctx.kolomSpelers = Array.from(kolom);

  // 2. Validatiestatus/weergave op MIJN EIGEN kolom (p1, ingelogd als p1):
  //    daar tellen alle onafhankelijke invoeren mee, ook die van derden —
  //    dat is precies het doel van cross-validatie op je eigen score.
  let st = vm.runInContext('scCelStatus(window._scCtx, "p1", 0)', sandbox);
  assert.strictEqual(st.status, 'empty');

  ctx.log.push({id:'l0', speler_id:'p1', hole_index:0, door_speler_id:'p1', waarde:5, updated_at:'2026-01-01T00:00:00Z'});
  ctx.log.push({id:'l0b', speler_id:'p1', hole_index:0, door_speler_id:'p3', waarde:5, updated_at:'2026-01-01T00:01:00Z'});
  st = vm.runInContext('scCelStatus(window._scCtx, "p1", 0)', sandbox);
  assert.strictEqual(st.status, 'validated', "op mijn eigen kolom telt de invoer van een medespeler (p3) gewoon mee");
  assert.strictEqual(st.waarde, 5);

  // 3. Validatiestatus/weergave op de kolom van een MEDESPELER (p2, bekeken
  //    door p1): een DERDE (p3) die voor p2 iets invult mag niet meetellen
  //    of zichtbaar zijn — alleen p2's eigen invoer en p1's eigen invoer.
  ctx.log.push({id:'l1', speler_id:'p2', hole_index:0, door_speler_id:'p3', waarde:5, updated_at:'2026-01-01T00:00:00Z'});
  st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
  assert.strictEqual(st.status, 'empty', "een invoer van een DERDE (niet ik, niet de kolomeigenaar zelf) mag bij mij niet zichtbaar zijn");
  assert.strictEqual(st.waarde, null);

  ctx.log.push({id:'l2', speler_id:'p2', hole_index:0, door_speler_id:'p1', waarde:5, updated_at:'2026-01-01T00:02:00Z'});
  st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
  assert.strictEqual(st.status, 'unvalidated', "nu ik zelf ook iets invulde, telt mijn eigen invoer mee (p3's invoer nog steeds niet)");
  assert.strictEqual(st.waarde, 5);

  ctx.log.push({id:'l2b', speler_id:'p2', hole_index:0, door_speler_id:'p2', waarde:5, updated_at:'2026-01-01T00:03:00Z'});
  st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
  assert.strictEqual(st.status, 'validated', "p2's eigen invoer komt overeen met mijn eigen invoer");

  ctx.log.push({id:'l3', speler_id:'p2', hole_index:1, door_speler_id:'p1', waarde:4, updated_at:'2026-01-01T00:02:00Z'});
  ctx.log.push({id:'l4', speler_id:'p2', hole_index:1, door_speler_id:'p2', waarde:6, updated_at:'2026-01-01T00:03:00Z'});
  st = vm.runInContext('scCelStatus(window._scCtx, "p2", 1)', sandbox);
  assert.strictEqual(st.status, 'mismatch');
  assert.strictEqual(st.waarde, 4, "op MIJN scherm toont de cel MIJN eigen invoer (4), niet die van p2 (6)");

  // Bevestig: op p2's eigen scherm (ingelogd als p2) toont dezelfde cel
  // p2's EIGEN invoer (6), en is nog steeds mismatch.
  vm.runInContext(`ingelogdSpeler = {id:'p2', naam:'Anna Bakker', exact_hcp:12};`, sandbox);
  st = vm.runInContext('scCelStatus(window._scCtx, "p2", 1)', sandbox);
  assert.strictEqual(st.status, 'mismatch');
  assert.strictEqual(st.waarde, 6, "op p2's EIGEN scherm toont dezelfde cel p2's eigen invoer (6)");
  vm.runInContext(`ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18};`, sandbox);

  console.log('[1/6] Validatiestatus/weergave — privacy tussen medespelers: OK');

  // 4. scOfficieleWaarde/scHoleScoresUitLog: uitsluitend iemands EIGEN
  //    invoer telt, GEEN fallback naar een medespeler die voor hem/haar
  //    invulde. Hans (p4) vult zelf niets in; Sierk-achtige medespeler p3
  //    tikt wel iets voor hem in — dat mag NIET zijn officiële score worden.
  ctx.log.push({id:'l5', speler_id:'p4', hole_index:0, door_speler_id:'p3', waarde:6, updated_at:'2026-01-01T00:00:00Z'});
  let officieel = vm.runInContext('scOfficieleWaarde(window._scCtx, "p4", 0)', sandbox);
  assert.strictEqual(officieel, null, "een medespeler-invoer mag NOOIT automatisch iemands officiële score worden");

  ctx.log.push({id:'l6', speler_id:'p4', hole_index:0, door_speler_id:'p4', waarde:7, updated_at:'2026-01-01T00:05:00Z'});
  officieel = vm.runInContext('scOfficieleWaarde(window._scCtx, "p4", 0)', sandbox);
  assert.strictEqual(officieel, 7, "zodra p4 zelf iets invult, is DAT zijn officiële score (niet de eerdere 6 van p3)");

  const holeScores = vm.runInContext('scHoleScoresUitLog(window._scCtx, "p4")', sandbox);
  assert.strictEqual(holeScores[0], 7);
  assert.strictEqual(holeScores[1], null, "holes die p4 zelf niet invulde blijven leeg, ook al bestaan er elders al gokjes van medespelers");

  console.log('[2/6] Officiële score kent geen fallback naar medespelers: OK');

  // 5. Volledige flow tegen de nep-backend: intikken, valideren, mismatch, wissen
  fakeLog = []; fakeScores = []; ctx.log = []; ctx.kolomScores = [];
  elements['scGrid'].innerHTML = vm.runInContext('scoreGridHtml(window._scCtx)', sandbox);
  makeEl('scc_1_0');

  elements['scc_1_0'].value = '4';
  await vm.runInContext('scGridCommit(1, 0, 18)', sandbox); // ingelogd als p1, kolom1=p2
  assert.strictEqual(fakeLog.length, 1);
  assert.ok(elements['scc_1_0'].className.includes('scc-unval'));

  let p2score = fakeScores.find(s=>s.speler_id==='p2');
  assert.ok(p2score, 'na de eerste invoer moet er een scores-rij voor p2 bestaan');
  assert.strictEqual(p2score.hole_scores[0], null, "de invoer kwam van p1 (een medespeler), niet van p2 zelf — dus nog geen officiële score voor p2");

  vm.runInContext(`ingelogdSpeler = {id:'p2', naam:'Anna Bakker', exact_hcp:12};`, sandbox);
  elements['scc_1_0'].value = '4';
  await vm.runInContext('scGridCommit(1, 0, 18)', sandbox); // p2 vult nu zelf hetzelfde in
  assert.ok(elements['scc_1_0'].className.includes('scc-val'), 'p2 eigen invoer + p1 eerdere invoer, gelijk -> gevalideerd (ingelogd als p2 zelf, dus alles telt mee)');
  p2score = fakeScores.find(s=>s.speler_id==='p2');
  assert.strictEqual(p2score.hole_scores[0], 4, "nu p2 zelf heeft ingevuld, is dat de officiële score");

  makeEl('scc_1_1');
  vm.runInContext(`ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18};`, sandbox);
  elements['scc_1_1'].value = '4';
  await vm.runInContext('scGridCommit(1, 1, 18)', sandbox); // p1 vult voor p2 een 4 in op hole 2
  vm.runInContext(`ingelogdSpeler = {id:'p2', naam:'Anna Bakker', exact_hcp:12};`, sandbox);
  elements['scc_1_1'].value = '6';
  await vm.runInContext('scGridCommit(1, 1, 18)', sandbox); // p2 vult voor zichzelf een 6 in op hole 2
  assert.ok(elements['scc_1_1'].className.includes('scc-mismatch'), 'twee onafhankelijke afwijkende invoeren moeten als mismatch tonen');
  assert.strictEqual(elements['scc_1_1'].value, 6, "de laatste her-render gebeurde vanuit p2's eigen sessie, dus toont p2's eigen invoer (6)");

  elements['scc_1_1'].value = '';
  await vm.runInContext('scGridBlur(1, 1)', sandbox); // p2 wist haar eigen invoer weer
  const remaining = fakeLog.filter(l=>l.speler_id==='p2' && l.hole_index===1);
  assert.strictEqual(remaining.length, 1, "wissen mag alleen de eigen invoer verwijderen, niet die van een ander");
  assert.strictEqual(remaining[0].door_speler_id, 'p1', "de overgebleven invoer is die van p1");

  console.log('[3/6] Volledige invoer/validatie/mismatch/wis-flow: OK');

  // 6. Subtotalenrij onderaan de gedeelde kaart: Bruto/Netto/STB per
  //    kolomspeler, zodat je in één oogopslag ziet hoe de flight ervoor
  //    staat. Gebruikt eerst ieders eigen OFFICIËLE invoer, en anders een
  //    conceptscore die ík (de kijker) zelf voor een medespeler heb
  //    ingetikt, nog vóórdat die het zelf heeft bevestigd. Zelfde
  //    privacyregel als de rest van de kaart blijft gelden: een gok van een
  //    DERDE (niet ik, niet de kolomeigenaar zelf) telt nooit mee. Netto/
  //    Stableford blijven '—' zolang iemands eigen playing hcp bij mij niet
  //    bekend is.
  fakeLog = []; fakeScores = []; ctx.log = []; ctx.kolomScores = [];
  ctx.spelerId = 'p1';
  vm.runInContext(`ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18};`, sandbox);

  ctx.log.push({id:'f1', speler_id:'p1', hole_index:0, door_speler_id:'p1', waarde:5, updated_at:'2026-01-01T00:00:00Z'});
  ctx.log.push({id:'f2', speler_id:'p1', hole_index:1, door_speler_id:'p1', waarde:4, updated_at:'2026-01-01T00:00:00Z'});
  ctx.log.push({id:'f3', speler_id:'p1', hole_index:2, door_speler_id:'p1', waarde:6, updated_at:'2026-01-01T00:00:00Z'});
  ctx.log.push({id:'f4', speler_id:'p2', hole_index:0, door_speler_id:'p2', waarde:4, updated_at:'2026-01-01T00:00:00Z'});
  ctx.log.push({id:'f5', speler_id:'p2', hole_index:1, door_speler_id:'p2', waarde:5, updated_at:'2026-01-01T00:00:00Z'});
  // p3 heeft zelf nog niets bevestigd — alleen een conceptscore die ík (p1,
  // de kijker) voor hem heb ingetikt. Die moet nu wél meetellen.
  ctx.log.push({id:'f6', speler_id:'p3', hole_index:0, door_speler_id:'p1', waarde:6, updated_at:'2026-01-01T00:00:00Z'});
  // p4: een DERDE (p2) heeft voor hem een gok ingetikt — dat blijft privé
  // tussen p2 en p4, en telt dus niet mee in mijn (p1's) werktotaal.
  ctx.log.push({id:'f7', speler_id:'p4', hole_index:0, door_speler_id:'p2', waarde:5, updated_at:'2026-01-01T00:00:00Z'});

  const gridHtml = vm.runInContext('scoreGridHtml(window._scCtx)', sandbox);
  assert.ok(gridHtml.includes('>Bruto<') && gridHtml.includes('>Netto<') && gridHtml.includes('>STB<'),
    'onder de gedeelde kaart moeten Bruto/Netto/STB-subtotaalrijen staan');

  const fvals = [...gridHtml.matchAll(/<div class="(sc-fval[^"]*)">([^<]*)<\/div>/g)].map(m=>({cls:m[1], val:m[2]}));
  assert.strictEqual(fvals.length, 12, 'moet 3 rijen x 4 kolommen (p1-p4) aan subtotaal-waarden bevatten');
  const [b1,b2,b3,b4, n1,n2,n3,n4, s1,s2,s3,s4] = fvals;

  assert.strictEqual(b1.val, '15', 'p1 bruto over de ingevulde holes (5+4+6)');
  assert.ok(b1.cls.includes('me'), 'mijn eigen kolom (p1) moet visueel als "me" gemarkeerd zijn, net als de kolomkop');
  assert.strictEqual(b2.val, '9', "p2 bruto over haar eigen ingevulde holes (4+5) — ongeacht dat haar playing hcp mij nog onbekend is");
  assert.ok(!b2.cls.includes('me'), 'p2 is niet "me"');
  assert.strictEqual(b3.val, '6', "p3 heeft zelf nog niets bevestigd, maar mijn eigen conceptscore voor hem telt nu wél mee in het werktotaal");
  assert.strictEqual(b4.val, '—', "de gok van een DERDE (p2) voor p4 blijft privé tussen hen en telt niet mee in mijn werktotaal");

  assert.notStrictEqual(n1.val, '—', 'mijn eigen netto is bekend (ik ken mijn eigen playing hcp)');
  assert.strictEqual(n2.val, '—', "p2's netto/stableford kan ik niet tonen zolang ik haar playing hcp niet ken");
  assert.strictEqual(n3.val, '—');
  assert.strictEqual(n4.val, '—');

  // Zodra p2's eigen playing hcp wél bekend is (bv. omdat ze zelf al een tee
  // gekozen en opgeslagen heeft), moet netto/stableford ook voor haar verschijnen.
  ctx.kolomScores.push({speler_id:'p2', playing_hcp:14});
  const gridHtml2 = vm.runInContext('scoreGridHtml(window._scCtx)', sandbox);
  const fvals2 = [...gridHtml2.matchAll(/<div class="sc-fval[^"]*">([^<]*)<\/div>/g)].map(m=>m[1]);
  assert.notStrictEqual(fvals2[5], '—', "zodra p2's playing hcp bekend is, moet haar netto wél verschijnen");

  // Bij een enkele kolom (geen flight) voegt de subtotalenrij niets toe aan
  // de losse Bruto/Netto/Stableford-tegels eronder — dan moet hij wegblijven.
  sandbox.__enkeleCtx = {...ctx, kolomSpelers:['p1']};
  const soloGridHtml = vm.runInContext('scoreGridHtml(window.__enkeleCtx)', sandbox);
  assert.ok(!soloGridHtml.includes('sc-fval') && !soloGridHtml.includes('sc-flabel'),
    'bij een losse kaart (geen flight) mag er geen subtotalenrij verschijnen');

  console.log('[4/6] Subtotalenrij per medespeler onderaan de gedeelde kaart: OK');

  // 7. Optioneel invoeren voor één medespeler via een vinkje in de kolomkop
  //    (scToggleMedespelerInvoer/scActieveKolommen/scActieveMedespelerKolom):
  //    standaard voer je alleen je eigen score in en zijn medespeler-kolommen
  //    gedimd en niet-invoerbaar (disabled) — pas als je er ÉÉN aanvinkt (bij
  //    een vierbal dus hooguit één tegelijk, een nieuwe vervangt de vorige)
  //    wordt precies die kolom ook invoerbaar. De spring-volgorde volgt dit:
  //    zonder aangevinkte medespeler spring je na je eigen invoer naar
  //    beneden (volgende hole); mét een aangevinkte medespeler spring je
  //    eerst naar rechts naar diens kolom, en pas na diens invoer naar
  //    beneden.
  fakeLog = []; fakeScores = []; ctx.log = []; ctx.kolomScores = [];
  ctx.spelerId = 'p1'; ctx.kolomSpelers = ['p1','p2','p3','p4'];
  vm.runInContext(`ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18}; localStorage.removeItem('scMedeInvoer_r1_p1');`, sandbox);

  // Pakt de HTML-blok van kolom ci in de headerrij (0-based, ikzelf is 0).
  function headBlok(gh, ci){
    const heads = [...gh.matchAll(/<div class="sc-head[^"]*">[\s\S]*?<\/div>/g)];
    return heads[ci] ? heads[ci][0] : '';
  }
  // Pakt de HTML van de invoer-cel (scc-wrap) voor kolom ci, hole i.
  function celBlok(gh, ci, i){
    const marker = `id="scc_${ci}_${i}"`;
    const idx = gh.indexOf(marker);
    if(idx<0) throw new Error('cel niet gevonden: kolom '+ci+', hole '+i);
    const wrapStart = gh.lastIndexOf('<div class="scc-wrap', idx);
    const wrapEnd = gh.indexOf('</div></div>', idx) + '</div></div>'.length;
    return gh.slice(wrapStart, wrapEnd);
  }

  let gh = vm.runInContext('scoreGridHtml(window._scCtx)', sandbox);
  assert.strictEqual((gh.match(/<input type="checkbox"/g)||[]).length, 3, 'de drie medespelers (p2,p3,p4) krijgen elk een vinkje, ikzelf (p1) niet');
  assert.ok(!headBlok(gh,0).includes('checkbox'), 'mijn eigen kolomkop (p1) krijgt geen vinkje');
  [1,2,3].forEach(ci=>{
    const head = headBlok(gh, ci);
    assert.ok(head.includes('sc-head-dim'), `kolom ${ci} moet standaard gedimd zijn (geen medespeler aangevinkt)`);
    assert.ok(!/checked/.test(head), `kolom ${ci} mag standaard niet aangevinkt zijn`);
    const cel = celBlok(gh, ci, 0);
    assert.ok(/\bdisabled\b/.test(cel), `invoercel van kolom ${ci} moet standaard disabled zijn`);
    assert.ok(cel.includes('scc-wrap-dim'), `invoercel van kolom ${ci} moet standaard gedimd zijn`);
  });
  let celEigen = celBlok(gh, 0, 0);
  assert.ok(!/\bdisabled\b/.test(celEigen), 'mijn eigen invoercel mag nooit disabled zijn');
  assert.ok(!celEigen.includes('scc-wrap-dim'), 'mijn eigen invoercel mag nooit gedimd zijn');

  // Vink p3 (kolomindex 2) aan als medespeler voor wie ik ook invoer.
  vm.runInContext('scToggleMedespelerInvoer(2)', sandbox);
  gh = elements['scGrid'].innerHTML;
  assert.ok(headBlok(gh,2).includes('checked'), 'p3 (kolom 2) moet nu aangevinkt zijn');
  assert.ok(!headBlok(gh,2).includes('sc-head-dim'), 'p3 (kolom 2) mag niet meer gedimd zijn');
  assert.ok(!/\bdisabled\b/.test(celBlok(gh,2,0)), 'p3 (kolom 2) moet nu invoerbaar zijn');
  [1,3].forEach(ci=>{
    assert.ok(headBlok(gh,ci).includes('sc-head-dim') && !headBlok(gh,ci).includes('checked'), `kolom ${ci} moet gedimd en niet aangevinkt blijven — maar één medespeler tegelijk actief`);
    assert.ok(/\bdisabled\b/.test(celBlok(gh,ci,0)), `kolom ${ci} moet disabled blijven`);
  });
  assert.strictEqual((gh.match(/checked/g)||[]).length, 1, 'precies één medespeler-vinkje mag aangevinkt zijn');

  // Nu p4 (kolomindex 3) aanvinken vervangt p3 automatisch (nooit twee tegelijk).
  vm.runInContext('scToggleMedespelerInvoer(3)', sandbox);
  gh = elements['scGrid'].innerHTML;
  assert.ok(headBlok(gh,3).includes('checked') && !headBlok(gh,3).includes('sc-head-dim'), 'p4 (kolom 3) is nu de actieve medespeler');
  assert.ok(headBlok(gh,2).includes('sc-head-dim') && !headBlok(gh,2).includes('checked'), 'p3 (kolom 2) dimt weer mee zodra een andere medespeler wordt aangevinkt');
  assert.strictEqual((gh.match(/checked/g)||[]).length, 1, 'ook na het wisselen mag maar één medespeler-vinkje aangevinkt zijn');

  // Nogmaals p4 aanvinken (uitvinken) gaat terug naar de standaard: niemand aangevinkt.
  vm.runInContext('scToggleMedespelerInvoer(3)', sandbox);
  gh = elements['scGrid'].innerHTML;
  assert.strictEqual((gh.match(/checked/g)||[]).length, 0, 'nogmaals aanvinken van dezelfde medespeler vinkt hem weer uit');
  [1,2,3].forEach(ci=>assert.ok(headBlok(gh,ci).includes('sc-head-dim'), `kolom ${ci} moet weer gedimd zijn nadat alles is uitgevinkt`));

  // Spring-volgorde, standaard (niemand aangevinkt): na mijn eigen invoer op
  // hole 1 springt de cursor naar mijn eigen kolom van hole 2, NIET naar een
  // (gedimde) medespeler-kolom.
  makeEl('scc_0_0'); makeEl('scc_0_1'); makeEl('scc_2_0');
  elements['scGrid'].innerHTML = gh;
  elements['scc_0_0'].value = '4';
  await vm.runInContext('scGridCommit(0, 0, 18)', sandbox);
  assert.ok(elements['scc_0_1']._focused, 'zonder aangevinkte medespeler moet de cursor na mijn eigen invoer naar mijn eigen kolom van de volgende hole springen');
  assert.ok(!elements['scc_2_0']._focused, 'zonder aangevinkte medespeler mag de cursor niet naar een medespeler-kolom springen');

  // Spring-volgorde met p3 (kolom 2) aangevinkt: na mijn eigen invoer op hole 1
  // eerst naar RECHTS naar p3's kolom op diezelfde hole, en pas na haar/zijn
  // invoer naar beneden naar mijn eigen kolom van hole 2.
  vm.runInContext('scToggleMedespelerInvoer(2)', sandbox);
  makeEl('scc_0_0'); makeEl('scc_2_0'); makeEl('scc_0_1');
  elements['scc_0_0'].value = '5';
  await vm.runInContext('scGridCommit(0, 0, 18)', sandbox);
  assert.ok(elements['scc_2_0']._focused, 'met p3 aangevinkt moet de cursor na mijn eigen invoer naar rechts springen naar p3 haar kolom');
  assert.ok(!elements['scc_0_1']._focused, 'nog niet naar de volgende hole — eerst p3 haar invoer op deze hole');

  elements['scc_2_0'].value = '5';
  await vm.runInContext('scGridCommit(2, 0, 18)', sandbox);
  assert.ok(elements['scc_0_1']._focused, 'na p3 haar invoer op deze hole springt de cursor naar beneden, naar mijn eigen kolom van de volgende hole');

  console.log('[5/6] Optioneel invoeren voor één medespeler (vinkje) + aangepaste spring-volgorde: OK');

  // 8. Geen flight (of geen startlijst in gebruik) -> gewoon terug naar 1 kolom, geen crash
  const soloCtx = {spelerId:'p1', flights:[], fSpelers:[]};
  sandbox.window._scCtx = soloCtx;
  const soloKolom = vm.runInContext('scKolomSpelers(window._scCtx)', sandbox);
  assert.strictEqual(JSON.stringify(soloKolom), JSON.stringify(['p1']));

  console.log('[6/6] Fallback zonder flight: OK');
  console.log('ALLE SCORE-GRID TESTS GESLAAGD');
}

run().catch(e=>{ console.error('TEST GEFAALD:', e); process.exit(1); });
