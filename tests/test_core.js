/* Headless check of main.js's exclusive-stopwatch state machine.
 * Runs the real main.js inside a vm with a minimal DOM stub and a mocked clock.
 *   node scratch/test_core.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'main.js');
const I18N_SRC = path.join(__dirname, '..', 'i18n.js');

let failures = 0;
function check(label, ok, extra) {
  if (ok) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + extra : ''));
  }
}

/* ------------------------------------------------------------ DOM stub */

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    textContent: '',
    value: '',
    disabled: false,
    hidden: true,
    dataset: {},
    style: { setProperty() {} },
    setAttribute() {},
    closest() { return null; },
    children: [],
    classes: new Set(),
    handlers: {},
    classList: {
      toggle(name, on) { if (on) el.classes.add(name); else el.classes.delete(name); },
      add(name) { el.classes.add(name); },
      remove(name) { el.classes.delete(name); },
      contains(name) { return el.classes.has(name); }
    },
    addEventListener(type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn); },
    appendChild(child) { el.children.push(child); return child; },
    scrollTop: 0,
    querySelector(sel) { return el.bySel[sel] || null; },
    cloneNode() { return makeCard(); },
    querySelectorAll() { return []; },
    get options() { return el.children; },
    bySel: {}
  };
  // Like the DOM: assigning '' to textContent removes the children.
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(v) { text = v; if (v === '') el.children.length = 0; }
  });
  return el;
}

function makeCard() {
  const card = makeEl('section');
  ['.task-name-text', '.task-name', '.task-time', '.task-over', '.task-target-h',
   '.task-target-m', '.task-target-view', '.task-menu', '.task-menu-btn', '.task-reset',
   '.task-wheel-h', '.task-wheel-m']
    .forEach(sel => { card.bySel[sel] = makeEl('div'); });
  return card;
}

function makeAudioStub() {
  const el = {
    calls: [],
    preload: '',
    src: '',
    currentTime: 0,
    play() { el.calls.push('play'); return { catch() {}, then() {} }; },
    pause() { el.calls.push('pause'); }
  };
  return el;
}

let lastAudio = null;

let NOW = 1700000000000;
let activeIntervals = 0;

function makeContext(store) {
  const byId = {};
  ['tasks', 'total-time', 'stop-all', 'reset-all', 'task-plus', 'task-minus', 'task-count-value',
   'settings-btn', 'settings-panel', 'settings-close', 'sheet-backdrop', 'target-total',
   'test-sound', 'sound-select', 'appVersion', 'qrOverlay', 'qrBtn', 'qrClose',
   'qrUrl', 'qrSrcUrl', 'auto-stop-extra', 'auto-stop-no-target',
   'changelogBtn', 'changelogOverlay', 'changelogList', 'changelogClose',
   'lang-select', 'fullscreen-btn', 'clearDataBtn', 'help-btn', 'helpOverlay', 'helpClose']
    .forEach(id => { byId[id] = makeEl('div'); });
  byId.tasks.textContent = '';

  const template = makeEl('template');
  template.content = { firstElementChild: makeCard() };
  byId['task-template'] = template;

  const documentStub = {
    readyState: 'complete',
    visibilityState: 'visible',
    title: '',
    documentElement: { lang: '' },
    querySelectorAll() { return []; },
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return makeEl(tag); },
    handlers: {},
    addEventListener(t, fn) { (documentStub.handlers[t] = documentStub.handlers[t] || []).push(fn); }
  };

  const windowStub = {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    navigator: { language: 'ja' },
    location: { reload() { windowStub.reloaded = true; } },
    confirm() { return true; },
    btoa(s) { return Buffer.from(s, 'binary').toString('base64'); },
    Audio: function (src) { lastAudio = makeAudioStub(); lastAudio.src = src; return lastAudio; },
    setInterval() { activeIntervals++; return activeIntervals; },
    clearInterval() { activeIntervals--; },
    setTimeout() { return 0; },
    clearTimeout() {},
    addEventListener() {}
  };

  windowStub.document = documentStub;
  const ctx = {
    window: windowStub,
    document: documentStub,
    console,
    Date: { now: () => NOW },
    __els: byId,
    __doc: documentStub
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(I18N_SRC, 'utf8'), ctx, { filename: 'i18n.js' });
  ctx.I18N = windowStub.I18N;
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'main.js' });
  return ctx;
}

