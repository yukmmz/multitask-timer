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
var APP_VERSION = '1.7.0';
var APP_URL = 'https://yukmmz.github.io/multitask-timer/';
var SRC_URL = 'https://github.com/yukmmz/multitask-timer';
/* Shared feedback endpoint (Google Apps Script web app, one for every yukmmz.github.io app).
 * Public on purpose: it can only append a row to a sheet and post to a Discord channel. */
var FEEDBACK_URL = 'https://script.google.com/macros/s/AKfycbxFJ-rTK2e5h05r6_j0RJJu-1Fo4Or3nsAnYcnGXC2i9I8FEdOIbNaXI1BfjunkQHEP/exec';
var APP_ID = 'multitask-timer';

/* What changed, newest first, shown from the settings sheet and from the
 * version next to the app name. Bumping APP_VERSION means adding an entry
 * here: the test checks that the first entry matches APP_VERSION. Written for
 * users, in both languages. */
var CHANGELOG = [
  { version: '1.7.0', date: '2026-10-04', items: [
    { ja: 'ヘッダーに「FB」ボタンを追加しました。ご意見・不具合の報告を開発者に送れます',
      en: 'New "FB" button in the header: send feedback or a bug report to the developer' },
    { ja: 'タスクの枠を長押ししてから動かすと、並び順を変えられるようにしました（色もタスクと一緒に動きます）',
      en: 'Press and hold a task\'s card, then drag it to change the order (its colour moves with it)' }
  ] },
  { version: '1.6.0', date: '2026-10-01', items: [
    { ja: '使い方を、設定の中からヘッダーの「?」ボタン（? キーでも開く）に移しました',
      en: '"How to use" moved from the settings to the "?" button in the header (or press ?)' },
    { ja: '全画面表示中は、全画面ボタンが「縮小」の形に変わるようにしました',
      en: 'While in full screen, the full-screen button changes to a "shrink" icon' }
  ] },
  { version: '1.5.0', date: '2026-10-01', items: [
    { ja: 'アプリ名の横にバージョンを表示するようにしました。押すと更新履歴が開きます',
      en: 'The version is shown next to the app name; tap it to open this changelog' },
    { ja: '日本語 / English を設定（⚙）で切り替えられるようにしました',
      en: 'Switch between Japanese and English in the settings (⚙)' },
    { ja: '設定に「他のアプリ」と「保存データを消す」を追加しました',
      en: 'Added "Other apps" and "Clear saved data" to the settings' },
    { ja: '全画面表示ボタン（⛶）を追加しました',
      en: 'Added a full-screen button (⛶)' }
  ] },
  { version: '1.4.0', date: '2026-09-30', items: [
    { ja: '設定（⚙）から更新履歴を見られるようにしました。新しい版を初めて開いたときは ⚙ に印が付きます',
      en: 'The changelog can be opened from the settings (⚙); a dot on ⚙ marks a new version' }
  ] },
  { version: '1.3.0', date: '2026-09-30', items: [
    { ja: '止め忘れたタスクを自動停止するようにしました（目安あり: 目安＋2時間、目安なし: 5時間。⚙ で変更可）',
      en: 'Tasks left running stop automatically (target + 2 h, or 5 h without a target; changeable in ⚙)' },
    { ja: '画面オフ中は表示の更新を止め、電池の消費を抑えるようにしました',
      en: 'The display stops updating while the screen is off, to save battery' }
  ] },
  { version: '1.2.1', date: '2026-09-08', items: [
    { ja: '最初のタップで通知音が鳴ってしまう問題を修正しました',
      en: 'Fixed the alert sound playing on the first tap' }
  ] },
  { version: '1.2.0', date: '2026-09-08', items: [
    { ja: '分のホイールが 59→0 でつながるようにしました',
      en: 'The minute wheel now wraps from 59 to 0' },
    { ja: 'ホイールをはじいたとき、途中で止まらないようにしました',
      en: 'Flicking a wheel no longer stops short' }
  ] },
  { version: '1.1.1', date: '2026-09-08', items: [
    { ja: 'ホイールの見た目を調整しました', en: 'Polished the look of the wheels' }
  ] },
  { version: '1.1.0', date: '2026-09-08', items: [
    { ja: 'iPad / スマートフォンでは、目安時間をホイールで選べるようにしました',
      en: 'On iPad and phones, the target time is picked with wheels' }
  ] },
  { version: '1.0.0', date: '2026-09-03', items: [
    { ja: '最初の公開版: タスク別の排他ストップウォッチ、目安時間と超過通知',
      en: 'First release: exclusive per-task stopwatches, target times and overrun alerts' },
    { ja: '通知音 12 種類と音のテスト、QR コードでの共有',
      en: '12 alert sounds with a sound test, and sharing by QR code' }
  ] }
];

/* UI strings. `c.*` keys are the common ones every yukmmz.github.io app uses
 * with the same wording; the rest belong to this app. */
