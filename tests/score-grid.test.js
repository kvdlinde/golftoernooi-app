// Regressietest voor de gedeelde scorekaart (score_holes_log / scoreGridHtml /
// scCelStatus / scGridCommit / scGridBlur) uit index.html. Draait in GitHub
// Actions bij elke push/PR - zie .github/workflows/test.yml.
//
// Aanpak: het <script>-blok uit index.html wordt in een geisoleerde Node vm-
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
                  id, innerHTML:'', value:'', textContent:'', style:{}, _attr:{},
                  classList: {
                            _set: new Set(),
                            add(c){ this._set.add(c); },
                            remove(c){ this._set.delete(c); },
                            toggle(c,f){ if(f===undefined){ if(this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if(f) this._set.add(c); else this._set.delete(c); },
                            contains(c){ return this._set.has(c); }
                  },
                  setAttribute(k,v){ this._attr[k]=v; },
                  getAttribute(k){ return this._attr[k]; },
                  appendChild(){}, focus(){ this._focused = true; }, select(){}, remove(){},
                  get className(){ return this._className||''; },
                  set className(v){ this._className = v; }
          };
          elements[id] = el;
          return el;
    }
    return {elements, makeEl};
}

function buildSandbox(){
    const {elements, makeEl} = makeElements();
    ['tc','scBody','scGrid','scTee','scPHInfo','scNoTeeMsg','scEntryArea','scBruto','scNetto','scStbl','scOpslaanBtn','moScore'].forEach(makeEl);
    elements['moScore'].classList.add('open');

  const documentStub = {
        getElementById(id){ return elements[id] || null; },
        activeElement: null,
        createElement(){ return makeEl('tmp'+Math.random()); },
  };

  const sandbox = {
        console, document: documentStub, window: {}, fetch: fakeFetch,
        crypto: { getRandomValues(arr){ for(let i=0;i<arr.length;i++) arr[i]=Math.floor(Math.random()*256); }, subtle: {} },
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
                            {id:'p3', naam:'Kay Linde', exact_hcp:20}
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
              ],
        log: [], kolomScores: [],
  };
    sandbox.window._scCtx = ctx;

  // 1. Kolomopbouw: zelf eerst, dan flight-genoten (max 3 extra)
  const kolom = vm.runInContext('scKolomSpelers(window._scCtx)', sandbox);
    assert.strictEqual(JSON.stringify(kolom), JSON.stringify(['p1','p2','p3']));
    ctx.kolomSpelers = Array.from(kolom);

  // 2. Validatiestatus: leeg / 1 invoer / 2 gelijke / 2 verschillende
  let st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
    assert.strictEqual(st.status, 'empty');

  ctx.log.push({id:'l1', speler_id:'p2', hole_index:0, door_speler_id:'p1', waarde:5, updated_at:'2026-01-01T00:00:00Z'});
    st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
    assert.strictEqual(st.status, 'unvalidated');
    assert.strictEqual(st.waarde, 5);

  ctx.log.push({id:'l2', speler_id:'p2', hole_index:0, door_speler_id:'p3', waarde:5, updated_at:'2026-01-01T00:01:00Z'});
    st = vm.runInContext('scCelStatus(window._scCtx, "p2", 0)', sandbox);
    assert.strictEqual(st.status, 'validated');

  ctx.log.push({id:'l3', speler_id:'p2', hole_index:1, door_speler_id:'p1', waarde:4, updated_at:'2026-01-01T00:02:00Z'});
    ctx.log.push({id:'l4', speler_id:'p2', hole_index:1, door_speler_id:'p2', waarde:6, updated_at:'2026-01-01T00:03:00Z'});
    st = vm.runInContext('scCelStatus(window._scCtx, "p2", 1)', sandbox);
    assert.strictEqual(st.status, 'mismatch');
    assert.strictEqual(st.waarde, 6, 'bij een mismatch moet de eigen invoer van de speler leidend blijven');

  console.log('[1/3] Validatiestatus-logica: OK');

  // 3. Volledige flow tegen de nep-backend: intikken, valideren, mismatch, wissen
  fakeLog = []; fakeScores = []; ctx.log = []; ctx.kolomScores = [];
    elements['scGrid'].innerHTML = vm.runInContext('scoreGridHtml(window._scCtx)', sandbox);
    makeEl('scc_1_0');

  elements['scc_1_0'].value = '4';
    await vm.runInContext('scGridCommit(1, 0, 18)', sandbox);
    assert.strictEqual(fakeLog.length, 1);
    assert.ok(elements['scc_1_0'].className.includes('scc-unval'));

  let p2score = fakeScores.find(s=>s.speler_id==='p2');
    assert.ok(p2score, 'na de eerste invoer moet er een scores-rij voor p2 bestaan');
    assert.strictEqual(p2score.hole_scores[0], 4);

  vm.runInContext(`ingelogdSpeler = {id:'p3', naam:'Kay Linde', exact_hcp:20};`, sandbox);
    elements['scc_1_0'].value = '4';
    await vm.runInContext('scGridCommit(1, 0, 18)', sandbox);
    assert.ok(elements['scc_1_0'].className.includes('scc-val'), 'twee onafhankelijke gelijke invoeren moeten valideren');

  makeEl('scc_1_1');
    elements['scc_1_1'].value = '4';
    await vm.runInContext('scGridCommit(1, 1, 18)', sandbox);
    vm.runInContext(`ingelogdSpeler = {id:'p1', naam:'Piet Jansen', exact_hcp:18};`, sandbox);
    elements['scc_1_1'].value = '6';
    await vm.runInContext('scGridCommit(1, 1, 18)', sandbox);
    assert.ok(elements['scc_1_1'].className.includes('scc-mismatch'), 'twee onafhankelijke afwijkende invoeren moeten als mismatch tonen');
    assert.strictEqual(elements['scc_1_1'].value, 4, 'de weergegeven score mag bij een mismatch niet stiekem veranderen');

  elements['scc_1_1'].value = '';
    await vm.runInContext('scGridBlur(1, 1)', sandbox);
    const remaining = fakeLog.filter(l=>l.speler_id==='p2' && l.hole_index===1);
    assert.strictEqual(remaining.length, 1, "wissen mag alleen de eigen invoer verwijderen, niet die van een ander");

  console.log('[2/3] Volledige invoer/validatie/mismatch/wis-flow: OK');

  // 4. Geen flight (of geen startlijst in gebruik) -> gewoon terug naar 1 kolom, geen crash
  const soloCtx = {spelerId:'p1', flights:[], fSpelers:[]};
    sandbox.window._scCtx = soloCtx;
    const soloKolom = vm.runInContext('scKolomSpelers(window._scCtx)', sandbox);
    assert.strictEqual(JSON.stringify(soloKolom), JSON.stringify(['p1']));

  console.log('[3/3] Fallback zonder flight: OK');
    console.log('ALLE SCORE-GRID TESTS GESLAAGD');
}

run().catch(e=>{ console.error('TEST GEFAALD:', e); process.exit(1); });