/* --------------------------------------------------------------- tests */

function invariantOneRunner(ctx, label) {
  const running = ctx.state.tasks.filter(t => ctx.state.runningId === t.id);
  check(label, running.length <= 1, 'running=' + running.length);
}

console.log('\n[1] fresh start');
const store = {};
NOW = 1700000000000;
let ctx = makeContext(store);
check('3 tasks by default', ctx.state.tasks.length === 3, ctx.state.tasks.length);
check('nothing running', ctx.state.runningId === null);
check('all at zero', ctx.state.tasks.every(t => ctx.elapsedOf(t) === 0));
check('default names A/B/C',
  ctx.state.tasks.map(t => t.name).join(',') === 'タスク A,タスク B,タスク C',
  ctx.state.tasks.map(t => t.name).join(','));

const [A, B, C] = ctx.state.tasks;

console.log('\n[2] press B -> only B runs');
ctx.toggleTask(B.id);
check('B is running', ctx.state.runningId === B.id);
invariantOneRunner(ctx, 'exactly one runner');
NOW += 5000;
check('B elapsed 5s', ctx.elapsedOf(B) === 5000, ctx.elapsedOf(B));
check('A still 0', ctx.elapsedOf(A) === 0);
check('C still 0', ctx.elapsedOf(C) === 0);
check('total 5s', ctx.totalElapsed() === 5000, ctx.totalElapsed());

console.log('\n[3] press A -> B stops, A starts');
ctx.toggleTask(A.id);
check('A is running', ctx.state.runningId === A.id);
invariantOneRunner(ctx, 'exactly one runner');
check('B frozen at 5s', ctx.elapsedOf(B) === 5000, ctx.elapsedOf(B));
NOW += 3000;
check('B stays 5s while A runs', ctx.elapsedOf(B) === 5000, ctx.elapsedOf(B));
check('A elapsed 3s', ctx.elapsedOf(A) === 3000, ctx.elapsedOf(A));

console.log('\n[4] press B again -> resumes from 5s');
ctx.toggleTask(B.id);
NOW += 2000;
check('B resumed to 7s', ctx.elapsedOf(B) === 7000, ctx.elapsedOf(B));
check('A frozen at 3s', ctx.elapsedOf(A) === 3000, ctx.elapsedOf(A));
invariantOneRunner(ctx, 'exactly one runner');

console.log('\n[5] press C -> B stops, only C runs');
ctx.toggleTask(C.id);
NOW += 1000;
check('C elapsed 1s', ctx.elapsedOf(C) === 1000, ctx.elapsedOf(C));
check('B frozen at 7s', ctx.elapsedOf(B) === 7000, ctx.elapsedOf(B));
check('total 11s', ctx.totalElapsed() === 11000, ctx.totalElapsed());
invariantOneRunner(ctx, 'exactly one runner');

console.log('\n[6] press the running task -> everything stops');
ctx.toggleTask(C.id);
check('nothing running', ctx.state.runningId === null);
NOW += 10000;
check('total frozen at 11s', ctx.totalElapsed() === 11000, ctx.totalElapsed());

console.log('\n[7] target-time overrun');
B.targetMin = 0.1 * 0 + 1; // 1 minute
B.notified = false;
ctx.toggleTask(B.id);
NOW += 53 * 1000; // B: 7s + 53s = 60s -> exactly at the target
ctx.render();
const bCard = ctx.__els.tasks.children[1];
check('time marked over', bCard.bySel['.task-time'].classes.has('over'));
check('overrun label shown', /超過/.test(bCard.bySel['.task-over'].textContent),
  bCard.bySel['.task-over'].textContent);
