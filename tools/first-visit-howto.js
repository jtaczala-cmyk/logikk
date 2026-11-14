#!/usr/bin/env node
'use strict';
/* First visit shows a short how-to over today's already started daily.
   Play / Escape persist prefs.seenHowTo. Solved, in-progress, and familiar visits do not show it. */
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

function shiftDay(key, delta) {
  const p = String(key).split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + delta * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
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
    firstChild: null, attrs: {}, onclick: null, href: '', focused: false,
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
  el.focus = function () { el.focused = true; };
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
  const listeners = {};
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
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
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
      intervals.push({ ms: ms, fn: fn, t: t });
      return t;
    },
    clearInterval: clearInterval,
    document: document,
    location: {
      search: opts.search || '',
      hash: opts.hash || '',
      pathname: opts.pathname || '/logikk/',
      origin: 'https://stop60.no'
    },
    navigator: opts.navigator || { language: 'nb', languages: ['nb'] },
    localStorage: memStore(opts.store || {}),
    matchMedia: function () { return { matches: true }; },
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    performance: { now: function () { return sandbox.__clockNow; } },
    __clockNow: 1700000000000,
    requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
    addEventListener: function () {},
    __newBoards: []
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('Date.now = function () { return __clockNow; };', sandbox);
  let src = gameScript(html);
  const needle = 'function newBoard(diff, daily) {\n';
  assert(src.includes(needle), 'newBoard needle missing');
  src = src.replace(needle, needle + '  window.__newBoards.push([diff, !!daily]);\n');
  try { vm.runInContext(src, sandbox, { filename: 'index.html' }); }
  catch (e) {
    intervals.forEach(function (x) { clearInterval(x.t); });
    throw e;
  }
  intervals.forEach(function (x) { clearInterval(x.t); });
  return {
    sandbox: sandbox, elements: elements, listeners: listeners, intervals: intervals, document: document,
    advance: function (ms) { sandbox.__clockNow += ms; }
  };
}

function freshBoard(lg, today) {
  const g = lg.generate('medium', 'daily-' + today);
  assert(g && g.solution && g.solution.length === 81, 'generator returned a board');
  return g;
}

function baseSave(g, today, extra) {
  const s = {
    v: 1, diff: 'medium', seed: today, daily: today,
    puz: g.puzzle.slice(), sol: g.solution.slice(), cur: g.puzzle.slice(),
    notes: g.puzzle.map(function () { return 0; }), hist: [],
    hintsUsed: 0, mistakes: 0, el: 0, timed: false, done: false, sel: -1, counted: 0
  };
  return Object.assign(s, extra || {});
}

function emptyStats() {
  return { easy: { won: 0, best: 0 }, medium: { won: 0, best: 0 }, hard: { won: 0, best: 0 }, daily: {} };
}

function boot(html, store, search, hash, pathname) {
  return runPage(html, { store: store, search: search || '?debug=1', hash: hash || '', pathname: pathname });
}

function gc(sandbox) { return sandbox.__gcLog || []; }
function starts(sandbox) { return gc(sandbox).filter(function (n) { return n === 'start-daily'; }); }
function state(sandbox) { return sandbox.LOGIKK.state(); }
function prefs(sandbox) { return JSON.parse(sandbox.localStorage.getItem('logikk_prefs_v1') || 'null'); }
function howtoOpen(r) { return !!(r.elements.howto && r.elements.howto.hidden === false); }
function tick(r) {
  const clock = r.intervals.filter(function (x) { return x.ms === 500; });
  assert(clock.length === 1, 'clock interval missing or duplicated');
  clock[0].fn();
}
function key(r, name) {
  const fns = r.listeners.keydown || [];
  assert(fns.length > 0, 'no keydown listener');
  fns.forEach(function (fn) { fn({ key: name, altKey: false, metaKey: false, preventDefault: function () {} }); });
}
function dump(r) {
  const out = {};
  ['logikk_prefs_v1', 'logikk_stats_v1', 'logikk_save_v1'].forEach(function (k) {
    const v = r.sandbox.localStorage.getItem(k);
    if (v != null) out[k] = v;
  });
  return out;
}

