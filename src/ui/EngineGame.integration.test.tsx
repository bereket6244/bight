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
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EngineGameScreen } from './screens/EngineGameScreen';
import { AppProvider } from './state/AppContext';
import type { EngineMove, EngineService, EngineStatus } from '../services/engine';

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
    expect(screen.getByTestId('engine-moves').textContent?.trim()).toBe('');
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

  it('hides the board once the opening plies are past', async () => {
    const user = userEvent.setup();
    await renderGame(fakeEngine({ moves: ['e7e5'] }));

    await user.click(screen.getByTestId('engine-visibility-never'));
    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    expect(document.querySelector('.board-wrap--hidden')).not.toBeNull();
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

  it('stops the search when the app is backgrounded', async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    await renderGame(engine);

    await user.click(screen.getByTestId('engine-start'));
    await screen.findByTestId('engine-game');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(engine.calls).toContain('stop'));
  });
});