check('notified once', B.notified === true);
check('count-up did NOT stop', ctx.state.runningId === B.id);
NOW += 4000;
check('keeps counting past target', ctx.elapsedOf(B) === 64000, ctx.elapsedOf(B));

console.log('\n[8] persistence across a reload (running task keeps running)');
ctx.stopAll();
ctx.toggleTask(A.id);          // A running, 3s accumulated
NOW += 6000;
const aBefore = ctx.elapsedOf(A);
const totalBefore = ctx.totalElapsed();
const ctx2 = makeContext(store); // reload: same localStorage, same clock
check('task count restored', ctx2.state.tasks.length === 3, ctx2.state.tasks.length);
check('A restored as running', ctx2.state.runningId === ctx2.state.tasks[0].id);
check('A elapsed preserved', ctx2.elapsedOf(ctx2.state.tasks[0]) === aBefore,
  ctx2.elapsedOf(ctx2.state.tasks[0]) + ' vs ' + aBefore);
check('total preserved', ctx2.totalElapsed() === totalBefore,
  ctx2.totalElapsed() + ' vs ' + totalBefore);
check('target minutes preserved', ctx2.state.tasks[1].targetMin === 1, ctx2.state.tasks[1].targetMin);
NOW += 2000;
check('restored task keeps counting', ctx2.elapsedOf(ctx2.state.tasks[0]) === aBefore + 2000);

console.log('\n[9] add / remove tasks (1..6)');
const ctx3 = makeContext({});
for (let i = 0; i < 10; i++) ctx3.addTask();
check('capped at 6', ctx3.state.tasks.length === 6, ctx3.state.tasks.length);
for (let i = 0; i < 10; i++) ctx3.removeTask();
check('floored at 1', ctx3.state.tasks.length === 1, ctx3.state.tasks.length);

console.log('\n[10] formatting');
check('0 -> 00:00:00', ctx3.formatDuration(0) === '00:00:00', ctx3.formatDuration(0));
check('59s', ctx3.formatDuration(59000) === '00:00:59', ctx3.formatDuration(59000));
check('1h2m3s', ctx3.formatDuration(3723000) === '01:02:03', ctx3.formatDuration(3723000));
check('100h', ctx3.formatDuration(360000000) === '100:00:00', ctx3.formatDuration(360000000));

console.log('\n[11] reset');
const ctx4 = makeContext({});
ctx4.toggleTask(ctx4.state.tasks[0].id);
NOW += 9000;
ctx4.resetAllTimes();
check('all zero after reset', ctx4.totalElapsed() === 0, ctx4.totalElapsed());
check('nothing running after reset', ctx4.state.runningId === null);
check('names kept', ctx4.state.tasks[0].name === 'タスク A', ctx4.state.tasks[0].name);

console.log('\n[12] corrupt storage falls back to defaults');
const ctx5 = makeContext({ 'multitask-timer/v1': '{not json' });
check('3 default tasks', ctx5.state.tasks.length === 3, ctx5.state.tasks.length);


console.log('\n[13] target time in hours + minutes');
const fakeCard = (h, m) => ({ targetH: { value: h }, targetM: { value: m } });
check('90 -> 1時間30分', ctx3.formatTargetLabel(90) === '1時間30分', ctx3.formatTargetLabel(90));
check('120 -> 2時間', ctx3.formatTargetLabel(120) === '2時間', ctx3.formatTargetLabel(120));
check('25 -> 25分', ctx3.formatTargetLabel(25) === '25分', ctx3.formatTargetLabel(25));
check('1h30m -> 90', ctx3.readTargetInputs(fakeCard('1', '30')) === 90,
  ctx3.readTargetInputs(fakeCard('1', '30')));
