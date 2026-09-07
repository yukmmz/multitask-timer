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

/* Single source of truth for the version and the URLs. The QR images encode
 * these same URLs, and the deploy check greps APP_VERSION out of the published
 * file — so bump it here and nowhere else. */
var APP_VERSION = '1.2.1';
var APP_URL = 'https://yukmmz.github.io/multitask-timer/';
var SRC_URL = 'https://github.com/yukmmz/multitask-timer';

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
  return { tasks: tasks, runningId: null, startedAt: null, soundId: DEFAULT_SOUND_ID };
}

function elapsedOf(task) {
  var ms = task.accumulatedMs;
  if (state.runningId === task.id && state.startedAt !== null) {
    ms += Date.now() - state.startedAt;
  }
  return ms > 0 ? ms : 0;
}

/** Minutes of every target that is set, or 0 when no task has one. */
function totalTargetMin() {
  var sum = 0;
  for (var i = 0; i < state.tasks.length; i++) {
    if (state.tasks[i].targetMin !== null) sum += state.tasks[i].targetMin;
  }
  return sum;
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

  var restored = {
    tasks: tasks,
    runningId: null,
    startedAt: null,
    soundId: findSound(parsed.soundId).id
  };

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

/* The alert is a WAV built at runtime and played through an <audio> element.
 *
 * Not the Web Audio API: iOS suspends an AudioContext when the page is hidden,
 * the screen locks, or another app plays audio, and an overrun fires without a
 * user gesture that could resume it — so only the first alert was ever audible.
 * iOS also treats Web Audio as ambient sound and silences it in silent mode.
 * A media element unlocked once by a gesture does not have either problem.
 *
 * iOS still refuses to play an element that was never started inside a gesture,
 * so `unlockAudio()` starts and stops the clip on the first tap. The clip opens
 * with LEAD_MS of silence so that unlocking play is inaudible.
 */

var SAMPLE_RATE = 22050;
var LEAD_MS = 150;      // head silence: the unlocking play stays inside it


/* ---- tone building blocks -------------------------------------------------
 * Every alert is synthesised from these, so the app ships no audio files. */

function toneSilence(rate, sec) {
  var out = [];
  for (var i = 0, n = Math.round(rate * sec); i < n; i++) out.push(0);
  return out;
}

/** Struck note: near-instant attack, exponential decay, optional overtones. */
function toneStruck(rate, hz, sec, gain, decay, partials) {
  var n = Math.round(rate * sec);
  var attack = Math.round(rate * 0.006);
  var out = [];
  partials = partials || [[1, 1]];
  for (var i = 0; i < n; i++) {
    var t = i / rate;
    var env = Math.exp(-decay * t);
    if (i < attack) env *= i / attack;
    var v = 0;
    for (var k = 0; k < partials.length; k++) {
      v += Math.sin(2 * Math.PI * hz * partials[k][0] * t) * partials[k][1];
    }
    out.push(v * gain * env);
  }
  return out;
}

/** Flat tone with short fades — the plain electronic beep. */
function toneFlat(rate, hz, sec, gain) {
  var n = Math.round(rate * sec);
  var fade = Math.round(rate * 0.008);
  var out = [];
  for (var i = 0; i < n; i++) {
    var env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    out.push(Math.sin(2 * Math.PI * hz * i / rate) * gain * env);
  }
  return out;
}

/** Frequency glide from f0 to f1 with an exponential decay. */
function toneSweep(rate, f0, f1, sec, gain, decay) {
  var n = Math.round(rate * sec);
  var attack = Math.round(rate * 0.006);
  var phase = 0;
  var out = [];
  for (var i = 0; i < n; i++) {
    var hz = f0 + (f1 - f0) * (i / n);
    phase += 2 * Math.PI * hz / rate;
    var env = Math.exp(-decay * (i / rate));
    if (i < attack) env *= i / attack;
    out.push(Math.sin(phase) * gain * env);
  }
  return out;
}

/** Several notes at once, fading in and out — no attack at all. */
function tonePad(rate, hzList, sec, gain) {
  var n = Math.round(rate * sec);
  var out = [];
  for (var i = 0; i < n; i++) {
    var env = Math.sin(Math.PI * (i / n));   // 0 -> 1 -> 0
    var v = 0;
    for (var k = 0; k < hzList.length; k++) {
      v += Math.sin(2 * Math.PI * hzList[k] * i / rate);
    }
    out.push(v / hzList.length * gain * env);
  }
  return out;
}

function toneJoin(parts) {
  var out = [];
  for (var i = 0; i < parts.length; i++) out = out.concat(parts[i]);
  return out;
}

/** Mix `b` into `a` starting at `offsetSec`, so notes can ring into each other. */
function toneOverlay(rate, a, b, offsetSec) {
  var off = Math.round(rate * offsetSec);
  var out = a.slice();
  for (var i = 0; i < b.length; i++) {
    var at = off + i;
    out[at] = (out[at] || 0) + b[i];
  }
  return out;
}

/* ---- the alert sounds ---------------------------------------------------
 * Ordered from calm to insistent. Overtone sets are shared so related sounds
 * keep the same character. */

var P_SOFT = [[1, 1], [2, 0.2]];
var P_WOOD = [[1, 1], [2, 0.25], [3, 0.08]];
var P_GLASS = [[1, 1], [2.4, 0.35], [4.1, 0.15]];
var P_BELL = [[1, 1], [2.76, 0.28], [5.4, 0.1]];
var P_MUSICBOX = [[1, 1], [3, 0.12], [5, 0.05]];
var P_KNOCK = [[1, 1], [1.6, 0.3]];

/** Notes struck one after another, each ringing into the next. */
function toneArpeggio(rate, notes, stepSec) {
  var out = toneSilence(rate, LEAD_MS / 1000);
  for (var i = 0; i < notes.length; i++) {
    out = toneOverlay(rate, out, notes[i], LEAD_MS / 1000 + i * stepSec);
  }
  return out;
}

var SOUNDS = [
  {
    id: 'chime',
    name: 'チャイム（3音）',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 523, 1.2, 0.22, 4.5, P_SOFT),
                                 toneStruck(rate, 659, 1.2, 0.22, 4.5, P_SOFT),
                                 toneStruck(rate, 784, 1.4, 0.22, 4, P_SOFT)], 0.14);
    }
  },
  {
    id: 'musicbox',
    name: 'オルゴール（3音）',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 1047, 1.6, 0.16, 3, P_MUSICBOX),
                                 toneStruck(rate, 1319, 1.6, 0.16, 3, P_MUSICBOX),
                                 toneStruck(rate, 1568, 1.8, 0.16, 2.6, P_MUSICBOX)], 0.12);
    }
  },
  {
    id: 'glocken',
    name: 'グロッケン（2音）',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 1047, 0.9, 0.18, 5, P_GLASS),
                                 toneStruck(rate, 1568, 1.1, 0.18, 4.5, P_GLASS)], 0.11);
    }
  },
  {
    id: 'harp',
    name: 'ハープ（4音）',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 523, 1.4, 0.16, 4, P_SOFT),
                                 toneStruck(rate, 659, 1.4, 0.16, 4, P_SOFT),
                                 toneStruck(rate, 784, 1.4, 0.16, 4, P_SOFT),
                                 toneStruck(rate, 1047, 1.6, 0.16, 3.5, P_SOFT)], 0.09);
    }
  },
  {
    id: 'bell',
    name: 'ベル（1音）',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneStruck(rate, 587, 1.6, 0.26, 3.2, P_BELL)]);
    }
  },
  {
    id: 'marimba',
    name: '木琴（2音）',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 523, 0.7, 0.3, 7, P_WOOD),
                                 toneStruck(rate, 784, 0.9, 0.3, 6, P_WOOD)], 0.16);
    }
  },
  {
    id: 'chord',
    name: '和音ひとつ',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 392, 1.6, 0.16, 3.5, P_SOFT),
                                 toneStruck(rate, 494, 1.6, 0.16, 3.5, P_SOFT),
                                 toneStruck(rate, 587, 1.6, 0.16, 3.5, P_SOFT)], 0);
    }
  },
  {
    id: 'soft',
    name: 'ポーン（控えめ）',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneStruck(rate, 523, 1.0, 0.18, 5, [[1, 1], [2, 0.15]])]);
    }
  },
  {
    id: 'pad',
    name: 'ふわっとパッド',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       tonePad(rate, [392, 494, 587], 1.4, 0.24)]);
    }
  },
  {
    id: 'knock',
    name: 'ノック（2回）',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneStruck(rate, 320, 0.3, 0.3, 20, P_KNOCK),
                       toneSilence(rate, 0.14),
                       toneStruck(rate, 320, 0.3, 0.3, 20, P_KNOCK)]);
    }
  },
  {
    id: 'blip',
    name: 'ピロン（2回）',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneSweep(rate, 440, 900, 0.28, 0.22, 5),
                       toneSilence(rate, 0.1),
                       toneSweep(rate, 440, 900, 0.28, 0.22, 5)]);
    }
  },
  {
    id: 'beep',
    name: 'ビープ（3回・目立つ）',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneFlat(rate, 880, 0.22, 0.35), toneSilence(rate, 0.09),
                       toneFlat(rate, 880, 0.22, 0.35), toneSilence(rate, 0.09),
                       toneFlat(rate, 880, 0.22, 0.35)]);
    }
  }
];

