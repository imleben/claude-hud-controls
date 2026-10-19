import type { HudColorName, HudColorValue, HudColorOverrides } from '../config.js';

export const RESET = '\x1b[0m';

const DIM = '\x1b[2m';
const BAR_EMPTY_BG = '\x1b[48;5;237m';
const PACE_MARK = '\x1b[97m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_BLUE = '\x1b[94m';
const BRIGHT_MAGENTA = '\x1b[95m';
const CLAUDE_ORANGE = '\x1b[38;5;208m';

const ANSI_BY_NAME: Record<HudColorName, string> = {
  dim: DIM,
  red: RED,
  green: GREEN,
  yellow: YELLOW,
  magenta: MAGENTA,
  cyan: CYAN,
  brightBlue: BRIGHT_BLUE,
  brightMagenta: BRIGHT_MAGENTA,
};

/** Convert a hex color string (#rrggbb) to a truecolor ANSI escape sequence. */
function hexToAnsi(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Resolve a color value to an ANSI escape sequence.
 * Accepts named presets, 256-color indices (0-255), or hex strings (#rrggbb).
 */
function resolveAnsi(value: HudColorValue | undefined, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return `\x1b[38;5;${value}m`;
  }
  if (typeof value === 'string' && value.startsWith('#') && value.length === 7) {
    return hexToAnsi(value);
  }
  return ANSI_BY_NAME[value as HudColorName] ?? fallback;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function withOverride(text: string, value: HudColorValue | undefined, fallback: string): string {
  return colorize(text, resolveAnsi(value, fallback));
}

export function green(text: string): string {
  return colorize(text, GREEN);
}

export function yellow(text: string): string {
  return colorize(text, YELLOW);
}

export function red(text: string): string {
  return colorize(text, RED);
}

export function cyan(text: string): string {
  return colorize(text, CYAN);
}

export function magenta(text: string): string {
  return colorize(text, MAGENTA);
}

export function dim(text: string): string {
  return colorize(text, DIM);
}

export function claudeOrange(text: string): string {
  return colorize(text, CLAUDE_ORANGE);
}

export function model(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.model, CYAN);
}

export function project(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.project, YELLOW);
}

export function git(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.git, MAGENTA);
}

export function gitBranch(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.gitBranch, CYAN);
}

export function label(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.label, DIM);
}

export function custom(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.custom, CLAUDE_ORANGE);
}

export function warning(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.warning, YELLOW));
}

export function critical(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.critical, RED));
}

export interface ContextThresholds {
  warning?: number;
  critical?: number;
}

// Local patch: dark green (low use) -> yellow -> red (full) truecolor gradient.
// Lightness rises with use, so an idle bar stays dim and a full one stands out.
export function gradientColor(percent: number): string {
  const t = Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : 0;
  const hue = 120 * (1 - t);
  const s = 0.7;
  const l = 0.3 + 0.2 * t;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `\x1b[38;2;${f(0)};${f(8)};${f(4)}m`;
}

export function getContextColor(
  percent: number,
  _colors?: Partial<HudColorOverrides>,
  _thresholds?: ContextThresholds,
): string {
  return gradientColor(percent);
}

// Local patch: the share of the window's time still left, 0-100, or null
// when the reset time is unknown.
export function windowTimeLeft(resetAt: Date | null, windowMs: number): number | null {
  if (!resetAt) {
    return null;
  }
  const left = ((resetAt.getTime() - Date.now()) / windowMs) * 100;
  return Number.isFinite(left) ? Math.max(0, Math.min(100, left)) : null;
}

// Local patch: with the share of the window's time still left, color by pace:
// green while quota left keeps up with time left, then one step per 5 points
// short (5, 10, 15, 20), red from 25 short.
export function getQuotaColor(
  percent: number,
  _colors?: Partial<HudColorOverrides>,
  timeLeft: number | null = null,
): string {
  if (timeLeft === null || !Number.isFinite(timeLeft) || !Number.isFinite(percent)) {
    return gradientColor(percent);
  }
  const short = timeLeft - (100 - percent);
  const step = Math.min(5, Math.max(0, Math.floor(short / 5)));
  return gradientColor(step * 20);
}

// Local patch: the bar is one row of background color, no block glyphs.
// remaining=true fills it by what is left (100 - percent); the fill takes the
// same color as the number beside it. With timeLeft, a thin │ stands where the
// fill would end on pace (time left, or time gone when the bar shows use).
function gradientBar(
  percent: number,
  width: number,
  colors: Partial<HudColorOverrides> | undefined,
  remaining: boolean,
  timeLeft: number | null,
): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const level = remaining ? 100 - safePercent : safePercent;
  const filled = level > 0 && safeWidth > 0 ? Math.max(1, Math.round((level / 100) * safeWidth)) : 0;
  const fill = getQuotaColor(safePercent, colors, timeLeft).replace('[38;', '[48;');
  let at = -1;
  if (timeLeft !== null && Number.isFinite(timeLeft) && safeWidth > 0) {
    const pace = Math.min(100, Math.max(0, remaining ? timeLeft : 100 - timeLeft));
    at = Math.min(safeWidth - 1, Math.round((pace / 100) * safeWidth));
  }
  const cells = Array.from({ length: safeWidth }, (_, i) =>
    `${i < filled ? fill : BAR_EMPTY_BG}${i === at ? `${PACE_MARK}│` : ' '}${RESET}`);
  return cells.join('');
}

export function quotaBar(
  percent: number,
  width: number = 10,
  colors?: Partial<HudColorOverrides>,
  remaining: boolean = false,
  timeLeft: number | null = null,
): string {
  return gradientBar(percent, width, colors, remaining, timeLeft);
}

export function coloredBar(
  percent: number,
  width: number = 10,
  colors?: Partial<HudColorOverrides>,
  _thresholds?: ContextThresholds,
  remaining: boolean = false,
): string {
  return gradientBar(percent, width, colors, remaining, null);
}
