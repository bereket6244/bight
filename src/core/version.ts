/**
 * Single source of truth for the app version.
 *
 * `scripts/sync-version.mjs` propagates this to package.json and the Android
 * `versionName`/`versionCode`, and a test asserts they all agree — the first
 * two passes shipped major changes while every one of these still said 1.0.0,
 * and session records were stamped with a hard-coded literal besides.
 *
 * versionCode is derived as major*10000 + minor*100 + patch.
 */
export const APP_VERSION = '2.2.0';

/** Android versionCode, derived from APP_VERSION so the two cannot drift. */
export function androidVersionCode(version: string = APP_VERSION): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}

/** Android package identifier, documented in BUILD_STATUS.md. */
export const PACKAGE_ID = 'io.github.bereketgirma.bight';

export const APP_NAME = 'Bight';
export const APP_TAGLINE = 'Board sight';
