#!/usr/bin/env node
/**
 * Reads the entry list back out of the built APK.
 *
 * Inspecting the archive rather than trusting the build is what caught AAPT
 * silently gunzipping the `.tar.gz` speech model into a plain `.tar` — a
 * difference that would have made voice report itself unavailable on device
 * while the model shipped correctly.
 *
 * Usage: node scripts/inspect-apk.mjs [path-to-apk]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const apk = process.argv[2] ?? path.join('release', 'Bight.apk');
if (!existsSync(apk)) {
  console.error(`No APK at ${apk}`);
  process.exit(1);
}

const javaHome = process.env.JAVA_HOME;
const jar = javaHome === undefined ? 'jar' : path.join(javaHome, 'bin', 'jar');

let entries = [];
try {
  entries = execFileSync(jar, ['tf', apk], { maxBuffer: 128 * 1024 * 1024 })
    .toString()
    .split(/\r?\n/)
    .filter(Boolean);
} catch (error) {
  console.error(`Could not read the APK with "${jar}": ${error.message}`);
  process.exit(1);
}

const bytes = statSync(apk).size;
const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');

const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e));
const model = entries.filter((e) => e.includes('vosk-model'));
const signature = entries.filter((e) => e.startsWith('META-INF/') && /\.(RSA|SF)$/.test(e));
const webAssets = entries.filter((e) => e.startsWith('assets/public/'));

console.log('─'.repeat(64));
console.log(`APK:        ${apk}`);
console.log(`Size:       ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes} bytes)`);
console.log(`SHA-256:    ${sha256}`);
console.log(`Entries:    ${entries.length}`);
console.log(`Dex:        ${dex.join(', ') || 'MISSING'}`);
console.log(`Web assets: ${webAssets.length} (index.html ${entries.includes('assets/public/index.html') ? 'present' : 'MISSING'})`);
console.log(`Voice model:${model.length > 0 ? ` ${model.join(', ')}` : ' NONE'}`);
console.log(`Signature:  ${signature.join(', ') || 'UNSIGNED'}`);
console.log('─'.repeat(64));

const problems = [];
if (dex.length === 0) problems.push('no classes.dex');
if (!entries.includes('assets/public/index.html')) problems.push('no web bundle');
if (signature.length === 0) problems.push('unsigned');
if (problems.length > 0) {
  console.error(`FAILED: ${problems.join(', ')}`);
  process.exit(1);
}
console.log('APK contents look correct.');
