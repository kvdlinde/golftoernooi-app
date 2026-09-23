// Regressietest: een admin-save mag nooit een hole-score overschrijven die een
// speler (of medespeler namens hem) ondertussen zelf via de gedeelde
// scorekaart heeft ingevoerd - zie slaScoreOp() / scSyncOfficieleScore() /
// resetScorekaart() in index.html. Bewaakt tegen het herintroduceren van de
// race condition die in v1.30.3 is opgelost.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if(!match) throw new Error('Kon geen <script>-blok vinden in index.html');
const src = match[1];

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
    function respond(data, status){ return Promise.resolve({ ok: status<400, status, text: async()=>JSON.stringify(data) }); }
    const store = table==='score_holes_log' ? fakeLog : table==='scores' ? fakeScores : null;
    if(!store) return respond([], 200);
    if(method==='GET'){
          let rows = store;
          for(const [k,v] of params.entries()){
                  if(k==='order') continue;
                  const m = v.match(/^eq\.(.*)$/);
                  if(m) rows = rows.filter(r=>String(r[k])===m[1]);
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

function makeElements(){
    const elements = {};
    function makeEl(id){
          const el = {
                  id, innerHTML:'', value:'', textContent:'', style:{}, _attr:{},
                  classList: { _set:new Set(), add(c){this._set.add(c);}, remove(c){this._set.delete(c);}, toggle(){}, contains(c){return this._set.has(c);} },
                  setAttribute(k,v){ this._attr[k]=v; }, getAttribute(k){ return this._attr[k]; },
                  appendChild(){}, focus(){}, select(){}, remove(){},
          };
          elements[id]=el; return el;
    }
    return {elements, makeEl};
}

async function run(){
    const {elements, makeEl} = makeElements();
    ['tc','scTee','moScore','panel-toernooi-detail','panel-beheer-toernooien'].forEach(makeEl);
    for(let i=0;i<18;i++) makeEl('h'+i);
    elements['scTee'].value = 't1';

  const documentStub = {
        getElementById(id){ return elements[id] || null; },
        createElement(){ return makeEl('tmp'+Math.random()); },
  };
    const sandbox = { console, document: documentStub, fetch: fakeFetch, setTimeout, clearTimeout, Promise, URLSearchParams, Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object, confirm: ()=>true };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

  vm.runInContext(`
      ingelogdAdmin = {id:'a1', naam:'Beheerder'};
          ingelogdSpeler = null;
              allSpelers = [ {id:'p1', naam:'Piet Jansen', exact_hcp:18} ];
                `, sandbox);

  const ctx = {
        rondeId: 'r1', spelerId: 'p1',
        holes: Array.from({length:18},(_,i)=>({par: i%4===0?5:4, si:i+1})),
        tees: [{id:'t1', kleur:'Geel', course_rating:70, slope_rating:120, par:72}],
        toernooi: {allowance_pct:100}, readOnly:false, currentPH: 18,
        existingScore: null, kolomSpelers:['p1'], log:[], kolomScores:[],
  };
    sandbox.window._scCtx = ctx;

  fakeLog.push(
    {id:'l1', ronde_id:'r1', speler_id:'p1', hole_index:0, door_speler_id:'p1', waarde:5, updated_at:'2026-01-01T00:00:00Z'},
    {id:'l2', ronde_id:'r1', speler_id:'p1', hole_index:1, door_speler_id:'p1', waarde:4, updated_at:'2026-01-01T00:01:00Z'},
    {id:'l3', ronde_id:'r1', speler_id:'p1', hole_index:2, door_speler_id:'p1', waarde:8, updated_at:'2026-01-01T00:02:00Z'},
      );
    fakeScores.push({id:'sc1', ronde_id:'r1', speler_id:'p1', tee_id:'t1', hole_scores:[5,4,8,...Array(15).fill(null)], playing_hcp:18});
    ctx.existingScore = fakeScores[0];

  for(let i=0;i<18;i++) elements['h'+i].value = '';
    elements['h0'].value = '5';
    elements['h1'].value = '4';
    elements['h2'].value = '6'; // admin corrigeert hole 3

  // Ondertussen voert de speler zelf onafhankelijk hole 4 in (admin weet dit nog niet)
  fakeLog.push({id:'l4', ronde_id:'r1', speler_id:'p1', hole_index:3, door_speler_id:'p1', waarde:4, updated_at:'2026-01-01T00:05:00Z'});

  await vm.runInContext('slaScoreOp()', sandbox);

  const finalLog = fakeLog.filter(l=>l.speler_id==='p1');
    const hole3Entry = finalLog.find(l=>l.hole_index===3);
    assert.ok(hole3Entry, 'de gelijktijdige invoer van de speler mag niet verdwijnen door de admin-save');
    assert.strictEqual(hole3Entry.waarde, 4);

  const hole2Entry = finalLog.find(l=>l.hole_index===2 && l.door_speler_id==='p1');
    assert.strictEqual(hole2Entry.waarde, 6, "admin's correctie moet wel worden toegepast");

  const finalScore = fakeScores.find(s=>s.speler_id==='p1');
    assert.strictEqual(finalScore.hole_scores[2], 6);
    assert.strictEqual(finalScore.hole_scores[3], 4, "de gelijktijdige speler-invoer moet ook in de scores-rij terechtkomen, niet teruggedraaid worden");

  console.log('[1/2] Admin-save overschrijft geen gelijktijdige speler-invoer: OK');

  vm.runInContext(`window._scCtx.existingScore = ${JSON.stringify(finalScore)};`, sandbox);
    await vm.runInContext('resetScorekaart()', sandbox);
    assert.strictEqual(fakeScores.find(s=>s.speler_id==='p1'), undefined);
    assert.strictEqual(fakeLog.filter(l=>l.speler_id==='p1').length, 0, 'resetScorekaart moet ook de invoerlog opruimen, anders herrijst de oude score');

  console.log('[2/2] resetScorekaart ruimt ook de invoerlog op: OK');
    console.log('ALLE ADMIN-RACE TESTS GESLAAGD');
}

run().catch(e=>{ console.error('TEST GEFAALD:', e); process.exit(1); });
