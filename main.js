/* multitask-timer — exclusive per-task stopwatches.
 *
 * Core invariant: at any moment either NO task is running, or EXACTLY ONE is.
 * Tapping a task's card stops whatever was running and resumes that task
 * from where it left off.
 *
 * Timing model (do not replace with an accumulating interval):
 *   elapsed(task) = task.accumulatedMs + (running ? Date.now() - startedAt : 0)
 * `setInterval` is used ONLY to repaint. Background tabs throttle timers, so an
 * accumulate-on-tick design would under-count on both Chrome and iPad Safari.
 *
 * UI model: the whole card is the start/stop control. Per-task settings (name,
 * target time, per-task reset) live behind the card's ⋯ menu; app-wide settings
 * (task count, reset-all, usage notes) live behind the header's ⚙ sheet.
 */

'use strict';

var STORAGE_KEY = 'multitask-timer/v1';
var MIN_TASKS = 1;
var MAX_TASKS = 6;
var DEFAULT_TASKS = 3;
var TICK_MS = 200;
var NAME_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/* ------------------------------------------------------------------ state */

/** @type {{tasks: Array, runningId: (number|null), startedAt: (number|null)}} */
var state = null;
var nextTaskId = 1;

/** Card DOM handles, index-aligned with state.tasks. */
var cards = [];

function makeTask(index) {
  return {
    id: nextTaskId++,
    name: 'タスク ' + (NAME_LETTERS[index] || String(index + 1)),
    accumulatedMs: 0,
    targetMin: null,   // null = no target time (the default)
    notified: false    // beeped once for the current overrun
  };
}

function defaultState() {
  var tasks = [];
  for (var i = 0; i < DEFAULT_TASKS; i++) tasks.push(makeTask(i));
  return { tasks: tasks, runningId: null, startedAt: null };
}

function elapsedOf(task) {
  var ms = task.accumulatedMs;
  if (state.runningId === task.id && state.startedAt !== null) {
    ms += Date.now() - state.startedAt;
  }
  return ms > 0 ? ms : 0;
}

function totalElapsed() {
  var sum = 0;
  for (var i = 0; i < state.tasks.length; i++) sum += elapsedOf(state.tasks[i]);
  return sum;
}

function findTask(id) {
  for (var i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].id === id) return state.tasks[i];
  }
  return null;
}

/* -------------------------------------------------------------- transitions */

/** Fold the running task's live time into its accumulator and stop everything. */
function stopAll() {
  if (state.runningId === null) return;
  var task = findTask(state.runningId);
  if (task && state.startedAt !== null) {
    var delta = Date.now() - state.startedAt;
    if (delta > 0) task.accumulatedMs += delta;
  }
  state.runningId = null;
  state.startedAt = null;
  save();
}

/** Start `id` (stopping any other task first). Pressing the running task stops it. */
function toggleTask(id) {
  unlockAudio();
  if (state.runningId === id) {
    stopAll();
  } else {
    stopAll();
    state.runningId = id;
    state.startedAt = Date.now();
    save();
  }
  render();
}

function resetTask(task) {
  if (state.runningId === task.id) stopAll();
  task.accumulatedMs = 0;
  task.notified = false;
  save();
  render();
}

function resetAllTimes() {
  state.runningId = null;
  state.startedAt = null;
  for (var i = 0; i < state.tasks.length; i++) {
    state.tasks[i].accumulatedMs = 0;
    state.tasks[i].notified = false;
  }
  save();
  render();
}

function addTask() {
  if (state.tasks.length >= MAX_TASKS) return;
  state.tasks.push(makeTask(state.tasks.length));
  save();
  buildCards();
  render();
}

function removeTask() {
  if (state.tasks.length <= MIN_TASKS) return;
  var last = state.tasks[state.tasks.length - 1];
  var hasTime = elapsedOf(last) > 0;
  if (hasTime && !window.confirm('「' + last.name + '」には ' + formatDuration(elapsedOf(last)) +
                                 ' の記録があります。削除しますか？')) {
    return;
  }
  if (state.runningId === last.id) {
    // Discard the live segment: the task itself is going away.
    state.runningId = null;
    state.startedAt = null;
  }
  state.tasks.pop();
  save();
  buildCards();
  render();
}

