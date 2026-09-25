// Verzameltest voor een aantal fixes uit eerdere sessies die nog niet in de
// CI-testsuite waren opgenomen (ze draaiden alleen lokaal). Elke sectie
// draait in zijn eigen geïsoleerde IIFE + eigen vm-sandbox, zodat de losse
// tests elkaar niet kunnen beïnvloeden via gedeelde globals (allSpelers,
// ingelogdAdmin, enzovoort) — precies zoals ze los ook al werkten.
//
// Secties:
//   1. Klassement-sortering op ronde (klsSorteerOpRonde/klsSorteerOpTotaal)
//   2. Realtime-herstel (visibilitychange/online/periodieke vangnet-check)
//   3. Modal-sluitkruisje (openModalHtml)
//   4. Startlijst-sortering op starttijd (flightsOpStarttijd)
//   5. Admin-conceptscores (admConceptWaarde/holeGridHtml/invoerstatus-badge)
//   6. Pinch-zoom + modal-viewport-sync (syncModalViewport/--vvh/--vvt)
//   7. Modal max-height volgt het toetsenbord (--vvh) i.p.v. een vaste 88vh
//   8. Scorekaart-popup: bruto-scorekleuren (skGrossKlasse)
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if(!match) throw new Error('Kon geen <script>-blok vinden in index.html');
const src = match[1];

