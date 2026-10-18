import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StdinData } from './types.js';

export interface EffortInfo {
  level: string;
  symbol: string;
}

export interface ResolveEffortOptions {
  // Current ultracode effort state from the transcript (see transcript.ts).
  // stdin reports ultracode as a normal level, so this is the only signal that
  // distinguishes it.
  ultracodeActive?: boolean;
}

const KNOWN_SYMBOLS: Record<string, string> = {
  low: '○',
  medium: '◔',
  high: '◑',
  xhigh: '◕',
  max: '●',
};

/**
 * Shape of the effort field in Claude Code stdin JSON.
 *
 * Historically absent; Claude Code 2.1.115+ sends an object with a string
 * `level` field (verified capture: `{ "level": "max" }`). The index signature
 * keeps the type permissive so future additions (e.g., a budget field) do not
 * require another breaking change here.
 */
export interface StdinEffort {
  level?: string | null;
  [key: string]: unknown;
}

export type StdinEffortInput = string | StdinEffort | null | undefined;

/**
 * Resolve the current session's effort level.
 *
 * Resolution order (matches `extractEffortString` below):
 * 1. stdin.effort as non-empty string — original PR #471 future-proofed path.
 * 2. stdin.effort as object with string `level` — Claude Code 2.1.115+ schema
 *    (e.g., `{ "level": "max" }`).
 * 3. null.
 *
 * When the transcript marks ultracode active (`options.ultracodeActive`), the
 * reported level is wrapped as `ultracode(<level>)` — the level is taken as-is,
 * not assumed to be `xhigh`.
 *
 * Non-matching inputs (numbers, booleans, arrays, objects without a string
 * `level`) return null rather than crashing.
 */
export function resolveEffortLevel(
  stdinEffort?: StdinEffortInput,
  options: ResolveEffortOptions = {},
): EffortInfo | null {
  const fromStdin = extractEffortString(stdinEffort);
  if (!fromStdin) {
    return null;
  }

  const info = formatEffort(fromStdin);
  // Ultracode reaches stdin as a normal level, so the transcript marker is the
  // only signal; wrap the reported level rather than assuming xhigh.
  return options.ultracodeActive === true
    ? { level: `ultracode(${info.level})`, symbol: info.symbol }
    : info;
}

function extractEffortString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const level = (value as { level?: unknown }).level;
    if (typeof level === 'string' && level.length > 0) {
      return level;
    }
  }
  return null;
}

function formatEffort(level: string): EffortInfo {
  const normalized = normalizeEffort(level);
  return { level: normalized, symbol: KNOWN_SYMBOLS[normalized] ?? '' };
}

function normalizeEffort(level: string | null | undefined): string {
  return level?.toLowerCase().trim() ?? '';
}

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Files of sessions this old are gone; the folder is swept when a session first reports.
const SHARED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Trades effort with the hud-controls mod (this repository's root), per
 * session, in `~/.claude/hud-controls`: writes `<id>.json` with the model and
 * level Claude Code hands this statusline, stamped `at` when the run started,
 * and returns the level the mod's row was pressed to from `<id>.pending.json`
 * while its /effort waits for the turn to end.
 */
export function shareEffort(
  stdin: StdinData,
  startedAt = Date.now(),
  dir = join(homedir(), '.claude', 'hud-controls'),
): StdinEffortInput {
  const id = stdin.session_id;
  if (!id || !/^[\w-]+$/.test(id)) {
    return stdin.effort;
  }
  try {
    const report = join(dir, `${id}.json`);
    let isFirst = false;
    try {
      statSync(report);
    } catch {
      isFirst = true;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      report,
      JSON.stringify({
        model: stdin.model?.id ?? null,
        effort: extractEffortString(stdin.effort),
        at: startedAt,
      }),
    );
    if (isFirst) {
      sweepShared(dir, startedAt);
    }
    const pending = (JSON.parse(readFileSync(join(dir, `${id}.pending.json`), 'utf8')) as {
      effort?: unknown;
    }).effort;
    if (typeof pending === 'string' && LEVELS.includes(pending)) {
      return { level: pending };
    }
  } catch {
    // No row pressed yet, or a file half written: the reported level stands.
  }
  return stdin.effort;
}

function sweepShared(dir: string, now: number): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > SHARED_MAX_AGE_MS) {
        unlinkSync(path);
      }
    } catch {
      // Swept by another session meanwhile, or not a file this can remove.
    }
  }
}
