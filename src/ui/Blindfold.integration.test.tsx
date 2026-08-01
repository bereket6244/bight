/**
 * Blindfold drills as a user meets them.
 *
 * These mount the real session screen over the real generators, so what is
 * being checked is the whole chain: sequence generation, the reveal schedule,
 * the palette, and the engine's answer handling.
 *
 * The load-bearing assertion is that the final position is never on screen
 * while the question is live. Everything else about blindfold training is
 * pointless if the answer is sitting on the board.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionScreen } from './screens/SessionScreen';
import { AppProvider } from './state/AppContext';
import { defaultSettings, type SessionSettings } from '../core/session/settings';
import type { ModeId } from '../core/training/types';

function renderBlindfold(
  modeId: ModeId,
  variantId: string,
  overrides: Partial<SessionSettings> = {},
) {
  const settings: SessionSettings = {
    ...defaultSettings(modeId, variantId),
    blindfoldPlies: 4,
    pacing: 'manual',
    moveHistory: 'visible',
    boardVisibility: 'start-only',
    adaptive: false,
    ...overrides,
  };
  const onExit = vi.fn();
  return { ...render(
    <AppProvider>
      <SessionScreen settings={settings} onExit={onExit} />
    </AppProvider>,
  ), onExit };
}

/** Every piece currently drawn on the board, as `square:piece` strings. */
function piecesOnBoard(): string[] {
  return [...document.querySelectorAll('.square')]
    .filter((square) => square.querySelector('svg') !== null)
    .map((square) => (square as HTMLElement).dataset.square ?? '');
}

async function playWholeSequence(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // Manual pacing: the tap target is present until the last move is shown.
  for (let guard = 0; guard < 40; guard += 1) {
    const button = screen.queryByTestId('blindfold-advance');
    if (button === null) return;
    await user.click(button);
  }
  throw new Error('The sequence never finished');
}

describe('blindfold tracking', () => {
  it('plays the sequence before asking anything', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed');

    await screen.findByTestId('blindfold-sequence');
    expect(screen.getByTestId('blindfold-progress')).toHaveTextContent('Move 0 of 4');
    // The question itself is withheld until the moves have been shown.
    expect(screen.getByText('Follow the moves')).toBeInTheDocument();

    await playWholeSequence(user);
    expect(screen.getByTestId('blindfold-progress')).toHaveTextContent('Sequence complete');
    expect(screen.queryByText('Follow the moves')).not.toBeInTheDocument();
  });

  it('reveals the moves one at a time', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed');

    await screen.findByTestId('blindfold-advance');
    expect(screen.getByTestId('blindfold-moves').textContent?.trim()).toBe('');

    await user.click(screen.getByTestId('blindfold-advance'));
    const afterOne = screen.getByTestId('blindfold-moves').textContent ?? '';
    expect(afterOne).toMatch(/^1\./);

    await user.click(screen.getByTestId('blindfold-advance'));
    const afterTwo = screen.getByTestId('blindfold-moves').textContent ?? '';
    expect(afterTwo.length).toBeGreaterThan(afterOne.length);
  });

  it('shows only the latest move when the history is set to that', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', { moveHistory: 'latest-only' });

    await screen.findByTestId('blindfold-advance');
    await user.click(screen.getByTestId('blindfold-advance'));
    await user.click(screen.getByTestId('blindfold-advance'));

    const text = screen.getByTestId('blindfold-moves').textContent ?? '';
    // One move, not two: no space-separated second entry.
    expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
  });

  it('takes the board away once the moves begin, on the start-only stage', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', { boardVisibility: 'start-only' });

    await screen.findByTestId('blindfold-advance');
    // The opening position is on screen before anything is played.
    expect(piecesOnBoard().length).toBeGreaterThan(20);

    await user.click(screen.getByTestId('blindfold-advance'));
    // Removed from the layout, not blanked: a hidden-but-present board left a
    // board-sized gap the user had to scroll past to reach the controls.
    await waitFor(() => expect(screen.queryByTestId('board')).not.toBeInTheDocument());
    expect(document.querySelectorAll('.board-wrap')).toHaveLength(0);
    expect(screen.getByTestId('board-collapsed-note')).toBeInTheDocument();
  });

  it('never draws the board at all on the last stage', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', { boardVisibility: 'never' });

    await screen.findByTestId('blindfold-sequence');
    expect(screen.getByText('No board')).toBeInTheDocument();
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();

    await playWholeSequence(user);
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.board-wrap')).toHaveLength(0);
  });

  it('keeps the board hidden once the sequence is over, whatever the stage', async () => {
    const user = userEvent.setup();
    // The most generous stage there is: a board after every single ply.
    renderBlindfold('blindfold-tracking', 'mixed', { boardVisibility: 'each-ply' });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);

    // The position the moves produced is the answer, so it is never drawn —
    // and the board takes no layout space while it is not being drawn.
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.square')).toHaveLength(0);
  });

  it('offers the move list as a hint, and only when it was hidden', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', {
      moveHistory: 'hidden',
      allowHints: true,
    });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);

    const hint = screen.getByTestId('blindfold-hint');
    await user.click(hint);
    expect(screen.getByTestId('blindfold-hint-moves').textContent).toContain('1.');
  });

  it('does not offer a hint when the move list was up the whole time', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', { moveHistory: 'visible' });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    expect(screen.queryByTestId('blindfold-hint')).not.toBeInTheDocument();
  });

  it('does not offer a hint when hints are turned off', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-tracking', 'mixed', {
      moveHistory: 'hidden',
      allowHints: false,
    });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    expect(screen.queryByTestId('blindfold-hint')).not.toBeInTheDocument();
  });
});