var STRINGS = {
  ja: {
    'c.settings': '設定', 'c.close': '閉じる', 'c.language': '言語', 'c.share': '共有',
    'c.showQr': 'QR コードを表示', 'c.changelog': '更新履歴', 'c.showChangelog': '表示',
    'c.otherApps': '他のアプリ', 'c.openPortal': 'アプリ一覧を開く', 'c.data': 'データ',
    'c.clearData': '保存データを消す', 'c.fullscreen': '全画面表示', 'c.exitFullscreen': '全画面を終了', 'c.help': '使い方',
    'c.feedback': 'フィードバックを送る', 'c.feedbackLead': 'ご意見・ご要望・不具合の報告をお寄せください。',
    'c.feedbackMessage': 'フィードバックの内容', 'c.feedbackPlaceholder': '使ってみた感想、困ったこと、ほしい機能など',
    'c.feedbackContact': '連絡先（任意・返信がほしい場合）',
    'c.feedbackNote': '送信を押したときに、書いた内容とアプリ名・バージョン・表示言語だけを開発者に送ります。',
    'c.feedbackSend': '送信', 'c.feedbackSending': '送信中…', 'c.feedbackThanks': '送信しました。ありがとうございます！',
    'c.feedbackEmpty': '内容を入力してください。', 'c.feedbackError': '送信できませんでした。時間をおいてもう一度お試しください。',
    'c.clearConfirm': 'このブラウザに保存されている、このアプリのデータ（計測記録・タスク名・設定）をすべて消して初期状態に戻します。\n元に戻せません。よろしいですか？',
    total: '合計', stopAll: '■ 全停止', taskCount: 'タスク数', taskMinus: 'タスクを減らす',
    taskPlus: 'タスクを増やす', sound: '通知音', soundKind: '通知音の種類', soundCheck: '動作確認',
    soundTest: '音をテスト', soundTestIn: '{n} 秒後に鳴らします…', soundTestAsk: '鳴りましたか？',
    autoStopWithTarget: '自動停止<br><small>目安あり</small>', autoStopNoTarget: '自動停止<br><small>目安なし</small>',
    autoStopWithTargetAria: '目安時間があるタスクの自動停止', autoStopNoTargetAria: '目安時間がないタスクの自動停止',
    autoStopOff: '自動停止しない', autoStopPlus: '目安 ＋ {d}',
    measured: '計測時間', resetAll: 'すべて 00:00:00 に戻す',
    resetAllConfirm: 'すべてのタスクの計測時間を 00:00:00 に戻しますか？\n（タスク名と目安時間は残ります）',
    taskMenu: 'このタスクの設定', taskName: 'タスク名', target: '目安時間',
    targetHours: '目安時間（時間）', targetMinutes: '目安時間（分）', unitHours: '時間', unitMinutes: '分',
    taskReset: '時間リセット', taskDefault: 'タスク {x}', untitled: '（無題）',
    targetView: '目安 {d}', over: '超過 +{t}', autoStopped: '自動停止しました', autoStoppedSuffix: '（自動停止）',
    targetTotal: '目安合計 {d}', durHM: '{h}時間{m}分', durH: '{h}時間', durM: '{m}分',
    removeConfirm: '「{name}」には {t} の記録があります。削除しますか？',
    taskResetConfirm: '「{name}」の時間を 00:00:00 に戻しますか？',
    help:
      '<p>タスクの枠を押すと、そのタスクだけがカウントアップし、走っていた他のタスクは自動で停止します。' +
      '走っているタスクをもう一度押すと停止します。</p>' +
      '<p>タスク名・目安時間・そのタスクだけの時間リセットは、各枠の右上の <span class="kbd-like">⋯</span> から設定できます。' +
      '設定ウィンドウは外側をタップすると閉じます。</p>' +
      '<p>並び順を変えるには、タスクの枠を長押しして持ち上げ、置きたい場所の枠まで動かして離します。</p>' +
      '<p>目安時間を超えると、経過時間が<strong class="sample-over">赤い太字</strong>になり、音でお知らせします。' +
      '音は最初に画面をどこか一度タップしてから有効になります。</p>' +
      '<p>目安時間は、パソコンでは数値入力、iPad / スマートフォンでは指でスクロールして選びます。</p>' +
      '<p>止め忘れの保険として、走り続けたタスクは<strong>自動停止</strong>します。' +
      '初期設定では、目安時間があるタスクは「目安 ＋ 2時間」、ないタスクは「5時間」で止まり、' +
      '記録される時間もそこで打ち切られます。長さは設定（⚙）の「自動停止」で変えられます（止めない設定も可）。</p>' +
      '<p>通知音は数種類から選べます。選ぶとその場で一度鳴ります。</p>' +
      '<p>設定（⚙）の <span class="kbd-like">音をテスト</span> を押すと数秒後に通知音が鳴ります。' +
      'ここで鳴れば、目安時間の超過通知も同じように鳴ります。</p>' +
      '<p><strong>iPad / iPhone で音が鳴らないとき</strong>は、' +
      '<strong>設定 → サウンド → 消音モード を OFF</strong> にしてください' +
      '（音量を上げただけでは鳴らないことがあります）。</p>' +
      '<p class="hint">ショートカット: <kbd>1</kbd>〜<kbd>6</kbd> タスク切替 / <kbd>Space</kbd> 全停止 / <kbd>?</kbd> 使い方 / <kbd>Esc</kbd> 閉じる</p>' +
      '<p class="note">計測データはこのブラウザ内（localStorage）にのみ保存されます。サーバーへは送信されません。</p>'
  },
  en: {
    'c.settings': 'Settings', 'c.close': 'Close', 'c.language': 'Language', 'c.share': 'Share',
    'c.showQr': 'Show QR codes', 'c.changelog': 'Changelog', 'c.showChangelog': 'Show',
    'c.otherApps': 'Other apps', 'c.openPortal': 'Open app list', 'c.data': 'Data',
    'c.clearData': 'Clear saved data', 'c.fullscreen': 'Full screen', 'c.exitFullscreen': 'Exit full screen', 'c.help': 'How to use',
    'c.feedback': 'Send feedback', 'c.feedbackLead': 'Comments, requests and bug reports are welcome.',
    'c.feedbackMessage': 'Your feedback', 'c.feedbackPlaceholder': 'What you liked, what was hard, what you would like to see…',
    'c.feedbackContact': 'Contact (optional, if you would like a reply)',
    'c.feedbackNote': 'Only what you write, plus the app name, version and display language, is sent to the developer when you press Send.',
    'c.feedbackSend': 'Send', 'c.feedbackSending': 'Sending…', 'c.feedbackThanks': 'Sent. Thank you!',
    'c.feedbackEmpty': 'Please write something first.', 'c.feedbackError': 'Could not send. Please try again later.',
    'c.clearConfirm': 'This deletes everything this app has saved in this browser (records, task names, settings) and starts over.\nThis cannot be undone. Continue?',
    total: 'Total', stopAll: '■ Stop all', taskCount: 'Tasks', taskMinus: 'Remove a task',
    taskPlus: 'Add a task', sound: 'Alert sound', soundKind: 'Alert sound', soundCheck: 'Check',
    soundTest: 'Test sound', soundTestIn: 'Playing in {n} s…', soundTestAsk: 'Did you hear it?',
    autoStopWithTarget: 'Auto-stop<br><small>with target</small>', autoStopNoTarget: 'Auto-stop<br><small>no target</small>',
    autoStopWithTargetAria: 'Auto-stop for tasks with a target', autoStopNoTargetAria: 'Auto-stop for tasks without a target',
    autoStopOff: 'Never', autoStopPlus: 'Target + {d}',
    measured: 'Times', resetAll: 'Reset all to 00:00:00',
    resetAllConfirm: 'Reset every task to 00:00:00?\n(Task names and targets are kept.)',
    taskMenu: 'Task settings', taskName: 'Task name', target: 'Target',
    targetHours: 'Target (hours)', targetMinutes: 'Target (minutes)', unitHours: 'h', unitMinutes: 'min',
    taskReset: 'Reset time', taskDefault: 'Task {x}', untitled: '(untitled)',
    targetView: 'Target {d}', over: 'Over +{t}', autoStopped: 'Auto-stopped', autoStoppedSuffix: ' (auto-stopped)',
    targetTotal: 'Total target {d}', durHM: '{h} h {m} min', durH: '{h} h', durM: '{m} min',
    removeConfirm: '"{name}" has {t} recorded. Remove it?',
    taskResetConfirm: 'Reset "{name}" to 00:00:00?',
    help:
      '<p>Tap a task\'s card to start it; whichever task was running stops. Tap the running task again to stop it.</p>' +
      '<p>Each card\'s <span class="kbd-like">⋯</span> menu sets the task name, a target time, and resets that task. ' +
      'Tap outside a panel to close it.</p>' +
      '<p>To change the order, press and hold a card until it lifts, drag it onto the place you want, and let go.</p>' +
      '<p>Past its target, a task\'s time turns <strong class="sample-over">bold red</strong> and an alert sounds. ' +
      'Sound works after the first tap anywhere on the page.</p>' +
      '<p>Targets are typed on a computer and picked with wheels on iPad and phones.</p>' +
      '<p>As a safety net, a task left running <strong>stops automatically</strong>: at target + 2 h, or after 5 h ' +
      'without a target, and the recorded time is cut there. Change or turn this off under "Auto-stop" in the settings (⚙).</p>' +
      '<p>Several alert sounds are available; picking one plays it once.</p>' +
      '<p><span class="kbd-like">Test sound</span> in the settings (⚙) plays the alert a few seconds later. ' +
      'If you hear it, overrun alerts will sound too.</p>' +
      '<p><strong>No sound on iPad / iPhone?</strong> Turn <strong>Settings → Sounds → Silent Mode OFF</strong> ' +
      '(raising the volume alone may not help).</p>' +
      '<p class="hint">Shortcuts: <kbd>1</kbd>–<kbd>6</kbd> switch task / <kbd>Space</kbd> stop all / <kbd>?</kbd> how to use / <kbd>Esc</kbd> close</p>' +
      '<p class="note">Records are stored only in this browser (localStorage) and never sent to a server.</p>'
  }
};
var LANG_KEY = 'multitask-timer/lang';
function t(key, params) { return I18N.t(key, params); }
var SEEN_VERSION_KEY = 'multitask-timer/seen-version';

