/**
 * The release artifact naming rule.
 *
 * An APK on disk used to be called `Bight.apk` and nothing else, which told a
 * user nothing about which version it was, whether it contained the engine, or
 * what licence it was under. These tests pin the format so that cannot come
 * back silently.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactName, isReleaseArtifactName } from '../scripts/releaseNaming.mjs';
import { APP_VERSION } from './core/version';

describe('release artifact names', () => {
  it('carries version, licence and variant', () => {
    expect(artifactName('2.1.0', 'GPL', 'engine')).toBe('Bight-v2.1.0-GPL-engine.apk');
    expect(artifactName('1.4.0', 'MIT', 'blindfold')).toBe('Bight-v1.4.0-MIT-blindfold.apk');
  });

  it('always contains the version it was built from', () => {
    expect(artifactName(APP_VERSION)).toContain(APP_VERSION);
  });

  it('recognises its own names, and rejects unversioned ones', () => {
    expect(isReleaseArtifactName(artifactName(APP_VERSION))).toBe(true);
    // The old scheme: no version, no licence, no variant.
    expect(isReleaseArtifactName('Bight.apk')).toBe(false);
    expect(isReleaseArtifactName('Bight-engine.apk')).toBe(false);
    expect(isReleaseArtifactName('Bight-blindfold-checkpoint.apk')).toBe(false);
  });

  it('matches the documented pattern', () => {
    const pattern = /^Bight-v\d+\.\d+\.\d+-(MIT|GPL)-[a-z-]+\.apk$/;
    expect(artifactName(APP_VERSION)).toMatch(pattern);
    expect(artifactName('10.20.30', 'MIT', 'engine-free')).toMatch(pattern);
  });

  it('names the current version, so a stale artifact cannot pass as current', () => {
    // The authoritative APK must be the one for the version in source.
    expect(artifactName(APP_VERSION)).toBe(`Bight-v${APP_VERSION}-GPL-engine.apk`);
  });
});

describe('the release index agrees with the source version', () => {
  // A plain path: vitest runs from the project root, and jsdom's URL is not
  // the URL that node:fs accepts.
  const releases = readFileSync(join(process.cwd(), 'release', 'RELEASES.md'), 'utf8');

  it('lists the current version', () => {
    expect(releases).toContain(APP_VERSION);
  });

  it('lists the artifact the build actually produces', () => {
    expect(releases).toContain(artifactName(APP_VERSION));
  });
});
