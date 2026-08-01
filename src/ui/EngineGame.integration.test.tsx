/**
 * Blindfold vs Computer, driven through the real screen with a fake engine.
 *
 * The engine is injected, so these tests cover the parts that matter and are
 * hardest to trigger for real: what the user sees while the computer thinks,
 * what happens when it returns an illegal move, and what happens when it never
 * answers at all. Whether Stockfish itself works is checked separately, in a
 * real browser, by `scripts/engine-smoke.mjs`.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineGameScreen, MIN_THINKING_MS } from './screens/EngineGameScreen';
import { AppProvider } from './state/AppContext';
import type { EngineMove, EngineService, EngineStatus } from '../services/engine';
import { SAVED_GAME_KEY } from '../core/engineGame/savedGame';
/**
 * Everything spoken, so "read moves aloud" can be asserted without a device.
 *
 * The module is mocked rather than spied on: the screen imports `speak`
 * directly, and rebinding the namespace export does not change a binding that
 * has already been imported.
 *
 * Actual audio output still needs real hardware. This proves the app asks for
 * it, for both sides, and never for a move that was refused.
 */
const spoken: string[] = [];

vi.mock('../services/speech', () => ({
  speak: async (text: string) => {
    spoken.push(text);
  },
  speechAvailable: () => true,
  stopSpeaking: () => undefined,
}));

function speechCalls(): string[] {
  return [...spoken];
}

beforeEach(() => {
  spoken.length = 0;
});

/** An engine that plays from a script, or misbehaves on demand. */
function fakeEngine(
  behaviour: {
    moves?: string[];
    failOnInitialize?: string;
    failOnMove?: string;
    illegalMove?: string;
  } = {},
): EngineService & { calls: string[] } {
  const moves = [...(behaviour.moves ?? ['e7e5', 'b8c6', 'g8f6', 'f8e7', 'e8g8'])];
  const calls: string[] = [];
  let status: EngineStatus = { state: 'idle', name: null, bootMs: null, error: null };

  return {
    calls,
    async initialize() {
      calls.push('initialize');
      if (behaviour.failOnInitialize !== undefined) {
        status = {
          state: 'failed',
          name: null,
          bootMs: null,
          error: { kind: 'load-failed', message: behaviour.failOnInitialize },
        };
        throw new Error(behaviour.failOnInitialize);
      }
      status = { state: 'ready', name: 'Fake Engine 1', bootMs: 12, error: null };
    },
    isReady: () => status.state === 'ready',
    async newGame() {
      calls.push('newGame');
    },
    async setPosition() {
      calls.push('setPosition');
    },
    async chooseMove(): Promise<EngineMove> {
      calls.push('chooseMove');
      if (behaviour.failOnMove !== undefined) throw new Error(behaviour.failOnMove);
      const uci = behaviour.illegalMove ?? moves.shift() ?? 'a1a2';
      return {
        uci,
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: null,
        ponder: null,
        elapsedMs: 5,
      };
    },
    async stop() {
      calls.push('stop');
    },
    async dispose() {
      calls.push('dispose');
      status = { ...status, state: 'disposed' };
    },
    getStatus: () => status,
    async setDifficulty() {
      calls.push('setDifficulty');
    },
  };
}

/**
 * Renders the screen and waits for the app provider to finish opening its
 * repository, which it does asynchronously — nothing is on screen until then.
 */
async function renderGame(engine: EngineService) {
  const onExit = vi.fn();
  const result = render(
    <AppProvider>
      <EngineGameScreen onExit={onExit} engineFactory={() => engine} />
    </AppProvider>,
  );
  await screen.findByTestId('engine-setup');
  return { onExit, ...result };
}

/** Plays a user move by tapping origin then destination. */
async function tapMove(
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  to: string,
): Promise<void> {
  await user.click(screen.getByTestId(`square-${from}`));
  await user.click(screen.getByTestId(`square-${to}`));
}

describe('setting a game up', () => {
  it('offers side, strength, board visibility and speech before starting', async () => {
    await renderGame(fakeEngine());
    await screen.findByTestId('engine-setup');

    for (const control of [
      'engine-side',
      'engine-difficulty',
      'engine-visibility',
      'engine-speak',
    ]) {
      expect(screen.getByTestId(control)).toBeInTheDocument();
    }
  });

  it('describes each strength in behaviour, never as a rating', async () => {
    await renderGame(fakeEngine());
    const detail = screen.getByTestId('engine-difficulty-detail').textContent ?? '';
    expect(detail.length).toBeGreaterThan(5);
    expect(detail).not.toMatch(/\b(elo|rated|rating|\d{3,4})\b/i);
  });

  it('does not start the engine until the game starts', async () => {
    const engine = fakeEngine();
    await renderGame(engine);
    await screen.findByTestId('engine-setup');
    expect(engine.calls).not.toContain('initialize');
  });
});