check('blank/blank -> null', ctx3.readTargetInputs(fakeCard('', '')) === null,
  ctx3.readTargetInputs(fakeCard('', '')));
check('hours only', ctx3.readTargetInputs(fakeCard('2', '')) === 120,
  ctx3.readTargetInputs(fakeCard('2', '')));
check('minutes only', ctx3.readTargetInputs(fakeCard('', '45')) === 45,
  ctx3.readTargetInputs(fakeCard('', '45')));
check('clamped at 1440', ctx3.readTargetInputs(fakeCard('99', '59')) === 1440,
  ctx3.readTargetInputs(fakeCard('99', '59')));


console.log('\n[14] total of the target times');
const ctx6 = makeContext({});
check('no targets -> 0', ctx6.totalTargetMin() === 0, ctx6.totalTargetMin());
ctx6.state.tasks[0].targetMin = 30;   // A: 30分
ctx6.state.tasks[1].targetMin = 60;   // B: 1時間
ctx6.state.tasks[2].targetMin = null; // C: 未設定
check('30 + 60 + none = 90', ctx6.totalTargetMin() === 90, ctx6.totalTargetMin());
check('labelled 1時間30分', ctx6.formatTargetLabel(ctx6.totalTargetMin()) === '1時間30分',
  ctx6.formatTargetLabel(ctx6.totalTargetMin()));
ctx6.render();
check('shown in the footer',
  ctx6.__els['target-total'].textContent === '目安合計 1時間30分',
  ctx6.__els['target-total'].textContent);
ctx6.state.tasks[0].targetMin = null;
ctx6.state.tasks[1].targetMin = null;
ctx6.render();
check('blank when nothing is set', ctx6.__els['target-total'].textContent === '',
  ctx6.__els['target-total'].textContent);


console.log('\n[15] the alert clip (WAV built at runtime)');
const clip = ctx3.beepSamples(8000);
check('opens with silence', clip.slice(0, 100).every(v => v === 0));
check('carries an audible tone', clip.some(v => Math.abs(v) > 0.2));
const plain = ctx3.findSound('beep').build(8000);
let bursts = 0;
for (let i = 1; i < plain.length; i++) {
  if (plain[i - 1] === 0 && plain[i] !== 0) bursts++;
}
check('the plain beep is three separate tones', bursts === 3, bursts);
check('the chime rings as one gesture', clip.filter((v, i) =>
  i > 0 && clip[i - 1] === 0 && v !== 0).length === 1);
const uri = ctx3.wavDataUri([0, 0.5, -0.5], 8000);
check('is a wav data URI', /^data:audio\/wav;base64,/.test(uri), uri.slice(0, 30));
const header = Buffer.from(uri.split(',')[1], 'base64');
check('RIFF/WAVE header', header.slice(0, 4).toString() === 'RIFF' &&
  header.slice(8, 12).toString() === 'WAVE', header.slice(0, 12).toString());
check('44-byte header + 16-bit samples', header.length === 44 + 3 * 2, header.length);

console.log('\n[16] alert sound choice');
const store7 = {};
const ctx7 = makeContext(store7);
check('defaults to the chime', ctx7.state.soundId === 'chime', ctx7.state.soundId);
check('every sound builds samples', ctx7.SOUNDS.every(s => s.build(8000).length > 1000));
check('ids are unique',
  new Set(ctx7.SOUNDS.map(s => s.id)).size === ctx7.SOUNDS.length);
check('unknown id falls back', ctx7.findSound('nope').id === 'chime',
  ctx7.findSound('nope').id);
ctx7.state.soundId = 'bell';
ctx7.save();
const ctx8 = makeContext(store7);
check('choice survives a reload', ctx8.state.soundId === 'bell', ctx8.state.soundId);

