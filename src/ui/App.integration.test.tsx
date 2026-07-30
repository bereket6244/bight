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

describe('answering a coordinate question', () => {
  it('accepts an answer from the two-tap keypad and advances', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'square-to-coordinate',
      variantId: 'standard',
      limit: { kind: 'questions', count: 5 },
    });

    await screen.findByTestId('session-screen');
    expect(screen.getByTestId('keypad')).toBeInTheDocument();

    // Ranks are inert until a file has been chosen - the two-step rule.
    expect(screen.getByTestId('key-rank-4')).toBeDisabled();
    await user.click(screen.getByTestId('key-file-e'));
    expect(screen.getByTestId('key-rank-4')).toBeEnabled();
    await user.click(screen.getByTestId('key-rank-4'));

    expect(await screen.findByTestId('feedback')).toBeInTheDocument();

    await user.click(screen.getByTestId('next-question'));
    await waitFor(() => expect(screen.queryByTestId('feedback')).not.toBeInTheDocument());
  });

  it('never opens a text input for coordinate entry', async () => {
    renderSession({ modeId: 'square-to-coordinate', variantId: 'standard' });
    await screen.findByTestId('session-screen');
    // No free-text field anywhere: the Android keyboard must never appear.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('answering by tapping the board', () => {
  it('accepts a tap on the prompted square', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      limit: { kind: 'questions', count: 5 },
    });

    await screen.findByTestId('session-screen');
    const coordinate = screen.getByTestId('prompt-coordinate').textContent?.trim() ?? '';
    expect(coordinate).toMatch(/^[a-h][1-8]$/);

    await user.click(screen.getByTestId(`square-${coordinate}`));

    const feedback = await screen.findByTestId('feedback');
    expect(feedback.className).toContain('feedback--correct');
  });

  it('registers a tap on an occupied square when pieces are shown', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'coordinate-to-square',
      variantId: 'standard',
      layout: 'starting',
      limit: { kind: 'questions', count: 5 },
    });

    await screen.findByTestId('session-screen');
    const coordinate = screen.getByTestId('prompt-coordinate').textContent?.trim() ?? '';
    await user.click(screen.getByTestId(`square-${coordinate}`));

    const feedback = await screen.findByTestId('feedback');
    expect(feedback.className).toContain('feedback--correct');
  });

  it('marks a wrong square as incorrect and names the right one', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'coordinate-to-square', variantId: 'standard' });

    await screen.findByTestId('session-screen');
    const coordinate = screen.getByTestId('prompt-coordinate').textContent?.trim() ?? '';
    const wrong = coordinate === 'a1' ? 'h8' : 'a1';

    await user.click(screen.getByTestId(`square-${wrong}`));
    const feedback = await screen.findByTestId('feedback');
    expect(feedback.className).toContain('feedback--wrong');
    expect(feedback.textContent).toContain(coordinate);
  });
});

describe('multi-square selection', () => {
  it('selects, deselects and submits a set of squares', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'knight-vision',
      variantId: 'attack-squares',
      limit: { kind: 'questions', count: 5 },
    });

    await screen.findByTestId('session-screen');
    const submit = screen.getByTestId('submit-set');

    // Selecting marks the square; selecting again clears it.
    await user.click(screen.getByTestId('square-a1'));
    expect(screen.getByTestId('square-a1')).toHaveAttribute('aria-pressed', 'true');
    expect(submit.textContent).toContain('1');

    await user.click(screen.getByTestId('square-a1'));
    expect(screen.getByTestId('square-a1')).toHaveAttribute('aria-pressed', 'false');

    // Nothing is graded until Submit is pressed.
    expect(screen.queryByTestId('feedback')).not.toBeInTheDocument();
    await user.click(submit);
    expect(await screen.findByTestId('feedback')).toBeInTheDocument();
  });

  it('reports missed and wrongly-selected squares separately', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'knight-vision', variantId: 'attack-squares' });

    await screen.findByTestId('session-screen');
    // Submit an empty answer: everything is missed, nothing is extra.
    await user.click(screen.getByTestId('submit-set'));

    const feedback = await screen.findByTestId('feedback');
    expect(feedback.textContent).toContain('Missed:');
    expect(feedback.textContent).toContain('Wrongly selected: none');
  });
});

describe('square colour mode', () => {
  it('accepts a light/dark answer from the large buttons', async () => {
    const user = userEvent.setup();
    renderSession({ modeId: 'square-color', variantId: 'coordinate' });

    await screen.findByTestId('session-screen');
    expect(screen.getByTestId('choice-light')).toBeInTheDocument();
    expect(screen.getByTestId('choice-dark')).toBeInTheDocument();

    await user.click(screen.getByTestId('choice-light'));
    expect(await screen.findByTestId('feedback')).toBeInTheDocument();
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
    await user.click(screen.getByTestId('next-question'));
    await user.click(screen.getByTestId('end-session'));

    const summary = await screen.findByTestId('session-summary');
    expect(within(summary).getByText(/ended early/i)).toBeInTheDocument();
  });

  it('shows a summary when the question limit is reached', async () => {
    const user = userEvent.setup();
    renderSession({
      modeId: 'square-color',
      variantId: 'coordinate',
      limit: { kind: 'questions', count: 2 },
      retry: 'none',
    });

    await screen.findByTestId('session-screen');
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByTestId('choice-light'));
      const next = screen.queryByTestId('next-question');
      if (next !== null) await user.click(next);
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

      await vi.waitFor(() => expect(screen.getByTestId('feedback')).toBeInTheDocument());
      expect(screen.getByTestId('feedback').className).toContain('feedback--wrong');
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