var STORAGE_KEY = 'multitask-timer/v1';
var MIN_TASKS = 1;
var MAX_TASKS = 6;
var DEFAULT_TASKS = 3;
var TICK_MS = 200;
var NAME_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/* Auto-stop: a safety net for a task left running by mistake (e.g. an iPad put
 * to sleep mid-task). Values are minutes; null means "never stop".
 *   with a target:    stop at target + AUTO_STOP_EXTRA
 *   without a target: stop at AUTO_STOP_NO_TARGET
 * The limit is on the task's total elapsed time, and the recorded time is cut
 * at the limit even when the stop is only noticed later (page asleep/closed). */
var DEFAULT_AUTO_STOP_EXTRA_MIN = 120;
var DEFAULT_AUTO_STOP_NO_TARGET_MIN = 300;
var AUTO_STOP_EXTRA_CHOICES = [30, 60, 120, 180, 240, 360, 480, 720, null];
var AUTO_STOP_NO_TARGET_CHOICES = [60, 120, 180, 240, 300, 360, 480, 600, 720, 1440, null];

/* ------------------------------------------------------------------ state */

/** @type {{tasks: Array, runningId: (number|null), startedAt: (number|null)}} */
var state = null;
var nextTaskId = 1;

/** Card DOM handles, index-aligned with state.tasks. */
var cards = [];