console.log('\n[17] version and share URLs');
const ctx9 = makeContext({});
check('APP_VERSION looks like x.y.z', /^\d+\.\d+\.\d+$/.test(ctx9.APP_VERSION), ctx9.APP_VERSION);
check('APP_URL is the pages URL',
  ctx9.APP_URL === 'https://yukmmz.github.io/multitask-timer/', ctx9.APP_URL);
check('SRC_URL is the repo URL',
  ctx9.SRC_URL === 'https://github.com/yukmmz/multitask-timer', ctx9.SRC_URL);
check('version is shown', ctx9.__els.appVersion.textContent === 'v' + ctx9.APP_VERSION,
  ctx9.__els.appVersion.textContent);
check('QR label matches the encoded app URL',
  ctx9.__els.qrUrl.textContent === ctx9.APP_URL, ctx9.__els.qrUrl.textContent);
check('QR label matches the encoded source URL',
  ctx9.__els.qrSrcUrl.textContent === ctx9.SRC_URL, ctx9.__els.qrSrcUrl.textContent);

console.log('\n[18] target-time wheels');
const ctx10 = makeContext({});
const wheelCard = {
  wheelH: { scrollTop: 0, children: [] },
  wheelM: { scrollTop: 0, children: [] }
};
check('both at zero -> no target', ctx10.readWheels(wheelCard) === null,
  ctx10.readWheels(wheelCard));
wheelCard.wheelH.scrollTop = 1 * ctx10.WHEEL_ITEM_H;
wheelCard.wheelM.scrollTop = 30 * ctx10.WHEEL_ITEM_H;
check('1h30m -> 90 min', ctx10.readWheels(wheelCard) === 90, ctx10.readWheels(wheelCard));
wheelCard.wheelH.scrollTop = 24 * ctx10.WHEEL_ITEM_H;
wheelCard.wheelM.scrollTop = 59 * ctx10.WHEEL_ITEM_H;
check('clamped at 1440', ctx10.readWheels(wheelCard) === 1440, ctx10.readWheels(wheelCard));
wheelCard.wheelH.scrollTop = 2.4 * ctx10.WHEEL_ITEM_H;   // mid-flick
wheelCard.wheelM.scrollTop = 0;
check('rounds to the nearest row', ctx10.readWheels(wheelCard) === 120,
  ctx10.readWheels(wheelCard));
wheelCard.wheelH.scrollTop = -50;                        // overscroll above zero
wheelCard.wheelM.scrollTop = 0;
check('hours clamp at zero', ctx10.readWheels(wheelCard) === null,
  ctx10.readWheels(wheelCard));
wheelCard.wheelH.scrollTop = 99 * ctx10.WHEEL_ITEM_H;    // past the last hour
wheelCard.wheelM.scrollTop = 0;
check('hours clamp at 24 (1440 cap)', ctx10.readWheels(wheelCard) === 1440,
  ctx10.readWheels(wheelCard));

// Minutes wrap instead: row 60 is 0 again, row 61 is 1, row 59 of the copy below
// is still 59.
wheelCard.wheelH.scrollTop = 0;
wheelCard.wheelM.scrollTop = 60 * ctx10.WHEEL_ITEM_H;
check('minute 60 wraps to 0', ctx10.readWheels(wheelCard) === null,
  ctx10.readWheels(wheelCard));
wheelCard.wheelM.scrollTop = 61 * ctx10.WHEEL_ITEM_H;
check('minute 61 wraps to 1', ctx10.readWheels(wheelCard) === 1,
  ctx10.readWheels(wheelCard));
wheelCard.wheelM.scrollTop = (ctx10.MINUTE_HOME * 60 + 59) * ctx10.WHEEL_ITEM_H;
check('minute 59 in the home copy is 59', ctx10.readWheels(wheelCard) === 59,
  ctx10.readWheels(wheelCard));