function main() {
  const htmls = pages.map(function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); });
  const scripts = htmls.map(gameScript);
  assert(scripts[0] === scripts[1] && scripts[1] === scripts[2], 'game script drifted between language pages');
  pages.forEach(function (p, i) {
    const tmp = path.join('/tmp', 'logikk-howto-' + p.replace(/\//g, '-') + '.js');
    fs.writeFileSync(tmp, scripts[i]);
    const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    assert(chk.status === 0, 'node --check failed for ' + p + '\n' + chk.stderr);
  });
  const src = scripts[0];
  assert(src.includes("playNow: 'Spill'") && src.includes("playNow: 'Zagraj'") && src.includes("playNow: 'Play'"), 'playNow strings missing');
  assert(src.includes('prefs.seenHowTo'), 'seenHowTo is not stored on prefs');
  assert(src.includes("'howto'") && src.includes('maybeHowTo') && src.includes('dismissHowTo'), 'how-to hooks missing');
  const shareFn = src.slice(src.indexOf('function resultShareText'), src.indexOf('function paintWinShare'));
  assert(shareFn.includes("t('name') + ' #' + dayNum(key)") && !shareFn.includes("t('daily')"), 'share line still uses the long daily title');
  assert(htmls[0].includes('data-t="playNow">Spill</button>'), 'no Play fallback');
  assert(htmls[1].includes('data-t="playNow">Play</button>'), 'en Play fallback');
  assert(htmls[2].includes('data-t="playNow">Zagraj</button>'), 'pl Play fallback');
  assert(htmls[0].includes('>Slik spiller du</h2>') && htmls[1].includes('>How to play</h2>') && htmls[2].includes('>Jak grać</h2>'), 'how-to headings drifted');
  htmls.forEach(function (html, i) {
    assert(html.includes('id="howto"') && html.includes('id="mRules"') && html.includes('id="rules"'), pages[i] + ' lost an overlay');
  });

  const today = dayKey();
  const html = htmls[0];
  const lgCtx = {};
  vm.createContext(lgCtx);
  vm.runInContext(src.slice(0, src.indexOf("(function () {\n'use strict';")) + '\nthis.LG = LG;', lgCtx);
  const g = freshBoard(lgCtx.LG, today);

  // 1. Empty storage: auto-daily, then the short overlay. One start event. Board stays.
  let r = boot(html, {});
  assert(JSON.stringify(r.sandbox.__newBoards) === '[["medium",true]]', 'first visit did not auto-start once');
  assert(starts(r.sandbox).length === 1 && gc(r.sandbox).indexOf('finish-daily') < 0, 'first visit tracked ' + JSON.stringify(gc(r.sandbox)));
  assert(howtoOpen(r), 'first visit did not show the how-to');
  assert(r.elements.menu.hidden === true && r.elements.win.hidden === true && r.elements.confirm.hidden === true, 'first visit opened another overlay');
  const st = state(r.sandbox);
  assert(st && st.done === false && st.daily === today, 'first visit did not keep today\'s daily');
  assert(r.elements.howtoH.textContent === 'Slik spiller du', 'how-to heading');
  assert(r.elements.howtoPlay.textContent === 'Spill' && r.elements.howtoPlay.getAttribute('aria-label') === 'Spill', 'Play button name');
  assert(r.elements.howtoPlay.focused === true, 'Play was not focused');
  assert((r.elements.howtoPts.innerHTML.match(/<li>/g) || []).length === 3, 'how-to is not the three PTS bullets');
  assert(r.elements.howtoPts.innerHTML.includes('Korte runder') && r.elements.howtoPts.innerHTML.includes('Enkle regler'), 'PTS bullets missing');
  assert(!r.elements.howtoPts.innerHTML.includes('X-Wing') && r.elements.rulesCard.innerHTML.includes('X-Wing'), 'short overlay used the long rules, or the long rules were dropped');
  const seed = st.seed, cur = st.cur.slice();

  r.elements.howtoPlay.onclick();
  assert(!howtoOpen(r), 'Play did not hide the how-to');
  assert(prefs(r.sandbox) && prefs(r.sandbox).seenHowTo === true, 'Play did not set prefs.seenHowTo');
  assert(starts(r.sandbox).length === 1 && JSON.stringify(r.sandbox.__newBoards) === '[["medium",true]]', 'Play started another board');
  assert(state(r.sandbox).seed === seed && state(r.sandbox).daily === today && state(r.sandbox).done === false, 'Play wiped the daily');
  assert(JSON.stringify(state(r.sandbox).cur) === JSON.stringify(cur), 'Play changed the grid');

  // 2. Second load of that device does not show it again (resume, and also seenHowTo alone).
  const saved = dump(r);
  let r2 = boot(html, saved);
  assert(!howtoOpen(r2), 'second load showed the how-to');
  assert(r2.sandbox.__newBoards.length === 0 && starts(r2.sandbox).length === 0, 'second load started a new daily');
  assert(state(r2.sandbox).seed === seed && state(r2.sandbox).done === false, 'second load did not resume the same daily');
  const prefsOnly = { logikk_prefs_v1: saved.logikk_prefs_v1 };
  r2 = boot(html, prefsOnly);
  assert(!howtoOpen(r2), 'seenHowTo alone did not suppress the how-to');
  assert(JSON.stringify(r2.sandbox.__newBoards) === '[["medium",true]]' && starts(r2.sandbox).length === 1, 'seenHowTo blocked the auto-daily');

  // 3. Refresh during the overlay (in-progress daily, flag still false) does not show it.
  const resumePrefs = JSON.stringify({ lang: 'no', mute: true, timed: false, showErr: true, seenHowTo: false });
  const progressDaily = baseSave(g, today);
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_save_v1: JSON.stringify(progressDaily), logikk_stats_v1: JSON.stringify(emptyStats()) });
  assert(!howtoOpen(r), 'in-progress daily showed the how-to');
  assert(r.sandbox.__newBoards.length === 0 && starts(r.sandbox).length === 0, 'in-progress daily auto-started');
  assert(state(r.sandbox).done === false && state(r.sandbox).daily === today, 'in-progress daily did not resume');

  // 4. Solved official daily: filled grid + win card, no how-to, no start/finish.
  const solvedStats = emptyStats();
  solvedStats.daily[today] = { t: 5000, h: 1 };
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_stats_v1: JSON.stringify(solvedStats) });
  assert(!howtoOpen(r), 'solved daily showed the how-to');
  assert(r.sandbox.__newBoards.length === 0 && starts(r.sandbox).length === 0 && gc(r.sandbox).indexOf('finish-daily') < 0, 'solved daily tracked a game');
  assert(state(r.sandbox).done === true && state(r.sandbox).daily === today, 'solved daily was not restored');
  assert(r.elements.win.hidden === false && r.elements.menu.hidden === true, 'solved daily did not keep the win card');
  const share = r.sandbox.LOGIKK.shareText().split('\n');
  const shareAll = share.join('\n');
  assert(share[0] === 'Ren logikk #' + r.sandbox.LOGIKK.dayNum(today), 'share first line is ' + share[0]);
  assert(share[share.length - 1] === 'stop60.no/logikk' && shareAll.includes('🟩') && shareAll.includes('\u23f1') && shareAll.includes('\uD83D\uDD25'), 'share card lost the emoji, time, streak, or plain link');
  assert(!shareAll.includes('Dagens brett'), 'share text still includes the long daily title');

  // 5. Familiar visitors: any daily key, or any level won, skips the overlay but still auto-starts.
  const yesterday = emptyStats();
  yesterday.daily[shiftDay(today, -1)] = { t: 0, h: 0 };
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_stats_v1: JSON.stringify(yesterday) });
  assert(!howtoOpen(r) && starts(r.sandbox).length === 1 && state(r.sandbox).daily === today && state(r.sandbox).done === false, 'past daily still showed the how-to or skipped today');
  const won = emptyStats();
  won.easy.won = 1;
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_stats_v1: JSON.stringify(won) });
  assert(!howtoOpen(r) && starts(r.sandbox).length === 1, 'a won practice game still showed the how-to');

  // 6. Escape dismisses and persists. A later Escape with nothing open does not invent the flag.
  r = boot(html, {});
  assert(howtoOpen(r), 'escape setup did not show the how-to');
  const before = state(r.sandbox).seed;
  key(r, 'Escape');
  assert(!howtoOpen(r) && prefs(r.sandbox).seenHowTo === true, 'Escape did not dismiss and persist');
  assert(state(r.sandbox).seed === before && starts(r.sandbox).length === 1, 'Escape restarted the daily');
  const practice = baseSave(g, today, { daily: '', seed: 'practice', diff: 'easy' });
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_save_v1: JSON.stringify(practice), logikk_stats_v1: JSON.stringify(emptyStats()) });
  assert(!howtoOpen(r) && state(r.sandbox).seed === 'practice', 'unfinished practice did not resume');
  key(r, 'Escape');
  assert(!(prefs(r.sandbox) && prefs(r.sandbox).seenHowTo), 'Escape set seenHowTo with no rules and no how-to');

  // 7. Opening or closing the long rules sets the flag. The long rules dialog still opens and closes.
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_save_v1: JSON.stringify(practice), logikk_stats_v1: JSON.stringify(emptyStats()) });
  r.elements.mRules.onclick();
  assert(r.elements.rules.hidden === false && prefs(r.sandbox).seenHowTo === true, 'mRules did not open the long rules or set the flag');
  r.elements.rClose.onclick();
  assert(r.elements.rules.hidden === true && prefs(r.sandbox).seenHowTo === true, 'rClose did not close the long rules');
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_save_v1: JSON.stringify(practice), logikk_stats_v1: JSON.stringify(emptyStats()) });
  r.document.getElementById('rules').hidden = false;
  key(r, 'Escape');
  assert(r.elements.rules.hidden === true && prefs(r.sandbox).seenHowTo === true, 'Escape did not close the long rules and set the flag');
  r = boot(html, { logikk_prefs_v1: resumePrefs, logikk_save_v1: JSON.stringify(practice), logikk_stats_v1: JSON.stringify(emptyStats()) });
  r.elements.rulesBtn.onclick();
  assert(r.elements.rules.hidden === false && prefs(r.sandbox).seenHowTo === true, 'rules button did not open the long rules or set the flag');

  // 8. ?daily=1 and #daily on a first visit still start once and keep the overlay.
  ['?debug=1&daily=1', null].forEach(function (search, i) {
    const hash = i === 1 ? '#daily' : '';
    const q = boot(html, {}, search || '?debug=1', hash);
    assert(howtoOpen(q) && starts(q.sandbox).length === 1 && q.sandbox.__newBoards.length === 1, (search || hash) + ' first visit did not keep a single auto-daily under the how-to');
    assert(state(q.sandbox).daily === today && state(q.sandbox).done === false && q.elements.menu.hidden === true, (search || hash) + ' left the menu or replaced the daily');
  });

  // 9. Timed mode does not count the read. Play releases the clock. The same board continues.
  const timedPrefs = JSON.stringify({ lang: 'no', mute: true, timed: true, showErr: true });
  r = boot(html, { logikk_prefs_v1: timedPrefs });
  assert(howtoOpen(r) && state(r.sandbox).timed === true, 'timed first visit did not show the how-to on a timed daily');
  const el0 = state(r.sandbox).el;
  r.advance(5000); tick(r); r.advance(5000); tick(r);
  assert(state(r.sandbox).el === el0, 'timer ran while the how-to was open');
  r.elements.howtoPlay.onclick();
  r.advance(1500); tick(r);
  assert(state(r.sandbox).el === el0 + 1500, 'timer stayed paused after Play (' + state(r.sandbox).el + ')');
  assert(state(r.sandbox).daily === today && starts(r.sandbox).length === 1, 'Play after a timed read started another daily');

  // 10. Entry pages use their own heading, Play label, and tighter share line.
  const plSolved = boot(html, { logikk_prefs_v1: JSON.stringify({ lang: 'pl', mute: true, timed: false, showErr: true }), logikk_stats_v1: JSON.stringify(solvedStats) }, '?debug=1', '', '/logikk/pl/');
  assert(!howtoOpen(plSolved), 'solved /pl/ showed the how-to');
  assert(plSolved.sandbox.LOGIKK.shareText().split('\n')[0] === 'Czysta logika #' + plSolved.sandbox.LOGIKK.dayNum(today), 'pl share line');
  assert(plSolved.sandbox.LOGIKK.shareText().split('\n').pop() === 'stop60.no/logikk/pl', 'pl share path');
  const enFresh = boot(html, {}, '?debug=1', '', '/logikk/en/');
  assert(howtoOpen(enFresh) && enFresh.elements.howtoPlay.getAttribute('aria-label') === 'Play' && enFresh.elements.howtoH.textContent === 'How to play', 'en how-to copy');
  assert(enFresh.elements.howtoPts.innerHTML.includes('Short rounds') && enFresh.elements.howtoPts.innerHTML.includes('Simple rules'), 'en PTS bullets');
  const plFresh = boot(html, {}, '?debug=1', '', '/logikk/pl/');
  assert(howtoOpen(plFresh) && plFresh.elements.howtoPlay.textContent === 'Zagraj' && plFresh.elements.howtoPts.innerHTML.includes('Krótkie rundy'), 'pl how-to copy');

  console.log('first-visit-howto: ok (' + today + ')');
}

try { main(); }
catch (e) {
  if (!failed) { failed++; console.error('FAIL:', e && e.stack || e); }
  process.exitCode = 1;
}
if (failed) process.exitCode = 1;