/** The first of the 6 card colours no other task uses (so a new task never repeats a colour). */
function freeColor(tasks) {
  for (var c = 0; c < 6; c++) {
    if (!tasks.some(function (task) { return task.color === c; })) return c;
  }
  return tasks.length % 6;
}

function makeTask(index, tasks) {
  return {
    id: nextTaskId++,
    name: t('taskDefault', { x: NAME_LETTERS[index] || String(index + 1) }),
    color: freeColor(tasks || []),   // stays with the task when the cards are reordered
    accumulatedMs: 0,
    targetMin: null,   // null = no target time (the default)
    notified: false,   // beeped once for the current overrun
    autoStopped: false // the last run was ended by auto-stop, not by the user
  };
}

function defaultState() {
  var tasks = [];
  for (var i = 0; i < DEFAULT_TASKS; i++) tasks.push(makeTask(i, tasks));
  return {
    tasks: tasks, runningId: null, startedAt: null, soundId: DEFAULT_SOUND_ID,
    autoStopExtraMin: DEFAULT_AUTO_STOP_EXTRA_MIN,
    autoStopNoTargetMin: DEFAULT_AUTO_STOP_NO_TARGET_MIN
  };
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

/**
 * Elapsed time (ms) at which the running task is auto-stopped, or null.
 * `task.accumulatedMs` is the time banked before the current run. A run that
 * starts already past the limit (the user restarted it on purpose) gets a fresh
 * allowance of the no-target length, so it is still covered by the safety net.
 */
function autoStopLimitMs(task) {
  var limitMin = task.targetMin !== null
    ? (state.autoStopExtraMin === null ? null : task.targetMin + state.autoStopExtraMin)
    : state.autoStopNoTargetMin;
  if (limitMin === null) return null;
  var limitMs = limitMin * 60000;
  if (task.accumulatedMs < limitMs) return limitMs;
  if (state.autoStopNoTargetMin === null) return null;
  return task.accumulatedMs + state.autoStopNoTargetMin * 60000;
}

/** Stop the running task if it has reached its limit, banking exactly the limit
 *  (not the wall-clock time since, which may include hours of sleep). */
function checkAutoStop() {
  if (state.runningId === null || state.startedAt === null) return false;
  var task = findTask(state.runningId);
  if (!task) return false;
  var limitMs = autoStopLimitMs(task);
  if (limitMs === null || elapsedOf(task) < limitMs) return false;
  task.accumulatedMs = limitMs;
  task.autoStopped = true;
  state.runningId = null;
  state.startedAt = null;
  save();
  return true;
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
    var task = findTask(id);
    if (task) task.autoStopped = false;
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
  task.autoStopped = false;
  save();
  render();
}

function resetAllTimes() {
  state.runningId = null;
  state.startedAt = null;
  for (var i = 0; i < state.tasks.length; i++) {
    state.tasks[i].accumulatedMs = 0;
    state.tasks[i].notified = false;
    state.tasks[i].autoStopped = false;
  }
  save();
  render();
}

function addTask() {
  if (state.tasks.length >= MAX_TASKS) return;
  state.tasks.push(makeTask(state.tasks.length, state.tasks));
  save();
  buildCards();
  render();
}

function removeTask() {
  if (state.tasks.length <= MIN_TASKS) return;
  var last = state.tasks[state.tasks.length - 1];
  var hasTime = elapsedOf(last) > 0;
  if (hasTime && !window.confirm(t('removeConfirm', { name: last.name, t: formatDuration(elapsedOf(last)) }))) {
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

/** A stored auto-stop setting if it is one of `choices`, else the default.
 *  A missing key (data saved before auto-stop existed) gets the default too. */
function loadChoice(value, choices, fallback) {
  if (value === undefined) return fallback;
  return choices.indexOf(value) >= 0 ? value : fallback;
}

/**
 * Restore. A task that was running when the page went away KEEPS running:
 * `startedAt` is an absolute timestamp, so the time spent while the tab was
 * closed or discarded is counted. That is deliberate — iPad Safari drops
 * background tabs while the user is still working, and an accidental reload
 * should not silently stop the measurement. Auto-stop still applies: the first
 * render after restoring cuts a run that passed its limit while away.
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
      name: typeof t.name === 'string' && t.name.length ? t.name.slice(0, 24) : t('taskDefault', { x: NAME_LETTERS[i] || String(i + 1) }),
      accumulatedMs: acc,
      targetMin: target,
      notified: t.notified === true,
      autoStopped: t.autoStopped === true,
      // saved before v1.7.0: colours followed the position, so keep that look
      color: clampInt(t.color, 0, 5, i % 6)
    });
  }

  var restored = {
    tasks: tasks,
    runningId: null,
    startedAt: null,
    soundId: findSound(parsed.soundId).id,
    autoStopExtraMin: loadChoice(parsed.autoStopExtraMin, AUTO_STOP_EXTRA_CHOICES,
                                 DEFAULT_AUTO_STOP_EXTRA_MIN),
    autoStopNoTargetMin: loadChoice(parsed.autoStopNoTargetMin, AUTO_STOP_NO_TARGET_CHOICES,
                                    DEFAULT_AUTO_STOP_NO_TARGET_MIN)
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
  if (h > 0 && m > 0) return t('durHM', { h: h, m: m });
  if (h > 0) return t('durH', { h: h });
  return t('durM', { m: m });
}

/** Labels for the auto-stop selects. */
function autoStopExtraLabel(min) {
  return min === null ? t('autoStopOff') : t('autoStopPlus', { d: formatTargetLabel(min) });
}

function autoStopNoTargetLabel(min) {
  return min === null ? t('autoStopOff') : formatTargetLabel(min);
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
    nameEn: 'Chime (3 notes)',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 523, 1.2, 0.22, 4.5, P_SOFT),
                                 toneStruck(rate, 659, 1.2, 0.22, 4.5, P_SOFT),
                                 toneStruck(rate, 784, 1.4, 0.22, 4, P_SOFT)], 0.14);
    }
  },
  {
    id: 'musicbox',
    name: 'オルゴール（3音）',
    nameEn: 'Music box (3 notes)',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 1047, 1.6, 0.16, 3, P_MUSICBOX),
                                 toneStruck(rate, 1319, 1.6, 0.16, 3, P_MUSICBOX),
                                 toneStruck(rate, 1568, 1.8, 0.16, 2.6, P_MUSICBOX)], 0.12);
    }
  },
  {
    id: 'glocken',
    name: 'グロッケン（2音）',
    nameEn: 'Glockenspiel (2 notes)',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 1047, 0.9, 0.18, 5, P_GLASS),
                                 toneStruck(rate, 1568, 1.1, 0.18, 4.5, P_GLASS)], 0.11);
    }
  },
  {
    id: 'harp',
    name: 'ハープ（4音）',
    nameEn: 'Harp (4 notes)',
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
    nameEn: 'Bell (1 note)',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneStruck(rate, 587, 1.6, 0.26, 3.2, P_BELL)]);
    }
  },
  {
    id: 'marimba',
    name: '木琴（2音）',
    nameEn: 'Xylophone (2 notes)',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 523, 0.7, 0.3, 7, P_WOOD),
                                 toneStruck(rate, 784, 0.9, 0.3, 6, P_WOOD)], 0.16);
    }
  },
  {
    id: 'chord',
    name: '和音ひとつ',
    nameEn: 'Single chord',
    build: function (rate) {
      return toneArpeggio(rate, [toneStruck(rate, 392, 1.6, 0.16, 3.5, P_SOFT),
                                 toneStruck(rate, 494, 1.6, 0.16, 3.5, P_SOFT),
                                 toneStruck(rate, 587, 1.6, 0.16, 3.5, P_SOFT)], 0);
    }
  },
  {
    id: 'soft',
    name: 'ポーン（控えめ）',
    nameEn: 'Pong (soft)',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       toneStruck(rate, 523, 1.0, 0.18, 5, [[1, 1], [2, 0.15]])]);
    }
  },
  {
    id: 'pad',
    name: 'ふわっとパッド',
    nameEn: 'Soft pad',
    build: function (rate) {
      return toneJoin([toneSilence(rate, LEAD_MS / 1000),
                       tonePad(rate, [392, 494, 587], 1.4, 0.24)]);
    }
  },
  {
    id: 'knock',
    name: 'ノック（2回）',
    nameEn: 'Knock (twice)',
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
    nameEn: 'Blip (twice)',
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
    nameEn: 'Beep (3 times, loud)',
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
  els.testSound.textContent = t('soundTestIn', { n: left });

  soundTestTimer = window.setInterval(function () {
    left--;
    if (left > 0) {
      els.testSound.textContent = t('soundTestIn', { n: left });
      return;
    }
    window.clearInterval(soundTestTimer);
    soundTestTimer = null;
    beep();
    els.testSound.disabled = false;
    els.testSound.textContent = t('soundTestAsk');
    window.setTimeout(function () {
      if (soundTestTimer === null) els.testSound.textContent = t('soundTest');
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
    // Colour belongs to the task, so it moves with the card when reordered.
    node.setAttribute('data-color', String(state.tasks[i].color));

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
  I18N.apply(els.tasks);
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
/* ----------------------------------------------------- reorder by dragging */

var LONG_PRESS_MS = 400;     // hold this long to pick a card up (a quick tap still starts/stops it)
var MOVE_CANCEL_PX = 10;     // moving further than this before the hold ends means "not a long press"
var suppressClickUntil = 0;
var drag = null;             // {card, from, to, startX, startY, pointerId}

/** Move a task to another position; times, targets and the running task are untouched. */
function moveTask(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.tasks.length || to >= state.tasks.length) return;
  var task = state.tasks.splice(from, 1)[0];
  state.tasks.splice(to, 0, task);
  save();
  buildCards();
  render();
}

/** The slot (card position measured when the drag began) under (x, y), or -1. */
function slotAt(x, y) {
  for (var i = 0; i < drag.slots.length; i++) {
    var r = drag.slots[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
  }
  return -1;
}

/** Slide every other card to the slot it would take if the held card were dropped at `to`. */
function previewOrder(to) {
  for (var i = 0; i < cards.length; i++) {
    if (i === drag.from) continue;
    var p = i;                                     // position after moving `from` to `to`
    if (drag.from < to && i > drag.from && i <= to) p = i - 1;
    if (drag.from > to && i >= to && i < drag.from) p = i + 1;
    var dx = drag.slots[p].left - drag.slots[i].left;
    var dy = drag.slots[p].top - drag.slots[i].top;
    cards[i].root.style.transform = (dx || dy) ? 'translate(' + dx + 'px, ' + dy + 'px)' : '';
  }
}

function endDrag(commit) {
  if (!drag) return;
  var d = drag;
  drag = null;
  clearTimeout(d.timer);
  if (!d.active) return;
  suppressClickUntil = Date.now() + 400;
  d.card.root.classList.remove('dragging');
  els.tasks.classList.remove('reordering');
  cards.forEach(function (c) { c.root.style.transform = ''; });
  if (commit && d.to >= 0) moveTask(d.from, d.to);
}

/** Long-press a card, then drag it onto another card's place. */
function bindReorder(card, index) {
  card.root.addEventListener('pointerdown', function (event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (isMenuTarget(event.target) || openMenuIndex >= 0 || drag) return;
    drag = { card: card, from: index, to: index, startX: event.clientX, startY: event.clientY,
             pointerId: event.pointerId, active: false, timer: null, slots: [] };
    drag.timer = setTimeout(function () {
      if (!drag || drag.card !== card) return;
      drag.active = true;
      drag.slots = cards.map(function (c) { return c.root.getBoundingClientRect(); });
      card.root.classList.add('dragging');
      els.tasks.classList.add('reordering');
      try { card.root.setPointerCapture(drag.pointerId); } catch (e) { /* ignore */ }
    }, LONG_PRESS_MS);
  });
  card.root.addEventListener('pointermove', function (event) {
    if (!drag || drag.card !== card) return;
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) endDrag(false);
      return;
    }
    card.root.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(1.04)';
    var to = slotAt(event.clientX, event.clientY);
    if (to >= 0 && to !== drag.to) {         // between cards: keep the last preview
      drag.to = to;
      previewOrder(to);
    }
  });
  card.root.addEventListener('pointerup', function () { if (drag && drag.card === card) endDrag(true); });
  card.root.addEventListener('pointercancel', function () { if (drag && drag.card === card) endDrag(false); });
  // While a card is held, the page must not scroll under the finger (iPad).
  card.root.addEventListener('touchmove', function (event) {
    if (drag && drag.active) event.preventDefault();
  }, { passive: false });
  // A long press on iOS would otherwise open the text-selection / callout menu.
  card.root.addEventListener('contextmenu', function (event) { event.preventDefault(); });
}

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
    if (Date.now() < suppressClickUntil) return;   // the click that ends a drag is not a tap
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

  bindReorder(card, index);

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
        !window.confirm(t('taskResetConfirm', { name: task.name }))) {
      return;
    }
    resetTask(task);
    closeTaskMenu();
    syncBackdrop();
  });
}

