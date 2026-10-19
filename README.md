# claude-hud-controls
[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Clickable model, effort, workflow and ultracode switches under the Claude
Code prompt, and a statusline HUD that agrees with them. When you pick an
effort level, both show it right away.

![The statusline above, the controls row at the bottom](docs/screenshot-pace.png)

The top lines are the statusline (`hud/`): the model and effort (`Opus 5.5
◔ med`), the project and git branch, then context, 5-hour and 7-day usage as
what remains, colored by how much is used. The bottom line is the controls
row (the mod), beside Claude Code's mode label. Opus is running, its effort
choices are open with `md` chosen, workflows (`wf`) are on and ultracode
(`uc`) is off.

The repository holds two parts:

| Part | What it is | Install |
| --- | --- | --- |
| `hud-controls` (repository root) | A Claude Code mod that draws the controls row under the prompt | `/plugin install` (below) |
| `hud/` | A modified [claude-hud](https://github.com/jarrodwatts/claude-hud) 0.8.0 statusline | clone + `statusLine` setting (below) |

Each part works alone. Used together, the statusline shows a click on the row
right away, and the row shows the effort level Claude Code reports.

## Features

### The controls row (`hud-controls`)

The row replaces the hint line under the prompt in the terminal and the desktop
app. Claude Code's own hint (`? for shortcuts`, …) stays above it. The row is
drawn as plain text, not buttons, so the pointer never highlights or inverts
it. On a narrow window it wraps onto more lines, and those lines can be
clicked too.

**Models: `Fable Opus Sonnet Haiku`**

- Each family has its own color: Fable violet, Opus orange, Sonnet blue and
  Haiku green. The running model is bold in full color; the others are dimmed.
- A click runs `/model <alias>` (`opus`, `sonnet`, …), the same as typing
  it, so the session switches at once to that family's latest release. The
  row names the family only; the statusline shows the exact version.
  - Claude Code's confirmations apply as they do for a typed `/model`.
  - During a turn, a click shows at once (underlined) and applies when the
    turn ends; only the last click runs.
- A click on a model also opens the effort choices. A click on the running
  model while they are open closes them.

**Effort: `lw md hg xh mx`** (low, medium, high, xhigh, max)

- These choices are drawn in the running model's color. The level in effect
  is bold.
- A click works like typing `/effort <level>` at the prompt, with the same
  confirmations and the same per-model limits.
- The level shows as chosen right away, even during a turn:
  - Claude Code runs a plugin's `/effort` only after the current turn ends,
    so a click made during a turn waits until then. A toast says so
    (`Effort high: applies when the current turn ends`).
  - Meanwhile the level is bold and **underlined** on the row, and the
    statusline already shows it.
  - Once the command runs, the underline goes away.
- Clicking several levels during one turn runs only the last one. Each new
  click replaces the one before it.
- An `/effort` you type at the prompt also replaces a waiting click:
  - a level or `auto` replaces a waiting level;
  - `ultracode on|off` replaces a waiting `uc` click.
- The row shows what actually took effect:
  - If Claude Code refuses a level, a toast gives the reason
    (`Effort not changed: …`) and the row keeps the level it had.
  - If you decline Claude Code's confirmation, the row shows the level
    Claude Code kept.
  - If the model caps the level, the row shows the capped level.
  - After `/effort auto`, no level is marked, since the model picks its own.
- The row learns the level in effect from several places:
  - at session start, from your per-model setting (`modelSettings`);
  - after that, from each turn the main agent runs;
  - from every `/effort` reply;
  - and, when the statusline is installed, from what Claude Code hands the
    statusline. It checks once a second.
- Switching models keeps the level until the statusline reports the new
  model's level, including that model's cap or default.

**Switches: `wf` and `uc`**

- `wf` turns dynamic workflows on and off (the `workflows` setting). It shows
  only when your Claude Code has that setting.
- `uc` runs `/effort ultracode on` or `/effort ultracode off`.
  - Ultracode needs workflows. If they are off, a toast says
    `Ultracode needs Workflow turned on`.
  - Turning workflows off also shows ultracode as off.
- A switch is gray while off, and bold in the model's color while on.
- A `uc` click made during a turn waits like an effort click: it is
  underlined until it runs. Clicking `uc` again before then cancels it.

### The statusline (`hud/`)

This is claude-hud 0.8.0 with these changes:

- **Flat bars.** Every bar is one row of background color instead of block
  characters.
- **Color shows how much is used.** The context number and bar use one color
  scale: dark green when little is used, through yellow, to red when full.
  It gets brighter as use grows, so an idle bar stays dim and a full one
  stands out. This scale replaces claude-hud's fixed thresholds and the color
  overrides for these bars.
- **Usage colored by pace.** The 5-hour and 7-day bars mark the share of the
  window's time still left with a thin `│`. Their bar and number stay green
  while the quota left is less than 5 points behind the time left, take one step toward red
  for every 5 points short (5, 10, 15, 20), and turn red from 25 points short.
  Without a reset time they use the scale above.
- **Bars show what remains.** With `contextValue` or `usageValue` set to
  `"remaining"` (as in `hud/config.json`), the bar fills by what is left,
  matching the number beside it. A bar with anything left shows at least one
  cell.
- **Short labels.** `Context`, `Usage` and `Weekly` become `ctx`, `5h` and
  `7d`. `medium` shows as `med`, and the model name has no brackets.
- **A steadier usage line.** Reset times on the usage line have no
  parentheses, and a `5h --` placeholder keeps the layout steady when Claude
  Code sends no 5-hour window.
- **Effort shared with the row.** The statusline shows a level clicked on the
  row while it waits for the turn to end. It also reports the level Claude
  Code hands it, so the row can show that level.

## Install

### The mod

At the prompt of a Claude Code terminal session:

```
/plugin install hud-controls --marketplace imleben/claude-hud-controls
```

Answer `y` to add the marketplace, then pick a scope (user is first). The row
appears in the session right away, and in every new session for the user
scope.

From a shell:

```sh
claude plugin install hud-controls --marketplace imleben/claude-hud-controls
```

In the desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with
`imleben/claude-hud-controls`, then **Add plugin**.

### The statusline

The statusline needs [Bun](https://bun.sh) on your `PATH`, or put Bun's full
path in place of `bun` below. Clone this repository:

```sh
git clone https://github.com/imleben/claude-hud-controls.git ~/claude-hud-controls
```

Set `statusLine` in `~/.claude/settings.json`. If you cloned somewhere other
than `~/claude-hud-controls`, change the path after `plugin_dir=`. The wrapper
sets the width from your terminal, and `refreshInterval` reruns the
statusline every 5 seconds, so the row stays current between turns:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'cols=${COLUMNS:-}; case \"$cols\" in \"\"|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk '\"'\"'{print $2}'\"'\"');; esac; case \"$cols\" in \"\"|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$HOME/claude-hud-controls/hud/; exec bun --env-file /dev/null \"${plugin_dir}src/index.ts\"'",
    "refreshInterval": 5
  }
}
```

For the look shown above, copy `hud/config.json` to
`~/.claude/plugins/claude-hud/config.json` if you have no config there yet. It
turns on the effort level, tools, agents, todos, duration, config counts and
session name; always shows the 7-day window; and shows context and usage as
what remains.

## How the two parts share effort

They share two small JSON files per session in `~/.claude/hud-controls`. The
files stay on your machine and hold no prompt or transcript content.

| File | Written by | Holds |
| --- | --- | --- |
| `<session>.json` | the statusline, on each run | the model id and effort level Claude Code handed it, and when the run started |
| `<session>.pending.json` | the row | a clicked level still waiting for the turn to end, or `null` |

Two rules keep the row from showing an outdated level:

- The row uses a report only if it is for the model now running.
- After an `/effort` reply, the row ignores reports from statusline runs that
  started less than a second after that reply.

A new session clears a waiting level left by a session that ended. The
statusline deletes files in the folder that are older than 7 days. If a file
can't be written, the click still runs once; only the statusline display is
lost.

Without the statusline, the row still works from settings, turns and
replies, and the statusline shows only what Claude Code reports.

## Check

From the repository root:

```sh
claude plugin validate .
claude plugin test .
```

The tests run the row against a mocked Claude Code. They cover:

- clicks and colors, on the terminal and on the desktop;
- a click made during a turn, and which click finally runs;
- refusals, declined confirmations and `auto`;
- `/effort` typed at the prompt;
- statusline reports, including a model switch;
- failed file writes, a new session and a reload.

Built and tested on Claude Code 2.1.302.

## License

The mod is MIT licensed (see `LICENSE`). `hud/` is a modified copy of
claude-hud 0.8.0 (commit `939eb66`), MIT licensed, Copyright (c) 2026 Jarrod
Watts (see `hud/LICENSE`). These files in `hud/src` differ from upstream:
`effort.ts`, `index.ts`, `i18n/en.ts`, `render/colors.ts`,
`render/lines/identity.ts`, `render/lines/project.ts`,
`render/lines/usage.ts`, `render/model-display.ts` and
`render/session-line.ts`. `hud/config.json` is new.
