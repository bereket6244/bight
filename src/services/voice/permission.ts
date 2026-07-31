/**
 * Microphone permission, written for the Android WebView lifecycle.
 *
 * `getUserMedia()` alone is not a reliable permission API inside a Capacitor
 * WebView. When the app does not yet hold Android's RECORD_AUDIO permission,
 * the call can reject *while the system dialog is still on screen*, so a grant
 * that arrives a second later is never seen. That is what made the reported
 * bug look like a denial immediately after the user tapped "While using this
 * app".
 *
 * The strategy here:
 *
 *  - query the Permissions API first, where the WebView supports it, because
 *    it answers without prompting;
 *  - only call `getUserMedia()` from an explicit user action;
 *  - if it rejects, re-query afterwards before believing the rejection;
 *  - re-check whenever the app returns to the foreground, which is exactly
 *    when a grant made in the system dialog becomes visible.
 */

export type PermissionOutcome = 'granted' | 'denied' | 'blocked' | 'unsupported';

/** How long to wait before re-checking a rejection that may have raced. */
const REJECTION_RECHECK_MS = 400;

interface PermissionStatusLike {
  state: 'granted' | 'denied' | 'prompt';
}

/**
 * Reads permission state without prompting.
 * Returns null when the browser cannot answer, which is common in WebViews.
 */
export async function queryMicrophonePermission(): Promise<PermissionOutcome | null> {
  try {
    const permissions = navigator.permissions;
    if (permissions?.query === undefined) return null;

    const status = (await permissions.query({
      name: 'microphone' as PermissionName,
    })) as unknown as PermissionStatusLike;

    switch (status.state) {
      case 'granted':
        return 'granted';
      case 'denied':
        // The Permissions API cannot distinguish "declined once" from
        // "blocked permanently"; the caller treats a queried denial as
        // blocked because a prompt would not appear again.
        return 'blocked';
      default:
        return null; // 'prompt' - nothing decided yet.
    }
  } catch {
    // Chrome on Android historically threw for the microphone descriptor.
    return null;
  }
}

/** True when the device exposes a microphone API at all. */
export function microphoneApiAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined;
  } catch {
    return false;
  }
}

/**
 * Opens a stream and closes it again, purely to establish permission.
 *
 * Returns the stream's tracks stopped, never leaving the microphone live —
 * the indicator staying on after a permission check is its own bug report.
 */
async function probeStream(): Promise<boolean> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  return true;
}

function classifyError(error: unknown): PermissionOutcome {
  const name = (error as { name?: string } | undefined)?.name ?? '';
  // NotAllowedError covers both "declined" and "blocked"; SecurityError is
  // raised when policy forbids it outright.
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'unsupported';
  return 'denied';
}

/**
 * Requests microphone access from an explicit user action.
 *
 * A rejection is re-checked against the Permissions API before it is believed,
 * because an Android WebView can reject while its dialog is still open.
 */
export async function requestMicrophone(): Promise<PermissionOutcome> {
  if (!microphoneApiAvailable()) return 'unsupported';

  try {
    await probeStream();
    return 'granted';
  } catch (error) {
    const initial = classifyError(error);

    // The race: the promise rejected but the user may have granted since.
    await new Promise((resolve) => setTimeout(resolve, REJECTION_RECHECK_MS));
    const queried = await queryMicrophonePermission();
    if (queried === 'granted') return 'granted';

    // A second attempt costs nothing when permission is already held, and
    // resolves the case where the first call raced the dialog.
    try {
      await probeStream();
      return 'granted';
    } catch (retryError) {
      const retry = classifyError(retryError);
      // Two refusals in a row, or a queried denial, means the dialog will not
      // appear again and only system settings can change it.
      if (queried === 'blocked') return 'blocked';
      return retry === 'blocked' ? 'blocked' : initial;
    }
  }
}

/**
 * Checks permission without prompting, for startup and app-resume
 * reconciliation.
 */
export async function checkMicrophoneSilently(): Promise<PermissionOutcome | null> {
  if (!microphoneApiAvailable()) return 'unsupported';
  return queryMicrophonePermission();
}
