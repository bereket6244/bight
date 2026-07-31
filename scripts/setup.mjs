#!/usr/bin/env node
/**
 * One-command environment check and setup.
 *
 * Reports every missing prerequisite rather than failing on the first one, so
 * a new machine can be brought up in one pass instead of a guessing game.
 * Nothing here assumes a particular install location: the Android SDK is found
 * through the standard environment variables or the default per-OS path.
 *
 * Usage: npm run setup
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const notes = [];

function check(label, fn) {
  try {
    const result = fn();
    console.log(`  ok    ${label}${result ? ` — ${result}` : ''}`);
    return true;
  } catch (error) {
    console.log(`  MISS  ${label}`);
    problems.push(`${label}: ${error.message}`);
    return false;
  }
}

console.log('\nBight setup\n');
console.log('Prerequisites:');

check('Node 18.18+', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 18)) {
    throw new Error(`found ${process.versions.node}; Vite 5 and Capacitor 6 need 18.18+`);
  }
  // Node 20+ would allow upgrading Vite/Capacitor; recorded, not required.
  if (major < 20) notes.push('Node 20+ would allow upgrading to Vite 7 / Capacitor 7.');
  return `v${process.versions.node}`;
});

check('Java 17 or 21', () => {
  const javaHome = process.env.JAVA_HOME;
  const java = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
  const output = execSync(`"${java}" -version 2>&1`, { encoding: 'utf8', shell: true });
  const match = /version "(\d+)/.exec(output);
  const major = match ? Number(match[1]) : 0;
  if (major !== 17 && major !== 21) {
    throw new Error(`found Java ${major || 'unknown'}; the Android build needs 17 or 21`);
  }
  return `Java ${major}`;
});

check('Android SDK', () => {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);

  const sdk = candidates.find((dir) => existsSync(path.join(dir, 'platform-tools')));
  if (sdk === undefined) {
    throw new Error('set ANDROID_HOME, or install the SDK to the default location');
  }

  // Capacitor 6 compiles against SDK 34.
  const platform34 = existsSync(path.join(sdk, 'platforms', 'android-34'));
  if (!platform34) notes.push(`Android platform 34 is missing from ${sdk}; the Gradle build needs it.`);

  return sdk;
});

check('android/local.properties', () => {
  const file = path.join(root, 'android', 'local.properties');
  if (!existsSync(file)) {
    throw new Error('missing; create it with sdk.dir=<your Android SDK path>');
  }
  const contents = readFileSync(file, 'utf8');
  if (!/sdk\.dir=/.test(contents)) throw new Error('present but has no sdk.dir');
  return 'present (not committed, by design)';
});

console.log('\nDependencies:');
if (!existsSync(path.join(root, 'node_modules'))) {
  console.log('  installing…');
  execSync('npm ci', { cwd: root, stdio: 'inherit' });
} else {
  console.log('  ok    node_modules present');
}

console.log('\nOffline voice model (optional):');
const modelDir = path.join(root, 'public', 'models');
const hasModel =
  existsSync(path.join(modelDir, 'vosk-model-small-en-us-0.15.tar.gz')) ||
  existsSync(path.join(modelDir, 'vosk-model-small-en-us-0.15.tar'));

if (hasModel) {
  console.log('  ok    model present');
} else {
  console.log('  MISS  not downloaded — run: npm run fetch:voice-model');
  notes.push('Without the model, Settings reports voice as unavailable. Everything else works.');
}

console.log('\n' + '─'.repeat(60));
if (problems.length > 0) {
  console.log('Missing prerequisites:\n');
  for (const problem of problems) console.log(`  - ${problem}`);
}
if (notes.length > 0) {
  console.log(`${problems.length > 0 ? '\n' : ''}Notes:\n`);
  for (const note of notes) console.log(`  - ${note}`);
}
if (problems.length === 0) {
  console.log('Ready. Next: npm run verify, then npm run android:build');
}
console.log('─'.repeat(60) + '\n');

process.exitCode = problems.length > 0 ? 1 : 0;
