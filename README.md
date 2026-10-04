# Multitask Timer

*English / [日本語](README_ja.md)*

**Open the app: https://yukmmz.github.io/multitask-timer/**

A web app that measures **how many minutes you spent on each task** when you work on several tasks in parallel,
with one stopwatch per task.

It runs entirely in the browser. Nothing to install, no server communication.

---

## Features

- One stopwatch per task (1 to 6 tasks); **exactly one runs at a time**, switching is one tap
- Optional target time per task, with a red display and a sound when exceeded
- Auto-stop as a safety net for forgetting to stop
- Total time of all tasks, Japanese / English, works on PC and iPad
- Reorder tasks: press and hold a card, then drag it (the other cards make room as you move)
- **FB** button in the header: send feedback or a bug report to the developer

---

## How to use

1. Tap **anywhere on the card** of the task you start; only that task counts up
   (by default there are three: "Task A", "Task B", "Task C").
2. To switch to another task, **just tap its card**.
   The running task stops automatically, and the new one resumes **from where it last stopped**.
3. To pause, tap the running task's card again, or press **"■ Stop all"** in the header.

**It is always either "everything stopped" or "exactly one task running".**
Two tasks never run at the same time.

### Per-task settings (⋯ at the top right of a card)

The **⋯** at the top right of each card opens settings for that task only.
Close the settings window by **tapping outside it** or with <kbd>Esc</kbd>.

- Change the **task name**
- **Target time** (set as "◯ h ◯ min")
- **Reset only this task's time**

### How to use window (? in the header)

The **?** button just left of ⚙ (or the <kbd>?</kbd> key) opens the instructions.
Close it with "Close", by tapping outside it, or with <kbd>Esc</kbd>.

### Overall settings (⚙ in the header)

The **⚙** at the right of the header opens the app-wide settings.

- **Language** … Japanese / English.
- **Tasks** … `−` / `＋` sets **1 to 6** tasks (3 by default). Removing a task that has recorded time asks for confirmation.
- **Alert sound** … the overrun sound and a "Test sound" button.
- **Auto-stop** … a safety net for forgetting to stop. It stops a task that keeps running (see below).
- **Reset all times to 00:00:00** … resets every task's time (task names and target times are kept).
- **Share** … QR codes for the app and its source.
- **Changelog** … shows the changes per version, newest first. The first time you open a new version, ⚙ gets a red dot, which disappears once you open the changelog. Tapping the version next to the app name opens it too.
- **Other apps** … opens the list of apps.
- **Clear saved data** … erases everything this app saved in the browser and starts over.

### Auto-stop (a safety net for forgetting to stop)

In case you forget to stop — for example, you close the iPad with a task still running — a task stops automatically once its elapsed time reaches a limit.

| Task | Default | Choices |
|---|---|---|
| With a target time | target + 2 h | target + 30 min to 12 h / never |
| Without a target time | 5 h | 1 to 24 h / never |

- The recorded time is **cut off at the moment it stops (the limit)**. Even if the screen was closed and you notice later, time beyond the limit is not added.
- A task that stopped automatically shows `Stopped automatically`. Tap it again to resume where it left off
  (if you resume after passing the limit, it auto-stops again after the "no target" length).

### Target time and warnings

You can optionally set a **target time** for each task as "◯ h ◯ min" (none by default).
On a computer you type the numbers; **on iPad / smartphones you pick them by scrolling with your finger** (the same feel as the iPhone alarm).
Once set, it appears in small text under the elapsed time, like `Target 1 h 30 min`.

If any task has a target, the **sum of the targets** appears in small text at the bottom of the screen, like **`Total target 1 h 30 min`**
(tasks without a target are not added).

When the elapsed time passes the target:

- the elapsed time turns **red and bold** (**it keeps counting up**)
- **a sound (three beeps) alerts you** (once per overrun)
- the overrun is shown, like `Over +00:05:12`

Pressing **"Test sound"** in ⚙ plays the beep a few seconds later. If you hear it, overrun alerts will sound too.
(It plays a few seconds later, not right when you press, to reproduce the same "playback without a user action" as an overrun alert.)

> **No sound (iPad / iPhone)?**
>
> 1. Turn **Settings → Sounds → Silent Mode OFF**. Even at full volume, it may not sound while Silent Mode is ON.
> 2. After opening the page, **tap somewhere once**. Browsers do not play sound until the first interaction (tapping a task once is enough).
> 3. Check that no other app is playing sound and that you are not connected to Bluetooth speakers / earphones.

### Total time

"Total" in the header always shows **the total elapsed time of all tasks**.

### Keyboard shortcuts (PC)

| Key | Action |
|---|---|
| <kbd>1</kbd>–<kbd>6</kbd> | Start that task (stop it if running) |
| <kbd>Space</kbd> | Stop all |
| <kbd>?</kbd> | Open "How to use" |
| <kbd>Esc</kbd> | Close the open window |

---

## Run locally

```sh
git clone https://github.com/yukmmz/multitask-timer.git
cd multitask-timer
python3 -m http.server 8000
# open http://localhost:8000 in your browser
```

Tests: `node tests/test_core.js` (from the repository root).

---

## Saved data

- Task names, target times, elapsed times and which task is running are saved **only in your browser's localStorage**.
  Nothing is ever sent to a server.
- After closing the tab or reloading, you can pick up where you left off the next time you open it.
- **If you close the tab while a task is running, that task is treated as having kept running**
  (the time while it was closed is added, up to the auto-stop limit). Stop it first if you are taking a break.
- To erase everything, use **⚙ → Clear saved data**. Clearing the browser's history / site data also clears the records.
- In private browsing, data may not be saved.
- The only thing ever sent anywhere is what you write in the **FB** window, and only when you press Send (together with the app name, version and display language).

---

## Supported environments

- Google Chrome / Edge / Safari / Firefox on desktop
- Safari on iPad / iPhone

A static site with no build step (`index.html` + `style.css` + `main.js` + `i18n.js`, no external libraries).

---

## License

MIT — see [LICENSE](LICENSE).
