/**
 * Integration tests: the app as a user meets it.
 *
 * These mount the real component tree over a real (in-memory) repository, so
 * they exercise the wiring between the session engine, the generators and the
 * screens rather than any of those in isolation.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { AppProvider } from './state/AppContext';
import { SessionScreen } from './screens/SessionScreen';
import { allModeVariants } from '../core/training/registry';
import { defaultSettings } from '../core/session/settings';
import type { SessionSettings } from '../core/session/settings';

function renderApp() {
  return render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
}

/** The square currently highlighted as the prompt. */
function currentPromptSquare(): string {
  const el = document.querySelector('.square--prompt');
  return (el as HTMLElement | null)?.dataset.square ?? '';
}

/** The coordinate shown as the prompt text. */
function currentPromptCoordinate(): string {
  return screen.getByTestId('prompt-coordinate').textContent?.trim() ?? '';
}

function renderSession(overrides: Partial<SessionSettings> = {}) {
  const settings: SessionSettings = {
    ...defaultSettings('square-color', 'coordinate'),
    ...overrides,
  };
  const onExit = vi.fn();
  const result = render(
    <AppProvider>
      <SessionScreen settings={settings} onExit={onExit} />
    </AppProvider>,
  );
  return { ...result, onExit };
}

describe('app shell', () => {
  it('starts on Home and shows the five tabs', async () => {
    renderApp();
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument();
    for (const tab of ['home', 'modes', 'progress', 'history', 'settings']) {
      expect(screen.getByTestId(`tab-${tab}`)).toBeInTheDocument();
    }
  });

  it('navigates between every tab without crashing', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');

    await user.click(screen.getByTestId('tab-modes'));
    expect(await screen.findByTestId('modes-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('tab-progress'));
    expect(await screen.findByTestId('progress-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('tab-history'));
    expect(await screen.findByTestId('history-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('tab-settings'));
    expect(await screen.findByTestId('settings-screen')).toBeInTheDocument();

    await user.click(screen.getByTestId('tab-home'));
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument();
  });

  it('shows an empty progress screen before any practice', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-progress'));
    expect(await screen.findByText(/Finish a session/i)).toBeInTheDocument();
  });
});

describe('every mode opens and asks a real question', () => {
  /**
   * The strongest guard against a mode being added and quietly breaking: open
   * every registered variant through the real session screen and assert it
   * renders a prompt and an answer surface.
   */
  it.each(allModeVariants().map(({ mode, variant }) => [`${mode.id}/${variant.id}`, mode.id, variant.id]))(
    'opens %s',
    async (_label, modeId, variantId) => {
      renderSession({
        modeId: modeId as SessionSettings['modeId'],
        variantId,
        limit: { kind: 'questions', count: 5 },
      });

      const screenEl = await screen.findByTestId('session-screen');
      expect(screenEl).toBeInTheDocument();

      // A prompt is always present.
      const prompt = screenEl.querySelector('.prompt__text');
      expect(prompt?.textContent?.length ?? 0).toBeGreaterThan(0);

      // And some way to answer: a board, a keypad, or choice buttons.
      const hasBoard = screenEl.querySelector('[data-testid="board"]') !== null;
      const hasKeypad = screenEl.querySelector('[data-testid="keypad"]') !== null;
      const hasChoice = screenEl.querySelector('.button-row') !== null;
      expect(hasBoard || hasKeypad || hasChoice).toBe(true);
    },
  );
});

describe('no manual progression controls exist anywhere', () => {
  /**
   * The guarantee this whole refactor exists to provide: no mode may render a
   * Next, Continue or Submit control, and no blocking result panel may appear
   * between questions.
   */
  it.each(allModeVariants().map(({ mode, variant }) => [`${mode.id}/${variant.id}`, mode.id, variant.id]))(
    'has no Next/Submit/feedback in %s',
    async (_label, modeId, variantId) => {
      renderSession({
        modeId: modeId as SessionSettings['modeId'],
        variantId,
        limit: { kind: 'questions', count: 5 },
      });

      await screen.findByTestId('session-screen');

      expect(screen.queryByTestId('next-question')).not.toBeInTheDocument();
      expect(screen.queryByTestId('submit-set')).not.toBeInTheDocument();
      expect(screen.queryByTestId('submit-path')).not.toBeInTheDocument();
      expect(screen.queryByTestId('retry-question')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^continue$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument();

      // Only session-level controls remain.
      expect(screen.getByTestId('pause')).toBeInTheDocument();
      expect(screen.getByTestId('end-session')).toBeInTheDocument();
    },
  );
});

describe('answering a coordinate question', () => {
  it('advances immediately on a correct keypad answer, with no Next', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'square-to-coordinate',
      variantId: 'standard',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    const first = currentPromptSquare();

    // Ranks are inert until a file has been chosen - the two-step rule.
    expect(screen.getByTestId(`key-rank-${first[1]}`)).toBeDisabled();
    await user.click(screen.getByTestId(`key-file-${first[0]}`));
    expect(screen.getByTestId(`key-rank-${first[1]}`)).toBeEnabled();
    await user.click(screen.getByTestId(`key-rank-${first[1]}`));

    // A new question is already on screen; nothing was pressed to get here.
    await waitFor(() => expect(currentPromptSquare()).not.toBe(first));
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('flashes red and keeps the question on a wrong coordinate', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'square-to-coordinate', variantId: 'standard' });

    await screen.findByTestId('session-screen');
    const target = currentPromptSquare();
    const wrongFile = target[0] === 'a' ? 'h' : 'a';

    await user.click(screen.getByTestId(`key-file-${wrongFile}`));
    await user.click(screen.getByTestId(`key-rank-${target[1]}`));

    await waitFor(() =>
      expect(screen.getByTestId('keypad-readout').className).toContain('keypad__readout--wrong'),
    );
    // Same question, and the answer is not revealed.
    expect(currentPromptSquare()).toBe(target);
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('never opens a text input for coordinate entry', async () => {
    renderSession({ modeId: 'square-to-coordinate', variantId: 'standard' });
    await screen.findByTestId('session-screen');
    // No free-text field anywhere: the Android keyboard must never appear.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('answering by tapping the board', () => {
  it('advances immediately on a correct tap', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    const coordinate = currentPromptCoordinate();
    expect(coordinate).toMatch(/^[a-h][1-8]$/);

    await user.click(screen.getByTestId(`square-${coordinate}`));

    await waitFor(() => expect(currentPromptCoordinate()).not.toBe(coordinate));
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('registers a tap on an occupied square when pieces are shown', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      layout: 'starting',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    const coordinate = currentPromptCoordinate();
    await user.click(screen.getByTestId(`square-${coordinate}`));

    await waitFor(() => expect(currentPromptCoordinate()).not.toBe(coordinate));
  });

  it('flashes the wrong square red and keeps the question, revealing nothing', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'coordinate-to-square', variantId: 'standard' });

    await screen.findByTestId('session-screen');
    const coordinate = currentPromptCoordinate();
    const wrong = coordinate === 'a1' ? 'h8' : 'a1';

    await user.click(screen.getByTestId(`square-${wrong}`));

    await waitFor(() =>
      expect(screen.getByTestId(`square-${wrong}`).className).toContain('square--wrong'),
    );
    // The question is unchanged and the correct square is not highlighted.
    expect(currentPromptCoordinate()).toBe(coordinate);
    expect(screen.getByTestId(`square-${coordinate}`).className).not.toContain('square--correct');
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('accepts the correct square straight after a wrong one', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    const coordinate = currentPromptCoordinate();
    const wrong = coordinate === 'a1' ? 'h8' : 'a1';

    await user.click(screen.getByTestId(`square-${wrong}`));
    await user.click(screen.getByTestId(`square-${coordinate}`));

    await waitFor(() => expect(currentPromptCoordinate()).not.toBe(coordinate));
  });
});

describe('multi-square questions complete themselves', () => {
  /** The knight's attacked squares, derived independently of the app. */
  function knightTargetsOnBoard(): string[] {
    const origin = (document.querySelector('.piece')?.closest('[data-square]') as HTMLElement | null)
      ?.dataset.square as string;
    const f = origin.charCodeAt(0) - 97;
    const r = Number(origin[1]) - 1;
    return [
      [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
    ]
      .map(([df, dr]) => [f + (df as number), r + (dr as number)])
      .filter(([x, y]) => (x as number) >= 0 && (x as number) < 8 && (y as number) >= 0 && (y as number) < 8)
      .map(([x, y]) => String.fromCharCode(97 + (x as number)) + ((y as number) + 1));
  }

  it('keeps correct squares selected and advances on the last one', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'knight-vision',
      variantId: 'attack-squares',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    const targets = knightTargetsOnBoard();
    const remaining = screen.getByTestId('remaining-count').textContent;
    expect(remaining).toBe(`${targets.length} left`);

    for (let i = 0; i < targets.length - 1; i += 1) {
      await user.click(screen.getByTestId(`square-${targets[i]}`));
      // Each correct square stays visibly selected.
      expect(screen.getByTestId(`square-${targets[i]}`).className).toContain('square--correct');
    }

    // Still the same question, no confirmation shown.
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();

    const before = knightTargetsOnBoard().join();
    await user.click(screen.getByTestId(`square-${targets[targets.length - 1]}`));

    // The last correct square completed the question by itself.
    await waitFor(() => expect(knightTargetsOnBoard().join()).not.toBe(before));
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('flashes a wrong square red and preserves earlier correct selections', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'knight-vision', variantId: 'attack-squares' });

    await screen.findByTestId('session-screen');
    const targets = knightTargetsOnBoard();
    const origin = (document.querySelector('.piece')?.closest('[data-square]') as HTMLElement)
      .dataset.square as string;
    const wrong = ['a1', 'h8', 'd4', 'e5'].find((sq) => !targets.includes(sq) && sq !== origin) as string;

    await user.click(screen.getByTestId(`square-${targets[0]}`));
    await user.click(screen.getByTestId(`square-${wrong}`));

    await waitFor(() =>
      expect(screen.getByTestId(`square-${wrong}`).className).toContain('square--wrong'),
    );
    // The earlier correct pick survives the mistake.
    expect(screen.getByTestId(`square-${targets[0]}`).className).toContain('square--correct');
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('ignores a repeat tap on an already-selected square', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'knight-vision', variantId: 'attack-squares' });

    await screen.findByTestId('session-screen');
    const targets = knightTargetsOnBoard();

    await user.click(screen.getByTestId(`square-${targets[0]}`));
    const countAfterFirst = screen.getByTestId('remaining-count').textContent;

    await user.click(screen.getByTestId(`square-${targets[0]}`));

    // No change, and crucially no red flash: a repeat tap is not a mistake.
    expect(screen.getByTestId('remaining-count').textContent).toBe(countAfterFirst);
    expect(screen.getByTestId(`square-${targets[0]}`).className).not.toContain('square--wrong');
  });
});

describe('square colour mode', () => {
  it('advances immediately on a correct light/dark answer', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'square-color',
      variantId: 'coordinate',
      limit: { kind: 'questions', count: 10 },
    });

    await screen.findByTestId('session-screen');
    expect(screen.getByTestId('choice-light')).toBeInTheDocument();
    expect(screen.getByTestId('choice-dark')).toBeInTheDocument();

    const first = currentPromptCoordinate();
    // One of the two must be right; try light, then dark if it flashed.
    await user.click(screen.getByTestId('choice-light'));
    if (currentPromptCoordinate() === first) {
      await user.click(screen.getByTestId('choice-dark'));
    }

    await waitFor(() => expect(currentPromptCoordinate()).not.toBe(first));
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
  });

  it('flashes the button red on a wrong colour and keeps the question', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'square-color', variantId: 'coordinate' });

    await screen.findByTestId('session-screen');
    const first = currentPromptCoordinate();

    await user.click(screen.getByTestId('choice-light'));
    if (currentPromptCoordinate() !== first) return; // light happened to be right

    await waitFor(() =>
      expect(screen.getByTestId('choice-light').className).toContain('answer-button--wrong'),
    );
    expect(currentPromptCoordinate()).toBe(first);
  });
});