describe('playing a game', () => {
  it('starts the engine, plays a move, and gets a reply', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);

    // The default keeps only the latest move; this test is about the list.
    await user.click(screen.getByTestId('engine-history-full'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5'));

    expect(engine.calls).toContain('initialize');
    expect(engine.calls).toContain('newGame');
    expect(engine.calls).toContain('chooseMove');
  });

  it('rejects an illegal user move without handing the turn over', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e5');
    // With no moves played there is no list element at all, which is what
    // keeps a hidden history from leaving a blank strip behind.
    expect(screen.queryByTestId('engine-moves')).not.toBeInTheDocument();
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
  });

  it('lets the engine open when the user takes Black', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['d2d4'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-side-black'));
    await user.click(screen.getByTestId('engine-start'));

    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. d4'));
  });

  it('shows whose move it is and the moves played so far', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('e5'));
  });

  it('takes the pieces away without taking the move input away', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    /*
     * This test used to assert only that `.board-wrap--hidden` existed, which
     * is the *bug* rather than the behaviour: that class made the board
     * invisible while leaving its 64 buttons in place, so the screen said
     * "Your move" with nothing to press. It now asserts what the user needs.
     */
    expect(screen.getByTestId('board')).toHaveAttribute('data-display-mode', 'empty-input');
    expect(document.querySelectorAll('.square svg')).toHaveLength(0);
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
  });

  it('reports captured material', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['d7d5', 'd8d5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('d5'));
    await tapMove(user, 'e4', 'd5');

    await waitFor(() =>
      expect(screen.getByTestId('engine-captures')).toHaveTextContent(/You have taken 1/),
    );
  });

  it('lets the user resign, and says so plainly', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await user.click(screen.getByTestId('engine-resign'));

    expect(await screen.findByTestId('engine-result')).toHaveTextContent('You resigned');
  });
});

describe('when the engine misbehaves', () => {
  it('refuses an illegal engine move and stops the game rather than playing it', async () => {
    const user = userEvent.setup();
    // e7e5 is a legal move for Black, but the engine returns it out of turn.
    await renderGame(fakeEngine({ illegalMove: 'a1a8' }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    const result = await screen.findByTestId('engine-result');
    expect(result).toHaveTextContent(/not legal/i);
    // The user's own move survived; only the engine's was thrown out.
    expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4');
  });

  it('shows a stable, actionable message when the engine will not start', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ failOnInitialize: 'wasm failed to load' }));

    await user.click(screen.getByTestId('engine-start'));

    const error = await screen.findByTestId('engine-error');
    expect(error).toHaveTextContent('wasm failed to load');
    expect(error).toHaveTextContent(/every other mode is unaffected/i);
  });

  it('stops the game when the engine stops answering', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ failOnMove: 'the engine did not respond with a move in time' }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    expect(await screen.findByTestId('engine-error')).toHaveTextContent(/did not respond/);
  });

  it('disposes the engine when the screen goes away', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    const { unmount } = await renderGame(engine);

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    unmount();
    await waitFor(() => expect(engine.calls).toContain('dispose'));
  });
});

describe('failure recovery and background behaviour', () => {
  it('offers Try again and End game when the engine fails', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ failOnInitialize: 'wasm failed to load' }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-error');

    expect(screen.getByTestId('engine-retry')).toBeInTheDocument();
    expect(screen.getByTestId('engine-end')).toBeInTheDocument();
  });

  it('Try again returns to setup rather than resuming a game the engine lost', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ failOnInitialize: 'wasm failed to load' }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-error');
    await user.click(screen.getByTestId('engine-retry'));

    expect(await screen.findByTestId('engine-setup')).toBeInTheDocument();
  });

});

/* ------------------------------------------------------------------ *
 * Playing while actually blindfolded
 *
 * Reported from a real Android device: once the pieces disappear the screen
 * says "Your move" but there is no way to enter one. These tests play a real
 * game with the board hidden, which is the only way to catch that.
 * ------------------------------------------------------------------ */

