import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration.
 *
 * The package id is derived from the repository owner, as the brief asks.
 * There is no `server.url`: Bight loads entirely from the packaged bundle so
 * it works with no network from the first launch.
 */
const config: CapacitorConfig = {
  appId: 'io.github.bereketgirma.bight',
  appName: 'Bight',
  webDir: 'dist',
  android: {
    // Bight is portrait-only training; letting the board rotate mid-session
    // would only shrink it.
    backgroundColor: '#16181c',
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