// Recentring must move the stack without changing the number under the band.
const loopWheel = { scrollTop: 0, children: [] };
loopWheel.scrollTop = (6 * 60 + 30) * ctx10.WHEEL_ITEM_H;   // last copy
check('recentre reports a move', ctx10.recentreWheel(loopWheel, 60) === true);
check('recentre lands on the home copy',
  loopWheel.scrollTop === (ctx10.MINUTE_HOME * 60 + 30) * ctx10.WHEEL_ITEM_H,
  loopWheel.scrollTop / ctx10.WHEEL_ITEM_H);
check('recentre keeps the same minute',
  ctx10.wheelValue(loopWheel, 60, true) === 30,
  ctx10.wheelValue(loopWheel, 60, true));
check('already home -> no move', ctx10.recentreWheel(loopWheel, 60) === false);
check('a card wheel got its 25 hour rows',
  ctx10.__els.tasks.children[0].bySel['.task-wheel-h'].children.length === 25,
  ctx10.__els.tasks.children[0].bySel['.task-wheel-h'].children.length);
check('the minute wheel is stacked for wrapping',
  ctx10.__els.tasks.children[0].bySel['.task-wheel-m'].children.length
    === 60 * ctx10.MINUTE_COPIES,
  ctx10.__els.tasks.children[0].bySel['.task-wheel-m'].children.length);

console.log('\n[19] the unlocking play is never heard');
const ctx11 = makeContext({});
lastAudio = null;
ctx11.unlockAudio();
check('an audio element was built', lastAudio !== null);
check('it is a wav data URI', /^data:audio\/wav;base64,/.test(lastAudio.src),
  String(lastAudio.src).slice(0, 30));
check('play then pause, in the same turn',
  lastAudio.calls.join(',') === 'play,pause', lastAudio.calls.join(','));
check('rewound after the unlock', lastAudio.currentTime === 0, lastAudio.currentTime);
const beforeBeep = lastAudio.calls.length;
ctx11.beep();
check('a real alert does play', lastAudio.calls.length > beforeBeep &&
  lastAudio.calls[lastAudio.calls.length - 1] === 'play',
  lastAudio.calls.join(','));

console.log('\n[20] auto-stop');
const H = 3600 * 1000;
const storeA = {};
const ctxA = makeContext(storeA);
check('default: target + 2h', ctxA.state.autoStopExtraMin === 120, ctxA.state.autoStopExtraMin);
check('default: 5h without a target', ctxA.state.autoStopNoTargetMin === 300,
  ctxA.state.autoStopNoTargetMin);
check('selects filled', ctxA.__els['auto-stop-extra'].children.length === 9 &&
  ctxA.__els['auto-stop-no-target'].children.length === 11);

const [P, Q] = ctxA.state.tasks;
ctxA.toggleTask(P.id);                     // no target -> 5h
NOW += 5 * H - 1000;
ctxA.render();
check('no target: still running just before 5h', ctxA.state.runningId === P.id);
NOW += 1000;
ctxA.render();
check('no target: stopped at 5h', ctxA.state.runningId === null);
check('no target: banked exactly 5h', ctxA.elapsedOf(P) === 5 * H, ctxA.elapsedOf(P));
check('auto-stop is shown on the card',
  /自動停止/.test(ctxA.__els.tasks.children[0].bySel['.task-over'].textContent),
  ctxA.__els.tasks.children[0].bySel['.task-over'].textContent);

Q.targetMin = 60;                          // target 1h -> stop at 3h
ctxA.toggleTask(Q.id);
NOW += 10 * H;                             // asleep for 10h: noticed late
ctxA.render();
check('target: stopped', ctxA.state.runningId === null);
check('target: cut at target + 2h, not at 10h', ctxA.elapsedOf(Q) === 3 * H, ctxA.elapsedOf(Q));

ctxA.toggleTask(P.id);                     // restarted past its limit
check('restart clears the auto-stop mark', P.autoStopped === false);
NOW += 1 * H;
ctxA.render();
check('restart past the limit keeps running', ctxA.state.runningId === P.id);
NOW += 4 * H;
ctxA.render();
check('...and gets a fresh 5h allowance', ctxA.state.runningId === null &&
  ctxA.elapsedOf(P) === 10 * H, ctxA.elapsedOf(P));