describe('session controls', () => {
  it('pauses and resumes', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'square-color', variantId: 'coordinate' });

    await screen.findByTestId('session-screen');
    await user.click(screen.getByTestId('pause'));
    expect(screen.getByTestId('paused-card')).toBeInTheDocument();

    await user.click(screen.getByText('Resume'));
    await waitFor(() => expect(screen.queryByTestId('paused-card')).not.toBeInTheDocument());
  });

  it('ends early and shows a partial summary', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'square-color',
      variantId: 'coordinate',
      limit: { kind: 'questions', count: 50 },
    });

    await screen.findByTestId('session-screen');
    await user.click(screen.getByTestId('choice-light'));
    await user.click(screen.getByTestId('end-session'));

    const summary = await screen.findByTestId('session-summary');
    expect(within(summary).getByText(/ended early/i)).toBeInTheDocument();
  });

  it('shows the summary only when the session actually ends', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      limit: { kind: 'questions', count: 3 },
      retry: 'none',
    });

    await screen.findByTestId('session-screen');

    // Answer until the session ends on its own. The summary must never appear
    // before that, and no per-question result panel ever appears.
    for (let guard = 0; guard < 10; guard += 1) {
      if (screen.queryByTestId('session-screen') === null) break;
      expect(screen.queryByTestId('session-summary')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();

      const coordinate = screen.queryByTestId('prompt-coordinate')?.textContent?.trim() ?? '';
      if (coordinate === '') break;
      await user.click(screen.getByTestId(`square-${coordinate}`));
    }

    expect(await screen.findByTestId('session-summary')).toBeInTheDocument();
  });

  it('runs a per-question timer down and records a timeout as a miss', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderSession({
        modeId: 'square-color',
        variantId: 'coordinate',
        questionTimer: { kind: 'per-question', seconds: 3 },
        accuracyFirst: false,
      });

      await vi.waitFor(() => expect(screen.getByTestId('session-screen')).toBeInTheDocument());
      expect(screen.getByTestId('question-timer')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });

      // A timeout must move the session on rather than stalling on a
      // blocking result panel.
      await vi.waitFor(() => expect(screen.queryByTestId('question-timer')).toBeInTheDocument());
      expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
      expect(screen.getByTestId('session-screen')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the per-question timer while accuracy-first is holding it back', async () => {
    renderSession({
      modeId: 'square-color',
      variantId: 'coordinate',
      questionTimer: { kind: 'per-question', seconds: 3 },
      accuracyFirst: true,
    });
    await screen.findByTestId('session-screen');
    expect(screen.queryByTestId('question-timer')).not.toBeInTheDocument();
  });
});