function render() {
  checkAutoStop();
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

    var name = task.name || t('untitled');
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

    var targetView = task.targetMin === null ? '' : t('targetView', { d: formatTargetLabel(task.targetMin) });
    if (targetView !== card.lastTargetView) {
      card.targetView.textContent = targetView;
      card.lastTargetView = targetView;
    }

    var overText = isOver ? t('over', { t: formatDuration(ms - targetMs) }) : '';
    if (task.autoStopped && !isRunning) overText = overText ? overText + t('autoStoppedSuffix') : t('autoStopped');
    if (overText !== card.lastOver) {
      card.over.textContent = overText;
      card.lastOver = overText;
    }
  }

  els.totalTime.textContent = formatDuration(totalElapsed());

  var targetSum = totalTargetMin();
  var targetSumText = targetSum > 0 ? t('targetTotal', { d: formatTargetLabel(targetSum) }) : '';
  if (targetSumText !== lastTargetTotal) {
    els.targetTotal.textContent = targetSumText;
    lastTargetTotal = targetSumText;
  }

  syncTicker(running);
  els.stopAll.disabled = !running;
  els.taskCountValue.textContent = String(state.tasks.length);
  els.taskMinus.disabled = state.tasks.length <= MIN_TASKS;
  els.taskPlus.disabled = state.tasks.length >= MAX_TASKS;

  updateTitle(running);
}