// Settings: change, off, and survive a reload.
ctxA.__els['auto-stop-no-target'].value = '600';
ctxA.__els['auto-stop-no-target'].handlers.change[0]();
check('setting changed to 10h', ctxA.state.autoStopNoTargetMin === 600,
  ctxA.state.autoStopNoTargetMin);
ctxA.__els['auto-stop-extra'].value = 'off';
ctxA.__els['auto-stop-extra'].handlers.change[0]();
check('setting turned off', ctxA.state.autoStopExtraMin === null, ctxA.state.autoStopExtraMin);
const ctxB = makeContext(storeA);
check('settings survive a reload', ctxB.state.autoStopNoTargetMin === 600 &&
  ctxB.state.autoStopExtraMin === null);
check('off is shown as selected after reload', ctxB.__els['auto-stop-extra'].value === 'off',
  ctxB.__els['auto-stop-extra'].value);
const Qb = ctxB.state.tasks[1];
ctxB.toggleTask(Qb.id);
NOW += 30 * H;
ctxB.render();
check('off: a task with a target never stops', ctxB.state.runningId === Qb.id);

// A run that passed its limit while the page was closed is cut on load.
const storeC = {};
const ctxC = makeContext(storeC);
ctxC.toggleTask(ctxC.state.tasks[2].id);
NOW += 8 * H;
const ctxD = makeContext(storeC);
check('closed past the limit: stopped on load', ctxD.state.runningId === null);
check('closed past the limit: banked 5h', ctxD.elapsedOf(ctxD.state.tasks[2]) === 5 * H,
  ctxD.elapsedOf(ctxD.state.tasks[2]));

// Data saved before auto-stop existed gets the defaults.
const old = JSON.parse(storeC['multitask-timer/v1']);
delete old.autoStopExtraMin;
delete old.autoStopNoTargetMin;
const ctxE = makeContext({ 'multitask-timer/v1': JSON.stringify(old) });
check('old data -> default settings', ctxE.state.autoStopExtraMin === 120 &&
  ctxE.state.autoStopNoTargetMin === 300);

console.log('\n[21] repaint loop only while running and visible');
const ctxT = makeContext({});
const vis = () => ctxT.__doc.handlers.visibilitychange.forEach(fn => fn());
check('idle page: no loop', ctxT.tickTimer === null, ctxT.tickTimer);
ctxT.toggleTask(ctxT.state.tasks[0].id);
check('running: loop on', ctxT.tickTimer !== null);
ctxT.__doc.visibilityState = 'hidden';
vis();
check('screen off / hidden: loop off', ctxT.tickTimer === null, ctxT.tickTimer);
check('...but the task still counts', ctxT.state.runningId === ctxT.state.tasks[0].id);
NOW += 60000;
ctxT.__doc.visibilityState = 'visible';
vis();
check('back: loop on again', ctxT.tickTimer !== null);
check('back: time includes the hidden minute',
  ctxT.elapsedOf(ctxT.state.tasks[0]) === 60000, ctxT.elapsedOf(ctxT.state.tasks[0]));
ctxT.stopAll();
ctxT.render();
check('stopped: loop off', ctxT.tickTimer === null, ctxT.tickTimer);
ctxT.toggleTask(ctxT.state.tasks[1].id);
NOW += 6 * H;
ctxT.render();
check('auto-stopped: loop off', ctxT.state.runningId === null && ctxT.tickTimer === null);

console.log('\n[22] changelog');
const ctxL = makeContext({});
check('first entry is the current version', ctxL.CHANGELOG[0].version === ctxL.APP_VERSION,
  ctxL.CHANGELOG[0].version + ' vs ' + ctxL.APP_VERSION);
const vnum = v => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
check('newest first, no duplicates', ctxL.CHANGELOG.every((e, i, a) =>
  i === 0 || vnum(a[i - 1].version) > vnum(e.version)));
