#!/usr/bin/env node
/**
 * One command from source to an installable APK.
 *
 *   web build -> capacitor sync -> gradle assembleDebug -> release/Bight.apk
 *
 * The APK is copied to release/ and committed deliberately, despite the usual
 * "never commit build output" rule, because a working installable APK is the
 * primary deliverable of this project.
 *
 * Usage: node scripts/build-apk.mjs [--release]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const releaseDir = path.join(root, 'release');
const wantRelease = process.argv.includes('--release');

const variant = wantRelease ? 'release' : 'debug';
const gradleTask = wantRelease ? 'assembleRelease' : 'assembleDebug';
const apkSource = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  variant,
  `app-${variant}.apk`,
);
const apkTarget = path.join(releaseDir, 'Bight.apk');

function run(command, args, options = {}) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

/**
 * Gradle needs a JDK. Prefer JAVA_HOME, then Android Studio's bundled runtime,
 * then a system Adoptium install, so the script works on a fresh machine
 * without the user hand-configuring anything.
 */
function resolveJavaHome() {
  if (process.env.JAVA_HOME !== undefined && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/usr/lib/jvm/java-21-openjdk',
    '/usr/lib/jvm/java-17-openjdk',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function main() {
  const javaHome = resolveJavaHome();
  if (javaHome === undefined) {
    throw new Error('No JDK found. Set JAVA_HOME to a JDK 17 or 21 installation.');
  }
  process.stdout.write(`Using JAVA_HOME=${javaHome}\n`);

  run('npm', ['run', 'build']);
  run('npx', ['cap', 'sync', 'android']);

  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(gradlew, [gradleTask, '--no-daemon'], {
    cwd: androidDir,
    env: { JAVA_HOME: javaHome },
  });

  await mkdir(releaseDir, { recursive: true });
  await copyFile(apkSource, apkTarget);

  const bytes = await readFile(apkTarget);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { size } = await stat(apkTarget);

  process.stdout.write(
    [
      '',
      '─'.repeat(64),
      `APK:      ${path.relative(root, apkTarget)}`,
      `Variant:  ${variant}`,
      `Size:     ${(size / 1024 / 1024).toFixed(2)} MB`,
      `SHA-256:  ${sha256}`,
      '',
      `Install:  adb install -r ${path.relative(root, apkTarget)}`,
      '─'.repeat(64),
      '',
    ].join('\n'),
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`\nBuild failed: ${error.message}\n`);
  process.exitCode = 1;
}