/** Square controls the user can actually see and press. */
function usableSquares(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="square-"]')].filter(
    (square) => {
      if (square.closest('[aria-hidden="true"]') !== null) return false;
      if ((square as HTMLButtonElement).disabled) return true;
      const style = window.getComputedStyle(square);
      return style.visibility !== 'hidden' && style.display !== 'none';
    },
  );
}

function pieceCount(): number {
  return document.querySelectorAll('.square svg').length;
}

describe('playing with the board hidden', () => {
  it('still offers 64 usable squares once the pieces are gone', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    // No pieces — that is the point of the mode.
    expect(pieceCount()).toBe(0);
    // But the grid the user types moves on must still be there and usable.
    expect(usableSquares()).toHaveLength(64);
  });

  it('lets the user play a hidden move and get a reply', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-history-full'));
    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e4');

    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5'));
    expect(engine.calls).toContain('chooseMove');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'));
  });

  it('lets the user play a second hidden move', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5', 'b8c6'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'));

    await tapMove(user, 'g1', 'f3');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('2. Nf3'));
  });

  it('works as Black, after the engine has opened', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['d2d4', 'c2c4'] }));

    await user.click(screen.getByTestId('engine-side-black'));
    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));

    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. d4'));
    expect(usableSquares()).toHaveLength(64);

    await tapMove(user, 'd7', 'd5');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('d5'));
  });

  it('stays usable after the first-six-plies cutoff hides the board', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5', 'b8c6', 'g8f6'] }));

    await user.click(screen.getByTestId('engine-visibility-first-moves'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'));
    await tapMove(user, 'g1', 'f3');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'));
    await tapMove(user, 'f1', 'c4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('Bc4'));

    // Six plies played: the board is gone, and the grid must remain.
    await waitFor(() => expect(pieceCount()).toBe(0));
    expect(usableSquares()).toHaveLength(64);
  });

  it('recovers from an illegal hidden move', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await tapMove(user, 'e2', 'e5');
    // With no moves played there is no list element at all, which is what
    // keeps a hidden history from leaving a blank strip behind.
    expect(screen.queryByTestId('engine-moves')).not.toBeInTheDocument();
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');

    // Still playable afterwards.
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4'));
  });

  it('leaks nothing about the hidden position', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    // Square labels must not name the piece standing there.
    for (const square of usableSquares()) {
      const label = square.getAttribute('aria-label') ?? '';
      expect(label, label).not.toMatch(/pawn|knight|bishop|rook|queen|king/i);
    }

    // Selecting an origin must not light up its legal destinations.
    await user.click(screen.getByTestId('square-e2'));
    expect(document.querySelectorAll('.square--hint')).toHaveLength(0);
    expect(document.querySelectorAll('.hint-dot')).toHaveLength(0);
  });

  it('marks the selected origin, and cancels when tapped again', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    await user.click(screen.getByTestId('square-e2'));
    expect(document.querySelectorAll('.square--origin')).toHaveLength(1);

    await user.click(screen.getByTestId('square-e2'));
    expect(document.querySelectorAll('.square--origin')).toHaveLength(0);
  });
});


/* ------------------------------------------------------------------ *
 * Move cadence and emphasis
 *
 * Reported from a real Android device: "the computer replies so quickly that
 * I cannot perceive a move occurred". These prove the reply is held long
 * enough to notice, marked on the board, and stated in words.
 *
 * Real timers throughout. Fake timers cannot be used here: the app provider
 * opens its repository asynchronously, and freezing the clock during render
 * hangs it before the screen ever appears.
 * ------------------------------------------------------------------ */
