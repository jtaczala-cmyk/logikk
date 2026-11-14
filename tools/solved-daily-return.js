#!/usr/bin/env node
'use strict';
/* Headless check for a solved official daily:
   bare visit, ?daily=1, #daily and the daily button restore the filled grid + win card
   and do not call newBoard or track start-daily / finish-daily. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'en/index.html', 'pl/index.html'];
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
    throw new Error(msg);
  }
}

function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function gameScript(html) {
  const start = html.indexOf('var LG = (function () {');
  const end = html.indexOf('</script>', start);
  assert(start > 0 && end > start, 'game script not found');
  return html.slice(start, end);
}

function memStore(init) {
  const data = Object.assign({}, init);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? String(data[k]) : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    clear() { Object.keys(data).forEach(function (k) { delete data[k]; }); }
  };
}

function makeElement() {
  const el = {
    hidden: false, textContent: '', innerHTML: '', className: '', id: '',
    tabIndex: 0, disabled: false, dataset: {}, style: { setProperty: function () {} },
    firstChild: null, attrs: {}, onclick: null, href: '',
    nextElementSibling: { textContent: '' }
  };
  el.classList = {
    toggle: function (name, force) {
      const has = el.className.split(/\s+/).indexOf(name) >= 0;
      const on = force === undefined ? !has : !!force;
      const parts = el.className.split(/\s+/).filter(Boolean).filter(function (n) { return n !== name; });
      if (on) parts.push(name);
      el.className = parts.join(' ');
      return on;
    },
    add: function (name) { this.toggle(name, true); },
    remove: function (name) { this.toggle(name, false); },
    contains: function (name) { return el.className.split(/\s+/).indexOf(name) >= 0; }
  };
  el.setAttribute = function (k, v) { el.attrs[k] = String(v); };
  el.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; };
  el.removeAttribute = function (k) { delete el.attrs[k]; };
  el.addEventListener = function () {};
  el.appendChild = function (child) { el.firstChild = el.firstChild || child; return child; };
  el.remove = function () {};
  el.focus = function () {};
  el.select = function () {};
  el.setSelectionRange = function () {};
  el.querySelector = function () { return { textContent: '', hidden: false, href: '', className: '' }; };
  el.querySelectorAll = function () { return []; };
  el.closest = function () { return el; };
  el.getContext = function () { return { clearRect: function () {}, fillRect: function () {}, save: function () {}, restore: function () {}, translate: function () {}, rotate: function () {} }; };
  el.getBoundingClientRect = function () { return { left: 0, top: 0, width: 40, height: 40 }; };
  Object.defineProperty(el, 'clientWidth', { get: function () { return 360; } });
  Object.defineProperty(el, 'clientHeight', { get: function () { return 360; } });
  Object.defineProperty(el, 'offsetWidth', { get: function () { return 40; } });
  return el;
}

const START_HIDDEN = { menu: 1, share: 1, rules: 1, win: 1, confirm: 1, clock: 1, mContinue: 1, wResult: 1, winNext: 1, winGrid: 1, winMore: 1, fPrivW: 1, sNative: 1, howto: 1 };

function runPage(html, opts) {
  const elements = {};
  const document = {
    title: '',
    visibilityState: 'visible',
    fonts: { ready: { then: function (fn) { fn(); } } },
    getElementById: function (id) {
      if (!elements[id]) {
        elements[id] = makeElement();
        elements[id].id = id;
        if (START_HIDDEN[id]) elements[id].hidden = true;
      }
      return elements[id];
    },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    createElement: function () { return makeElement(); },
    addEventListener: function () {}
  };
  document.documentElement = makeElement();
  document.body = makeElement();
  document.head = makeElement();
  const intervals = [];
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function (fn, ms) {
      const t = setInterval(fn, ms);
      if (t && t.unref) t.unref();
      intervals.push({ ms: ms, t: t });
      return t;
    },
    clearInterval: clearInterval,
    document: document,
    location: {
      search: opts.search || '',
      hash: opts.hash || '',
      pathname: '/logikk/',
      origin: 'https://stop60.no'
    },
    navigator: { language: 'nb', languages: ['nb'] },
    localStorage: memStore(opts.store || {}),
    matchMedia: function () { return { matches: true }; },
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
    addEventListener: function () {},
    __newBoards: []
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  let src = gameScript(html);
  const needle = 'function newBoard(diff, daily) {\n';
  assert(src.includes(needle), 'newBoard needle missing');
  src = src.replace(needle, needle + '  window.__newBoards.push([diff, !!daily]);\n');
  const end = src.lastIndexOf('})();');
  src = src.slice(0, end) + 'window.__guard=function(){newBoard("medium",true);};\n' + src.slice(end);
  try { vm.runInContext(src, sandbox, { filename: 'index.html' }); }
  catch (e) {
    intervals.forEach(function (x) { clearInterval(x.t); });
    throw e;
  }
  intervals.forEach(function (x) { clearInterval(x.t); });
  return { sandbox: sandbox, elements: elements, intervals: intervals.map(function (x) { return x.ms; }) };
}

function freshBoard(lg, today) {
  const g = lg.generate('medium', 'daily-' + today);
  assert(g && g.solution && g.solution.length === 81, 'generator returned a board');
  assert(g.solution.every(function (v, i) { return v >= 1 && v <= 9 && (!g.puzzle[i] || g.puzzle[i] === v); }), 'solution fills the puzzle');
  return g;
}

function baseSave(g, today, extra) {
  const s = {
    v: 1, diff: 'medium', seed: today, daily: today,
    puz: g.puzzle.slice(), sol: g.solution.slice(), cur: g.solution.slice(),
    notes: g.puzzle.map(function () { return 0; }), hist: [],
    hintsUsed: 2, mistakes: 4, el: 77777, timed: true, done: true, sel: -1, counted: 0
  };
  return Object.assign(s, extra || {});
}

function statsObj() {
  return {
    easy: { won: 0, best: 0 }, medium: { won: 3, best: 0 }, hard: { won: 0, best: 0 },
    daily: {}, streak: { cur: 1, best: 1 }
  };
}

function withDaily(today, rec) {
  const st = statsObj();
  st.daily[today] = rec;
  return st;
}

const PREFS = JSON.stringify({ lang: 'no', mute: true, timed: false, showErr: true });

function boot(html, store, search, hash) {
  return runPage(html, { store: store, search: search || '?debug=1', hash: hash || '' });
}

function gc(sandbox) { return sandbox.__gcLog || []; }
function state(sandbox) { return sandbox.LOGIKK.state(); }
function filled(st) { return st && st.cur.length === 81 && st.cur.every(function (v, i) { return v === st.sol[i] && v >= 1 && v <= 9; }); }

function main() {
  const htmls = pages.map(function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); });
  const scripts = htmls.map(gameScript);
  assert(scripts[0] === scripts[1] && scripts[1] === scripts[2], 'game script drifted between language pages');
  pages.forEach(function (p, i) {
    const tmp = path.join('/tmp', 'logikk-' + p.replace(/\//g, '-') + '.js');
    fs.writeFileSync(tmp, scripts[i]);
    const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    assert(chk.status === 0, 'node --check failed for ' + p + '\n' + chk.stderr);
  });
  htmls.forEach(function (html, i) {
    assert(html.includes("shareResult: 'Del resultatet', copyResult: 'Del resultatet'"), pages[i] + ' no share labels');
    assert(html.includes("shareResult: 'Udostępnij wynik', copyResult: 'Udostępnij wynik'"), pages[i] + ' pl share labels');
    assert(html.includes("shareResult: 'Share result', copyResult: 'Share result'"), pages[i] + ' en share labels');
    assert(html.includes("copied: 'Kopiert!'") && html.includes("copied: 'Skopiowano!'") && html.includes("copied: 'Copied!'"), pages[i] + ' copied labels changed');
    assert(html.includes("shareBtn: 'Del …'") && html.includes("copy: 'Kopier lenke'"), pages[i] + ' game-link labels changed');
    assert(!html.includes('Kopier resultat') && !html.includes('Kopiuj wynik') && !html.includes('Copy result'), pages[i] + ' old result labels remain');
    assert(!/[?&]utm_|utm_source|utm_medium|utm_campaign/i.test(scripts[i]), pages[i] + ' script picked up tracking params');
  });
  assert(htmls[0].includes('data-t="shareResult">Del resultatet</span>'), 'no button fallback');
  assert(htmls[1].includes('data-t="shareResult">Share result</span>'), 'en button fallback');
  assert(htmls[2].includes('data-t="shareResult">Udostępnij wynik</span>'), 'pl button fallback');

  const src = scripts[0];
  assert(src.includes('setTimeout(openWin, 900);'), 'fresh-solve delay changed');
  const show = src.slice(src.indexOf('function showSolvedDaily'), src.indexOf('function newBoard'));
  assert(!show.includes('track(') && !show.includes('clockStart'), 'restore tracks or starts the clock');
  assert(show.includes('cur: g.solution.slice()') && show.includes('counted: 1') && show.includes('openWin()'), 'restore does not fill the grid and open the win card');
  const nb = src.slice(src.indexOf('function newBoard'), src.indexOf('/* ---------------- board DOM'));
  assert(nb.indexOf('todayDailySolved') >= 0 && nb.indexOf('todayDailySolved') < nb.indexOf("track('start-"), 'newBoard can still regenerate a solved daily before the guard');
  const bootSrc = src.slice(src.indexOf('S = loadSave();'), src.indexOf('if (/[?&]nobadge'));
  assert(bootSrc.includes('if (S && !S.done)') && bootSrc.includes('showSolvedDaily()') && bootSrc.includes("ask('medium', true)"), 'boot no longer resumes an unfinished board or auto-starts an unsolved daily');
  assert(!bootSrc.includes('newBoard'), 'bare boot calls newBoard directly');

  const today = dayKey();
  const lgCtx = {};
  vm.createContext(lgCtx);
  vm.runInContext(src.slice(0, src.indexOf("(function () {\n'use strict';")) + '\nthis.LG = LG;', lgCtx);
  const g = freshBoard(lgCtx.LG, today);
  const html = htmls[0];
  const rec = { t: 5000, h: 1 };
  const stats = withDaily(today, rec);
  const statsJson = JSON.stringify(stats);

  function storeOf(save, st) {
    const out = { logikk_prefs_v1: PREFS };
    if (st) out.logikk_stats_v1 = JSON.stringify(st);
    if (save) out.logikk_save_v1 = JSON.stringify(save);
    return out;
  }
  function solvedView(r, label) {
    const st = state(r.sandbox);
    assert(r.sandbox.__newBoards.length === 0, label + ' called newBoard ' + JSON.stringify(r.sandbox.__newBoards));
    assert(gc(r.sandbox).indexOf('start-daily') < 0 && gc(r.sandbox).indexOf('finish-daily') < 0, label + ' tracked ' + JSON.stringify(gc(r.sandbox)));
    assert(st && st.done && st.daily === today, label + ' board is not today\'s solved daily');
    assert(filled(st), label + ' grid is not filled with the solution');
    assert(r.elements.win && r.elements.win.hidden === false, label + ' win card hidden');
    assert(r.elements.menu.hidden === true, label + ' start menu is open');
    assert(!r.elements.howto || r.elements.howto.hidden !== false, label + ' showed the how-to overlay');
    assert(r.elements.confirm.hidden === true, label + ' confirm dialog is open');
    assert(r.elements.wResult && r.elements.wResult.hidden === false, label + ' share-result button hidden');
    assert(r.elements.winGrid && r.elements.winGrid.hidden === false && /stop60\.no\/logikk/.test(r.elements.winGrid.textContent) && !/utm/i.test(r.elements.winGrid.textContent), label + ' share card missing');
    assert(r.elements.winNext && r.elements.winNext.hidden === false, label + ' countdown hidden');
    assert(r.elements.winMore && r.elements.winMore.hidden === false, label + ' until-tomorrow links hidden');
    assert(r.sandbox.localStorage.getItem('logikk_stats_v1') === statsJson, label + ' changed stats.daily or the streak');
    const live = r.sandbox.LOGIKK.stats();
    assert(live.daily[today].t === 5000 && live.daily[today].h === 1 && live.medium.won === 3 && live.streak.cur === 1 && live.streak.best === 1, label + ' recounted the daily');
  }

  // 1. Bare visit, save is already today's solved daily (even if counted was never set).
  const save = baseSave(g, today);
  let r = boot(html, storeOf(save, stats));
  solvedView(r, 'bare save');
  const st1 = state(r.sandbox);
  assert(st1.mistakes === 4 && st1.el === 77777 && st1.hintsUsed === 2 && st1.counted === 1, 'bare save regenerated today\'s board');
  assert(r.intervals.indexOf(500) < 0, 'bare save started the clock');
  const beforeClick = gc(r.sandbox).slice();
  r.elements.menu.hidden = false;
  r.elements.mDaily.onclick();
  solvedView(r, 'mDaily');
  assert(gc(r.sandbox).length === beforeClick.length, 'mDaily tracked an event');
  assert(state(r.sandbox).mistakes === 4, 'mDaily rebuilt the board');
  r.sandbox.__guard();
  assert(JSON.stringify(r.sandbox.__newBoards) === '[["medium",true]]', 'guard was not the daily newBoard path');
  assert(gc(r.sandbox).indexOf('start-daily') < 0 && gc(r.sandbox).indexOf('finish-daily') < 0, 'guard tracked a daily');
  assert(state(r.sandbox).done && state(r.sandbox).mistakes === 4 && filled(state(r.sandbox)), 'guard cleared the solved daily');
  assert(r.sandbox.localStorage.getItem('logikk_stats_v1') === statsJson, 'guard cleared stats.daily');
  r.elements.wAgain.onclick();
  assert(gc(r.sandbox).indexOf('start-medium') >= 0, 'practice again did not start');
  assert(gc(r.sandbox).indexOf('start-daily') < 0 && gc(r.sandbox).indexOf('finish-daily') < 0, 'practice again tracked a daily');
  assert(r.sandbox.localStorage.getItem('logikk_stats_v1') === statsJson, 'practice newBoard cleared today\'s stats.daily');
  assert(state(r.sandbox).done === false && state(r.sandbox).daily === '', 'practice again stayed on the daily');

  // 2. Bare visit, today's result is stored but the save is a later finished practice board.
  const practice = baseSave(g, today, { daily: '', seed: 'practice', diff: 'easy', done: true, counted: 1, mistakes: 9, el: 111, hintsUsed: 0 });
  r = boot(html, storeOf(practice, stats));
  solvedView(r, 'practice save');
  const st2 = state(r.sandbox);
  assert(st2.mistakes === 0 && st2.el === 5000 && st2.hintsUsed === 1 && st2.timed === true && st2.counted === 1, 'practice save was not rebuilt from the daily record');
  assert(JSON.stringify(st2.puz) === JSON.stringify(g.puzzle) && JSON.stringify(st2.cur) === JSON.stringify(g.solution), 'rebuilt board is not today\'s official daily');

  // 3. ?daily=1 and #daily must not start a new daily.
  r = boot(html, storeOf(save, stats), '?debug=1&daily=1');
  solvedView(r, '?daily=1');
  assert(state(r.sandbox).mistakes === 4 && state(r.sandbox).el === 77777, '?daily=1 regenerated the saved daily');
  r = boot(html, storeOf(null, stats), '?debug=1', '#daily');
  solvedView(r, '#daily');
  assert(state(r.sandbox).el === 5000 && state(r.sandbox).hintsUsed === 1 && filled(state(r.sandbox)), '#daily did not rebuild the official board');

  // 4. Unfinished practice still resumes, and ?daily=1 still asks before replacing it when today is unsolved.
  const progress = baseSave(g, today, { daily: '', seed: 'practice', diff: 'easy', done: false, counted: 0, mistakes: 1, el: 10, hintsUsed: 0, cur: g.puzzle.slice() });
  const hole = progress.cur.findIndex(function (v) { return !v; });
  progress.cur[hole] = g.solution[hole];
  r = boot(html, storeOf(progress, statsObj()));
  assert(r.sandbox.__newBoards.length === 0 && gc(r.sandbox).indexOf('start-daily') < 0, 'unfinished practice auto-started a daily');
  assert(state(r.sandbox).done === false && state(r.sandbox).daily === '' && state(r.sandbox).seed === 'practice', 'unfinished practice did not resume');
  assert((!r.elements.win || r.elements.win.hidden === true) && r.elements.menu.hidden === true, 'unfinished practice opened the menu or the win card');
  assert(!r.elements.howto || r.elements.howto.hidden !== false, 'unfinished practice showed the how-to overlay');
  assert(r.intervals.indexOf(500) >= 0, 'unfinished practice did not start the clock');
  r = boot(html, storeOf(progress, statsObj()), '?debug=1&daily=1');
  assert(r.sandbox.__newBoards.length === 0 && gc(r.sandbox).indexOf('start-daily') < 0, '?daily=1 on practice started a daily without confirm');
  assert(r.elements.confirm.hidden === false, '?daily=1 on unfinished practice skipped the confirm dialog');
  assert(state(r.sandbox).daily === '' && state(r.sandbox).done === false, '?daily=1 replaced the practice board before confirm');

  // 5. ?daily=1 when today is already solved shows the result instead of the confirm / a new board.
  r = boot(html, storeOf(progress, stats), '?debug=1&daily=1');
  solvedView(r, '?daily=1 solved');
  assert(r.sandbox.__newBoards.length === 0, '?daily=1 solved entered newBoard');

  // 6. A bare visit with nothing in progress and no solved daily still auto-starts today's board.
  r = boot(html, storeOf(null, statsObj()));
  assert(JSON.stringify(r.sandbox.__newBoards) === '[["medium",true]]', 'unsolved bare visit did not auto-start the daily');
  assert(gc(r.sandbox).indexOf('start-daily') >= 0 && gc(r.sandbox).indexOf('finish-daily') < 0, 'unsolved bare visit tracked the wrong event');
  assert(gc(r.sandbox).filter(function (n) { return n === 'start-daily'; }).length === 1, 'unsolved bare visit started the daily more than once');
  assert(!r.elements.howto || r.elements.howto.hidden !== false, 'familiar auto-start showed the how-to overlay');
  assert(state(r.sandbox).done === false && state(r.sandbox).daily === today, 'unsolved bare visit did not open today\'s daily');
  const after = JSON.parse(r.sandbox.localStorage.getItem('logikk_stats_v1'));
  assert(!after.daily[today] && after.medium.won === 3, 'auto-start wrote today\'s stats.daily');

  // 7. Solve saved in the 900ms before openWin (counted 0, no stats.daily entry) is recorded once on return.
  const unrecorded = baseSave(g, today);
  r = boot(html, storeOf(unrecorded, statsObj()));
  const st7 = state(r.sandbox);
  assert(st7 && st7.done && st7.daily === today && st7.counted === 1, 'unrecorded solve was not kept');
  assert(st7.mistakes === 4 && st7.el === 77777 && st7.hintsUsed === 2, 'unrecorded solve was rebuilt and lost the result');
  assert(filled(st7), 'unrecorded solve grid is not the saved solution');
  assert(r.elements.win && r.elements.win.hidden === false && r.elements.menu.hidden === true, 'unrecorded solve did not open the win card');
  assert(r.sandbox.__newBoards.length === 0 && gc(r.sandbox).indexOf('start-daily') < 0, 'unrecorded solve started a new daily');
  assert(gc(r.sandbox).filter(function (n) { return n === 'finish-daily'; }).length === 1, 'unrecorded solve tracked finish-daily ' + JSON.stringify(gc(r.sandbox)));
  assert(r.intervals.indexOf(500) < 0, 'unrecorded solve started the clock');
  const live7 = r.sandbox.LOGIKK.stats();
  assert(live7.daily[today] && live7.daily[today].t === 77777 && live7.daily[today].h === 2, 'unrecorded solve did not write the daily record');
  assert(live7.medium.won === 4 && live7.medium.best === 77777, 'unrecorded solve did not count the win');
  assert(live7.streak.cur === 1 && live7.streak.best === 1, 'unrecorded solve did not update the streak');
  const stored7 = storeOf(JSON.parse(r.sandbox.localStorage.getItem('logikk_save_v1')), JSON.parse(r.sandbox.localStorage.getItem('logikk_stats_v1')));
  r = boot(html, stored7);
  const live7b = r.sandbox.LOGIKK.stats();
  assert(live7b.medium.won === 4 && live7b.daily[today].t === 77777 && live7b.streak.cur === 1, 'second visit recounted the recovered daily');
  assert(gc(r.sandbox).indexOf('finish-daily') < 0 && gc(r.sandbox).indexOf('start-daily') < 0, 'second visit tracked the daily again');
  assert(state(r.sandbox).mistakes === 4 && state(r.sandbox).counted === 1 && filled(state(r.sandbox)), 'second visit rebuilt the recovered daily');

  console.log('solved-daily-return: ok (' + today + ')');
}

try { main(); }
catch (e) {
  if (!failed) { failed++; console.error('FAIL:', e && e.stack || e); }
  process.exitCode = 1;
}
if (failed) process.exitCode = 1;