var DEFAULT_SOUND_ID = 'chime';

function findSound(id) {
  for (var i = 0; i < SOUNDS.length; i++) {
    if (SOUNDS[i].id === id) return SOUNDS[i];
  }
  return SOUNDS[0];
}

var beepAudio = null;
var audioUnlocked = false;
var builtSoundId = null;

/** Samples for the currently chosen alert, lead silence included. */
function beepSamples(rate) {
  return findSound(state ? state.soundId : DEFAULT_SOUND_ID).build(rate);
}

/** Wrap samples in a 16-bit mono WAV and return it as a data: URI. */
function wavDataUri(samples, rate) {
  var bytes = [];
  function str(s) { for (var k = 0; k < s.length; k++) bytes.push(s.charCodeAt(k) & 0xff); }
  function u32(v) { bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
  function u16(v) { bytes.push(v & 255, (v >> 8) & 255); }

  var n = samples.length;
  str('RIFF'); u32(36 + n * 2); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
  str('data'); u32(n * 2);
  for (var i = 0; i < n; i++) {
    var v = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
    if (v < 0) v += 0x10000;
    bytes.push(v & 255, (v >> 8) & 255);
  }

  var chars = '';
  for (var p = 0; p < bytes.length; p += 0x8000) {
    chars += String.fromCharCode.apply(null, bytes.slice(p, p + 0x8000));
  }
  return 'data:audio/wav;base64,' + window.btoa(chars);
}

/** Build the clip once. */
function ensureBeepAudio() {
  if (!window.Audio || !window.btoa) return;
  var wanted = state ? state.soundId : DEFAULT_SOUND_ID;
  if (beepAudio && builtSoundId === wanted) return;
  try {
    var uri = wavDataUri(beepSamples(SAMPLE_RATE), SAMPLE_RATE);
    if (beepAudio) beepAudio.src = uri;    // keep the element: it stays unlocked
    else {
      beepAudio = new window.Audio(uri);
      beepAudio.preload = 'auto';
    }
    builtSoundId = wanted;
  } catch (e) {
    beepAudio = null;
    builtSoundId = null;
  }
}

/** Switch alert sound and play it once, so the choice is audible immediately. */
function setSound(id) {
  state.soundId = findSound(id).id;
  save();
  ensureBeepAudio();
  audioUnlocked = true;     // we are inside the change gesture
  beep();
}

/** On a user gesture, start and stop the clip so later plays are permitted. */
function unlockAudio() {
  ensureBeepAudio();
  if (!beepAudio || audioUnlocked) return;
  try {
    // Start and stop in the same turn. Waiting on the play() promise would
    // pause only after playback had begun, and on a slow start that is past
    // the clip's lead silence — which is audible as a beep on the first tap.
    var promise = beepAudio.play();
    beepAudio.pause();
    try { beepAudio.currentTime = 0; } catch (e) { /* ignore */ }
    audioUnlocked = true;
    // Pausing that quickly rejects the promise; that is the expected path.
    if (promise && typeof promise['catch'] === 'function') {
      promise['catch'](function () { /* ignore */ });
    }
  } catch (e) {
    /* Refused: the next gesture retries. */
  }
}

/** Three short beeps. Silent until a gesture has unlocked playback. */
function beep() {
  if (!beepAudio) return;
  try {
    beepAudio.currentTime = 0;
    var promise = beepAudio.play();
    if (promise && typeof promise['catch'] === 'function') {
      promise['catch'](function () { /* ignore */ });
    }
  } catch (e) {
    /* ignore */
  }
}

/* The settings sheet's sound test. The press unlocks playback, then the beep
 * fires from a timer a few seconds later — exactly how a real overrun alert
 * reaches `beep()`. Beeping during the press instead would pass even when the
 * real alert is silent, which is the failure this test exists to catch. */

var TEST_DELAY_S = 3;
var soundTestTimer = null;

function runSoundTest() {
  if (soundTestTimer !== null) return;
  unlockAudio();

  var left = TEST_DELAY_S;
  els.testSound.disabled = true;
  els.testSound.textContent = left + ' 秒後に鳴らします…';

  soundTestTimer = window.setInterval(function () {
    left--;
    if (left > 0) {
      els.testSound.textContent = left + ' 秒後に鳴らします…';
      return;
    }
    window.clearInterval(soundTestTimer);
    soundTestTimer = null;
    beep();
    els.testSound.disabled = false;
    els.testSound.textContent = '鳴りましたか？';
    window.setTimeout(function () {
      if (soundTestTimer === null) els.testSound.textContent = '音をテスト';
    }, 5000);
  }, 1000);
}

/* ---- target-time wheels ---------------------------------------------------
 * An iOS-alarm-style picker for coarse pointers. The wheels and the number
 * fields both write `task.targetMin`, so whichever the device shows, the stored
 * value is the same.
 *
 * The minute wheel wraps: 59 is followed by 0 and 0 is preceded by 59. That is
 * done by stacking several copies of 0..59 and, once the scroll has settled,
 * jumping back to the middle copy. The jump is invisible because the row under
 * the band shows the same number either way, and it happens at rest so it never
 * cuts a flick short. Hours stay bounded — a target of 24 hours has an end.
 */

var WHEEL_ITEM_H = 40;      // must match .wheel-item height in style.css
var WHEEL_ROWS = 5;         // must match .wheel height / WHEEL_ITEM_H

var MINUTE_COPIES = 7;      // enough that one flick cannot run off the stack
var MINUTE_HOME = 3;        // the copy the wheel is recentred on

/** True when the primary input is a finger rather than a mouse. */
function isCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

/** Fill a wheel with `copies` runs of 0..count-1. */
function buildWheel(el, count, copies) {
  for (var c = 0; c < (copies || 1); c++) {
    for (var i = 0; i < count; i++) {
      var item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = String(i);
      el.appendChild(item);
    }
  }
}

/** Which row is under the band, counting from the top of the whole stack. */
function wheelRow(el) {
  var row = Math.round((el.scrollTop || 0) / WHEEL_ITEM_H);
  return row < 0 ? 0 : row;
}

/** The value under the band. Wrapping wheels take the remainder; bounded ones
 *  clamp, so overscrolling past the end still reads as the last value. */
function wheelValue(el, count, wrap) {
  var row = wheelRow(el);
  if (wrap) return ((row % count) + count) % count;
  return row > count - 1 ? count - 1 : row;
}

/** Scroll a wheel so `value` lands in the band. Does nothing while hidden:
 *  a display:none element cannot be scrolled, so call this after opening. */
function setWheelValue(el, value, wrap) {
  var row = wrap ? MINUTE_HOME * 60 + value : value;
  el.scrollTop = row * WHEEL_ITEM_H;
}

/** Slide the stack back to the middle copy, keeping the same number under the
 *  band. Returns true when it moved. Only safe once scrolling has stopped. */
function recentreWheel(el, count) {
  var row = wheelRow(el);
  var copy = Math.floor(row / count);
  if (copy === MINUTE_HOME) return false;
  el.scrollTop += (MINUTE_HOME - copy) * count * WHEEL_ITEM_H;
  return true;
}

/** Emphasise the row in the band, so the wheel reads like the iOS one.
 *  Called on every scroll event, so it only touches what changed. */
function markWheelRow(el, row) {
  if (el.markedIndex === row) return;
  var items = el.children;
  var previous = items[el.markedIndex];
  if (previous && previous.classList) previous.classList.remove('selected');
  var current = items[row];
  if (current && current.classList) current.classList.add('selected');
  el.markedIndex = row;
}

/** Ease onto the nearest row. Snapping is `proximity` rather than `mandatory`
 *  so a flick keeps its momentum; this is what guarantees it still lands
 *  aligned once the glide is over. */
function alignWheel(el) {
  var target = wheelRow(el) * WHEEL_ITEM_H;
  if (Math.abs(el.scrollTop - target) < 1) return;
  if (el.scrollTo) el.scrollTo({ top: target, behavior: 'smooth' });
  else el.scrollTop = target;
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
  // The wheels could not be scrolled while the menu was display:none.
  syncWheels(card, state.tasks[index]);
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
      wheelH: node.querySelector('.task-wheel-h'),
      wheelM: node.querySelector('.task-wheel-m'),
      targetView: node.querySelector('.task-target-view'),
      menu: node.querySelector('.task-menu'),
      menuBtn: node.querySelector('.task-menu-btn'),
      reset: node.querySelector('.task-reset'),
      lastTime: '',
      lastOver: '',
      lastName: '',
      lastTargetView: '',
      lastRunning: null,
      lastIsOver: null,
      wheelTimer: null,
      wheelSyncing: false
    };
    bindCard(card, state.tasks[i], i);
    els.tasks.appendChild(node);
    cards.push(card);
  }

  if (els.tasks.style) els.tasks.style.setProperty('--cols', String(state.tasks.length));
}

