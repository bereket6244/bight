/**
 * Voice capability state machine.
 *
 * ## Why this exists
 *
 * Reported from a real Android device: Settings showed "Voice answers"
 * already checked and the status "Ready — recognition runs on this device",
 * even though the microphone had never been requested. Turning it off and on
 * produced the Android permission dialog; granting "While using this app"
 * still produced "Voice answers need microphone permission", the switch
 * stayed off, and a message flashed at the bottom of the screen.
 *
 * Three separate faults caused that:
 *
 *  1. `checkVoiceAvailability()` reported `ready` when the *model* and
 *     *library* were present. It never consulted microphone permission, so
 *     "Ready" was a claim the app had not earned.
 *  2. The stored `voiceInput: true` preference was rendered directly as the
 *     checkbox state, so a preference saved on a previous install showed as
 *     enabled with no permission behind it.
 *  3. Permission was inferred from a single `getUserMedia()` call. Inside an
 *     Android WebView that call can reject while the system dialog is still
 *     up, so a grant arriving a moment later was never noticed — the app had
 *     already written `voiceInput: false`.
 *
 * This module keeps capability and permission as separate, explicit facts and
 * only reports `ready` once a stream has actually been opened.
 */

export type VoiceState =
  /** Looking for the model file. */
  | 'model-checking'
  /** No model in this build; voice cannot work at all. */
  | 'model-missing'
  /** The recognition library could not be loaded. */
  | 'library-missing'
  /** Model present, microphone never asked for. */
  | 'permission-not-requested'
  /** The system dialog is up. */
  | 'permission-requesting'
  /** Permission refused this time; asking again is allowed. */
  | 'permission-denied'
  /** Refused permanently, or blocked by policy. Only Settings can fix it. */
  | 'permission-blocked'
  /** Permission granted; the recognizer has not been proven yet. */
  | 'permission-granted'
  /** Loading the model into the recognizer. */
  | 'recognizer-loading'
  /** Model, library, permission and a real stream have all been verified. */
  | 'ready'
  /** Actively listening during a session. */
  | 'listening'
  /** The recognizer failed after starting. */
  | 'recognizer-error'
  /** No microphone API at all (a desktop browser without one, for example). */
  | 'unavailable';

export interface VoiceStatus {
  state: VoiceState;
  /** One short sentence, safe to show the user. */
  detail: string;
  /** Whether an explicit retry makes sense from here. */
  canRetry: boolean;
  /** Whether the only route forward is the OS app-settings screen. */
  needsAppSettings: boolean;
}

const STATUS: Record<VoiceState, Omit<VoiceStatus, 'state'>> = {
  'model-checking': {
    detail: 'Checking for the offline speech model…',
    canRetry: false,
    needsAppSettings: false,
  },
  'model-missing': {
    detail: 'This build does not include the offline speech model.',
    canRetry: false,
    needsAppSettings: false,
  },
  'library-missing': {
    detail: 'The speech recognition library is missing from this build.',
    canRetry: false,
    needsAppSettings: false,
  },
  'permission-not-requested': {
    detail: 'Microphone permission has not been requested yet.',
    canRetry: true,
    needsAppSettings: false,
  },
  'permission-requesting': {
    detail: 'Waiting for your answer to the microphone request…',
    canRetry: false,
    needsAppSettings: false,
  },
  'permission-denied': {
    detail: 'Microphone permission was declined. Voice answers stay off; touch input still works.',
    canRetry: true,
    needsAppSettings: false,
  },
  'permission-blocked': {
    detail: 'Microphone access is blocked for this app. Turn it on in system settings.',
    canRetry: false,
    needsAppSettings: true,
  },
  'permission-granted': {
    detail: 'Microphone allowed. Preparing the recognizer…',
    canRetry: false,
    needsAppSettings: false,
  },
  'recognizer-loading': {
    detail: 'Loading the speech model…',
    canRetry: false,
    needsAppSettings: false,
  },
  ready: {
    detail: 'Ready. Recognition runs on this device and nothing is sent anywhere.',
    canRetry: false,
    needsAppSettings: false,
  },
  listening: { detail: 'Listening…', canRetry: false, needsAppSettings: false },
  'recognizer-error': {
    detail: 'The recognizer stopped unexpectedly. Touch input still works.',
    canRetry: true,
    needsAppSettings: false,
  },
  unavailable: {
    detail: 'This device has no microphone available to the app.',
    canRetry: false,
    needsAppSettings: false,
  },
};

export function describeVoiceState(state: VoiceState): VoiceStatus {
  return { state, ...STATUS[state] };
}

/**
 * Whether voice answering can actually be used right now.
 *
 * Deliberately narrow: only `ready` and `listening` qualify. Having the model
 * is not enough, and neither is having permission — this is the check that the
 * old implementation was missing.
 */
export function isVoiceUsable(state: VoiceState): boolean {
  return state === 'ready' || state === 'listening';
}

/** Whether the user could still get to a usable state by acting. */
export function isVoiceRecoverable(state: VoiceState): boolean {
  return (
    state === 'permission-not-requested' ||
    state === 'permission-denied' ||
    state === 'permission-blocked' ||
    state === 'recognizer-error'
  );
}

/**
 * Reconciles a stored "the user wants voice" preference with reality.
 *
 * The preference records an intention; it never by itself means voice is on.
 * A checkbox rendered straight from the preference is what made the app claim
 * voice was enabled when no permission had ever been granted.
 */
export function effectiveVoiceEnabled(preference: boolean, state: VoiceState): boolean {
  return preference && isVoiceUsable(state);
}

/** Short label for the badge beside the Voice answers heading. */
export function voiceBadgeText(state: VoiceState): string {
  switch (state) {
    case 'model-checking':
    case 'permission-requesting':
    case 'recognizer-loading':
      return 'Checking';
    case 'ready':
    case 'listening':
      return 'Ready';
    case 'permission-not-requested':
      return 'Needs permission';
    case 'permission-denied':
      return 'Permission declined';
    case 'permission-blocked':
      return 'Blocked';
    case 'model-missing':
    case 'library-missing':
    case 'unavailable':
      return 'Unavailable';
    case 'permission-granted':
      return 'Preparing';
    case 'recognizer-error':
      return 'Error';
  }
}
