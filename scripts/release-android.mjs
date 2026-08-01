#!/usr/bin/env node
/**
 * One command from source to a *named* release artifact.
 *
 * The project used to ship `release/Bight.apk` and nothing else, which made
 * the download history ambiguous: an APK on disk told you nothing about which
 * version it was, whether it contained the engine, or what licence it was
 * distributed under. Every authoritative build now carries all three in its
 * filename:
 *
 *     Bight-v<version>-<licence>-<variant>.apk
 *
 * `release/Bight.apk` remains as a convenience copy and is written
 * byte-for-byte from the versioned file, so the two can never drift.
 *
 * Usage: node scripts/release-android.mjs [--release] [--force]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactName } from './releaseNaming.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const force = process.argv.includes('--force');


function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function run(command, args) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result;
}

// Importable for the filename tests without running a build.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = /APP_VERSION = '([^']+)'/.exec(
    readFileSync(path.join(root, 'src', 'core', 'version.ts'), 'utf8'),
  )?.[1];

  if (version === undefined) {
    console.error('Could not read APP_VERSION from src/core/version.ts');
    process.exit(1);
  }

  const target = path.join(releaseDir, artifactName(version));

  run('node', ['scripts/sync-version.mjs']);
  run('node', ['scripts/prepare-engine.mjs']);
  run('node', ['scripts/build-apk.mjs', ...(process.argv.includes('--release') ? ['--release'] : [])]);

  const built = path.join(releaseDir, 'Bight.apk');
  if (!existsSync(built)) {
    console.error('The build did not produce release/Bight.apk');
    process.exit(1);
  }

  const builtHash = sha256(built);

  /*
   * Refuse to quietly replace a *different* binary already published under
   * this version. Rebuilding the same bytes is fine; changing what a released
   * version means is not.
   */
  if (existsSync(target) && sha256(target) !== builtHash && !force) {
    console.error('');
    console.error(`${path.basename(target)} already exists with different contents.`);
    console.error('Bump the version, or pass --force if you really mean to replace it.');
    process.exit(1);
  }

  copyFileSync(built, target);
  writeFileSync(`${target}.sha256`, `${builtHash}  ${path.basename(target)}\n`);

  // The convenience copy is written from the versioned file, so they cannot
  // disagree even if the build is re-run.
  copyFileSync(target, built);

  const bytes = statSync(target).size;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const versionCode = /versionCode (\d+)/.exec(
    readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8'),
  )?.[1];

  const engineEntries = (() => {
    try {
      const out = execFileSync('node', ['scripts/inspect-apk.mjs', target], {
        cwd: root,
        encoding: 'utf8',
      });
      return /Engine:\s+(.+)/.exec(out)?.[1]?.trim() ?? 'unknown';
    } catch {
      return 'inspection failed';
    }
  })();

  console.log('');
  console.log('─'.repeat(64));
  console.log(`Version      ${version}`);
  console.log(`versionCode  ${versionCode ?? 'unknown'}`);
  console.log(`Package      io.github.bereketgirma.bight`);
  console.log(`Commit       ${commit}`);
  console.log(`Artifact     release/${path.basename(target)}`);
  console.log(`Convenience  release/Bight.apk (byte-identical)`);
  console.log(`Size         ${(bytes / 1048576).toFixed(2)} MB (${bytes} bytes)`);
  console.log(`SHA-256      ${builtHash}`);
  console.log(`Checksum     release/${path.basename(target)}.sha256`);
  console.log(`Engine       ${engineEntries}`);
  console.log(`Signing      debug (no production key exists for this project)`);
  console.log('─'.repeat(64));
  console.log('');
  console.log('Add this row to release/RELEASES.md:');
  console.log(
    `| ${version} | v${version.replace(/\./g, '.')}-gpl-engine | ${path.basename(target)} | \`${commit.slice(0, 7)}\` | ${(bytes / 1048576).toFixed(2)} MB | \`${builtHash}\` |`,
  );
}
