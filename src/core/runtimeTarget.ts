/** Runtime/build target boundaries shared by storage and copied assets. */

export type RuntimeTarget = 'app' | 'web-demo';

export function runtimeTargetFromValue(value: string | undefined): RuntimeTarget {
  return value === 'web-demo' ? 'web-demo' : 'app';
}

export const RUNTIME_TARGET: RuntimeTarget = runtimeTargetFromValue(
  import.meta.env.VITE_BIGHT_TARGET,
);

export const IS_WEB_DEMO = RUNTIME_TARGET === 'web-demo';

/** Resolve a file copied from public/ beneath Vite's configured base path. */
export function assetUrl(path: string, baseUrl: string = import.meta.env.BASE_URL): string {
  const cleanPath = path.replace(/^\/+/, '');
  const base = baseUrl === '' ? './' : baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${cleanPath}`;
}

export function engineGamePersistenceEnabled(target: RuntimeTarget = RUNTIME_TARGET): boolean {
  return target !== 'web-demo';
}