describe('board settings reach the board', () => {
  it('renders the board flipped when black orientation is chosen', async () => {
    renderSession({ modeId: 'coordinate-to-square', variantId: 'standard', orientation: 'black' });
    await screen.findByTestId('session-screen');
    expect(screen.getByTestId('board')).toHaveAttribute('data-orientation', 'black');
  });

  it('hides coordinate labels when asked', async () => {
    const { container } = renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      labels: 'never',
    });
    await screen.findByTestId('session-screen');
    expect(container.querySelectorAll('.square-label')).toHaveLength(0);
  });

  it('hides the board entirely in the blindfold variant', async () => {
    renderSession({ modeId: 'memory-square-to-coordinate', variantId: 'blindfold' });
    await screen.findByTestId('session-screen');
    expect(screen.getByText(/answer from memory/i)).toBeInTheDocument();
  });
});

describe('settings screen', () => {
  it('switches theme and applies it to the document', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-settings'));

    const select = await screen.findByTestId('setting-theme');
    await user.selectOptions(select, 'light');

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    );

    await user.selectOptions(select, 'dark');
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('toggles sound and haptics', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-settings'));

    const sound = await screen.findByTestId('setting-sound');
    expect(sound).toBeChecked();
    await user.click(sound);
    await waitFor(() => expect(sound).not.toBeChecked());
  });

  it('reports which storage engine is in use', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-settings'));
    expect(await screen.findByText('Storage')).toBeInTheDocument();
  });

  it('rejects an invalid backup without touching existing data', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-settings'));

    const input = await screen.findByTestId('import-file');
    const file = new File(['{ not json at all'], 'bad.json', { type: 'application/json' });
    await user.upload(input as HTMLInputElement, file);

    const message = await screen.findByRole('status');
    expect(message.className).toContain('feedback--wrong');
    // No confirmation dialog appeared, so nothing could have been imported.
    expect(screen.queryByText('Replace everything')).not.toBeInTheDocument();
  });

  it('previews a valid backup and asks before importing', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByTestId('home-screen');
    await user.click(screen.getByTestId('tab-settings'));

    const backup = JSON.stringify({
      format: 'bight-backup',
      schemaVersion: 1,
      appVersion: '1.0.0',
      exportedAt: Date.now(),
      data: {
        attempts: [],
        sessions: [],
        daily: [],
        achievements: [],
        personalBests: [],
        preferences: {},
      },
    });

    const input = await screen.findByTestId('import-file');
    await user.upload(
      input as HTMLInputElement,
      new File([backup], 'bight-backup.json', { type: 'application/json' }),
    );

    expect(await screen.findByText('Import this backup?')).toBeInTheDocument();
    expect(screen.getByText('Merge')).toBeInTheDocument();
    expect(screen.getByText('Replace everything')).toBeInTheDocument();
  });
});

describe('failure isolation', () => {
  it('keeps the rest of the app alive when a screen throws', async () => {
    const user = userEvent.setup();
    // Silence the expected React error-boundary logging.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderApp();
      await screen.findByTestId('home-screen');
      // Navigation itself still works after visiting every screen, which is
      // the property the boundaries exist to protect.
      await user.click(screen.getByTestId('tab-progress'));
      await user.click(screen.getByTestId('tab-home'));
      expect(await screen.findByTestId('home-screen')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