var lastTitle = '';
var lastTargetTotal = '';

/* The repaint loop runs only while a task is running AND the page is visible.
 * Timing never depends on it (see the header), so stopping it loses nothing,
 * and a page that iOS keeps alive with the screen off does no work at all.
 * Every state change and every return to the page calls render(), which
 * restarts it when needed. */
var tickTimer = null;

function syncTicker(running) {
  var want = running && document.visibilityState !== 'hidden';
  if (want && tickTimer === null) {
    tickTimer = window.setInterval(render, TICK_MS);
  } else if (!want && tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

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

/* --------------------------------------------------------------- changelog */

function readSeenVersion() {
  try { return window.localStorage.getItem(SEEN_VERSION_KEY); } catch (e) { return null; }
}

function writeSeenVersion() {
  try { window.localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION); } catch (e) { /* ignore */ }
}

/** First visit ever: nothing is "new", so record the version quietly. A user
 *  who already had data but no seen-version is upgrading, and gets the mark. */
function initSeenVersion() {
  if (readSeenVersion() !== null) return;
  var hadData = false;
  try { hadData = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { /* ignore */ }
  if (!hadData) writeSeenVersion();
}

function syncNewsMark() {
  var hasNews = readSeenVersion() !== APP_VERSION;
  els.settingsBtn.classList.toggle('has-news', hasNews);
  els.changelogBtn.classList.toggle('has-news', hasNews);
}

function buildChangelog() {
  els.changelogList.textContent = '';
  for (var i = 0; i < CHANGELOG.length; i++) {
    var entry = CHANGELOG[i];
    var section = document.createElement('section');
    section.className = 'changelog-entry';
    var head = document.createElement('h3');
    head.className = 'changelog-version';
    head.textContent = 'v' + entry.version + ' (' + entry.date + ')';
    section.appendChild(head);
    var list = document.createElement('ul');
    for (var j = 0; j < entry.items.length; j++) {
      var li = document.createElement('li');
      var item = entry.items[j];
      li.textContent = item[I18N.lang()] || item.ja;
      list.appendChild(li);
    }
    section.appendChild(list);
    els.changelogList.appendChild(section);
  }
}

function openChangelog() {
  setSettingsOpen(false);
  els.changelogOverlay.hidden = false;
  if (els.changelogList.scrollTop) els.changelogList.scrollTop = 0;
  writeSeenVersion();
  syncNewsMark();
}

/* -------------------------------------------------------------------- init */

/* ------------------------------------------------ common header / settings */

/** ⛶ toggles full screen. Hidden where the browser cannot do it (iPhone). */
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleFullscreen() {
  var root = document.documentElement;
  if (fullscreenElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) {
      var p = req.call(root);
      if (p && typeof p['catch'] === 'function') p['catch'](function () { /* ignore */ });
    }
  }
}

/** Swap the icon and label so the button shows what a press will do
 * (expand when windowed, shrink while full screen). Also runs when the user
 * leaves full screen with Esc, which never touches the button. */
function syncFullscreenBtn() {
  var on = !!fullscreenElement();
  var label = t(on ? 'c.exitFullscreen' : 'c.fullscreen');
  els.fullscreenBtn.classList.toggle('is-fullscreen', on);
  els.fullscreenBtn.title = label;
  els.fullscreenBtn.setAttribute('aria-label', label);
}

function initFullscreen() {
  var root = document.documentElement;
  var supported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  els.fullscreenBtn.hidden = !supported;
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);
  syncFullscreenBtn();
}