/* ------------------------------------------------------------------ storage */

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* Private mode / quota: keep running in memory. */
  }
}

function clampInt(value, lo, hi, fallback) {
  var n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Restore. A task that was running when the page went away KEEPS running:
 * `startedAt` is an absolute timestamp, so the time spent while the tab was
 * closed or discarded is counted. That is deliberate — iPad Safari drops
 * background tabs while the user is still working, and an accidental reload
 * should not silently stop the measurement.
 */
function load() {
  var raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return defaultState();
  }
  if (!raw) return defaultState();

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return defaultState();
  }
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    return defaultState();
  }

  var tasks = [];
  var count = Math.min(parsed.tasks.length, MAX_TASKS);
  for (var i = 0; i < count; i++) {
    var t = parsed.tasks[i] || {};
    var acc = typeof t.accumulatedMs === 'number' && isFinite(t.accumulatedMs) && t.accumulatedMs > 0
      ? t.accumulatedMs : 0;
    var target = null;
    if (t.targetMin !== null && t.targetMin !== undefined && t.targetMin !== '') {
      var m = clampInt(t.targetMin, 0, 1440, null);
      target = (m === null || m <= 0) ? null : m;
    }
    tasks.push({
      id: nextTaskId++,
      name: typeof t.name === 'string' && t.name.length ? t.name.slice(0, 24) : 'タスク ' + (NAME_LETTERS[i] || (i + 1)),
      accumulatedMs: acc,
      targetMin: target,
      notified: t.notified === true
    });
  }

  var restored = { tasks: tasks, runningId: null, startedAt: null };

  // The stored id space is not the fresh one, so map by position.
  var runningIndex = -1;
  for (var j = 0; j < count; j++) {
    if (parsed.tasks[j] && parsed.tasks[j].id === parsed.runningId) { runningIndex = j; break; }
  }
  var startedAt = typeof parsed.startedAt === 'number' && isFinite(parsed.startedAt) ? parsed.startedAt : null;
  if (runningIndex >= 0 && startedAt !== null && startedAt <= Date.now()) {
    restored.runningId = tasks[runningIndex].id;
    restored.startedAt = startedAt;
  }
  return restored;
}

/* ----------------------------------------------------------------- format */

function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** ms -> "HH:MM:SS" (hours grow past 99 rather than wrapping). */
function formatDuration(ms) {
  var total = Math.floor(ms / 1000);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

/** Minutes -> "1時間30分" / "2時間" / "25分" (the target is stored in minutes). */
function formatTargetLabel(min) {
  var h = Math.floor(min / 60);
  var m = min % 60;
  if (h > 0 && m > 0) return h + '時間' + m + '分';
  if (h > 0) return h + '時間';
  return m + '分';
}

/* ------------------------------------------------------------------- audio */

var audioCtx = null;

/** iOS blocks audio until a user gesture, so unlock on the first interaction. */
function unlockAudio() {
  if (!audioCtx) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try { audioCtx = new Ctx(); } catch (e) { audioCtx = null; return; }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(function () { /* ignore */ });
  }
}

/** Three short beeps. Silent if audio was never unlocked by a gesture. */
function beep() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  var t0 = audioCtx.currentTime;
  for (var i = 0; i < 3; i++) {
    var start = t0 + i * 0.28;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.26);
  }
}

/* -------------------------------------------------------------------- DOM */

var els = {};

/** Index of the card whose ⋯ menu is open, or -1. Only one may be open. */
var openMenuIndex = -1;

function closeTaskMenu() {
  if (openMenuIndex < 0) return;
  var card = cards[openMenuIndex];
  if (card) {
    card.menu.hidden = true;
    card.menuBtn.setAttribute('aria-expanded', 'false');
  }
  openMenuIndex = -1;
}

function openTaskMenu(index) {
  closeTaskMenu();
  var card = cards[index];
  if (!card) return;
  card.menu.hidden = false;
  card.menuBtn.setAttribute('aria-expanded', 'true');
  openMenuIndex = index;
  syncBackdrop();
}

function setSettingsOpen(open) {
  els.settingsPanel.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  syncBackdrop();
}

/** The backdrop is shared: visible while the sheet or any card menu is open. */
function syncBackdrop() {
  var anyOpen = !els.settingsPanel.hidden || openMenuIndex >= 0;
  els.backdrop.hidden = !anyOpen;
}