describe('making the computer reply perceptible', () => {
  it('does not apply an instant engine reply instantly', async () => {
    const user = userEvent.setup();
    // The fake engine answers in microseconds, as a shallow search nearly does.
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    // The user's move is in; the computer is visibly thinking and has not yet
    // replied. This is the state the device report said was never visible.
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4'));
    expect(screen.getByTestId('engine-moves')).not.toHaveTextContent('e5');
    expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i);

    // And it lands only after the minimum presentation interval.
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('e5'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
  });

  it('holds the reply for at least the minimum interval', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    const started = Date.now();
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('e5'), {
      timeout: MIN_THINKING_MS * 4,
    });

    // Measured rather than assumed. A little slack for scheduling jitter.
    expect(Date.now() - started).toBeGreaterThanOrEqual(MIN_THINKING_MS - 100);
  });

  it('shows the user move on the board while the computer thinks', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(() =>
      expect(screen.getByTestId('square-e2').className).toContain('square--last-from'),
    );
    expect(screen.getByTestId('square-e4').className).toContain('square--last-to');
    expect(screen.getByTestId('engine-last-move')).toHaveTextContent('You played');
  });

  it('marks and announces the engine move once it lands', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    expect(screen.getByTestId('engine-last-move')).toHaveTextContent('e5');
    expect(screen.getByTestId('square-e7').className).toContain('square--last-from');
    expect(screen.getByTestId('square-e5').className).toContain('square--last-to');
  });

  it('marks the engine move on the hidden grid too, without drawing pieces', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(
      () => expect(screen.getByTestId('square-e5').className).toContain('square--last-to'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    // The marks are allowed — the user can read the move in SAN already. The
    // pieces are not.
    expect(document.querySelectorAll('.square svg')).toHaveLength(0);
  });

  it('refuses a second user move while the computer is thinking', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    await tapMove(user, 'd2', 'd4');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('e5'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(screen.getByTestId('engine-moves')).not.toHaveTextContent('d4');
  });

  it('never leaves "Computer thinking" up after the move lands', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(screen.getByTestId('engine-turn')).not.toHaveTextContent(/thinking/i);
  });

  it('drops a delayed reply belonging to a game the user has left', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    // Resign while the presentation delay is still running.
    await user.click(screen.getByTestId('engine-resign'));
    await new Promise((resolve) => setTimeout(resolve, MIN_THINKING_MS + 400));

    // The abandoned reply must not have been played onto the finished game.
    expect(screen.getByTestId('engine-result')).toHaveTextContent('You resigned');
    expect(screen.getByTestId('engine-moves')).not.toHaveTextContent('e5');
  });

  it('speaks both sides when spoken moves are on', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-speak-on'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );

    const said = speechCalls();
    expect(said).toContain('e4');
    expect(said).toContain('e5');
  });

  it('speaks nothing when spoken moves are off', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );

    expect(speechCalls()).toHaveLength(0);
  });

  it('does not speak an illegal attempt, which never became a move', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-speak-on'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e5');

    expect(speechCalls()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Backgrounding, history, and resuming
 * ------------------------------------------------------------------ */

/** Fires a visibility change, as Android does when the app is backgrounded. */
function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('backgrounding during the computer turn', () => {
  it('stops the search rather than leaving it running', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    setVisibility('hidden');
    await waitFor(() => expect(engine.calls).toContain('stop'));
  });

  it('does not strand the game in "Computer thinking" for ever', async () => {
    const user = userEvent.setup();
    // Two copies of the same reply: the abandoned turn consumes one from the
    // script, where real Stockfish would simply answer the unchanged position
    // again.
    await renderGame(fakeEngine({ moves: ['e7e5', 'e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    setVisibility('hidden');
    // The old handler stopped the search and left `thinking` true, so the game
    // came back with nothing running and no way to continue.
    await waitFor(() =>
      expect(screen.getByTestId('engine-turn')).not.toHaveTextContent(/thinking/i),
    );

    setVisibility('visible');
    await waitFor(
      () => expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move'),
      { timeout: MIN_THINKING_MS * 4 },
    );
  });

  it('plays exactly one computer move on return, never two', async () => {
    const user = userEvent.setup();
    // As above: the abandoned turn takes one entry from the script.
    const engine = fakeEngine({ moves: ['e7e5', 'e7e5', 'b8c6'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    setVisibility('hidden');
    setVisibility('visible');

    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 5 },
    );

    // One reply, not two: Black has moved once and it is White to play.
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
    expect(screen.getByTestId('engine-last-move')).toHaveTextContent('e5');
  });

  it('keeps the user move that was already made', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-history-full'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    setVisibility('hidden');
    setVisibility('visible');

    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4'), {
      timeout: MIN_THINKING_MS * 4,
    });
  });

  it('does nothing on return when it is the user to move', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    setVisibility('hidden');
    setVisibility('visible');

    // The engine was never asked for a move, because it did not owe one.
    expect(engine.calls.filter((call) => call === 'chooseMove')).toHaveLength(0);
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
  });
});

describe('the move-history setting', () => {
  it('shows only the latest move by default', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    // The reply is there; the user's own move has scrolled out of the list.
    const list = screen.getByTestId('engine-moves').textContent ?? '';
    expect(list).toContain('e5');
    expect(list).not.toContain('1. e4 ');
  });

  it('shows the whole score sheet on the full setting', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-history-full'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5'), {
      timeout: MIN_THINKING_MS * 4,
    });
  });

  it('renders no list at all when the history is hidden, and no blank gap', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-history-hidden'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');

    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );

    expect(screen.queryByTestId('engine-moves')).not.toBeInTheDocument();
    // The latest move is still perceivable, which is what keeps the game
    // playable with the history off.
    expect(screen.getByTestId('engine-last-move')).toHaveTextContent('e5');
  });

  it('reveals the history on request, and only on the setting that offers it', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-history-hidden-reveal'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );

    expect(screen.queryByTestId('engine-moves')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('engine-reveal-history'));
    expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5');
  });

  it('offers no reveal action on the plain hidden setting', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-history-hidden'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    expect(screen.queryByTestId('engine-reveal-history')).not.toBeInTheDocument();
  });
});