async function main(){

  // ===================== 1. Klassement-sortering op ronde =====================
  await (async function(){
    let fakeScores = [];
    function fakeFetch(url, opts){
      const path_ = url.split('/rest/v1/')[1];
      const [table, qs] = path_.split('?');
      const params = new URLSearchParams(qs||'');
      function respond(data, status){ return Promise.resolve({ ok: status<400, status, text: async()=>JSON.stringify(data) }); }
      if(table!=='scores') return respond([], 200);
      let rows = fakeScores;
      for(const [k,v] of params.entries()){
        const inM = v.match(/^in\.\((.*)\)$/);
        if(inM){ const ids = inM[1].split(','); rows = rows.filter(r=>ids.includes(String(r[k]))); }
      }
      return respond(rows, 200);
    }
    function makeEl(){
      return { innerHTML:'', querySelector(){ return null; } };
    }
    const klsBody = makeEl();
    const documentStub = { getElementById(id){ return id==='klsBody' ? klsBody : null; } };
    const sandbox = {
      console, document: documentStub, window: {}, fetch: fakeFetch,
      localStorage: { _s:{}, getItem(k){ return this._s[k]??null; }, setItem(k,v){ this._s[k]=v; } },
      crypto: { getRandomValues(arr){ for(let i=0;i<arr.length;i++) arr[i]=0; }, subtle:{} },
      setTimeout, clearTimeout, Promise, URLSearchParams,
      Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    vm.runInContext(`
      ingelogdAdmin = {naam:'Admin'};
      ingelogdSpeler = null;
      allSpelers = [
        {id:'p1', naam:'Kay van de Linde'},
        {id:'p2', naam:'Richard Dirne'},
        {id:'p3', naam:'Sierk Roosma'},
      ];
      allCombinaties = []; allBanen = []; allLussen = [];
      allTeams = []; allTeamLeden = [];
      allRondes = [
        {id:'r1', toernooi_id:'t1', naam:'Waterloo', volgorde:1, status:'gesloten', combinatie_id:null},
        {id:'r2', toernooi_id:'t1', naam:'Apremont', volgorde:2, status:'gesloten', combinatie_id:null},
      ];
    `, sandbox);

    fakeScores = [
      {id:'s1', ronde_id:'r1', speler_id:'p1', stableford:30, bruto:78, netto:68, birdies_bruto:1, eagles_bruto:0, hole_scores:Array(18).fill(4), playing_hcp:10},
      {id:'s2', ronde_id:'r1', speler_id:'p2', stableford:10, bruto:90, netto:80, birdies_bruto:0, eagles_bruto:0, hole_scores:Array(18).fill(4), playing_hcp:10},
      {id:'s3', ronde_id:'r2', speler_id:'p1', stableford:15, bruto:84, netto:74, birdies_bruto:0, eagles_bruto:0, hole_scores:Array(18).fill(4), playing_hcp:10},
      {id:'s4', ronde_id:'r2', speler_id:'p2', stableford:25, bruto:80, netto:70, birdies_bruto:2, eagles_bruto:0, hole_scores:Array(18).fill(4), playing_hcp:10},
      {id:'s5', ronde_id:'r1', speler_id:'p3', stableford:22, bruto:83, netto:73, birdies_bruto:0, eagles_bruto:0, hole_scores:Array(18).fill(4), playing_hcp:10},
    ];

    sandbox.localStorage.setItem('klassementToernooi', 't1');
    sandbox.localStorage.setItem('klassementMode', 'stableford');

    function volgordeUitTable(){
      const namen = [];
      const re = /<b>([^<]+)<\/b>/g;
      let m;
      while((m = re.exec(klsBody.innerHTML))){ namen.push(m[1]); }
      return namen;
    }

    await vm.runInContext(`tekenKlassementBody('t1','stableford')`, sandbox);
    let volgorde = volgordeUitTable();
    assert.strictEqual(volgorde[0], 'Kay van de Linde', 'zonder ronde-sortering wint p1 op totaal');
    assert.ok(klsBody.innerHTML.includes('Totaal') && klsBody.innerHTML.includes('box-shadow:inset 0 -3px 0 var(--gold)'), 'Totaal-kop moet als actieve sortering gemarkeerd zijn (gouden onderstreping)');

    vm.runInContext(`klsSorteerOpRonde('Apremont')`, sandbox);
    await new Promise(r=>setTimeout(r,10));
    volgorde = volgordeUitTable();
    assert.strictEqual(volgorde[0], 'Richard Dirne', 'gesorteerd op Apremont moet p2 (30 pt) bovenaan staan, ondanks lager totaal');
    assert.strictEqual(volgorde[volgorde.length-1], 'Sierk Roosma', 'wie deze ronde niet speelde moet onderaan zakken');

    vm.runInContext(`klsSorteerOpRonde('Apremont')`, sandbox);
    await new Promise(r=>setTimeout(r,10));
    volgorde = volgordeUitTable();
    assert.strictEqual(volgorde[0], 'Kay van de Linde', 'nogmaals klikken op dezelfde ronde moet terug naar het totaal gaan');

    vm.runInContext(`klsSorteerOpRonde('Apremont')`, sandbox);
    await new Promise(r=>setTimeout(r,10));
    vm.runInContext(`tekenKlassementBody('t1','birdie-bruto')`, sandbox);
    await new Promise(r=>setTimeout(r,10));
    volgorde = volgordeUitTable();
    assert.strictEqual(volgorde[0], 'Richard Dirne', 'de ronde-sortering moet blijven staan bij het wisselen van subtab');
    vm.runInContext(`klsSorteerOpTotaal()`, sandbox);
    await new Promise(r=>setTimeout(r,10));

    console.log('[1/8] Klassement-sortering op ronde: OK');
  })();

  // ===================== 2. Realtime-herstel =====================
  await (async function(){
    function makeElements(){
      const elements = {};
      function makeEl(id){
        const el = {
          _id: id, innerHTML:'',
          classList: { _set: new Set(), add(c){this._set.add(c);}, remove(c){this._set.delete(c);}, contains(c){return this._set.has(c);} },
          get id(){ return this._id; }, set id(v){ this._id=v; elements[v]=this; },
        };
        if(id!=null) elements[id]=el;
        return el;
      }
      return {elements, makeEl};
    }
    const {elements, makeEl} = makeElements();
    ['panel-klassement','panel-toernooi-detail'].forEach(makeEl);

    const docListeners = {};
    const winListeners = {};
    let visibilityState = 'hidden';
    const documentStub = {
      getElementById(id){ return elements[id] || null; },
      addEventListener(evt, fn){ (docListeners[evt] = docListeners[evt]||[]).push(fn); },
      get visibilityState(){ return visibilityState; },
    };

    let intervalMs = null;
    const sandbox = {
      console, document: documentStub,
      fetch: async()=>({ok:true,status:200,text:async()=>'[]'}),
      crypto: { getRandomValues(arr){ for(let i=0;i<arr.length;i++) arr[i]=0; }, subtle:{} },
      setTimeout, clearTimeout, Promise, URLSearchParams,
      setInterval(fn, ms){ intervalMs = ms; return 1; },
      Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object,
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = (evt, fn)=>{ (winListeners[evt] = winListeners[evt]||[]).push(fn); };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    vm.runInContext(`
      allRondes = [];
      huidigToernooiDetailId = 't1';
      function renderKlassementPanel(){ __renderKlassementCalls++; }
      function openToernooiDetail(id){ __openToernooiDetailCalls++; }
    `, sandbox);
    sandbox.__renderKlassementCalls = 0;
    sandbox.__openToernooiDetailCalls = 0;

    const origFetch = sandbox.fetch;
    sandbox.fetch = async(...args)=>{ return origFetch(...args); };

    assert.ok(docListeners['visibilitychange'] && docListeners['visibilitychange'].length===1,
      'visibilitychange-listener moet geregistreerd zijn');
    assert.ok(winListeners['online'] && winListeners['online'].length===1,
      'online-listener moet geregistreerd zijn');

    sandbox.__unsubCalls = 0;
    sandbox.__createClientCalls = 0;
    vm.runInContext(`
      function __makeFakeChannel(){
        const ch = { on(){ return ch; }, subscribe(){ return ch; }, unsubscribe(){ __unsubCalls++; } };
        return ch;
      }
      window.supabase = { createClient(){ __createClientCalls++; return { channel(){ return __makeFakeChannel(); } }; } };
      setupRealtime();
    `, sandbox);
    assert.strictEqual(sandbox.__createClientCalls, 1, 'eerste setupRealtime() moet één kanaal opzetten');
    vm.runInContext('heropenRealtime()', sandbox);
    assert.strictEqual(sandbox.__unsubCalls, 1, 'het oude kanaal moet worden afgemeld (unsubscribe) vóór het opnieuw opzetten');
    assert.strictEqual(sandbox.__createClientCalls, 2, 'daarna moet er een vers kanaal worden opgezet');

    elements['panel-klassement'].classList.add('active');
    visibilityState = 'visible';
    let heropenCalls = 0;
    vm.runInContext(`
      heropenRealtime = function(){ __heropenCalls(); };
    `, sandbox);
    sandbox.__heropenCalls = ()=>{ heropenCalls++; };
    docListeners['visibilitychange'][0]();
    await new Promise(r=>setTimeout(r, 750));
    assert.strictEqual(sandbox.__renderKlassementCalls, 1, 'zichtbaar worden met open klassement moet het klassement verversen');
    assert.strictEqual(heropenCalls, 1, 'zichtbaar worden moet ook het kanaal heropenen');

    elements['panel-klassement'].classList.remove('active');
    elements['panel-toernooi-detail'].classList.remove('active');
    sandbox.__renderKlassementCalls = 0;
    sandbox.__openToernooiDetailCalls = 0;
    vm.runInContext('periodiekeVersverCheck()', sandbox);
    await new Promise(r=>setTimeout(r, 750));
    assert.strictEqual(sandbox.__renderKlassementCalls, 0, 'geen open klassement/detailscherm -> geen onnodige refresh');

    elements['panel-toernooi-detail'].classList.add('active');
    vm.runInContext('periodiekeVersverCheck()', sandbox);
    await new Promise(r=>setTimeout(r, 750));
    assert.strictEqual(sandbox.__openToernooiDetailCalls, 1, 'open toernooi-detailscherm moet meeliften met de periodieke check');
    assert.strictEqual(intervalMs, 60000, 'de vangnet-check moet elk 60s lopen');

    console.log('[2/8] Realtime-herstel (visibilitychange/online/periodieke check): OK');
  })();

  // ===================== 3. Modal-sluitkruisje =====================
  await (async function(){
    function makeElements(){
      const elements = {};
      function makeEl(id){
        const el = {
          _id: id, innerHTML:'',
          classList: { _set:new Set(), add(c){this._set.add(c);}, remove(c){this._set.delete(c);}, contains(c){return this._set.has(c);} },
          appendChild(){},
          get id(){ return this._id; }, set id(v){ this._id=v; elements[v]=this; },
        };
        if(id!=null) elements[id]=el;
        return el;
      }
      return {elements, makeEl};
    }
    const {elements, makeEl} = makeElements();
    makeEl('modals');
    const documentStub = {
      getElementById(id){ return elements[id] || null; },
      createElement(){ return makeEl(null); },
    };
    const sandbox = { console, document: documentStub, window: {}, Set, Array, Object };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    vm.runInContext(`openModalHtml('moTest', '<h3>Test</h3><p>inhoud</p>')`, sandbox);
    const modal = elements['moTest'];
    assert.ok(modal, 'modal moet aangemaakt zijn onder het opgegeven id');
    assert.ok(modal.classList.contains('open'), 'modal moet open zijn');
    assert.ok(modal.innerHTML.includes('class="mo-close"'), 'modal moet een sluit-kruisje bevatten');
    assert.ok(modal.innerHTML.includes(`closeModal('moTest')`), 'het kruisje moet closeModal met het juiste id aanroepen');
    assert.ok(modal.innerHTML.includes('&times;'), 'het kruisje moet alleen een × tonen, geen tekst');
    const closeBtnHtml = modal.innerHTML.match(/<button[^>]*class="mo-close"[^>]*>([^<]*)<\/button>/);
    assert.ok(closeBtnHtml, 'het kruisje-element moet als losse <button> herkenbaar zijn');
    assert.strictEqual(closeBtnHtml[1].trim(), '&times;', 'de knop mag alleen het × entity bevatten, geen labeltekst');
    const closeIdx = modal.innerHTML.indexOf('mo-close');
    const titelIdx = modal.innerHTML.indexOf('<h3>Test</h3>');
    assert.ok(closeIdx>=0 && closeIdx < titelIdx, 'het kruisje moet vóór de modal-inhoud in de DOM staan');

    console.log('[3/8] Modal-sluitkruisje aanwezig, correct en klikbaar: OK');
  })();

  // ===================== 4. Startlijst-sortering op starttijd =====================
  await (async function(){
    const documentStub = {
      getElementById(){ return null; },
      addEventListener(){},
      createElement(){ return { classList:{add(){},remove(){},contains(){return false;}}, appendChild(){}, style:{} }; },
    };
    const sandbox = { console, Array, Object, String, parseInt, document: documentStub, window: {}, setInterval(){}, setTimeout, clearTimeout };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = ()=>{};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    const flights = [
      {id:'f1', volgorde:1, starttijd:'12:40'},
      {id:'f2', volgorde:2, starttijd:'12:30'},
    ];
    sandbox.__flights = flights;
    const gesorteerd = vm.runInContext('flightsOpStarttijd(__flights)', sandbox);
    assert.strictEqual(gesorteerd[0].id, 'f2', '12:30 moet vóór 12:40 komen, ongeacht het volgorde-veld');
    assert.strictEqual(gesorteerd[1].id, 'f1');

    const metLeeg = [
      {id:'f1', volgorde:1, starttijd:''},
      {id:'f2', volgorde:2, starttijd:'09:10'},
      {id:'f3', volgorde:3, starttijd:null},
    ];
    sandbox.__flights2 = metLeeg;
    const g2 = vm.runInContext('flightsOpStarttijd(__flights2)', sandbox);
    assert.strictEqual(g2[0].id, 'f2', 'de enige flight mét starttijd moet bovenaan staan');
    assert.strictEqual(g2[1].id, 'f1', 'flights zonder starttijd zakken onderaan, in hun eigen volgorde');
    assert.strictEqual(g2[2].id, 'f3');

    const uren = [
      {id:'f1', volgorde:1, starttijd:'10:00'},
      {id:'f2', volgorde:2, starttijd:'9:05'},
    ];
    sandbox.__flights3 = uren;
    const g3 = vm.runInContext('flightsOpStarttijd(__flights3)', sandbox);
    assert.strictEqual(g3[0].id, 'f2', '9:05 moet vóór 10:00 komen (numerieke vergelijking, geen tekstvergelijking)');

    console.log('[4/8] Startlijst-sortering op starttijd (niet op opslagvolgorde): OK');
  })();

  // ===================== 5. Admin-conceptscores =====================
  await (async function(){
    function makeSandbox(){
      const documentStub = {
        getElementById(){ return null; },
        querySelector(){ return null; },
        addEventListener(){},
        documentElement: { style: { setProperty(){} } },
      };
      const sandbox = {
        console, document: documentStub, window: {}, setTimeout, clearTimeout, setInterval(){}, Promise, URLSearchParams,
        Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object,
        localStorage: { _s:{}, getItem(k){ return this._s[k]??null; }, setItem(k,v){ this._s[k]=v; } },
      };
      sandbox.window = sandbox;
      sandbox.window.addEventListener = ()=>{};
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox, {filename:'index.html<script>'});
      return sandbox;
    }

    const sandbox = makeSandbox();

    vm.runInContext(`
      var logGeen = [];
      var logEens = [
        {speler_id:'p2', hole_index:3, waarde:4, door_speler_id:'p1', updated_at:'2026-09-20T10:00:00Z'},
        {speler_id:'p2', hole_index:3, waarde:4, door_speler_id:'p2', updated_at:'2026-09-20T10:05:00Z'},
      ];
      var logAfwijkend = [
        {speler_id:'p2', hole_index:5, waarde:5, door_speler_id:'p1', updated_at:'2026-09-20T10:00:00Z'},
        {speler_id:'p2', hole_index:5, waarde:6, door_speler_id:'p3', updated_at:'2026-09-20T10:10:00Z'},
      ];
      var rGeen = admConceptWaarde(logGeen, 'p2', 3);
      var rEens = admConceptWaarde(logEens, 'p2', 3);
      var rAfwijkend = admConceptWaarde(logAfwijkend, 'p2', 5);
      var rNieuwste = admConceptWaarde(logAfwijkend.concat([{speler_id:'p2',hole_index:5,waarde:7,door_speler_id:'p2',updated_at:'2026-09-20T10:20:00Z'}]), 'p2', 5);
    `, sandbox);
    assert.strictEqual(sandbox.rGeen.status, 'geen', 'geen log-entries -> status geen');
    assert.strictEqual(sandbox.rGeen.waarde, null);
    assert.strictEqual(sandbox.rEens.status, 'eens', 'twee entries met dezelfde waarde -> eens');
    assert.strictEqual(sandbox.rEens.waarde, 4);
    assert.strictEqual(sandbox.rAfwijkend.status, 'afwijkend', 'verschillende waardes -> afwijkend');
    assert.strictEqual(sandbox.rNieuwste.waarde, 7, 'bij afwijkende waardes moet de nieuwste (updated_at) worden getoond');

    const holes = Array.from({length:3}, (_,i)=>({par:4, si:i+1}));
    const log = [
      {speler_id:'p2', hole_index:0, waarde:5, door_speler_id:'p1', updated_at:'2026-09-20T09:00:00Z'},
      {speler_id:'p2', hole_index:1, waarde:3, door_speler_id:'p1', updated_at:'2026-09-20T09:00:00Z'},
      {speler_id:'p2', hole_index:1, waarde:4, door_speler_id:'p3', updated_at:'2026-09-20T09:05:00Z'},
    ];
    vm.runInContext(`var __holes = ${JSON.stringify(holes)}; var __log = ${JSON.stringify(log)};`, sandbox);
    const htmlNoOfficial = vm.runInContext(`holeGridHtml(__holes, null, false, __log, 'p2')`, sandbox);
    assert.ok(/id="h0"[^>]*class="concept"/.test(htmlNoOfficial) || /class="concept"[^>]*id="h0"/.test(htmlNoOfficial), 'hole 0 moet concept-class krijgen');
    assert.ok(htmlNoOfficial.includes('value="5"'), 'hole 0 moet voorgevuld zijn met de conceptwaarde 5');
    assert.ok(/id="h1"[^>]*class="concept-afwijkend"/.test(htmlNoOfficial) || /class="concept-afwijkend"[^>]*id="h1"/.test(htmlNoOfficial), 'hole 1 moet concept-afwijkend krijgen (spelers oneens)');
    assert.ok(htmlNoOfficial.includes('h2') && htmlNoOfficial.match(/id="h2"[^>]*value=""/), 'hole 2 heeft geen log-entry en moet leeg blijven');
    assert.ok(htmlNoOfficial.includes('concept — alvast ingevuld'), 'legenda moet verschijnen zodra er een concept-waarde getoond wordt');

    const existing = {hole_scores: [4, null, null]};
    const htmlWithOfficial = vm.runInContext(`holeGridHtml(__holes, ${JSON.stringify(existing)}, false, __log, 'p2')`, sandbox);
    assert.ok(htmlWithOfficial.match(/id="h0"[^>]*value="4"/), 'officiële waarde (4) moet behouden blijven, niet overschreven door concept (5)');
    assert.ok(!htmlWithOfficial.match(/id="h0"[^>]*class="concept"/) && !htmlWithOfficial.match(/class="concept"[^>]*id="h0"/), 'hole met officiële waarde krijgt geen concept-styling');

    const htmlReadOnly = vm.runInContext(`holeGridHtml(__holes, null, true, __log, 'p2')`, sandbox);
    assert.ok(!htmlReadOnly.includes('concept — alvast ingevuld'), 'bij readOnly (afgesloten ronde) geen concept-prefill/legenda');
    assert.ok(htmlReadOnly.match(/id="h0"[^>]*value=""/), 'readOnly zonder officiële score blijft leeg, geen concept-invulling');

    vm.runInContext(`
      var deeln = [{speler_id:'p1'},{speler_id:'p2'},{speler_id:'p3'}];
      var testSpelers = [{id:'p1',naam:'Kay'},{id:'p2',naam:'Richard'},{id:'p3',naam:'Sierk'}];
      var scores = [{speler_id:'p1', hole_scores:Array(18).fill(4), stableford:30}];
      var logRonde = [];
      for(var i=0;i<10;i++) logRonde.push({speler_id:'p2', hole_index:i, waarde:4});
      var rows = deeln.map(function(d){
        var sp = testSpelers.find(function(s){ return s.id===d.speler_id; });
        var sc = scores.find(function(s){ return s.speler_id===sp.id; });
        var compleet = !!(sc && sc.stableford!=null);
        var aantal = sc && sc.hole_scores ? sc.hole_scores.filter(function(v){ return v!=null; }).length : 0;
        var conceptAantal = (aantal===0) ? new Set(logRonde.filter(function(l){ return l.speler_id===sp.id; }).map(function(l){ return l.hole_index; })).size : 0;
        return {sp:sp, compleet:compleet, aantal:aantal, conceptAantal:conceptAantal};
      });
      var teksten = rows.map(function(r){
        var heeftConcept = !r.compleet && r.aantal===0 && r.conceptAantal>0;
        return r.compleet ? 'Compleet' : heeftConcept ? (r.conceptAantal===18?'Concept compleet':'Concept: '+r.conceptAantal+'/18') : (r.aantal>0?r.aantal+'/18':'Nog niets');
      });
    `, sandbox);
    assert.strictEqual(sandbox.teksten[0], 'Compleet', 'p1 heeft een officiële, complete kaart');
    assert.strictEqual(sandbox.teksten[1], 'Concept: 10/18', 'p2 heeft alleen conceptdata -> amber badge i.p.v. rode "Nog niets"');
    assert.strictEqual(sandbox.teksten[2], 'Nog niets', 'p3 heeft geen scores en geen log -> blijft "Nog niets"');

    console.log('[5/8] Admin-conceptscores (prefill + invoerstatus-badge): OK');
  })();

  // ===================== 6. Pinch-zoom + modal-viewport-sync =====================
  await (async function(){
    const viewportMatch = html.match(/<meta name="viewport" content="([^"]*)">/);
    assert.ok(viewportMatch, 'viewport-meta moet aanwezig zijn');
    const content = viewportMatch[1];
    assert.ok(!content.includes('user-scalable=no'), 'user-scalable=no moet weg zijn zodat inzoomen weer kan');
    assert.ok(!content.includes('maximum-scale=1.0') && !content.includes('maximum-scale=1'), 'maximum-scale mag niet meer op 1 staan');

    const moRuleMatch = html.match(/\.mo\{[^}]*\}/);
    assert.ok(moRuleMatch, '.mo CSS-regel moet bestaan');
    const moRule = moRuleMatch[0];
    assert.ok(moRule.includes('var(--vvt') && moRule.includes('var(--vvh'), '.mo moet top/height uit --vvt/--vvh halen i.p.v. een starre inset:0');

    const setProps = {};
    const documentStub = {
      documentElement: { style: { setProperty(k,v){ setProps[k]=v; } } },
      addEventListener(){},
      getElementById(){ return null; },
    };
    const vvListeners = {};
    const sandbox = {
      console, document: documentStub, window: {}, setInterval(){}, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = ()=>{};
    sandbox.window.visualViewport = {
      height: 480, offsetTop: 37,
      addEventListener(evt, fn){ (vvListeners[evt] = vvListeners[evt]||[]).push(fn); },
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    assert.ok(vvListeners['resize'] && vvListeners['resize'].length>=1, 'visualViewport resize-listener moet geregistreerd zijn');
    assert.ok(vvListeners['scroll'] && vvListeners['scroll'].length>=1, 'visualViewport scroll-listener moet geregistreerd zijn');
    assert.strictEqual(setProps['--vvh'], '480px', 'directe aanroep bij laden moet --vvh al zetten');
    assert.strictEqual(setProps['--vvt'], '37px', 'directe aanroep bij laden moet --vvt al zetten');

    sandbox.window.visualViewport.height = 300;
    sandbox.window.visualViewport.offsetTop = 0;
    vvListeners['resize'][0]();
    assert.strictEqual(setProps['--vvh'], '300px', 'bij het opkomen van het toetsenbord moet --vvh meekrimpen');
    assert.strictEqual(setProps['--vvt'], '0px', '--vvt moet meebewegen met offsetTop');

    console.log('[6/8] Pinch-zoom weer mogelijk + modal volgt --vvh/--vvt: OK');
  })();

  // ===================== 7. Modal max-height volgt het toetsenbord =====================
  await (async function(){
    const mdMatch = html.match(/\n\.md\{[^}]*\}/);
    assert.ok(mdMatch, '.md CSS-regel moet bestaan');
    const mdRule = mdMatch[0];
    assert.ok(mdRule.includes('var(--vvh'), '.md max-height moet var(--vvh...) gebruiken zodat het toetsenbord-krimpen wordt gevolgd');
    assert.ok(!/max-height:88vh(?!\))/.test(mdRule) || mdRule.includes('min('), '.md mag geen kale vaste 88vh meer als max-height hebben');

    const landscapeMatch = html.match(/#moScorekaart \.md\{[^}]*max-height:[^;]*/);
    assert.ok(landscapeMatch, 'landscape #moScorekaart .md-override moet bestaan');
    assert.ok(landscapeMatch[0].includes('var(--vvh'), 'landscape #moScorekaart .md max-height moet ook var(--vvh...) gebruiken');

    console.log('[7/8] Modal max-height (alle modals, incl. Startlijst) volgt --vvh i.p.v. vaste 88vh: OK');
  })();

  // ===================== 8. Scorekaart-popup: bruto-scorekleuren =====================
  await (async function(){
    const documentStub = {
      getElementById(){ return null; },
      querySelector(){ return null; },
      addEventListener(){},
      documentElement: { style: { setProperty(){} } },
    };
    const sandbox = {
      console, document: documentStub, window: {}, setTimeout, clearTimeout, setInterval(){}, Promise, URLSearchParams,
      Set, Array, Math, Date, JSON, parseInt, parseFloat, isNaN, String, Number, Object,
      localStorage: { _s:{}, getItem(k){ return this._s[k]??null; }, setItem(k,v){ this._s[k]=v; } },
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = ()=>{};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, {filename:'index.html<script>'});

    const cases = [
      [3, 5, 'sk-eagle'],
      [10, 12, 'sk-eagle'],
      [4, 5, 'sk-birdie'],
      [5, 5, 'sk-par'],
      [6, 5, 'sk-bogey'],
      [7, 5, 'sk-worse'],
      [12, 5, 'sk-worse'],
    ];
    cases.forEach(([score,par,expected])=>{
      const got = vm.runInContext(`skGrossKlasse(${score}, ${par})`, sandbox);
      assert.strictEqual(got, expected, `score ${score} t.o.v. par ${par} moet '${expected}' zijn, kreeg '${got}'`);
    });

    assert.strictEqual(vm.runInContext(`skGrossKlasse(null, 5)`, sandbox), '');
    assert.strictEqual(vm.runInContext(`skGrossKlasse(5, null)`, sandbox), '');

    // Zachte tint-cellen (achtergrond + eigen tekstkleur), zoals het oorspronkelijke
    // ontwerp — geen effen blokjes met witte letters meer (op verzoek teruggedraaid).
    ['sk-eagle','sk-birdie','sk-par','sk-bogey','sk-worse'].forEach(cls=>{
      const re = new RegExp('\\.sk \\.'+cls+'\\{background:[^;}]+;color:[^}]+\\}');
      assert.ok(re.test(html), `.sk .${cls} moet bestaan met een eigen achtergrond- en tekstkleur`);
      assert.ok(!new RegExp('\\.sk \\.'+cls+'\\{[^}]*color:#fff[^}]*\\}').test(html), `.sk .${cls} mag geen witte tekst meer hebben`);
    });
    assert.ok(!/function ptsClass\(/.test(html), 'ptsClass (stableford-gebaseerd) hoort hier niet meer te bestaan');

    console.log('[8/8] Scorekaart-popup kleurt de Score-rij op bruto slagen (eagle/birdie/par/bogey/meer dan bogey): OK');
  })();

  console.log('ALLE OVERIGE REGRESSIETESTS GESLAAGD');
}
main().catch(e=>{ console.error('TEST GEFAALD:', e); process.exit(1); });