function closeOverlays() {
  closeTaskMenu();
  setSettingsOpen(false);
}

function buildCards() {
  var tpl = document.getElementById('task-template');
  els.tasks.textContent = '';
  cards = [];
  openMenuIndex = -1;

  for (var i = 0; i < state.tasks.length; i++) {
    var node = tpl.content.firstElementChild.cloneNode(true);
    // Colour follows the card's position, so A/B/C keep the same colours.
    node.setAttribute('data-color', String(i % 6));

    var card = {
      root: node,
      nameText: node.querySelector('.task-name-text'),
      nameInput: node.querySelector('.task-name'),
      time: node.querySelector('.task-time'),
      over: node.querySelector('.task-over'),
      targetH: node.querySelector('.task-target-h'),
      targetM: node.querySelector('.task-target-m'),
      targetView: node.querySelector('.task-target-view'),
      menu: node.querySelector('.task-menu'),
      menuBtn: node.querySelector('.task-menu-btn'),
      reset: node.querySelector('.task-reset'),
      lastTime: '',
      lastOver: '',
      lastName: '',
      lastTargetView: '',
      lastRunning: null,
      lastIsOver: null
    };
    bindCard(card, state.tasks[i], i);
    els.tasks.appendChild(node);
    cards.push(card);
  }

  if (els.tasks.style) els.tasks.style.setProperty('--cols', String(state.tasks.length));
}

/** Fill the menu's hour/minute fields from the task (blank means zero). */
function writeTargetInputs(card, task) {
  if (task.targetMin === null) {
    card.targetH.value = '';
    card.targetM.value = '';
    return;
  }
  var h = Math.floor(task.targetMin / 60);
  var m = task.targetMin % 60;
  card.targetH.value = h === 0 ? '' : String(h);
  card.targetM.value = m === 0 ? '' : String(m);
}

/** Read the menu's hour/minute fields. Returns minutes, or null for "no target". */
function readTargetInputs(card) {
  var h = clampInt(card.targetH.value.trim(), 0, 24, 0);
  var m = clampInt(card.targetM.value.trim(), 0, 59, 0);
  if (h === null) h = 0;
  if (m === null) m = 0;
  var total = h * 60 + m;
  if (total <= 0) return null;
  return total > 1440 ? 1440 : total;
}

/** True when the click landed on the card's menu button or inside the menu. */
function isMenuTarget(target) {
  return !!(target && typeof target.closest === 'function' &&
            target.closest('.task-menu, .task-menu-btn'));
}

function bindCard(card, task, index) {
  card.nameInput.value = task.name;
  writeTargetInputs(card, task);

  // The whole card toggles, except where the per-task menu lives.
  card.root.addEventListener('click', function (event) {
    if (isMenuTarget(event.target)) return;
    if (openMenuIndex === index) { closeTaskMenu(); syncBackdrop(); return; }
    toggleTask(task.id);
  });

  card.root.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    if (event.target !== card.root) return;   // let inputs and buttons behave normally
    event.preventDefault();
    event.stopPropagation();
    toggleTask(task.id);
  });

  card.menuBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    if (openMenuIndex === index) { closeTaskMenu(); syncBackdrop(); }
    else openTaskMenu(index);
  });

  card.nameInput.addEventListener('input', function () {
    task.name = card.nameInput.value;
    save();
    render();
  });

  function onTargetInput() {
    task.targetMin = readTargetInputs(card);
    // A new target re-arms the alert if we are not past it yet.
    task.notified = false;
    save();
    render();
  }
  card.targetH.addEventListener('input', onTargetInput);
  card.targetM.addEventListener('input', onTargetInput);

  card.reset.addEventListener('click', function (event) {
    event.stopPropagation();
    if (elapsedOf(task) > 0 &&
        !window.confirm('「' + task.name + '」の時間を 00:00:00 に戻しますか？')) {
      return;
    }
    resetTask(task);
    closeTaskMenu();
    syncBackdrop();
  });
}

