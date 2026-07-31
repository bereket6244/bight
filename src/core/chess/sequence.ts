/**
 * Legal move sequences for blindfold training.
 *
 * Everything here is replayed and validated through chess.js: a sequence is
 * only returned once every move has actually been played from the starting
 * position, so the SAN, the UCI, the captures and the final FEN are recorded
 * facts rather than predictions.
 *
 * Piece *identity* is tracked separately from piece type, because "where is
 * the knight that started on g1" is a different question from "where is a
 * white knight", and after a promotion the two diverge entirely.
 */

import { Chess } from 'chess.js';
import { STARTING_FEN } from './position';
import type { PieceColor, PieceType, SquareName } from './types';
import type { Rng } from '../rng';

const SYMBOL_TO_TYPE: Record<string, PieceType> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** A piece followed through a sequence, identified by where it started. */
export interface TrackedPiece {
  /** Stable id: colour, original type and origin square, e.g. "w-n-g1". */
  id: string;
  color: PieceColor;
  /** The type it started as. */
  originalType: PieceType;
  /** What it is now — different from `originalType` after a promotion. */
  currentType: PieceType;
  /** Where it started the sequence. */
  origin: SquareName;
  /** Where it stands now, or null once captured. */
  square: SquareName | null;
  captured: boolean;
  /** Ply index (1-based) on which it was captured, if it was. */
  capturedOnPly: number | null;
  /** Ply indices on which this piece moved. */
  movedOnPlies: number[];
  promoted: boolean;
}

/** One ply of a validated sequence. */
export interface SequencePly {
  /** 1-based ply number. */
  ply: number;
  /** Full move number as printed in notation. */
  moveNumber: number;
  color: PieceColor;
  san: string;
  uci: string;
  from: SquareName;
  to: SquareName;
  pieceType: PieceType;
  /** Id of the piece that moved. */
  pieceId: string;
  /** What was taken, if anything. */
  captured: { type: PieceType; color: PieceColor; square: SquareName; pieceId: string } | null;
  isEnPassant: boolean;
  isCastle: boolean;
  promotion: PieceType | null;
  isCheck: boolean;
  isCheckmate: boolean;
  /** FEN after this ply. */
  fen: string;
}

export interface MoveSequence {
  startFen: string;
  startTurn: PieceColor;
  plies: SequencePly[];
  /** FEN after the last ply. */
  finalFen: string;
  finalTurn: PieceColor;
  /** Every piece that began the sequence, with its fate. */
  pieces: TrackedPiece[];
  /** SAN list, ready to display. */
  san: string[];
  /** UCI list, for reproduction. */
  uci: string[];
  captureCount: number;
  seed: number;
}

/** How much capturing a sequence should contain. */
export type CaptureBias = 'ordinary' | 'capture-focused' | 'heavy-exchanges';

export interface SequenceRequest {
  /** Where to start. Defaults to the normal initial position. */
  startFen?: string;
  /** Number of plies (half-moves). Never "moves" — the wording matters. */
  plies: number;
  captureBias?: CaptureBias;
  /** Reject sequences ending in checkmate/stalemate unless allowed. */
  allowTermination?: boolean;
}

function typeOf(symbol: string): PieceType {
  return SYMBOL_TO_TYPE[symbol] as PieceType;
}

function colorOf(symbol: string): PieceColor {
  return symbol === 'w' ? 'white' : 'black';
}

function pieceIdFor(color: PieceColor, type: PieceType, origin: SquareName): string {
  return `${color[0]}-${type[0] === 'k' && type === 'knight' ? 'n' : type[0]}-${origin}`;
}

/** Builds the identity table for whatever stands on the board at the start. */
function initialPieces(chess: Chess): Map<SquareName, TrackedPiece> {
  const bySquare = new Map<SquareName, TrackedPiece>();

  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell === null) continue;
      const square = cell.square as unknown as SquareName;
      const color = colorOf(cell.color);
      const type = typeOf(cell.type);
      bySquare.set(square, {
        id: pieceIdFor(color, type, square),
        color,
        originalType: type,
        currentType: type,
        origin: square,
        square,
        captured: false,
        capturedOnPly: null,
        movedOnPlies: [],
        promoted: false,
      });
    }
  }

  return bySquare;
}

/**
 * Scores a candidate move against the requested capture bias.
 * Higher is more likely to be chosen; nothing is ever forced.
 */
function weightFor(
  move: { san: string; captured?: string; piece: string; flags: string },
  bias: CaptureBias,
): number {
  const isCapture = move.captured !== undefined;
  const isCastle = move.flags.includes('k') || move.flags.includes('q');
  const isPawn = move.piece === 'p';
  const isKnight = move.piece === 'n';

  let weight = 1;

  if (isCapture) {
    weight *= bias === 'heavy-exchanges' ? 12 : bias === 'capture-focused' ? 6 : 1.4;
  }
  // A little bias toward the moves that make a sequence feel like a game
  // rather than a random walk.
  if (isCastle) weight *= 2.5;
  if (isPawn) weight *= 1.2;
  if (isKnight) weight *= 1.3;

  return weight;
}

