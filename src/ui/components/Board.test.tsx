import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Board, buildMarks } from './Board';
import { STARTING_FEN } from '../../core/chess/position';
import { ALL_SQUARES } from '../../core/chess/square';
import type { SquareName } from '../../core/chess/types';

const EMPTY = '8/8/8/8/8/8/8/8';
const STARTING = STARTING_FEN.split(' ')[0] as string;

describe('board rendering', () => {
  it('renders all 64 squares', () => {
    render(<Board fen={EMPTY} orientation="white" labels="always" />);
    for (const square of ALL_SQUARES) {
      expect(screen.getByTestId(`square-${square}`)).toBeInTheDocument();
    }
  });

  it('renders pieces from the FEN', () => {
    render(<Board fen={STARTING} orientation="white" labels="always" />);
    expect(screen.getByTestId('piece-e1')).toBeInTheDocument();
    expect(screen.getByTestId('piece-a8')).toBeInTheDocument();
    expect(screen.queryByTestId('piece-e4')).not.toBeInTheDocument();
  });

  it('survives a malformed FEN without crashing', () => {
    render(<Board fen="this is not a fen" orientation="white" labels="always" />);
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
  });

  it('labels squares for screen readers, including the piece', () => {
    render(<Board fen={STARTING} orientation="white" labels="always" />);
    expect(screen.getByLabelText('e4')).toBeInTheDocument();
    expect(screen.getByLabelText('e1, white king')).toBeInTheDocument();
  });
});

