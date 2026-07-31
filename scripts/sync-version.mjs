#!/usr/bin/env node
/**
 * Propagates the single source of truth version to everywhere else.
 *
 * `src/core/version.ts` owns the number. This script writes it into
 * package.json and the Android `versionName`/`versionCode`. A test asserts
 * they all agree, so a version bump cannot half-land — which is what happened
 * across the first two passes, when every file still said 1.0.0 after major
 * changes.
 *
 * Usage: node scripts/sync-version.mjs [--check]
 *   --check exits non-zero on a mismatch instead of writing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, contents) {
  writeFileSync(path.join(root, relative), contents);
}

// The version literal in version.ts is the authority.
const versionSource = read('src/core/version.ts');
const match = /APP_VERSION\s*=\s*'([^']+)'/.exec(versionSource);
if (match === null) {
  console.error('Could not find APP_VERSION in src/core/version.ts');
  process.exit(1);
}
const version = match[1];
const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

const problems = [];

// package.json
const pkgPath = 'package.json';
const pkg = JSON.parse(read(pkgPath));
if (pkg.version !== version) {
  if (checkOnly) problems.push(`package.json is ${pkg.version}, expected ${version}`);
  else {
    pkg.version = version;
    write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

// Android build.gradle
const gradlePath = 'android/app/build.gradle';
let gradle = read(gradlePath);
const nameMatch = /versionName\s+"([^"]+)"/.exec(gradle);
const codeMatch = /versionCode\s+(\d+)/.exec(gradle);

if (nameMatch?.[1] !== version || Number(codeMatch?.[1]) !== versionCode) {
  if (checkOnly) {
    problems.push(
      `android versionName=${nameMatch?.[1]} versionCode=${codeMatch?.[1]}, ` +
        `expected ${version} / ${versionCode}`,
    );
  } else {
    gradle = gradle
      .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`)
      .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
    write(gradlePath, gradle);
  }
}

if (checkOnly) {
  if (problems.length > 0) {
    console.error(`Version mismatch (source of truth: ${version}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Versions agree: ${version} (versionCode ${versionCode})`);
} else {
  console.log(`Synced version ${version}, versionCode ${versionCode}`);
}
