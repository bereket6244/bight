/**
 * UCI text parsing. Pure functions over strings, so it is exhaustively
 * testable without a worker, a browser, or an engine.
 *
 * The engine's output is a text stream from a program we do not control, which
 * means it must be treated as untrusted input: every parser here returns null
 * rather than throwing, and nothing assumes a field is present.
 */

import type { EngineMove } from './engineTypes';

/** `bestmove e2e4 ponder e7e5` → the move, or null if it is not one. */
export function parseBestMove(line: string, elapsedMs = 0): EngineMove | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'bestmove') return null;

  const uci = parts[1];
  if (uci === undefined) return null;

  // `bestmove (none)` is what the engine says in a finished position. It is a
  // valid answer to a bad question, not a move.
  if (!isUciMove(uci)) return null;

  const ponderIndex = parts.indexOf('ponder');
  const ponderToken = ponderIndex === -1 ? undefined : parts[ponderIndex + 1];
  const ponder = ponderToken !== undefined && isUciMove(ponderToken) ? ponderToken : null;

  return {
    uci,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? (uci[4] as string).toLowerCase() : null,
    ponder,
    elapsedMs,
  };
}

/** True for `e2e4` and `e7e8q`, false for `(none)`, `0000` and anything else. */
export function isUciMove(token: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(token);
}

/** `id name Stockfish 18 Lite WASM` → `Stockfish 18 Lite WASM`. */
export function parseIdName(line: string): string | null {
  const match = /^id name (.+)$/.exec(line.trim());
  return match === null ? null : (match[1] as string).trim();
}

export interface UciInfo {
  depth?: number;
  /** Score in centipawns, from the side to move's point of view. */
  scoreCp?: number;
  /** Moves to mate, signed. Present instead of `scoreCp` in a mating line. */
  scoreMate?: number;
  /** The principal variation, in UCI. */
  pv?: string[];
  nodes?: number;
  timeMs?: number;
  /** MultiPV index, 1-based. Absent means 1. */
  multipv?: number;
}

/**
 * Parses an `info` line.
 *
 * Returns null for anything that is not one, including `info string …`, which
 * is free-form engine chatter rather than search data.
 */
export function parseInfo(line: string): UciInfo | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('info ')) return null;
  if (trimmed.startsWith('info string')) return null;

  const tokens = trimmed.split(/\s+/);
  const info: UciInfo = {};

  for (let i = 1; i < tokens.length; i += 1) {
    switch (tokens[i]) {
      case 'depth':
        info.depth = toInt(tokens[i + 1]);
        break;
      case 'multipv':
        info.multipv = toInt(tokens[i + 1]);
        break;
      case 'nodes':
        info.nodes = toInt(tokens[i + 1]);
        break;
      case 'time':
        info.timeMs = toInt(tokens[i + 1]);
        break;
      case 'score': {
        const kind = tokens[i + 1];
        const value = toInt(tokens[i + 2]);
        if (kind === 'cp' && value !== undefined) info.scoreCp = value;
        else if (kind === 'mate' && value !== undefined) info.scoreMate = value;
        break;
      }
      case 'pv':
        // `pv` runs to the end of the line by definition.
        info.pv = tokens.slice(i + 1).filter(isUciMove);
        i = tokens.length;
        break;
      default:
        break;
    }
  }

  return info;
}

function toInt(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const value = Number.parseInt(token, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** Builds a `position` command. Moves are appended only when there are some. */
export function positionCommand(fen: string, moves: readonly string[] = []): string {
  const base = fen === 'startpos' ? 'position startpos' : `position fen ${fen}`;
  return moves.length === 0 ? base : `${base} moves ${moves.join(' ')}`;
}

/** Builds a `go` command from search limits. */
export function goCommand(limits: { movetimeMs?: number; depth?: number }): string {
  const parts = ['go'];
  if (limits.depth !== undefined) parts.push('depth', String(limits.depth));
  if (limits.movetimeMs !== undefined) parts.push('movetime', String(limits.movetimeMs));
  // A `go` with no limits searches forever, which must never be sent.
  if (parts.length === 1) parts.push('movetime', '1000');
  return parts.join(' ');
}

/** Builds a `setoption` command. */
export function setOptionCommand(name: string, value: string | number | boolean): string {
  return `setoption name ${name} value ${String(value)}`;
}
