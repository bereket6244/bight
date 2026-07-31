/**
 * Grading. One place decides whether an answer is right, for every mode.
 *
 * Multi-square answers report missed and wrongly-selected squares separately
 * so feedback can show the user both kinds of mistake.
 */

import { sortSquares } from '../chess/geometry';
import { forksFrom } from '../chess/fork';
import { isValidKnightRoute } from '../chess/knightRoute';
import { occupancyFromFen } from '../chess/position';
import { squareColor } from '../chess/square';
import type { SquareName } from '../chess/types';
import type { ExpectedAnswer, Grade, Question, SubmittedAnswer } from './types';

function describeSquares(squares: readonly SquareName[]): string {
  if (squares.length === 0) return 'none';
  return sortSquares(squares).join(', ');
}

/**
 * Grades a submitted answer against the expected one.
 *
 * A mismatch in answer kind is treated as incorrect rather than throwing: the
 * session must never crash because a mode and its answer control disagree.
 */
export function gradeAnswer(expected: ExpectedAnswer, submitted: SubmittedAnswer): Grade {
  if (expected.kind !== submitted.kind) {
    return {
      correct: false,
      missed: [],
      extra: [],
      explanation: 'No answer was recorded.',
    };
  }

  switch (expected.kind) {
    case 'single-square': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'single-square' }>).square;
      if (answer === null) {
        return { correct: false, missed: [expected.square], extra: [], explanation: 'No square was tapped.' };
      }
      // Fork problems often have several equally correct squares.
      const acceptable = [expected.square, ...(expected.alternatives ?? [])];
      const correct = acceptable.includes(answer);
      return {
        correct,
        missed: correct ? [] : [expected.square],
        extra: correct ? [] : [answer],
        explanation: correct
          ? `${answer} is correct.`
          : `That was ${answer}. The answer is ${describeSquares(acceptable)}.`,
      };
    }

    case 'coordinate': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'coordinate' }>).square;
      if (answer === null) {
        return { correct: false, missed: [expected.square], extra: [], explanation: 'No coordinate was entered.' };
      }
      const correct = answer === expected.square;
      return {
        correct,
        missed: correct ? [] : [expected.square],
        extra: correct ? [] : [answer],
        explanation: correct
          ? `${expected.square} is correct.`
          : `You answered ${answer}. The highlighted square is ${expected.square}.`,
      };
    }

    case 'square-set': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'square-set' }>).squares;
      const expectedSet = new Set(expected.squares);
      const answerSet = new Set(answer);
      const missed = sortSquares(expected.squares.filter((square) => !answerSet.has(square)));
      const extra = sortSquares(answer.filter((square) => !expectedSet.has(square)));
      const correct = missed.length === 0 && extra.length === 0;
      return {
        correct,
        missed,
        extra,
        explanation: correct
          ? `All ${expected.squares.length} squares correct.`
          : `Missed: ${describeSquares(missed)}. Wrongly selected: ${describeSquares(extra)}.`,
      };
    }

    case 'square-color': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'square-color' }>).color;
      if (answer === null) {
        return { correct: false, missed: [], extra: [], explanation: 'No colour was chosen.' };
      }
      const correct = answer === expected.color;
      return {
        correct,
        missed: [],
        extra: [],
        explanation: correct ? `Correct - ${expected.color}.` : `That square is ${expected.color}.`,
      };
    }

    case 'choice': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'choice' }>).choice;
      if (answer === null) {
        return { correct: false, missed: [], extra: [], explanation: 'No answer was chosen.' };
      }
      const correct = answer === expected.correct;
      return {
        correct,
        missed: [],
        extra: [],
        explanation: correct ? 'Correct.' : `The answer is ${expected.correct}.`,
      };
    }

    case 'piece-journey': {
      const path = (submitted as Extract<SubmittedAnswer, { kind: 'piece-journey' }>).path;
      if (path.length === 0) {
        return {
          correct: false,
          missed: expected.exampleRoute.slice(1),
          extra: [],
          explanation: `The ${expected.piece} never moved. One route is ${expected.exampleRoute.join(' - ')}.`,
        };
      }

      const landing = path[path.length - 1] as SquareName;
      const occupancy = occupancyFromFen(expected.fen);
      occupancy.delete(expected.from);
      const forks = forksFrom(
        { type: expected.piece, color: expected.color },
        landing,
        expected.targets,
        occupancy,
      );

      const moves = path.length;
      const optimal = moves <= expected.minMoves;

      return {
        correct: forks,
        missed: forks ? [] : expected.exampleRoute.slice(1),
        extra: [],
        // Taking the long way round is solved, not wrong. The session records
        // it separately rather than calling it a chess mistake.
        optimal: forks ? optimal : undefined,
        explanation: forks
          ? optimal
            ? `${landing} attacks both, in ${moves} move${moves === 1 ? '' : 's'}.`
            : `${landing} attacks both, but in ${moves} moves rather than ${expected.minMoves}.`
          : `The ${expected.piece} on ${landing} does not attack both targets yet.`,
      };
    }

    case 'square-path': {
      const answer = (submitted as Extract<SubmittedAnswer, { kind: 'square-path' }>).squares;
      if (answer.length === 0) {
        return {
          correct: false,
          missed: expected.exampleRoute.slice(1),
          extra: [],
          explanation: `No route was traced. One shortest route is ${expected.exampleRoute.join(' - ')}.`,
        };
      }

      // The origin is already on the board, so the user taps only the steps
      // after it. Rebuild the full path before validating.
      const fullPath = answer[0] === expected.from ? [...answer] : [expected.from, ...answer];
      const endsCorrectly = fullPath[fullPath.length - 1] === expected.to;
      const legal = isValidKnightRoute(fullPath);
      const moves = fullPath.length - 1;
      const shortEnough = !expected.requireShortest || moves === expected.shortestLength;
      const correct = legal && endsCorrectly && shortEnough;

      let explanation: string;
      if (correct) {
        explanation = `${fullPath.join(' - ')} in ${moves} move${moves === 1 ? '' : 's'}.`;
      } else if (!legal) {
        explanation = `That path contains a step that is not a knight move. One shortest route is ${expected.exampleRoute.join(' - ')}.`;
      } else if (!endsCorrectly) {
        explanation = `That route ends on ${fullPath[fullPath.length - 1]}, not ${expected.to}.`;
      } else {
        explanation = `That works but takes ${moves} moves; ${expected.shortestLength} is possible, for example ${expected.exampleRoute.join(' - ')}.`;
      }

      return { correct, missed: correct ? [] : expected.exampleRoute.slice(1), extra: [], explanation };
    }

    case 'move': {
      const answer = submitted as Extract<SubmittedAnswer, { kind: 'move' }>;
      if (answer.from === null || answer.to === null) {
        return { correct: false, missed: [expected.to], extra: [], explanation: 'No move was made.' };
      }
      const acceptableTargets = [expected.to, ...(expected.alternativeTargets ?? [])];
      const correct = answer.from === expected.from && acceptableTargets.includes(answer.to);
      return {
        correct,
        missed: correct ? [] : [expected.to],
        extra: correct ? [] : [answer.to],
        explanation: correct
          ? `${expected.from}-${answer.to} is correct.`
          : `You played ${answer.from}-${answer.to}. The answer is ${expected.from}-${expected.to}.`,
      };
    }
  }
}

