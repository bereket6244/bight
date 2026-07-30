/**
 * Haptic feedback.
 *
 * Prefers the Capacitor Haptics plugin on device and falls back to the web
 * Vibration API. Both are optional: with neither available the app is simply
 * silent, and visual feedback carries the whole load.
 */

export type HapticKind = 'light' | 'medium' | 'error';

interface HapticsPlugin {
  impact?: (options: { style: string }) => Promise<void>;
  notification?: (options: { type: string }) => Promise<void>;
}

/**
 * The plugin is kept inside a wrapper object rather than returned directly.
 *
 * Capacitor plugin objects are proxies that throw `UNIMPLEMENTED` for any
 * unknown property. Resolving a promise *with* one makes the JavaScript engine
 * probe it for `.then` to see whether it is thenable, which trips that proxy
 * and produces an unhandled rejection. Boxing it keeps the proxy off the
 * resolution path.
 */
let pluginBox: { plugin: HapticsPlugin | null } | null = null;

async function loadPlugin(): Promise<{ plugin: HapticsPlugin | null }> {
  if (pluginBox !== null) return pluginBox;
  try {
    const module = (await import('@capacitor/haptics')) as unknown as {
      Haptics?: HapticsPlugin;
    };
    pluginBox = { plugin: module.Haptics ?? null };
  } catch {
    pluginBox = { plugin: null };
  }
  return pluginBox;
}

const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  light: 12,
  medium: 25,
  error: [22, 40, 22],
};

export function vibrate(kind: HapticKind = 'light'): void {
  void (async () => {
    const { plugin } = await loadPlugin();
    if (plugin !== null) {
      try {
        if (kind === 'error' && plugin.notification !== undefined) {
          await plugin.notification({ type: 'ERROR' });
          return;
        }
        if (plugin.impact !== undefined) {
          await plugin.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
          return;
        }
      } catch {
        // Fall through to the web API.
      }
    }

    try {
      navigator.vibrate?.(WEB_PATTERNS[kind]);
    } catch {
      // No haptics available; nothing to do.
    }
  })();
}
