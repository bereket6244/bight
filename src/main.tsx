import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AppProvider } from './ui/state/AppContext';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import './ui/theme.css';

/**
 * Edge-to-edge Android needs the status bar to overlay the WebView; the app
 * shell then pads itself with the safe-area insets. Failure here is harmless,
 * so it never blocks startup.
 */
async function configureNativeShell(): Promise<void> {
  try {
    const { StatusBar, Style } = (await import('@capacitor/status-bar')) as unknown as {
      StatusBar: {
        setOverlaysWebView: (options: { overlay: boolean }) => Promise<void>;
        setStyle: (options: { style: string }) => Promise<void>;
      };
      Style: { Dark: string };
    };
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Running in a browser, or the plugin is absent.
  }
}

void configureNativeShell();

const container = document.getElementById('root');
if (container === null) throw new Error('Bight could not find its root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary label="Bight">
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
