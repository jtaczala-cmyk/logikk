#!/usr/bin/env node
'use strict';
/* Official daily difficulty: medium through 2026-11-14, easy from 2026-11-15.
   Practice boards stay on the difficulty the menu asks for. */
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

function gameScript(html) {
  const start = html.indexOf('var LG = (function () {');
  const end = html.indexOf('</script>', start);
  assert(start > 0 && end > start, 'game script not found');
  return html.slice(start, end);
}

function inlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const body = m[2].trim();
    if (body) out.push(body);
  }
  return out;
}

function loadDailyDiff(src) {
  const start = src.indexOf('var DAILY_EASY_FROM = ');
  const end = src.indexOf('function showSolvedDaily');
  assert(start > 0 && end > start, 'dailyDiff helper missing');
  assert(src.indexOf('var DAILY_EASY_FROM = ', start + 1) < 0, 'dailyDiff helper is not unique');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.dailyDiff = dailyDiff; this.DAILY_EASY_FROM = DAILY_EASY_FROM;', ctx);
  return ctx;
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
    tabIndex: 0, disabled: false, dataset: {}, style: { setProperty: function () {}, animationDelay: '' },
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

function freezeDate(sandbox, y, m, d) {
  const fixed = new Date(y, m - 1, d, 12, 0, 0).getTime();
  vm.runInContext(
    '(function () {\n' +
    '  var RealDate = Date;\n' +
    '  var fixed = ' + fixed + ';\n' +
    '  function D() {\n' +
    '    var n = arguments.length;\n' +
    '    if (n === 0) return new RealDate(fixed);\n' +
    '    if (n === 1) return new RealDate(arguments[0]);\n' +
    '    return new RealDate(arguments[0], arguments[1], arguments[2] || 1, arguments[3] || 0, arguments[4] || 0, arguments[5] || 0, arguments[6] || 0);\n' +
    '  }\n' +
    '  D.now = function () { return fixed; };\n' +
    '  D.parse = RealDate.parse;\n' +
    '  D.UTC = RealDate.UTC;\n' +
    '  D.prototype = RealDate.prototype;\n' +
    '  Date = D;\n' +
    '})();',
    sandbox
  );
}

function runPage(html, src, opts) {
  const elements = {};
  const intervals = [];
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
    addEventListener: function () {},
    execCommand: function () { return true; }
  };
  document.documentElement = makeElement();
  document.body = makeElement();
  document.head = makeElement();
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function (fn, ms) {
      const t = setInterval(fn, ms);
      if (t && t.unref) t.unref();
      intervals.push(t);
      return t;
    },
    clearInterval: clearInterval,
    document: document,
    location: {
      search: opts.search || '?debug=1',
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
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
    addEventListener: function () {},
    __newBoards: []
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (opts.date) freezeDate(sandbox, opts.date[0], opts.date[1], opts.date[2]);
  let code = src;
  const needle = 'function newBoard(diff, daily) {\n';
  assert(code.includes(needle), 'newBoard needle missing');
  code = code.replace(needle, needle + '  window.__newBoards.push([diff, !!daily]);\n');
  try { vm.runInContext(code, sandbox, { filename: 'index.html' }); }
  finally { intervals.forEach(function (t) { clearInterval(t); }); }
  return { sandbox: sandbox, elements: elements };
}

function main() {
  const htmls = pages.map(function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); });
  const scripts = htmls.map(gameScript);
  assert(scripts[0] === scripts[1] && scripts[1] === scripts[2], 'game script drifted between language pages');
  pages.forEach(function (p, i) {
    inlineScripts(htmls[i]).forEach(function (body, n) {
      const tmp = path.join('/tmp', 'logikk-daily-diff-' + p.replace(/\//g, '-') + '-' + n + '.js');
      fs.writeFileSync(tmp, body);
      const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      assert(chk.status === 0, 'node --check failed for ' + p + ' script ' + n + '\n' + chk.stderr);
    });
  });

  const src = scripts[0];
  assert(!/generate\(\s*'medium'\s*,\s*'daily-/.test(src), 'official daily still calls generate(\'medium\', \'daily-');
  assert(src.includes("againDaily: 'Nytt middels brett'") && src.includes("againDaily: 'New medium board'") && src.includes("againDaily: 'Nowa plansza (średni)'"), 'againDaily practice label changed');
  assert(src.includes('Dagens brett er det samme for alle, hver dag, på et nivå som vanligvis tar noen minutter (lett).'), 'Norwegian how-to sentence');
  assert(src.includes('The daily puzzle is the same for everyone, every day, at a level that usually takes a few minutes (easy).'), 'English how-to sentence');
  assert(src.includes('Plansza dnia jest codziennie taka sama dla wszystkich, na poziomie, który zwykle zajmuje kilka minut (łatwy).'), 'Polish how-to sentence');
  assert(!src.includes('Dagens brett (middels)') && !src.includes('The daily puzzle (medium)') && !src.includes('Plansza dnia (średnia)'), 'old daily-as-medium how-to remains');
  assert(src.includes('Tidsmodus er av som standard') && src.includes('Timed mode is off by default') && src.includes('Tryb czasowy jest domyślnie wyłączony'), 'timed-mode sentence was dropped');
  assert(src.includes("t('name') + ' #' + dayNum(key)") && src.includes("return 'stop60.no/logikk';"), 'share line changed');
  assert(src.includes("GC_CODE = 'jtaczala-games'") && src.includes("track('start-' + (daily ? 'daily' : diff))") && src.includes("track('finish-' + (S.daily ? 'daily' : d))") && src.includes("track('share')"), 'GoatCounter events changed');
  assert(!/[?&]utm_|utm_source|utm_medium|utm_campaign/i.test(src), 'tracking params appeared');
  assert(src.includes("ask('medium', true)"), 'daily autostart no longer goes through ask');

  const helper = loadDailyDiff(src);
  assert(helper.DAILY_EASY_FROM === '2026-11-15', 'cutoff constant');
  assert(helper.dailyDiff('2026-11-14') === 'medium', '14 Nov is ' + helper.dailyDiff('2026-11-14'));
  assert(helper.dailyDiff('2026-11-15') === 'easy', '15 Nov is ' + helper.dailyDiff('2026-11-15'));
  assert(helper.dailyDiff('2026-11-13') === 'medium' && helper.dailyDiff('2026-11-16') === 'easy', '13 Nov stayed medium and 16 Nov is easy');

  const lgCtx = {};
  vm.createContext(lgCtx);
  vm.runInContext(src.slice(0, src.indexOf("(function () {\n'use strict';")) + '\nthis.LG = LG;', lgCtx);
  const LG = lgCtx.LG;
  const medium = LG.generate(helper.dailyDiff('2026-11-14'), 'daily-2026-11-14');
  const easy = LG.generate(helper.dailyDiff('2026-11-15'), 'daily-2026-11-15');
  assert(medium && medium.diff === 'medium' && medium.seed === 'daily-2026-11-14' && medium.level === 2, 'daily-2026-11-14 was not a medium board');
  assert(easy && easy.diff === 'easy' && easy.seed === 'daily-2026-11-15' && easy.level === 1, 'daily-2026-11-15 was not an easy board');
  assert(JSON.stringify(medium.puzzle) !== JSON.stringify(easy.puzzle), 'the two daily seeds produced the same puzzle');

  const html = htmls[0];
  const prefs = JSON.stringify({ lang: 'no', mute: true, timed: false, showErr: true, seenHowTo: true });
  function store(extra) {
    const out = { logikk_prefs_v1: prefs };
    if (extra) Object.assign(out, extra);
    return out;
  }

  let r = runPage(html, src, { date: [2026, 11, 14] });
  let st = r.sandbox.LOGIKK.state();
  assert(JSON.stringify(r.sandbox.__newBoards) === '[["medium",true]]', '14 Nov autostart was ' + JSON.stringify(r.sandbox.__newBoards));
  assert(st && st.done === false && st.daily === '2026-11-14' && st.seed === '2026-11-14' && st.diff === 'medium', '14 Nov official daily was ' + (st && st.diff));
  assert(JSON.stringify(st.puz) === JSON.stringify(medium.puzzle), '14 Nov autostart was not seed daily-2026-11-14');
  assert(r.sandbox.__gcLog.indexOf('start-daily') >= 0 && r.sandbox.__gcLog.indexOf('finish-daily') < 0, '14 Nov tracked ' + JSON.stringify(r.sandbox.__gcLog));

  r = runPage(html, src, { date: [2026, 11, 15] });
  st = r.sandbox.LOGIKK.state();
  assert(st && st.done === false && st.daily === '2026-11-15' && st.seed === '2026-11-15' && st.diff === 'easy', '15 Nov official daily was ' + (st && st.diff));
  assert(JSON.stringify(st.puz) === JSON.stringify(easy.puzzle), '15 Nov autostart was not seed daily-2026-11-15');
  const dailyPuzzle = st.puz.slice();
  r.elements.mEasy.dataset.d = 'easy';
  r.elements.mEasy.onclick();
  st = r.sandbox.LOGIKK.state();
  assert(st.diff === 'easy' && st.daily === '' && st.done === false && st.seed !== '2026-11-15', 'practice easy did not leave the official daily');
  assert(JSON.stringify(st.puz) !== JSON.stringify(dailyPuzzle), 'practice easy reused the daily puzzle');
  assert(r.sandbox.__gcLog.indexOf('start-easy') >= 0, 'practice easy did not track start-easy');
  r.elements.mHard.dataset.d = 'hard';
  r.elements.mHard.onclick();
  st = r.sandbox.LOGIKK.state();
  assert(st.diff === 'hard' && st.daily === '' && st.seed.indexOf('daily-') !== 0, 'practice hard was started as a daily');

  ['?debug=1&daily=1', '#daily'].forEach(function (flag) {
    const search = flag.charAt(0) === '?' ? flag : '?debug=1';
    const hash = flag.charAt(0) === '#' ? flag : '';
    const q = runPage(html, src, { date: [2026, 11, 15], search: search, hash: hash });
    const s = q.sandbox.LOGIKK.state();
    assert(s && s.diff === 'easy' && s.daily === '2026-11-15' && s.done === false, flag + ' did not autostart the easy daily');
  });
  ['/logikk/', '/logikk/en/', '/logikk/pl/'].forEach(function (pathname) {
    const q = runPage(html, src, { date: [2026, 11, 15], pathname: pathname });
    const s = q.sandbox.LOGIKK.state();
    assert(s && s.diff === 'easy' && s.daily === '2026-11-15' && s.done === false, pathname + ' did not autostart the easy daily');
  });

  const hole = medium.puzzle.findIndex(function (v) { return !v; });
  assert(hole >= 0, 'medium daily has no empty cell');
  const progress = {
    v: 1, diff: 'medium', seed: '2026-11-14', daily: '2026-11-14',
    puz: medium.puzzle.slice(), sol: medium.solution.slice(), cur: medium.puzzle.slice(),
    notes: medium.puzzle.map(function () { return 0; }), hist: [],
    hintsUsed: 1, mistakes: 2, el: 12345, timed: false, done: false, sel: -1, counted: 0
  };
  progress.cur[hole] = medium.solution[hole];
  r = runPage(html, src, { date: [2026, 11, 14], store: store({ logikk_save_v1: JSON.stringify(progress) }) });
  st = r.sandbox.LOGIKK.state();
  assert(r.sandbox.__newBoards.length === 0, 'in-progress 14 Nov daily was regenerated');
  assert(st.cur[hole] === medium.solution[hole] && st.mistakes === 2 && st.el === 12345 && st.diff === 'medium' && st.done === false, 'resume did not keep the saved medium grid');
  assert(!r.sandbox.__gcLog || r.sandbox.__gcLog.indexOf('start-daily') < 0, 'resume tracked a new daily');

  function solved(day, board) {
    const stats = { easy: { won: 0, best: 0 }, medium: { won: 0, best: 0 }, hard: { won: 0, best: 0 }, daily: {} };
    stats.daily[day] = { t: 4000, h: 2 };
    const q = runPage(html, src, { date: day.split('-').map(Number), store: store({ logikk_stats_v1: JSON.stringify(stats) }) });
    const s = q.sandbox.LOGIKK.state();
    assert(q.sandbox.__newBoards.length === 0, day + ' solved return called newBoard');
    assert(s && s.done === true && s.daily === day && s.diff === helper.dailyDiff(day), day + ' solved return rebuilt ' + (s && s.diff));
    assert(JSON.stringify(s.puz) === JSON.stringify(board.puzzle) && JSON.stringify(s.cur) === JSON.stringify(board.solution), day + ' solved return was a different board');
    assert(!q.sandbox.__gcLog || (q.sandbox.__gcLog.indexOf('start-daily') < 0 && q.sandbox.__gcLog.indexOf('finish-daily') < 0), day + ' solved return tracked a game');
    assert(q.sandbox.LOGIKK.shareText().split('\n')[0] === 'Ren logikk #' + q.sandbox.LOGIKK.dayNum(day), day + ' share title');
    assert(q.sandbox.LOGIKK.shareText().split('\n').pop() === 'stop60.no/logikk', day + ' share link');
  }
  solved('2026-11-14', medium);
  solved('2026-11-15', easy);

  console.log('daily-diff: ok');
}

try { main(); }
catch (e) {
  if (!failed) { failed++; console.error('FAIL:', e && e.stack || e); }
  process.exitCode = 1;
}
if (failed) process.exitCode = 1;