export function gradeQuestion(question: Question, submitted: SubmittedAnswer): Grade {
  return gradeAnswer(question.expected, submitted);
}

/** An empty answer of the right shape, used when a timer expires. */
export function emptyAnswerFor(expected: ExpectedAnswer): SubmittedAnswer {
  switch (expected.kind) {
    case 'single-square':
      return { kind: 'single-square', square: null };
    case 'coordinate':
      return { kind: 'coordinate', square: null };
    case 'square-set':
      return { kind: 'square-set', squares: [] };
    case 'square-color':
      return { kind: 'square-color', color: null };
    case 'choice':
      return { kind: 'choice', choice: null };
    case 'move':
      return { kind: 'move', from: null, to: null };
    case 'square-path':
      return { kind: 'square-path', squares: [] };
    case 'piece-journey':
      return { kind: 'piece-journey', path: [] };
  }
}

/** Renders the expected answer for the end-of-session review. */
export function describeExpected(expected: ExpectedAnswer): string {
  switch (expected.kind) {
    case 'single-square':
      return expected.alternatives === undefined || expected.alternatives.length === 0
        ? expected.square
        : describeSquares([expected.square, ...expected.alternatives]);
    case 'coordinate':
      return expected.square;
    case 'square-set':
      return describeSquares(expected.squares);
    case 'square-color':
      return expected.color;
    case 'choice':
      return expected.correct;
    case 'move':
      return `${expected.from}-${expected.to}`;
    case 'square-path':
      return expected.exampleRoute.join(' - ');
    case 'piece-journey':
      return `${expected.exampleRoute.join(' - ')} (${expected.minMoves} moves)`;
  }
}

/** Renders a submitted answer for the review screen and stored history. */
export function describeSubmitted(submitted: SubmittedAnswer): string {
  switch (submitted.kind) {
    case 'single-square':
    case 'coordinate':
      return submitted.square ?? '(no answer)';
    case 'square-set':
      return submitted.squares.length === 0 ? '(no answer)' : describeSquares(submitted.squares);
    case 'square-color':
      return submitted.color ?? '(no answer)';
    case 'choice':
      return submitted.choice ?? '(no answer)';
    case 'move':
      return submitted.from === null || submitted.to === null
        ? '(no answer)'
        : `${submitted.from}-${submitted.to}`;
    case 'square-path':
      return submitted.squares.length === 0 ? '(no answer)' : submitted.squares.join(' - ');
    case 'piece-journey':
      return submitted.path.length === 0 ? '(no answer)' : submitted.path.join(' - ');
  }
}

/** Convenience used by the square-colour mode's voice and button input. */
export function colorOf(square: SquareName): 'light' | 'dark' {
  return squareColor(square);
}
