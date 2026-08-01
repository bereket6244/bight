#!/usr/bin/env node
/**
 * Refuses to let a GPL-licensed engine ship without its compliance paperwork.
 *
 * The failure this prevents is quiet and serious: someone removes the engine
 * and forgets to restore the MIT licence, or adds it and forgets the source
 * correspondence, and the repository ends up distributing GPL binaries while
 * claiming to be MIT. Neither direction should be possible by accident, so the
 * check runs in CI.
 *
 * Usage: npm run verify:licenses
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function read(file) {
  const full = path.join(root, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/** Is a GPL-licensed engine actually part of this build? */
const engineDir = path.join(root, 'public', 'engine');
const enginePresent =
  existsSync(engineDir) && readdirSync(engineDir).some((name) => name.endsWith('.wasm'));

const packageJson = JSON.parse(read('package.json') ?? '{}');
const declared = packageJson.license ?? '(none)';
const dependsOnStockfish = packageJson.dependencies?.stockfish !== undefined;

notes.push(`engine assets present: ${enginePresent ? 'yes' : 'no'}`);
notes.push(`stockfish dependency:  ${dependsOnStockfish ? packageJson.dependencies.stockfish : 'none'}`);
notes.push(`package.json license:  ${declared}`);

if (dependsOnStockfish || enginePresent) {
  // Shipping the engine: the combined work must be offered under the GPL, and
  // the paperwork that makes that meaningful must exist.
  if (!/^GPL-3\.0/.test(declared)) {
    problems.push(
      `package.json declares "${declared}" while the GPL engine is present. ` +
        'A GPL engine in the distributed application means the whole is GPLv3.',
    );
  }

  const licence = read('LICENSE');
  if (licence === null || !licence.includes('GNU GENERAL PUBLIC LICENSE')) {
    problems.push('LICENSE is missing or is not the GPLv3 text.');
  }

  const mit = read('LICENSE-MIT');
  if (mit === null || !mit.includes('MIT License')) {
    problems.push(
      'LICENSE-MIT is missing. The previous MIT licence must be preserved, ' +
        'not replaced — Bight\'s own code is still available under it.',
    );
  }

  for (const required of [
    'GPL_COMPLIANCE.md',
    'ENGINE_SOURCE.md',
    'ENGINE_LICENSES.md',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    if (read(required) === null) problems.push(`${required} is missing.`);
  }

  // The source-correspondence document must actually identify the binary that
  // ships, not merely exist.
  const source = read('ENGINE_SOURCE.md') ?? '';
  const manifestRaw = read('public/engine/manifest.json');
  if (manifestRaw !== null) {
    const manifest = JSON.parse(manifestRaw);
    if (!source.includes(manifest.version)) {
      problems.push(
        `ENGINE_SOURCE.md does not mention the engine version actually bundled (${manifest.version}).`,
      );
    }
    for (const file of manifest.files ?? []) {
      if (!source.includes(file.sha256)) {
        problems.push(
          `ENGINE_SOURCE.md does not record the checksum of ${file.name}, ` +
            'so the shipped binary cannot be matched to its source.',
        );
      }
    }
    notes.push(`engine package:        stockfish ${manifest.version}`);
  } else if (enginePresent) {
    problems.push('public/engine/manifest.json is missing, so the shipped binary is unidentified.');
  }
} else {
  // No engine: the project is MIT again, and should say so.
  if (declared !== 'MIT') {
    notes.push(
      `No engine is present but package.json says "${declared}". ` +
        'That is legal but probably unintended.',
    );
  }
}

console.log('');
for (const note of notes) console.log(`  ${note}`);
console.log('');

if (problems.length > 0) {
  console.error('Licence compliance problems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('Licence compliance checks passed.');