describe('resuming an unfinished game', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('offers a game left unfinished', async () => {
    const user = userEvent.setup();
    const first = await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );

    // Leaving used to discard the game silently.
    first.unmount();

    await renderGame(fakeEngine());
    expect(await screen.findByTestId('engine-resume')).toBeInTheDocument();
    expect(screen.getByTestId('engine-resume')).toHaveTextContent(/White, 1 move/i);
  });

  it('replays the moves back onto the board', async () => {
    const user = userEvent.setup();
    const first = await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-history-full'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    first.unmount();

    await renderGame(fakeEngine({ moves: ['b8c6'] }));
    await user.click(await screen.findByTestId('engine-resume-yes'));

    await screen.findByTestId('engine-game');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5'));
    // And it is playable: the user can carry on.
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
  });

  it('lets the user decline and start fresh, forgetting the save', async () => {
    const user = userEvent.setup();
    const first = await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    first.unmount();

    const second = await renderGame(fakeEngine());
    await user.click(await screen.findByTestId('engine-resume-no'));
    expect(screen.queryByTestId('engine-resume')).not.toBeInTheDocument();
    second.unmount();

    // And it is not offered again.
    await renderGame(fakeEngine());
    await screen.findByTestId('engine-setup');
    expect(screen.queryByTestId('engine-resume')).not.toBeInTheDocument();
  });

  it('offers nothing when there is no saved game', async () => {
    await renderGame(fakeEngine());
    await screen.findByTestId('engine-setup');
    expect(screen.queryByTestId('engine-resume')).not.toBeInTheDocument();
  });

  it('discards a corrupt save rather than trying to interpret it', async () => {
    window.localStorage.setItem(SAVED_GAME_KEY, '{"version":1,"moves":["not-a-move"]}');

    await renderGame(fakeEngine());
    await screen.findByTestId('engine-setup');
    expect(screen.queryByTestId('engine-resume')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SAVED_GAME_KEY)).toBeNull();
  });

  it('does not offer a finished game', async () => {
    const user = userEvent.setup();
    const first = await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(
      () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
      { timeout: MIN_THINKING_MS * 4 },
    );
    await user.click(screen.getByTestId('engine-resign'));
    await screen.findByTestId('engine-result');
    first.unmount();

    await renderGame(fakeEngine());
    await screen.findByTestId('engine-setup');
    expect(screen.queryByTestId('engine-resume')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Looking at the position on purpose
 *
 * Blindfold play is the point, but being stuck is not: a player who has lost
 * the thread needs a way to see where everything is and then carry on, without
 * abandoning the game or editing their settings. This is a *temporary* reveal,
 * so every test here also checks that the setting underneath is untouched.
 * ------------------------------------------------------------------ */

/** What the board says stands on a square, read the way a user would. */
function pieceAt(square: string): string {
  const label = screen.getByTestId(`square-${square}`).getAttribute('aria-label') ?? '';
  // "e4, white pawn" -> "white pawn"; a bare "e4" means empty.
  return label === square ? '' : label.slice(square.length + 2);
}

/** Starts a hidden game and plays 1. e4 e5, leaving it as the user's move. */
async function hiddenGameAfterOneMove(
  user: ReturnType<typeof userEvent.setup>,
  engine: ReturnType<typeof fakeEngine>,
): Promise<void> {
  await user.click(screen.getByTestId('engine-visibility-never'));
  await user.click(screen.getByTestId('engine-start'));
  await screen.findByTestId('engine-game');
  await tapMove(user, 'e2', 'e4');
  await waitFor(
    () => expect(screen.getByTestId('engine-last-move')).toHaveTextContent('Computer played'),
    { timeout: MIN_THINKING_MS * 4 },
  );
  expect(engine.calls).toContain('chooseMove');
}

describe('showing the pieces on purpose', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('offers no reveal while the pieces are already on the board', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine());

    await user.click(screen.getByTestId('engine-visibility-always'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    expect(pieceCount()).toBe(32);
    expect(screen.queryByTestId('engine-show-pieces')).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-hide-pieces')).not.toBeInTheDocument();
  });

  it('reveals the whole position, every piece on its own square', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);
    await hiddenGameAfterOneMove(user, engine);

    expect(pieceCount()).toBe(0);
    await user.click(screen.getByTestId('engine-show-pieces'));

    // Not "a board appeared" — the *right* board. Both pawns have moved, both
    // origin squares are empty, and the back ranks are untouched.
    expect(pieceCount()).toBe(32);
    expect(pieceAt('e4')).toBe('white pawn');
    expect(pieceAt('e5')).toBe('black pawn');
    expect(pieceAt('e2')).toBe('');
    expect(pieceAt('e7')).toBe('');
    expect(pieceAt('e1')).toBe('white king');
    expect(pieceAt('d8')).toBe('black queen');
    expect(pieceAt('b1')).toBe('white knight');
  });

  it('hides them again and gives the empty input grid back', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);
    await hiddenGameAfterOneMove(user, engine);

    await user.click(screen.getByTestId('engine-show-pieces'));
    expect(pieceCount()).toBe(32);

    await user.click(screen.getByTestId('engine-hide-pieces'));
    expect(pieceCount()).toBe(0);
    // The grid the user enters moves on must survive the round trip: this is
    // the exact failure a real device reported, and hiding by any other means
    // would reintroduce it.
    expect(screen.getByTestId('board')).toHaveAttribute('data-display-mode', 'empty-input');
    expect(usableSquares()).toHaveLength(64);
    expect(screen.getByTestId('engine-show-pieces')).toBeInTheDocument();
  });

  it('keeps the game intact across a reveal and a hide', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);
    await user.click(screen.getByTestId('engine-history-full'));
    await hiddenGameAfterOneMove(user, engine);

    const callsBefore = [...engine.calls];

    await user.click(screen.getByTestId('engine-show-pieces'));
    await user.click(screen.getByTestId('engine-hide-pieces'));

    // Same position, same move list, same side to move, and the engine was
    // neither asked for anything nor stopped.
    expect(screen.getByTestId('engine-moves')).toHaveTextContent('1. e4 e5');
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
    expect(screen.getByTestId('engine-last-move')).toHaveTextContent('e5');
    expect(engine.calls).toEqual(callsBefore);
  });

  it('lets the user carry on playing after hiding again', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5', 'b8c6'] });
    await renderGame(engine);
    await user.click(screen.getByTestId('engine-history-full'));
    await hiddenGameAfterOneMove(user, engine);

    await user.click(screen.getByTestId('engine-show-pieces'));
    await user.click(screen.getByTestId('engine-hide-pieces'));

    await tapMove(user, 'g1', 'f3');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('2. Nf3 Nc6'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(pieceCount()).toBe(0);
  });

  it('lets the user play while the pieces are revealed, and keeps them current', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5', 'b8c6'] });
    await renderGame(engine);
    await hiddenGameAfterOneMove(user, engine);

    await user.click(screen.getByTestId('engine-show-pieces'));
    await tapMove(user, 'g1', 'f3');

    await waitFor(() => expect(pieceAt('c6')).toBe('black knight'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(pieceAt('f3')).toBe('white knight');
    expect(pieceAt('g1')).toBe('');
    // Still a reveal, not a settings change.
    expect(screen.getByTestId('engine-hide-pieces')).toBeInTheDocument();
  });

  it('reveals while the computer is thinking, without disturbing the reply', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');
    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i));

    // Mid-search. The user's own move must be visible, and the reply must
    // still arrive: the reveal is render state and touches no turn token,
    // timer or search.
    await user.click(screen.getByTestId('engine-show-pieces'));
    expect(pieceAt('e4')).toBe('white pawn');
    expect(screen.getByTestId('engine-turn')).toHaveTextContent(/thinking/i);

    await waitFor(() => expect(pieceAt('e5')).toBe('black pawn'), {
      timeout: MIN_THINKING_MS * 4,
    });
    expect(screen.getByTestId('engine-turn')).toHaveTextContent('Your move');
    expect(engine.calls).not.toContain('stop');
  });

  it('works on "First 6 plies", which hides the board part-way through', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5', 'b8c6', 'g8f6'] });
    await renderGame(engine);

    // The default; stated explicitly because this test is about it.
    await user.click(screen.getByTestId('engine-visibility-first-moves'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    // Pieces are still on the board, so there is nothing to reveal yet.
    expect(pieceCount()).toBe(32);
    expect(screen.queryByTestId('engine-show-pieces')).not.toBeInTheDocument();

    await tapMove(user, 'e2', 'e4');
    await waitFor(() => expect(pieceAt('e5')).toBe('black pawn'), { timeout: MIN_THINKING_MS * 4 });
    await tapMove(user, 'g1', 'f3');
    await waitFor(() => expect(pieceAt('c6')).toBe('black knight'), { timeout: MIN_THINKING_MS * 4 });
    await tapMove(user, 'f1', 'c4');

    // Six plies: the board goes away on its own, and the control appears.
    await waitFor(() => expect(pieceCount()).toBe(0), { timeout: MIN_THINKING_MS * 4 });
    const reveal = await screen.findByTestId('engine-show-pieces');

    await user.click(reveal);
    expect(pieceAt('c4')).toBe('white bishop');
    expect(pieceAt('f6')).toBe('black knight');
    expect(pieceAt('f3')).toBe('white knight');
  });

  it('is a reveal, not a settings change: a resumed game comes back hidden', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    const first = await renderGame(engine);
    await hiddenGameAfterOneMove(user, engine);

    // Reveal and walk away without hiding again. If the reveal had been
    // written into the visibility setting, or saved, the game would come back
    // with the pieces on show and the blindfold quietly switched off.
    await user.click(screen.getByTestId('engine-show-pieces'));
    expect(pieceCount()).toBe(32);
    first.unmount();

    await renderGame(fakeEngine({ moves: ['b8c6'] }));
    await user.click(await screen.findByTestId('engine-resume-yes'));
    await screen.findByTestId('engine-game');

    expect(pieceCount()).toBe(0);
    expect(screen.getByTestId('board')).toHaveAttribute('data-display-mode', 'empty-input');
    expect(screen.getByTestId('engine-show-pieces')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-hide-pieces')).not.toBeInTheDocument();
  });

  it('reveals a resumed position correctly, and stays playable', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    const first = await renderGame(engine);
    await user.click(screen.getByTestId('engine-history-full'));
    await hiddenGameAfterOneMove(user, engine);
    first.unmount();

    await renderGame(fakeEngine({ moves: ['b8c6'] }));
    await user.click(await screen.findByTestId('engine-resume-yes'));
    await screen.findByTestId('engine-game');

    // The reveal must reflect the replayed position, not a fresh board.
    await user.click(screen.getByTestId('engine-show-pieces'));
    expect(pieceAt('e4')).toBe('white pawn');
    expect(pieceAt('e5')).toBe('black pawn');
    expect(pieceAt('e2')).toBe('');

    await user.click(screen.getByTestId('engine-hide-pieces'));
    await tapMove(user, 'g1', 'f3');
    await waitFor(() => expect(screen.getByTestId('engine-moves')).toHaveTextContent('Nf3'), {
      timeout: MIN_THINKING_MS * 4,
    });
  });

  it('keeps hidden-board discipline while the pieces are away', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ moves: ['e7e5'] });
    await renderGame(engine);
    await hiddenGameAfterOneMove(user, engine);

    await user.click(screen.getByTestId('engine-show-pieces'));
    await user.click(screen.getByTestId('engine-hide-pieces'));

    // After a round trip the hidden board must still give nothing away.
    for (const square of usableSquares()) {
      const label = square.getAttribute('aria-label') ?? '';
      expect(label, label).not.toMatch(/pawn|knight|bishop|rook|queen|king/i);
    }
    await user.click(screen.getByTestId('square-g1'));
    expect(document.querySelectorAll('.square--hint')).toHaveLength(0);
  });
});