/** Fill the menu's hour/minute fields from the task (blank means zero). */
function writeTargetInputs(card, task) {
  var h = task.targetMin === null ? 0 : Math.floor(task.targetMin / 60);
  var m = task.targetMin === null ? 0 : task.targetMin % 60;

  if (task.targetMin === null) {
    card.targetH.value = '';
    card.targetM.value = '';
  } else {
    card.targetH.value = h === 0 ? '' : String(h);
    card.targetM.value = m === 0 ? '' : String(m);
  }

  markWheelRow(card.wheelH, h);
  markWheelRow(card.wheelM, wheelRow(card.wheelM));
}

/** Move the wheels to the task's value. Only works once the menu is visible. */
function syncWheels(card, task) {
  var h = task.targetMin === null ? 0 : Math.floor(task.targetMin / 60);
  var m = task.targetMin === null ? 0 : task.targetMin % 60;
  card.wheelSyncing = true;
  setWheelValue(card.wheelH, h, false);
  setWheelValue(card.wheelM, m, true);
  markWheelRow(card.wheelH, h);
  markWheelRow(card.wheelM, MINUTE_HOME * 60 + m);
  card.wheelSyncing = false;
}

/** Read the wheels. Returns minutes, or null for "no target". */
function readWheels(card) {
  var total = wheelValue(card.wheelH, 25, false) * 60 +
              wheelValue(card.wheelM, 60, true);
  if (total <= 0) return null;
  return total > 1440 ? 1440 : total;
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

  buildWheel(card.wheelH, 25, 1);                // 0..24 hours, bounded
  buildWheel(card.wheelM, 60, MINUTE_COPIES);   // 0..59 minutes, wrapping

  // Momentum scrolling fires a burst of events and then stops; commit once
  // it settles rather than on every frame.
  function onWheelScroll() {
    if (card.wheelSyncing) return;
    // Follow the finger; the value itself is only committed once it settles.
    markWheelRow(card.wheelH, wheelRow(card.wheelH));
    markWheelRow(card.wheelM, wheelRow(card.wheelM));
    if (card.wheelTimer !== null) window.clearTimeout(card.wheelTimer);
    card.wheelTimer = window.setTimeout(function () {
      card.wheelTimer = null;
      task.targetMin = readWheels(card);
      task.notified = false;
      save();

      // The glide is over, so the stack can be shifted and the row squared up
      // without either being felt.
      card.wheelSyncing = true;
      recentreWheel(card.wheelM, 60);
      alignWheel(card.wheelH);
      alignWheel(card.wheelM);
      markWheelRow(card.wheelH, wheelRow(card.wheelH));
      markWheelRow(card.wheelM, wheelRow(card.wheelM));
      // Smooth scrolling keeps firing events; ignore them rather than looping.
      window.setTimeout(function () { card.wheelSyncing = false; }, 400);

      render();
    }, 140);
  }

  card.wheelH.addEventListener('scroll', onWheelScroll);
  card.wheelM.addEventListener('scroll', onWheelScroll);

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

  var targetSum = totalTargetMin();
  var targetSumText = targetSum > 0 ? '目安合計 ' + formatTargetLabel(targetSum) : '';
  if (targetSumText !== lastTargetTotal) {
    els.targetTotal.textContent = targetSumText;
    lastTargetTotal = targetSumText;
  }

  els.stopAll.disabled = !running;
  els.taskCountValue.textContent = String(state.tasks.length);
  els.taskMinus.disabled = state.tasks.length <= MIN_TASKS;
  els.taskPlus.disabled = state.tasks.length >= MAX_TASKS;

  updateTitle(running);
}