/**
 * Discourages shuffling a single piece back and forth, which is legal but
 * useless for mental tracking.
 */
function shufflePenalty(
  move: { from: string; to: string },
  history: Array<{ from: string; to: string }>,
): number {
  const recent = history.slice(-4);
  // Moving straight back where it came from.
  const undoes = recent.some((prior) => prior.from === move.to && prior.to === move.from);
  if (undoes) return 0.15;
  // Moving the same piece repeatedly.
  const samePiece = recent.filter((prior) => prior.to === move.from).length;
  return samePiece >= 2 ? 0.4 : 1;
}

/**
 * Plays a validated legal sequence.
 *
 * Returns null when the position runs out of moves before the requested
 * length, unless termination was explicitly allowed. The caller retries with
 * fresh randomness rather than being handed a short sequence.
 */
export function generateSequence(rng: Rng, request: SequenceRequest): MoveSequence | null {
  const {
    startFen = STARTING_FEN,
    plies,
    captureBias = 'ordinary',
    allowTermination = false,
  } = request;

  if (plies <= 0) return null;

  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return null;
  }

  const seed = rng.nextInt(0x7fffffff);
  const bySquare = initialPieces(chess);
  const byId = new Map<string, TrackedPiece>();
  for (const piece of bySquare.values()) byId.set(piece.id, piece);

  const startTurn = colorOf(chess.turn());
  const sequence: SequencePly[] = [];
  const played: Array<{ from: string; to: string }> = [];

  for (let ply = 1; ply <= plies; ply += 1) {
    const legal = chess.moves({ verbose: true });
    if (legal.length === 0) {
      // Checkmate or stalemate reached early.
      return allowTermination && sequence.length > 0 ? finish() : null;
    }

    const chosen = rng.pickWeighted(
      legal,
      (move) =>
        weightFor(move as never, captureBias) *
        shufflePenalty({ from: move.from, to: move.to }, played),
    );

    const moveNumber = Number(chess.fen().split(' ')[5] ?? 1);
    const mover = bySquare.get(chosen.from as unknown as SquareName);
    if (mover === undefined) return null; // Identity table desynchronised.

    // Resolve the captured piece *before* applying the move, because en
    // passant takes a piece that is not on the destination square.
    let capturedInfo: SequencePly['captured'] = null;
    if (chosen.captured !== undefined) {
      const capturedSquare = (
        chosen.flags.includes('e')
          ? `${chosen.to[0]}${chosen.from[1]}`
          : chosen.to
      ) as unknown as SquareName;
      const victim = bySquare.get(capturedSquare);
      if (victim === undefined) return null;
      capturedInfo = {
        type: typeOf(chosen.captured),
        color: victim.color,
        square: capturedSquare,
        pieceId: victim.id,
      };
      victim.captured = true;
      victim.capturedOnPly = ply;
      victim.square = null;
      bySquare.delete(capturedSquare);
    }

    const applied = chess.move({
      from: chosen.from,
      to: chosen.to,
      promotion: chosen.promotion ?? 'q',
    });

    // Move the identity to its new square.
    bySquare.delete(mover.origin === mover.square ? mover.origin : (mover.square as SquareName));
    bySquare.delete(chosen.from as unknown as SquareName);
    mover.square = chosen.to as unknown as SquareName;
    mover.movedOnPlies.push(ply);
    if (applied.promotion !== undefined) {
      mover.currentType = typeOf(applied.promotion);
      mover.promoted = true;
    }
    bySquare.set(mover.square, mover);

    // Castling moves the rook too; keep its identity in step.
    if (applied.isKingsideCastle() || applied.isQueensideCastle()) {
      const rank = chosen.from[1];
      const rookFrom = (applied.isKingsideCastle() ? `h${rank}` : `a${rank}`) as SquareName;
      const rookTo = (applied.isKingsideCastle() ? `f${rank}` : `d${rank}`) as SquareName;
      const rook = bySquare.get(rookFrom);
      if (rook !== undefined) {
        bySquare.delete(rookFrom);
        rook.square = rookTo;
        rook.movedOnPlies.push(ply);
        bySquare.set(rookTo, rook);
      }
    }

    sequence.push({
      ply,
      moveNumber,
      color: colorOf(applied.color),
      san: applied.san,
      uci: `${applied.from}${applied.to}${applied.promotion ?? ''}`,
      from: applied.from as unknown as SquareName,
      to: applied.to as unknown as SquareName,
      pieceType: typeOf(applied.piece),
      pieceId: mover.id,
      captured: capturedInfo,
      isEnPassant: applied.isEnPassant(),
      isCastle: applied.isKingsideCastle() || applied.isQueensideCastle(),
      promotion: applied.promotion === undefined ? null : typeOf(applied.promotion),
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      fen: chess.fen(),
    });

    played.push({ from: chosen.from, to: chosen.to });
  }

  return finish();

  function finish(): MoveSequence {
    return {
      startFen,
      startTurn,
      plies: sequence,
      finalFen: chess.fen(),
      finalTurn: colorOf(chess.turn()),
      pieces: [...byId.values()],
      san: sequence.map((p) => p.san),
      uci: sequence.map((p) => p.uci),
      captureCount: sequence.filter((p) => p.captured !== null).length,
      seed,
    };
  }
}

