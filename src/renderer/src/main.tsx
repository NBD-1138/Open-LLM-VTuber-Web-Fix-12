import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { LAppAdapter } from '../WebSDK/src/lappadapter';
import './i18n';

const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('onnxruntime')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// Suppress specific console.error messages from @chatscope/chat-ui-kit-react
const originalConsoleError = console.error;
const errorMessagesToIgnore = ["Warning: Failed"];
console.error = (...args: any[]) => {
  if (typeof args[0] === 'string') {
    const shouldIgnore = errorMessagesToIgnore.some((msg) => args[0].startsWith(msg));
    if (shouldIgnore) {
      return; // Suppress the warning
    }
  }
  // Call the original console.error for other messages
  originalConsoleError.apply(console, args);
};

if (typeof window !== 'undefined') {
  const globalAny = window as any;
  const coreConfig = globalAny.Live2DCubismCore ?? {};
  coreConfig.RESERVED_FUNCTION_POINTERS = Math.max(
    Number(coreConfig.RESERVED_FUNCTION_POINTERS) || 0,
    4096,
  );
  coreConfig.ALLOW_TABLE_GROWTH = 1;
  globalAny.Live2DCubismCore = coreConfig;
  const moduleConfig = globalAny.Module ?? {};
  moduleConfig.RESERVED_FUNCTION_POINTERS = coreConfig.RESERVED_FUNCTION_POINTERS;
  moduleConfig.ALLOW_TABLE_GROWTH = coreConfig.ALLOW_TABLE_GROWTH;
  globalAny.Module = moduleConfig;

  globalAny.getLAppAdapter = () => LAppAdapter.getInstance();

  // Dynamically load the Live2D Core script
  const loadLive2DCore = () => new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './libs/live2dcubismcore.js'; // Path to the copied script
    script.onload = () => {
      console.log('Live2D Cubism Core loaded successfully.');
      resolve();
    };
    script.onerror = (error) => {
      console.error('Failed to load Live2D Cubism Core:', error);
      reject(error);
    };
    document.head.appendChild(script);
  });

  // Load the script and then render the app
  loadLive2DCore()
    .then(() => {
      createRoot(document.getElementById('root')!).render(
        <App />,
      );
    })
    .catch((error) => {
      console.error('Application failed to start due to script loading error:', error);
      // Optionally render an error message to the user
      const rootElement = document.getElementById('root');
      if (rootElement) {
        rootElement.innerHTML = 'Error loading required components. Please check the console for details.';
      }
    });
}