describe('orientation', () => {
  it('draws a8 first for white and h1 first for black', () => {
    const { rerender } = render(<Board fen={EMPTY} orientation="white" labels="always" />);
    let cells = screen.getAllByRole('gridcell');
    expect(cells[0]).toHaveAttribute('data-square', 'a8');
    expect(cells[63]).toHaveAttribute('data-square', 'h1');

    rerender(<Board fen={EMPTY} orientation="black" labels="always" />);
    cells = screen.getAllByRole('gridcell');
    expect(cells[0]).toHaveAttribute('data-square', 'h1');
    expect(cells[63]).toHaveAttribute('data-square', 'a8');
  });

  it('maps a tap to the same square in both orientations', async () => {
    const user = userEvent.setup();
    const onSquareTap = vi.fn();

    const { rerender } = render(
      <Board fen={EMPTY} orientation="white" labels="always" onSquareTap={onSquareTap} />,
    );
    await user.click(screen.getByTestId('square-c6'));
    expect(onSquareTap).toHaveBeenLastCalledWith('c6');

    rerender(<Board fen={EMPTY} orientation="black" labels="always" onSquareTap={onSquareTap} />);
    await user.click(screen.getByTestId('square-c6'));
    expect(onSquareTap).toHaveBeenLastCalledWith('c6');
    expect(onSquareTap).toHaveBeenCalledTimes(2);
  });

  it('keeps all 64 squares present when flipped', () => {
    render(<Board fen={STARTING} orientation="black" labels="always" />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    expect(screen.getByTestId('piece-e1')).toBeInTheDocument();
  });
});

describe('labels', () => {
  it('shows file and rank labels when set to always', () => {
    const { container } = render(<Board fen={EMPTY} orientation="white" labels="always" />);
    expect(container.querySelectorAll('.square-label--file')).toHaveLength(8);
    expect(container.querySelectorAll('.square-label--rank')).toHaveLength(8);
  });

  it('hides labels when set to never', () => {
    const { container } = render(<Board fen={EMPTY} orientation="white" labels="never" />);
    expect(container.querySelectorAll('.square-label')).toHaveLength(0);
  });
});

describe('tapping squares', () => {
  it('registers a tap on an empty square', async () => {
    const user = userEvent.setup();
    const onSquareTap = vi.fn();
    render(<Board fen={EMPTY} orientation="white" labels="always" onSquareTap={onSquareTap} />);

    await user.click(screen.getByTestId('square-f6'));
    expect(onSquareTap).toHaveBeenCalledWith('f6');
  });

  /**
   * The spec calls this out explicitly: in coordinate mode a decorative piece
   * must not swallow the tap on the square beneath it.
   */
  it('registers a tap on a square occupied by a decorative piece', async () => {
    const user = userEvent.setup();
    const onSquareTap = vi.fn();
    render(
      <Board
        fen={STARTING}
        orientation="white"
        labels="always"
        decorativePieces
        onSquareTap={onSquareTap}
      />,
    );

    await user.click(screen.getByTestId('piece-e1'));
    expect(onSquareTap).toHaveBeenCalledWith('e1');
  });

  it('registers taps on every occupied square of a full board', async () => {
    const user = userEvent.setup();
    const onSquareTap = vi.fn();
    render(
      <Board
        fen={STARTING}
        orientation="white"
        labels="always"
        decorativePieces
        onSquareTap={onSquareTap}
      />,
    );

    for (const square of ['a1', 'd8', 'h2', 'e7'] as SquareName[]) {
      await user.click(screen.getByTestId(`square-${square}`));
      expect(onSquareTap).toHaveBeenLastCalledWith(square);
    }
  });

  it('does not fire taps when disabled', async () => {
    const user = userEvent.setup();
    const onSquareTap = vi.fn();
    render(
      <Board fen={EMPTY} orientation="white" labels="always" disabled onSquareTap={onSquareTap} />,
    );

    await user.click(screen.getByTestId('square-f6'));
    expect(onSquareTap).not.toHaveBeenCalled();
  });
});

describe('marks', () => {
  it('applies a class per mark type', () => {
    const marks = buildMarks({
      prompt: ['a1'],
      selected: ['b2'],
      correct: ['c3'],
      wrong: ['d4'],
      missed: ['e5'],
      hints: ['f6'],
    });
    render(<Board fen={EMPTY} orientation="white" labels="always" marks={marks} />);

    expect(screen.getByTestId('square-a1').className).toContain('square--prompt');
    expect(screen.getByTestId('square-b2').className).toContain('square--selected');
    expect(screen.getByTestId('square-c3').className).toContain('square--correct');
    expect(screen.getByTestId('square-d4').className).toContain('square--wrong');
    expect(screen.getByTestId('square-e5').className).toContain('square--missed');
    expect(screen.getByTestId('square-f6').className).toContain('square--hint');
  });

  it('exposes selection state to assistive technology', () => {
    render(
      <Board
        fen={EMPTY}
        orientation="white"
        labels="always"
        marks={buildMarks({ selected: ['b2'] })}
      />,
    );
    expect(screen.getByTestId('square-b2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets feedback marks win over selection', () => {
    const marks = buildMarks({ selected: ['a1'], wrong: ['a1'] });
    render(<Board fen={EMPTY} orientation="white" labels="always" marks={marks} />);
    expect(screen.getByTestId('square-a1').className).toContain('square--wrong');
  });

  it('renders ordinal badges for route tracing', () => {
    const badges = new Map<SquareName, number>([
      ['b3', 1],
      ['d4', 2],
    ]);
    render(<Board fen={EMPTY} orientation="white" labels="always" badges={badges} />);
    expect(screen.getByTestId('square-b3')).toHaveTextContent('1');
    expect(screen.getByTestId('square-d4')).toHaveTextContent('2');
  });
});

describe('timed reveal', () => {
  it('hides prompt marks after the reveal window', () => {
    vi.useFakeTimers();
    try {
      const marks = buildMarks({ prompt: ['e4'] });
      render(
        <Board fen={EMPTY} orientation="white" labels="always" marks={marks} revealMs={500} />,
      );

      expect(screen.getByTestId('square-e4').className).toContain('square--prompt');
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByTestId('square-e4').className).not.toContain('square--prompt');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps prompt marks when no reveal window is set', () => {
    vi.useFakeTimers();
    try {
      const marks = buildMarks({ prompt: ['e4'] });
      render(<Board fen={EMPTY} orientation="white" labels="always" marks={marks} />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByTestId('square-e4').className).toContain('square--prompt');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hide answer feedback marks', () => {
    vi.useFakeTimers();
    try {
      const marks = buildMarks({ prompt: ['e4'], correct: ['d5'] });
      render(
        <Board fen={EMPTY} orientation="white" labels="always" marks={marks} revealMs={300} />,
      );
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByTestId('square-d5').className).toContain('square--correct');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('hidden board', () => {
  it('renders no pieces and shows a note', () => {
    render(<Board fen={STARTING} orientation="white" labels="always" hidden />);
    expect(screen.queryByTestId('piece-e1')).not.toBeInTheDocument();
    expect(screen.getByText(/answer from memory/i)).toBeInTheDocument();
  });
});

describe('moving pieces', () => {
  const fen = '8/8/8/8/3N4/8/8/8';

  it('moves by tapping the piece and then the destination', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <Board
        fen={fen}
        orientation="white"
        labels="always"
        onMove={onMove}
        movableSquares={['d4']}
      />,
    );

    await user.click(screen.getByTestId('square-d4'));
    expect(screen.getByTestId('square-d4').className).toContain('square--origin');

    await user.click(screen.getByTestId('square-e6'));
    expect(onMove).toHaveBeenCalledWith('d4', 'e6');
  });

  it('puts the piece back down when tapped twice', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <Board fen={fen} orientation="white" labels="always" onMove={onMove} movableSquares={['d4']} />,
    );

    await user.click(screen.getByTestId('square-d4'));
    await user.click(screen.getByTestId('square-d4'));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId('square-d4').className).not.toContain('square--origin');
  });

  it('ignores a first tap on a square with nothing movable', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <Board fen={fen} orientation="white" labels="always" onMove={onMove} movableSquares={['d4']} />,
    );

    await user.click(screen.getByTestId('square-a1'));
    await user.click(screen.getByTestId('square-b2'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('marks the movable piece as draggable', () => {
    render(
      <Board fen={fen} orientation="white" labels="always" onMove={vi.fn()} movableSquares={['d4']} />,
    );
    expect(screen.getByTestId('piece-d4')).toHaveAttribute('draggable', 'true');
  });

  it('clears a half-finished selection when the position changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Board fen={fen} orientation="white" labels="always" onMove={vi.fn()} movableSquares={['d4']} />,
    );

    await user.click(screen.getByTestId('square-d4'));
    expect(screen.getByTestId('square-d4').className).toContain('square--origin');

    rerender(
      <Board
        fen="8/8/8/8/8/8/3N4/8"
        orientation="white"
        labels="always"
        onMove={vi.fn()}
        movableSquares={['d2']}
      />,
    );
    expect(screen.getByTestId('square-d4').className).not.toContain('square--origin');
  });
});
