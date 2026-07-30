#!/usr/bin/env node
/**
 * Downloads the Vosk small English model for offline voice answers.
 *
 * The model is NOT committed to the repository: it is ~40 MB of binary that
 * would be cloned by everyone whether or not they want voice. This script
 * fetches it into public/models/, from where Vite copies it into the build and
 * Capacitor packages it into the APK - so the shipped app still recognises
 * speech with no network at all.
 *
 * Licence: vosk-model-small-en-us-0.15 is Apache-2.0, which permits
 * redistribution inside the APK. See THIRD_PARTY_NOTICES.md.
 *
 * Usage:  node scripts/fetch-voice-model.mjs
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MODEL_NAME = 'vosk-model-small-en-us-0.15';

/**
 * vosk-browser loads a tar.gz archive. The Alphacephei site publishes a .zip;
 * the vosk-browser project publishes the same model repacked as .tar.gz, which
 * is what we need, so that is the primary source.
 */
const SOURCES = [
  `https://ccoreilly.github.io/vosk-browser/models/${MODEL_NAME}.tar.gz`,
  `https://alphacephei.com/vosk/models/${MODEL_NAME}.tar.gz`,
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = path.join(root, 'public', 'models');
const targetFile = path.join(targetDir, `${MODEL_NAME}.tar.gz`);

async function alreadyPresent() {
  try {
    const info = await stat(targetFile);
    return info.size > 1_000_000;
  } catch {
    return false;
  }
}

async function download(url) {
  process.stdout.write(`Trying ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.body === null) throw new Error('Empty response body');

  await mkdir(targetDir, { recursive: true });
  await pipeline(response.body, createWriteStream(targetFile));

  const info = await stat(targetFile);
  if (info.size < 1_000_000) {
    await rm(targetFile, { force: true });
    throw new Error(`Downloaded file is only ${info.size} bytes`);
  }
  return info.size;
}

async function main() {
  if (await alreadyPresent()) {
    process.stdout.write(`Model already present at ${targetFile}\n`);
    return;
  }

  const failures = [];
  for (const url of SOURCES) {
    try {
      const size = await download(url);
      process.stdout.write(
        `Saved ${MODEL_NAME} (${(size / 1024 / 1024).toFixed(1)} MB) to ${targetFile}\n`,
      );
      return;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  process.stderr.write(
    `Could not fetch the voice model.\n${failures.join('\n')}\n\n` +
      'Voice answers will report as unavailable; every other mode is unaffected\n' +
      'and the two-tap coordinate keypad remains the primary input.\n',
  );
  process.exitCode = 1;
}

await main();
