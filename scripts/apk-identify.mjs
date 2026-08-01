#!/usr/bin/env node
/**
 * Reads an APK's own manifest metadata back, rather than trusting its filename.
 *
 * Filenames are a claim; the binary is the fact. Before a historical build is
 * renamed or indexed, this is what establishes what it actually is.
 *
 * Usage: node scripts/apk-identify.mjs [file ...]
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');

const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync(releaseDir)
        .filter((name) => name.endsWith('.apk'))
        .map((name) => path.join(releaseDir, name));

/** Entry names, read straight from the zip central directory. */
function entriesOf(buffer) {
  const names = [];
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let at = buffer.indexOf(signature);
  while (at !== -1) {
    const nameLength = buffer.readUInt16LE(at + 28);
    names.push(buffer.toString('utf8', at + 46, at + 46 + nameLength));
    at = buffer.indexOf(signature, at + 46 + nameLength);
  }
  return names;
}

/** Extracts one entry from the zip, inflating it if it is deflated. */
function readEntry(buffer, wanted) {
  const localSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let at = buffer.indexOf(localSignature);

  while (at !== -1) {
    const method = buffer.readUInt16LE(at + 8);
    const compressedSize = buffer.readUInt32LE(at + 18);
    const uncompressedSize = buffer.readUInt32LE(at + 22);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extraLength = buffer.readUInt16LE(at + 28);
    const name = buffer.toString('utf8', at + 30, at + 30 + nameLength);
    const dataAt = at + 30 + nameLength + extraLength;

    if (name === wanted && compressedSize > 0) {
      const data = buffer.subarray(dataAt, dataAt + compressedSize);
      try {
        return method === 0 ? data : inflateRawSync(data);
      } catch {
        return null;
      }
    }

    at = buffer.indexOf(localSignature, dataAt + (compressedSize || uncompressedSize || 1));
  }
  return null;
}

/**
 * versionName and versionCode, read from the APK itself.
 *
 * `aapt` is used when it is on the PATH. Otherwise the binary AndroidManifest
 * is extracted and inflated, and its string pool is scanned: Android stores
 * pool strings as length-prefixed UTF-16, so the version name is present
 * verbatim once the entry is decompressed. The point of doing this at all is
 * that a filename is a claim and the binary is the fact.
 */
function versionOf(file, buffer) {
  try {
    const out = execFileSync('aapt', ['dump', 'badging', file], { encoding: 'utf8' });
    return {
      versionName: /versionName='([^']+)'/.exec(out)?.[1] ?? null,
      versionCode: /versionCode='([^']+)'/.exec(out)?.[1] ?? null,
      source: 'aapt',
    };
  } catch {
    const manifest = readEntry(buffer, 'AndroidManifest.xml');
    if (manifest === null) return { versionName: null, versionCode: null, source: 'unreadable' };

    // Every version-shaped string in the pool; the manifest holds exactly one.
    const text = manifest.toString('utf16le');
    const candidates = [...new Set(text.match(/\d+\.\d+\.\d+/g) ?? [])];
    return {
      versionName: candidates.length === 1 ? candidates[0] : (candidates[0] ?? null),
      versionCode: null,
      source: candidates.length === 0 ? 'unknown' : 'AndroidManifest string pool',
      ambiguous: candidates.length > 1 ? candidates : undefined,
    };
  }
}

console.log('');
for (const file of files) {
  const buffer = readFileSync(file);
  const entries = entriesOf(buffer);
  const engine = entries.filter((e) => e.includes('assets/public/engine/'));
  const version = versionOf(file, buffer);

  console.log(path.basename(file));
  console.log(`  size        ${(statSync(file).size / 1048576).toFixed(2)} MB`);
  console.log(`  sha256      ${createHash('sha256').update(buffer).digest('hex')}`);
  console.log(`  versionName ${version.versionName ?? 'UNKNOWN'} (from ${version.source})`);
  if (version.versionCode !== null) console.log(`  versionCode ${version.versionCode}`);
  console.log(`  package     ${entries.includes('AndroidManifest.xml') ? 'AndroidManifest.xml present' : 'MISSING'}`);
  console.log(`  engine      ${engine.length > 0 ? `${engine.length} files` : 'none'}`);
  console.log(`  signed      ${entries.some((e) => /^META-INF\/.*\.(RSA|SF)$/.test(e)) ? 'yes (debug)' : 'no'}`);
  console.log('');
}