function render() {
  var running = state.runningId !== null;

  for (var i = 0; i < state.tasks.length; i++) {
    var task = state.tasks[i];
    var card = cards[i];
    if (!card) continue;

    var ms = elapsedOf(task);
    var text = formatDuration(ms);
    if (text !== card.lastTime) {
      card.time.textContent = text;
      card.lastTime = text;
    }

    var name = task.name || '（無題）';
    if (name !== card.lastName) {
      card.nameText.textContent = name;
      card.lastName = name;
    }

    var isRunning = state.runningId === task.id;
    if (isRunning !== card.lastRunning) {
      card.root.classList.toggle('running', isRunning);
      card.lastRunning = isRunning;
    }

    // Target-time overrun: warn loudly, but never stop counting.
    var targetMs = task.targetMin === null ? null : task.targetMin * 60000;
    var isOver = targetMs !== null && ms >= targetMs;

    if (isOver && !task.notified) {
      task.notified = true;
      beep();
      save();
    } else if (!isOver && task.notified) {
      task.notified = false;
      save();
    }

    if (isOver !== card.lastIsOver) {
      card.time.classList.toggle('over', isOver);
      card.lastIsOver = isOver;
    }

    var targetView = task.targetMin === null ? '' : '目安 ' + formatTargetLabel(task.targetMin);
    if (targetView !== card.lastTargetView) {
      card.targetView.textContent = targetView;
      card.lastTargetView = targetView;
    }

    var overText = isOver ? '超過 +' + formatDuration(ms - targetMs) : '';
    if (overText !== card.lastOver) {
      card.over.textContent = overText;
      card.lastOver = overText;
    }
  }

  els.totalTime.textContent = formatDuration(totalElapsed());
  els.stopAll.disabled = !running;
  els.taskCountValue.textContent = String(state.tasks.length);
  els.taskMinus.disabled = state.tasks.length <= MIN_TASKS;
  els.taskPlus.disabled = state.tasks.length >= MAX_TASKS;

  updateTitle(running);
}

var lastTitle = '';

function updateTitle(running) {
  var title = 'マルチタスクタイマー';
  if (running) {
    var task = findTask(state.runningId);
    if (task) title = '▶ ' + formatDuration(elapsedOf(task)) + ' ' + task.name;
  }
  if (title !== lastTitle) {
    document.title = title;
    lastTitle = title;
  }
}

/* -------------------------------------------------------------------- init */

function onKeyDown(event) {
  var tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') {
    closeOverlays();
    return;
  }
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    unlockAudio();
    stopAll();
    render();
    return;
  }
  var n = parseInt(event.key, 10);
  if (n >= 1 && n <= state.tasks.length) {
    event.preventDefault();
    closeTaskMenu();
    syncBackdrop();
    toggleTask(state.tasks[n - 1].id);
  }
}

function init() {
  els.tasks = document.getElementById('tasks');
  els.totalTime = document.getElementById('total-time');
  els.stopAll = document.getElementById('stop-all');
  els.resetAll = document.getElementById('reset-all');
  els.taskPlus = document.getElementById('task-plus');
  els.taskMinus = document.getElementById('task-minus');
  els.taskCountValue = document.getElementById('task-count-value');
  els.settingsBtn = document.getElementById('settings-btn');
  els.settingsPanel = document.getElementById('settings-panel');
  els.settingsClose = document.getElementById('settings-close');
  els.backdrop = document.getElementById('sheet-backdrop');

  state = load();
  buildCards();
  render();

  els.stopAll.addEventListener('click', function () {
    unlockAudio();
    stopAll();
    render();
  });

  els.settingsBtn.addEventListener('click', function () {
    unlockAudio();
    closeTaskMenu();
    setSettingsOpen(els.settingsPanel.hidden);
  });

  els.settingsClose.addEventListener('click', function () { setSettingsOpen(false); });
  els.backdrop.addEventListener('click', closeOverlays);

  els.resetAll.addEventListener('click', function () {
    if (totalElapsed() > 0 &&
        !window.confirm('すべてのタスクの計測時間を 00:00:00 に戻しますか？\n（タスク名と目安時間は残ります）')) {
      return;
    }
    resetAllTimes();
  });

  els.taskPlus.addEventListener('click', function () { unlockAudio(); addTask(); });
  els.taskMinus.addEventListener('click', function () { unlockAudio(); removeTask(); });

  document.addEventListener('keydown', onKeyDown);
  // Unlock audio on the very first gesture anywhere, so the first overrun beeps.
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') save();
    else render();
  });

  window.setInterval(render, TICK_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