/** The "How to use" window, opened by the header ? button or the ? key. */
function openHelp() {
  closeOverlays();
  els.helpOverlay.hidden = false;
}

/** The feedback window, opened by the header FB button. */
function openFeedback() {
  closeOverlays();
  els.feedbackStatus.textContent = '';
  els.feedbackStatus.className = 'feedback-status';
  els.feedbackOverlay.hidden = false;
  els.feedbackMessage.focus();
}

function setFeedbackStatus(key, kind) {
  els.feedbackStatus.textContent = t(key);
  els.feedbackStatus.className = 'feedback-status' + (kind ? ' ' + kind : '');
}

/** Post the message to the shared GAS endpoint. Sent as text/plain so the
 * browser makes a "simple" request: GAS cannot answer a CORS preflight. */
function sendFeedback(event) {
  event.preventDefault();
  var message = els.feedbackMessage.value.trim();
  if (!message) { setFeedbackStatus('c.feedbackEmpty', 'err'); return; }
  els.feedbackSend.disabled = true;
  setFeedbackStatus('c.feedbackSending', '');
  fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      app: APP_ID, version: APP_VERSION, lang: I18N.lang(), message: message,
      contact: els.feedbackContact.value.trim(), website: els.feedbackWebsite.value
    })
  }).then(function (res) { return res.json(); }).then(function (res) {
    if (!res || !res.ok) throw new Error(res && res.error);
    els.feedbackMessage.value = '';
    els.feedbackContact.value = '';
    setFeedbackStatus('c.feedbackThanks', 'ok');
  }).catch(function () {
    setFeedbackStatus('c.feedbackError', 'err');
  }).then(function () {
    els.feedbackSend.disabled = false;
  });
}

/** Delete everything this app keeps in the browser and start over. */
function clearSavedData() {
  if (!window.confirm(t('c.clearConfirm'))) return;
  [STORAGE_KEY, SEEN_VERSION_KEY, LANG_KEY].forEach(function (key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  });
  window.location.reload();
}

/** Text that is built in JS rather than marked up with data-i18n. */
function applyLanguage() {
  els.langSelect.value = I18N.lang();
  I18N.apply(els.tasks);   // cards are cloned from a <template>, outside document.apply's reach
  for (var s = 0; s < SOUNDS.length; s++) {
    els.soundSelect.options[s].textContent = soundName(SOUNDS[s]);
  }
  relabelSelect(els.autoStopExtra, AUTO_STOP_EXTRA_CHOICES, autoStopExtraLabel);
  relabelSelect(els.autoStopNoTarget, AUTO_STOP_NO_TARGET_CHOICES, autoStopNoTargetLabel);
  if (soundTestTimer === null) els.testSound.textContent = t('soundTest');
  syncFullscreenBtn();
  buildChangelog();
  for (var i = 0; i < cards.length; i++) {
    cards[i].lastName = cards[i].lastTargetView = cards[i].lastOver = '';
  }
  lastTargetTotal = '';
  render();
}

function soundName(sound) {
  return I18N.lang() === 'en' && sound.nameEn ? sound.nameEn : sound.name;
}

function relabelSelect(select, choices, label) {
  for (var i = 0; i < choices.length; i++) select.options[i].textContent = label(choices[i]);
}

/** Fill an auto-stop <select> and write the choice to `state[key]`.
 *  Option values are strings, so "off" (null) is stored as the value "off". */
function bindAutoStopSelect(select, choices, label, key) {
  for (var i = 0; i < choices.length; i++) {
    var option = document.createElement('option');
    option.value = choices[i] === null ? 'off' : String(choices[i]);
    option.textContent = label(choices[i]);
    select.appendChild(option);
  }
  select.value = state[key] === null ? 'off' : String(state[key]);
  select.addEventListener('change', function () {
    state[key] = select.value === 'off' ? null : parseInt(select.value, 10);
    save();
    render();
  });
}

