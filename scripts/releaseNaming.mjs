/**
 * The release artifact naming rule, in one place.
 *
 * Kept as its own module because two very different things need it: the build
 * script that produces the file, and the test that stops the format regressing.
 * A filename that carries the version, the licence and the variant is the whole
 * point — `Bight.apk` on its own told a user none of the three.
 *
 *     Bight-v<version>-<licence>-<variant>.apk
 */

/** Licence of the distributed build. A decision, never sniffed. */
export const DEFAULT_LICENCE = 'GPL';

/** Which build this is: with the engine, or without it. */
export const DEFAULT_VARIANT = 'engine';

export function artifactName(version, licence = DEFAULT_LICENCE, variant = DEFAULT_VARIANT) {
  return `Bight-v${version}-${licence}-${variant}.apk`;
}

/** True for a name this project would produce. Used by the CI guard. */
export function isReleaseArtifactName(name) {
  return /^Bight-v\d+\.\d+\.\d+-(MIT|GPL)-[a-z-]+\.apk$/.test(name);
}
