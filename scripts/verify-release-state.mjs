#!/usr/bin/env node
/**
 * Guards against the release-management mistakes this project has actually
 * made, so CI fails instead of a user downloading something ambiguous.
 *
 * Each check corresponds to something that went wrong:
 *
 *  - `Bight.apk` was the only artifact, so its version was unknowable.
 *  - `Bight-engine.apk` was a byte-identical duplicate that added nothing.
 *  - BUILD_STATUS.md said 1.4.0 while the source said 2.0.0.
 *  - The release index and the APK on disk could disagree silently.
 *
 * Usage: npm run verify:release
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactName, isReleaseArtifactName } from './releaseNaming.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const problems = [];

const version = /APP_VERSION = '([^']+)'/.exec(
  readFileSync(path.join(root, 'src', 'core', 'version.ts'), 'utf8'),
)?.[1];

if (version === undefined) {
  console.error('Could not read APP_VERSION from src/core/version.ts');
  process.exit(1);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/* ---- The authoritative APK is named after the current version ---------- */
const expected = artifactName(version);
const expectedPath = path.join(releaseDir, expected);

if (!existsSync(expectedPath)) {
  problems.push(`release/${expected} is missing — run \`npm run release:android\`.`);
} else {
  /* ---- The convenience copy really is a copy --------------------------- */
  const convenience = path.join(releaseDir, 'Bight.apk');
  if (!existsSync(convenience)) {
    problems.push('release/Bight.apk is missing.');
  } else if (sha256(convenience) !== sha256(expectedPath)) {
    problems.push(
      `release/Bight.apk is not byte-identical to ${expected}. ` +
        'The convenience copy must never drift from the versioned build.',
    );
  }

  /* ---- The checksum file matches the binary ---------------------------- */
  const checksumFile = `${expectedPath}.sha256`;
  if (!existsSync(checksumFile)) {
    problems.push(`release/${expected}.sha256 is missing.`);
  } else if (!readFileSync(checksumFile, 'utf8').includes(sha256(expectedPath))) {
    problems.push(`release/${expected}.sha256 does not match the binary beside it.`);
  }
}

/* ---- No unversioned APKs other than the one convenience copy ----------- */
if (existsSync(releaseDir)) {
  for (const name of readdirSync(releaseDir).filter((n) => n.endsWith('.apk'))) {
    if (name === 'Bight.apk') continue;
    if (!isReleaseArtifactName(name)) {
      problems.push(
        `release/${name} is not a versioned artifact name. ` +
          'Every authoritative APK carries its version, licence and variant.',
      );
    }
  }

  /* ---- No byte-identical duplicates ----------------------------------- */
  const seen = new Map();
  for (const name of readdirSync(releaseDir).filter((n) => n.endsWith('.apk'))) {
    const hash = sha256(path.join(releaseDir, name));
    const previous = seen.get(hash);
    // Bight.apk is a deliberate copy of the current release; anything else is
    // duplicated binary data with no historical value.
    if (previous !== undefined && ![name, previous].includes('Bight.apk')) {
      problems.push(`release/${name} and release/${previous} are byte-identical duplicates.`);
    }
    seen.set(hash, name);
  }
}

/* ---- Documentation agrees with the source version ---------------------- */
for (const doc of ['BUILD_STATUS.md', 'release/RELEASES.md']) {
  const text = existsSync(path.join(root, doc)) ? readFileSync(path.join(root, doc), 'utf8') : null;
  if (text === null) {
    problems.push(`${doc} is missing.`);
    continue;
  }
  if (!text.includes(version)) {
    problems.push(`${doc} does not mention the current version ${version}.`);
  }
}

const buildStatus = readFileSync(path.join(root, 'BUILD_STATUS.md'), 'utf8');
if (existsSync(expectedPath) && !buildStatus.includes(sha256(expectedPath))) {
  problems.push('BUILD_STATUS.md does not carry the checksum of the current APK.');
}

console.log('');
console.log(`  version   ${version}`);
console.log(`  artifact  ${expected}${existsSync(expectedPath) ? '' : ' (MISSING)'}`);
if (existsSync(expectedPath)) {
  console.log(`  size      ${(statSync(expectedPath).size / 1048576).toFixed(2)} MB`);
  console.log(`  sha256    ${sha256(expectedPath)}`);
}
console.log('');

if (problems.length > 0) {
  console.error('Release state problems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('Release state checks passed.');