var lastTitle = '';
var lastTargetTotal = '';

function updateTitle(running) {
  var title = 'Multitask Timer';
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
    if (els.qrOverlay) els.qrOverlay.hidden = true;
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
  els.targetTotal = document.getElementById('target-total');
  els.settingsBtn = document.getElementById('settings-btn');
  els.settingsPanel = document.getElementById('settings-panel');
  els.settingsClose = document.getElementById('settings-close');
  els.testSound = document.getElementById('test-sound');
  els.soundSelect = document.getElementById('sound-select');
  els.appVersion = document.getElementById('appVersion');
  els.qrOverlay = document.getElementById('qrOverlay');
  els.qrBtn = document.getElementById('qrBtn');
  els.qrClose = document.getElementById('qrClose');
  els.qrUrl = document.getElementById('qrUrl');
  els.qrSrcUrl = document.getElementById('qrSrcUrl');
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
  els.testSound.addEventListener('click', runSoundTest);

  els.appVersion.textContent = 'Multitask Timer v' + APP_VERSION;

  // The QR images encode these strings; print the same constants so the two
  // cannot drift apart when one of them is edited.
  els.qrUrl.textContent = APP_URL;
  els.qrSrcUrl.textContent = SRC_URL;

  els.qrBtn.addEventListener('click', function () {
    setSettingsOpen(false);
    els.qrOverlay.hidden = false;
  });
  els.qrClose.addEventListener('click', function () { els.qrOverlay.hidden = true; });
  els.qrOverlay.addEventListener('click', function (event) {
    if (event.target === els.qrOverlay) els.qrOverlay.hidden = true;
  });

  for (var s = 0; s < SOUNDS.length; s++) {
    var option = document.createElement('option');
    option.value = SOUNDS[s].id;
    option.textContent = SOUNDS[s].name;
    els.soundSelect.appendChild(option);
  }
  els.soundSelect.value = state.soundId;
  els.soundSelect.addEventListener('change', function () {
    setSound(els.soundSelect.value);
  });
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