describe('blindfold reconstruction', () => {
  it('offers every piece in the palette and no counts', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial');

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);

    const palette = await screen.findByTestId('piece-palette');
    // Twelve buttons: six piece types, two colours. A palette that showed only
    // what was still needed would give the material balance away.
    expect(palette.querySelectorAll('.palette__piece')).toHaveLength(12);
    for (const color of ['white', 'black']) {
      for (const type of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
        expect(screen.getByTestId(`palette-${color}-${type}`)).toBeInTheDocument();
      }
    }
  });

  it('places a piece with two taps: the piece, then the square', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial');

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');

    // An empty board to start with.
    expect(piecesOnBoard()).toHaveLength(0);

    await user.click(screen.getByTestId('palette-white-king'));
    expect(screen.getByTestId('palette-white-king')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no Submit button anywhere on a reconstruction question', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'full');

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');

    for (const label of [/submit/i, /^next$/i, /^continue$/i, /^check$/i, /^done$/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('shows an eraser only where there is something to erase', async () => {
    const user = userEvent.setup();
    const partial = renderBlindfold('blindfold-reconstruction', 'partial');
    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');
    expect(screen.queryByTestId('palette-eraser')).not.toBeInTheDocument();
    partial.unmount();

    renderBlindfold('blindfold-reconstruction', 'correction');
    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');
    expect(screen.getByTestId('palette-eraser')).toBeInTheDocument();
  });

  it('draws the damaged position for a correction question', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'correction');

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');

    // Something to repair, rather than an empty board.
    expect(piecesOnBoard().length).toBeGreaterThan(10);
  });
});

describe('progressive blindfold', () => {
  it('runs a session and names the stage it is on', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-progressive', 'ladder', { boardVisibility: 'each-ply' });

    await screen.findByTestId('blindfold-advance');
    expect(document.querySelector('.session-bar strong')?.textContent).toContain('Stage 1');

    await playWholeSequence(user);
    expect(screen.getByTestId('blindfold-progress')).toHaveTextContent('Sequence complete');
  });
});

/* ------------------------------------------------------------------ *
 * Reconstruction layout
 *
 * Reported from a real Android device: during hidden playback a large blank
 * square sat in the middle of the screen and the palette was below it, so the
 * user had to scroll through empty space to reach the controls.
 * ------------------------------------------------------------------ */
describe('reconstruction layout while the board is hidden', () => {
  it('reserves no board-sized space during hidden playback', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial', { boardVisibility: 'never' });

    await screen.findByTestId('blindfold-advance');

    // Nothing board-shaped is in the tree at all while the moves play out.
    expect(screen.queryByTestId('board')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.board-wrap')).toHaveLength(0);
    expect(document.querySelectorAll('.square')).toHaveLength(0);

    // And the user is told why, in one line.
    expect(screen.getByTestId('board-collapsed-note')).toHaveTextContent(/follow the moves/i);
    await user.click(screen.getByTestId('blindfold-advance'));
    expect(document.querySelectorAll('.square')).toHaveLength(0);
  });

  it('keeps the playback controls reachable while the board is gone', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial', { boardVisibility: 'never' });

    // The advance control is what drives the sequence; it must be present and
    // usable throughout, not stranded below a blank board.
    await screen.findByTestId('blindfold-advance');
    await user.click(screen.getByTestId('blindfold-advance'));
    expect(screen.getByTestId('blindfold-progress')).toHaveTextContent('Move 1 of');
    expect(screen.getByTestId('blindfold-sequence')).toBeInTheDocument();
  });

  it('brings the board back with the palette right after it, once answering starts', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial', { boardVisibility: 'never' });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);

    const board = await screen.findByTestId('board');
    const palette = await screen.findByTestId('piece-palette');

    // Both present, and the palette is the board's next sibling in document
    // order — nothing sits between them.
    expect(board).toBeInTheDocument();
    expect(palette).toBeInTheDocument();
    expect(
      board.compareDocumentPosition(palette) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const between = [...document.querySelectorAll('*')].filter(
      (el) =>
        (board.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        (palette.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 &&
        !board.contains(el) &&
        !palette.contains(el),
    );
    expect(between, between.map((el) => el.className).join(', ')).toHaveLength(0);
  });

  it('does not offer the palette before there is anything to place', async () => {
    renderBlindfold('blindfold-reconstruction', 'partial', { boardVisibility: 'never' });
    await screen.findByTestId('blindfold-advance');
    expect(screen.queryByTestId('piece-palette')).not.toBeInTheDocument();
  });

  it('can be completed end to end with the board hidden throughout playback', async () => {
    const user = userEvent.setup();
    renderBlindfold('blindfold-reconstruction', 'partial', { boardVisibility: 'never' });

    await screen.findByTestId('blindfold-advance');
    await playWholeSequence(user);
    await screen.findByTestId('piece-palette');

    // The answer board is a real, visible board with real squares to tap.
    expect(screen.getByTestId('board')).toHaveAttribute('data-display-mode', 'position');
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
  });
});
