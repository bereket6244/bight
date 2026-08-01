#!/usr/bin/env node
/**
 * Copies the Stockfish engine assets out of node_modules into public/engine/.
 *
 * From there Vite copies them into `dist`, and Capacitor packages them into the
 * APK, so the shipped app runs the engine with no network at all.
 *
 * The assets are NOT committed: 7 MB of WebAssembly would be cloned by
 * everyone whether or not they want the engine. They come from the `stockfish`
 * npm package, pinned to an exact version in package-lock.json, so this is
 * reproducible without a download — unlike the voice model, which does need
 * one.
 *
 * Only the **lite single-threaded** build is copied. The full build is 113 MB
 * and the multi-threaded builds need cross-origin isolation, which a Capacitor
 * WebView does not provide.
 *
 * Licence: Stockfish and Stockfish.js are GPLv3. Bundling them makes the
 * distributed application a combined GPLv3 work — see GPL_COMPLIANCE.md,
 * ENGINE_SOURCE.md and ENGINE_LICENSES.md before shipping a build with the
 * engine in it.
 *
 * Usage:  node scripts/prepare-engine.mjs [--check]
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'stockfish', 'bin');
const target = path.join(root, 'public', 'engine');
const manifestPath = path.join(target, 'manifest.json');

/** The exact files the app loads. Nothing else is copied. */
export const ENGINE_FILES = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

/** Also copied so the licence travels with the binary it covers. */
const LICENCE_FILES = [{ from: '../Copying.txt', to: 'COPYING-stockfish.txt' }];

const checkOnly = process.argv.includes('--check');

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function main() {
  if (!existsSync(source)) {
    console.error('The `stockfish` package is not installed.');
    console.error('Run: npm install');
    process.exit(1);
  }

  await mkdir(target, { recursive: true });

  const manifest = {
    package: 'stockfish',
    version: JSON.parse(
      await readFile(path.join(root, 'node_modules', 'stockfish', 'package.json'), 'utf8'),
    ).version,
    build: 'lite single-threaded WebAssembly',
    files: [],
  };

  let changed = false;

  for (const name of ENGINE_FILES) {
    const from = path.join(source, name);
    const to = path.join(target, name);

    if (!existsSync(from)) {
      console.error(`Missing engine asset: ${name}`);
      console.error('The stockfish package may have changed its file layout.');
      process.exit(1);
    }

    const hash = await sha256(from);
    const size = (await stat(from)).size;
    manifest.files.push({ name, sha256: hash, bytes: size });

    const needsCopy = !existsSync(to) || (await sha256(to)) !== hash;
    if (needsCopy) {
      changed = true;
      if (!checkOnly) await copyFile(from, to);
    }
    console.log(
      `${needsCopy ? (checkOnly ? 'STALE ' : 'copied') : 'ok    '} ${name}  ` +
        `${(size / 1048576).toFixed(2)} MB  ${hash.slice(0, 16)}…`,
    );
  }

  for (const { from, to } of LICENCE_FILES) {
    const src = path.join(source, from);
    if (existsSync(src) && !checkOnly) await copyFile(src, path.join(target, to));
  }

  if (!checkOnly) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (checkOnly && changed) {
    console.error('\npublic/engine is out of date. Run: node scripts/prepare-engine.mjs');
    process.exit(1);
  }

  console.log(`\nEngine assets ready in public/engine (stockfish ${manifest.version}).`);
}

await main();