/**
 * Minimum captures a bias should aim for, used to reject weak sequences.
 *
 * Scaled to the length, because captures need moves to set up: nothing can be
 * taken on ply one, and the first exchange from the opening is realistically
 * ply three at the earliest. Asking a four-ply sequence for two captures made
 * "Beginner + heavy exchanges" — a combination the setup page offers — fail to
 * generate at all.
 */
export function minimumCaptures(bias: CaptureBias, plies: number): number {
  switch (bias) {
    case 'heavy-exchanges':
      return Math.max(1, Math.floor(plies / 3));
    case 'capture-focused':
      return Math.max(1, Math.floor(plies / 6));
    case 'ordinary':
      return 0;
  }
}

/**
 * Generates a sequence meeting the request, retrying until it does.
 *
 * The capture count is a *preference*, so a request that cannot be met after
 * `attempts` tries returns the capture-heaviest legal sequence found rather
 * than nothing. Only a complete inability to build a legal sequence of the
 * requested length returns null — that is a real failure and the caller throws
 * on it. The alternative, failing because a short sequence could not fit two
 * captures in, meant a legitimate pair of settings crashed the session.
 */
export function requireSequence(
  rng: Rng,
  request: SequenceRequest,
  attempts = 40,
): MoveSequence | null {
  const wanted = minimumCaptures(request.captureBias ?? 'ordinary', request.plies);
  let best: MoveSequence | null = null;

  for (let i = 0; i < attempts; i += 1) {
    const sequence = generateSequence(rng, request);
    if (sequence === null) continue;
    if (sequence.captureCount >= wanted) return sequence;
    if (best === null || sequence.captureCount > best.captureCount) best = sequence;
  }
  return best;
}

/**
 * Replays a sequence independently and checks it against what was recorded.
 * Used by tests, and cheap enough to assert in development builds.
 */
export function verifySequence(sequence: MoveSequence): { ok: boolean; problem: string | null } {
  let chess: Chess;
  try {
    chess = new Chess(sequence.startFen);
  } catch (error) {
    return { ok: false, problem: `start FEN rejected: ${String(error)}` };
  }

  for (const ply of sequence.plies) {
    const legal = chess.moves({ verbose: true });
    const match = legal.find(
      (move) => move.from === ply.from && move.to === ply.to && move.san === ply.san,
    );
    if (match === undefined) {
      return { ok: false, problem: `ply ${ply.ply} (${ply.san}) is not legal` };
    }
    const applied = chess.move({ from: ply.from, to: ply.to, promotion: ply.promotion?.[0] ?? 'q' });
    if (applied.san !== ply.san) {
      return { ok: false, problem: `ply ${ply.ply} SAN mismatch: ${applied.san} vs ${ply.san}` };
    }
    const uci = `${applied.from}${applied.to}${applied.promotion ?? ''}`;
    if (uci !== ply.uci) {
      return { ok: false, problem: `ply ${ply.ply} UCI mismatch: ${uci} vs ${ply.uci}` };
    }
  }

  if (chess.fen() !== sequence.finalFen) {
    return { ok: false, problem: `final FEN mismatch` };
  }
  if (colorOf(chess.turn()) !== sequence.finalTurn) {
    return { ok: false, problem: `final turn mismatch` };
  }
  return { ok: true, problem: null };
}

/** Pieces still on the board at the end of a sequence. */
export function survivingPieces(sequence: MoveSequence): TrackedPiece[] {
  return sequence.pieces.filter((piece) => !piece.captured);
}

/** Pieces taken during a sequence. */
export function capturedPieces(sequence: MoveSequence): TrackedPiece[] {
  return sequence.pieces.filter((piece) => piece.captured);
}

/** Human-readable name for a tracked piece, used in prompts. */
export function describePiece(piece: TrackedPiece): string {
  const side = piece.color === 'white' ? 'White' : 'Black';
  if (piece.promoted) {
    return `${side}'s ${piece.currentType} promoted from ${piece.origin}`;
  }
  return `${side}'s ${piece.originalType} that started on ${piece.origin}`;
}

/** Occupancy of the final position, as a square→piece map. */
export function finalOccupancy(sequence: MoveSequence): Map<SquareName, { type: PieceType; color: PieceColor }> {
  const map = new Map<SquareName, { type: PieceType; color: PieceColor }>();
  for (const piece of survivingPieces(sequence)) {
    if (piece.square === null) continue;
    map.set(piece.square, { type: piece.currentType, color: piece.color });
  }
  return map;
}