check('every entry has a date and items', ctxL.CHANGELOG.every(e =>
  /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.items.length > 0));
const listEl = ctxL.__els.changelogList;
check('one section per version', listEl.children.length === ctxL.CHANGELOG.length,
  listEl.children.length);
check('newest shown on top', listEl.children[0].children[0].textContent.indexOf('v' + ctxL.APP_VERSION) === 0,
  listEl.children[0].children[0].textContent);
check('brand-new user: no mark', !ctxL.__els['settings-btn'].classes.has('has-news'));

// An existing user upgrading: data saved, but this version never seen.
const storeU = { 'multitask-timer/v1': JSON.stringify({ tasks: [{ name: 'x' }] }) };
const ctxU = makeContext(storeU);
check('upgrading user: mark on ⚙', ctxU.__els['settings-btn'].classes.has('has-news'));
check('upgrading user: mark on the button', ctxU.__els.changelogBtn.classes.has('has-news'));
ctxU.__els.changelogBtn.handlers.click[0]();
check('opening shows the overlay', ctxU.__els.changelogOverlay.hidden === false);
check('opening clears the mark', !ctxU.__els['settings-btn'].classes.has('has-news'));
const ctxU2 = makeContext(storeU);
check('mark stays cleared after reload', !ctxU2.__els['settings-btn'].classes.has('has-news'));
ctxU2.__els.changelogOverlay.hidden = false;
ctxU2.__els.changelogClose.handlers.click[0]();
check('close button hides it', ctxU2.__els.changelogOverlay.hidden === true);

console.log('\n[23] language switch, clear data, version link');
const storeI = {};
const ctxI = makeContext(storeI);
check('browser ja -> Japanese', ctxI.I18N.lang() === 'ja');
check('ja duration', ctxI.formatTargetLabel(90) === '1時間30分', ctxI.formatTargetLabel(90));
ctxI.__els['lang-select'].value = 'en';
ctxI.__els['lang-select'].handlers.change[0]();
check('switched to English', ctxI.I18N.lang() === 'en');
check('en duration', ctxI.formatTargetLabel(90) === '1 h 30 min', ctxI.formatTargetLabel(90));
check('<html lang> follows', ctxI.__doc.documentElement.lang === 'en', ctxI.__doc.documentElement.lang);
check('changelog rebuilt in English', /moved from the settings/.test(
  ctxI.__els.changelogList.children[0].children[1].children[0].textContent));
check('sound names in English', ctxI.__els['sound-select'].children[0].textContent === 'Chime (3 notes)',
  ctxI.__els['sound-select'].children[0].textContent);
check('choice saved', storeI['multitask-timer/lang'] === 'en');
const ctxI2 = makeContext(storeI);
check('choice survives a reload', ctxI2.I18N.lang() === 'en');
check('every ja key has an en twin', Object.keys(ctxI.STRINGS.ja).every(k => k in ctxI.STRINGS.en),
  Object.keys(ctxI.STRINGS.ja).filter(k => !(k in ctxI.STRINGS.en)).join(','));
check('every changelog item is bilingual', ctxI.CHANGELOG.every(e => e.items.every(i => i.ja && i.en)));
ctxI2.__els.appVersion.handlers.click[0]();
check('version opens the changelog', ctxI2.__els.changelogOverlay.hidden === false);
ctxI2.__els.clearDataBtn.handlers.click[0]();
check('clear data removes every key', !('multitask-timer/v1' in storeI) &&
  !('multitask-timer/lang' in storeI) && !('multitask-timer/seen-version' in storeI),
  Object.keys(storeI).join(','));
check('...and reloads', ctxI2.window.reloaded === true);

console.log(failures === 0 ? '\nALL PASS\n' : '\n' + failures + ' FAILURE(S)\n');
process.exit(failures === 0 ? 0 : 1);
