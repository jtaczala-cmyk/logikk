#!/usr/bin/env node
'use strict';
/* Static checks for the daily challenge picker: all 10 targets, humorous
   share lines with a 1-5 score and a plain stop60.no/daily/ link, and a
   GoatCounter event per target only after a successful share or copy. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pages = ['index.html', 'en/index.html', 'pl/index.html'];
const ids = ['boss','pm','accountant','coworker','bus','neighbour','kiosk','manager','intern','other'];
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  }
}

const forbidden = /Defender|Space Invaders|MasterChef|Temple Run|Labyrinth|labirynt|Taito|Atari|Williams|professional|Galaga|Galaxy Attack|Star Wars|\bOslo\b/i;
const names = /Støre|Stoltenberg|Tusk|Donald|Trump|Biden|Sunak|Starmer|Solberg/i;

const htmls = pages.map(function (f) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  assert(!forbidden.test(src), f + ' has a forbidden word');
  assert(!names.test(src), f + ' names a real person');
  assert(!/[?&]utm_|utm_source|utm_medium|utm_campaign/i.test(src), f + ' has tracking params');
  assert(src.includes('id="wChallenge"') && src.includes('id="wChOpen"') && src.includes('id="wChMenu"'), f + ' missing picker markup');
  assert(src.includes("challenge: 'Utfordre…'") && src.includes("challenge: 'Wyzwij…'") && src.includes("challenge: 'Challenge…'"), f + ' missing picker titles');
  ids.forEach(function (id) {
    assert(src.includes('data-ch="' + id + '"'), f + ' missing button ' + id);
    assert(src.includes('chLbl_' + id + ':'), f + ' missing label ' + id);
    assert(src.includes('chTxt_' + id + ':'), f + ' missing text ' + id);
  });
  assert(src.includes("return t('chTxt_' + id, { s: challengeScore() }) + '\\nstop60.no/daily/';") ||
         src.includes('return t(\'chTxt_\' + id, { s: challengeScore() }) + \'\nstop60.no/daily/\';') ||
         src.includes(" + '\\nstop60.no/daily/'"), f + ' share text does not append the plain daily link');
  assert(src.includes("track('challenge-' + id)"), f + ' missing per-target GoatCounter event');
  assert(src.includes("if (name === 'AbortError') { finish(); return; }"), f + ' cancelled share should not copy or count');
  assert(src.includes('var s = 5 - (S.hintsUsed | 0) - (S.mistakes | 0);') && src.includes('return s < 1 ? 1 : s;'), f + ' score formula changed');
  assert((src.match(/stop60\.no\/daily\//g) || []).length >= 1, f + ' missing stop60.no/daily/');
  assert(!src.includes('https://stop60.no/daily/?'), f + ' daily link has a query string');
  return src;
});

assert(htmls.length === 3, 'expected three language pages');
if (failed) {
  console.error(failed + ' checks failed');
  process.exit(1);
}
console.log('ok: challenge picker present on', pages.join(', '));
