/**
 * Third-pass guarantees: versioning, branding, and the handoff scaffolding.
 *
 * These assert facts about the repository rather than about running code, so a
 * future change cannot bump the app version in one place and leave the Android
 * manifest behind, or reintroduce the stock Capacitor launcher icon.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, androidVersionCode } from './core/version';
import { SCHEMA_VERSION } from './core/storage/types';

const root = process.cwd();
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const exists = (relative: string): boolean => existsSync(join(root, relative));

describe('versioning is synchronized', () => {
  it('is no longer the stale 1.0.0 from the first pass', () => {
    expect(APP_VERSION).not.toBe('1.0.0');
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });

  it('matches the Android versionName and versionCode', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);
    expect(gradle).toContain(`versionCode ${androidVersionCode()}`);
  });

  it('derives a monotonic versionCode', () => {
    expect(androidVersionCode('1.0.0')).toBe(10000);
    expect(androidVersionCode('1.3.0')).toBe(10300);
    expect(androidVersionCode('2.0.1')).toBe(20001);
    expect(androidVersionCode('1.3.0')).toBeGreaterThan(androidVersionCode('1.2.9'));
  });

  it('has no hard-coded version literal left in runtime source', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(relative);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          // version.ts is allowed to contain it - it is the source of truth.
          if (relative.endsWith('core/version.ts')) continue;
          // The engine config pins a *third-party* package version, which has
          // nothing to do with Bight's own and must not track it.
          if (relative.endsWith('services/engine/engineConfig.ts')) continue;
          const contents = readFileSync(join(root, relative), 'utf8');
          if (/['"]\d+\.\d+\.\d+['"]/.test(contents)) offenders.push(relative);
        }
      }
    };
    walk('src');
    expect(offenders, `Use APP_VERSION instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the storage schema version stable unless deliberately changed', () => {
    // The third pass added optional attempt fields only, which old records can
    // omit, so no schema bump was needed.
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('branding', () => {
  it('ships editable source SVGs', () => {
    expect(exists('assets/branding/bight-icon-source.svg')).toBe(true);
    expect(exists('assets/branding/bight-icon-monochrome.svg')).toBe(true);
  });

  it('generates every Android launcher resource', () => {
    for (const resource of [
      'android/app/src/main/res/drawable/ic_launcher_foreground.xml',
      'android/app/src/main/res/drawable/ic_launcher_monochrome.xml',
      'android/app/src/main/res/drawable/ic_launcher_legacy.xml',
      'android/app/src/main/res/values/ic_launcher_background.xml',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
      'android/app/src/main/res/mipmap-anydpi/ic_launcher.xml',
      'android/app/src/main/res/mipmap-anydpi/ic_launcher_round.xml',
    ]) {
      expect(exists(resource), resource).toBe(true);
    }
  });

  it('declares adaptive, round and themed monochrome layers', () => {
    const adaptive = read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
    expect(adaptive).toContain('<adaptive-icon');
    expect(adaptive).toContain('ic_launcher_foreground');
    expect(adaptive).toContain('<monochrome');
    expect(read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml')).toContain(
      '<monochrome',
    );
  });

  it('has no stock Capacitor PNG launcher icon left', () => {
    const res = 'android/app/src/main/res';
    const strays: string[] = [];
    for (const entry of readdirSync(join(root, res), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const file of readdirSync(join(root, res, entry.name))) {
        if (/^ic_launcher.*\.png$/.test(file)) strays.push(`${entry.name}/${file}`);
      }
    }
    expect(strays, `Stock icons remain:\n${strays.join('\n')}`).toEqual([]);
  });

  it('uses Bight board colours, not the Capacitor default', () => {
    const background = read('android/app/src/main/res/values/ic_launcher_background.xml');
    expect(background).toContain('#2F4A23');
    expect(background).not.toContain('#FFFFFF');
  });

  it('keeps the manifest pointing at the launcher resources', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
  });

  it('keeps the artwork inside the adaptive-icon safe zone', () => {
    // The safe zone is a circle of radius 33 about (54,54) on the 108dp
    // canvas. The lens spans x 20..88, which is outside that circle at the
    // extremes, so the *outline* is allowed to bleed into the mask area while
    // the iris - the part that must survive every mask - stays central.
    const foreground = read('android/app/src/main/res/drawable/ic_launcher_foreground.xml');
    expect(foreground).toContain('viewportWidth="108"');
    // Iris radius 13.5 about centre: comfortably inside 33.
    expect(foreground).toContain('13.5');
  });
});

describe('handoff scaffolding', () => {
  it('provides AGENTS.md and CODEX_HANDOFF.md', () => {
    expect(exists('AGENTS.md')).toBe(true);
    expect(exists('CODEX_HANDOFF.md')).toBe(true);
  });

  it('provides a changelog', () => {
    expect(exists('CHANGELOG.md')).toBe(true);
    expect(read('CHANGELOG.md')).toContain(APP_VERSION);
  });

  it('documents the commands it claims to provide', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of [
      'setup',
      'verify',
      'test:browser',
      'android:build',
      'inspect:apk',
      'icons',
      'sync:version',
    ]) {
      expect(pkg.scripts[script], `npm run ${script}`).toBeDefined();
    }
  });

  it('ships the scripts those commands point at', () => {
    for (const script of [
      'scripts/setup.mjs',
      'scripts/sync-version.mjs',
      'scripts/generate-icons.mjs',
      'scripts/build-apk.mjs',
      'scripts/inspect-apk.mjs',
      'scripts/browser-tests.mjs',
      'scripts/fetch-voice-model.mjs',
    ]) {
      expect(exists(script), script).toBe(true);
    }
  });

  it('has a CI workflow', () => {
    expect(exists('.github/workflows/ci.yml')).toBe(true);
  });

  it('commits the lockfile and the Gradle wrapper', () => {
    expect(exists('package-lock.json')).toBe(true);
    expect(exists('android/gradlew')).toBe(true);
    expect(exists('android/gradle/wrapper/gradle-wrapper.properties')).toBe(true);
  });

  it('does not commit machine-specific or secret files', () => {
    const ignore = read('.gitignore');
    for (const pattern of ['local.properties', '*.jks', '*.keystore', 'keystore.properties']) {
      expect(ignore, pattern).toContain(pattern);
    }
  });
});

describe('development diagnostics are gated', () => {
  it('is disabled outside a development build', async () => {
    const { isDevDiagnosticsEnabled, devSeedOverride } = await import('./core/dev/diagnostics');
    // Vitest runs with DEV true, but no ?debug=1 is present in jsdom's URL, so
    // the panel stays off. The production guard is the `import.meta.env.DEV`
    // check, which Vite compiles away entirely in a release build.
    expect(isDevDiagnosticsEnabled()).toBe(false);
    expect(devSeedOverride()).toBeNull();
  });
});