function onKeyDown(event) {
  var tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') {
    if (els.qrOverlay) els.qrOverlay.hidden = true;
    if (els.changelogOverlay) els.changelogOverlay.hidden = true;
    if (els.helpOverlay) els.helpOverlay.hidden = true;
    if (els.feedbackOverlay) els.feedbackOverlay.hidden = true;
    closeOverlays();
    return;
  }
  if (event.key === '?') {
    if (tag === 'SELECT') return;   // a focused dropdown (e.g. language) keeps its own keys
    event.preventDefault();
    openHelp();
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
  els.autoStopExtra = document.getElementById('auto-stop-extra');
  els.autoStopNoTarget = document.getElementById('auto-stop-no-target');
  els.changelogBtn = document.getElementById('changelogBtn');
  els.changelogOverlay = document.getElementById('changelogOverlay');
  els.changelogList = document.getElementById('changelogList');
  els.changelogClose = document.getElementById('changelogClose');
  els.langSelect = document.getElementById('lang-select');
  els.fullscreenBtn = document.getElementById('fullscreen-btn');
  els.clearDataBtn = document.getElementById('clearDataBtn');
  els.helpBtn = document.getElementById('help-btn');
  els.helpOverlay = document.getElementById('helpOverlay');
  els.helpClose = document.getElementById('helpClose');
  els.feedbackBtn = document.getElementById('feedback-btn');
  els.feedbackOverlay = document.getElementById('feedbackOverlay');
  els.feedbackForm = document.getElementById('feedbackForm');
  els.feedbackMessage = document.getElementById('feedbackMessage');
  els.feedbackContact = document.getElementById('feedbackContact');
  els.feedbackWebsite = document.getElementById('feedbackWebsite');
  els.feedbackStatus = document.getElementById('feedbackStatus');
  els.feedbackSend = document.getElementById('feedbackSend');
  els.feedbackClose = document.getElementById('feedbackClose');

  // Before anything is built: default task names and labels use the language.
  I18N.init(LANG_KEY, STRINGS);

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

  els.appVersion.textContent = 'v' + APP_VERSION;
  els.appVersion.addEventListener('click', openChangelog);

  // The QR images encode these strings; print the same constants so the two
  // cannot drift apart when one of them is edited.
  els.qrUrl.textContent = APP_URL;
  els.qrSrcUrl.textContent = SRC_URL;

  els.qrBtn.addEventListener('click', function () {
    setSettingsOpen(false);
    els.qrOverlay.hidden = false;
  });
  els.qrClose.addEventListener('click', function () { els.qrOverlay.hidden = true; });

  initSeenVersion();
  buildChangelog();
  syncNewsMark();
  els.changelogBtn.addEventListener('click', openChangelog);
  els.changelogClose.addEventListener('click', function () { els.changelogOverlay.hidden = true; });
  els.changelogOverlay.addEventListener('click', function (event) {
    if (event.target === els.changelogOverlay) els.changelogOverlay.hidden = true;
  });
  els.qrOverlay.addEventListener('click', function (event) {
    if (event.target === els.qrOverlay) els.qrOverlay.hidden = true;
  });

  for (var s = 0; s < SOUNDS.length; s++) {
    var option = document.createElement('option');
    option.value = SOUNDS[s].id;
    option.textContent = soundName(SOUNDS[s]);
    els.soundSelect.appendChild(option);
  }
  els.soundSelect.value = state.soundId;
  els.soundSelect.addEventListener('change', function () {
    setSound(els.soundSelect.value);
  });

  bindAutoStopSelect(els.autoStopExtra, AUTO_STOP_EXTRA_CHOICES, autoStopExtraLabel,
                     'autoStopExtraMin');
  bindAutoStopSelect(els.autoStopNoTarget, AUTO_STOP_NO_TARGET_CHOICES, autoStopNoTargetLabel,
                     'autoStopNoTargetMin');
  els.backdrop.addEventListener('click', closeOverlays);

  els.resetAll.addEventListener('click', function () {
    if (totalElapsed() > 0 &&
        !window.confirm(t('resetAllConfirm'))) {
      return;
    }
    resetAllTimes();
  });

  els.helpBtn.addEventListener('click', openHelp);
  els.helpClose.addEventListener('click', function () { els.helpOverlay.hidden = true; });
  els.helpOverlay.addEventListener('click', function (event) {
    if (event.target === els.helpOverlay) els.helpOverlay.hidden = true;
  });
  els.feedbackBtn.addEventListener('click', openFeedback);
  els.feedbackForm.addEventListener('submit', sendFeedback);
  els.feedbackClose.addEventListener('click', function () { els.feedbackOverlay.hidden = true; });
  els.feedbackOverlay.addEventListener('click', function (event) {
    if (event.target === els.feedbackOverlay) els.feedbackOverlay.hidden = true;
  });
  // The global key handler ignores keys typed into fields, so Esc is handled here too.
  els.feedbackOverlay.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') els.feedbackOverlay.hidden = true;
  });
  initFullscreen();
  els.clearDataBtn.addEventListener('click', clearSavedData);
  els.langSelect.value = I18N.lang();
  els.langSelect.addEventListener('change', function () { I18N.set(els.langSelect.value); });
  I18N.onChange(applyLanguage);
  applyLanguage();

  els.taskPlus.addEventListener('click', function () { unlockAudio(); addTask(); });
  els.taskMinus.addEventListener('click', function () { unlockAudio(); removeTask(); });

  document.addEventListener('keydown', onKeyDown);
  // Unlock audio on the very first gesture anywhere, so the first overrun beeps.
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  window.addEventListener('pagehide', function () { save(); syncTicker(false); });
  window.addEventListener('pageshow', render);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { save(); syncTicker(false); }
    else render();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
