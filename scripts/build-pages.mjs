#!/usr/bin/env node

import { access, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

process.env.VITE_BIGHT_TARGET = 'web-demo';

const { build } = await import('vite');
await build({ root });

const publicDocuments = [
  'LICENSE',
  'LICENSE-MIT',
  'GPL_COMPLIANCE.md',
  'ENGINE_SOURCE.md',
  'ENGINE_LICENSES.md',
  'THIRD_PARTY_NOTICES.md',
];

for (const name of publicDocuments) {
  await copyFile(path.join(root, name), path.join(dist, name));
}

// GitHub Pages bypasses Jekyll for this static Vite artifact. The fallback
// lets a project-site URL be refreshed even if a future UI route is added.
await writeFile(path.join(dist, '.nojekyll'), '');
await copyFile(path.join(dist, 'index.html'), path.join(dist, '404.html'));

const required = [
  'index.html',
  '404.html',
  '.nojekyll',
  'engine/stockfish-18-lite-single.js',
  'engine/stockfish-18-lite-single.wasm',
  'models/vosk-model-small-en-us-0.15.tar.gz',
  ...publicDocuments,
];

for (const name of required) await access(path.join(dist, name));

console.log('GitHub Pages artifact is ready in dist/.');
