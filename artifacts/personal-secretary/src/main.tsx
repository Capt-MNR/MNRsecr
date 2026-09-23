import { createRoot } from 'react-dom/client';
import { customFetch, setAuthRefreshHandler } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

setAuthRefreshHandler(async () => {
  try {
    await customFetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      responseType: 'json',
      skipAuthRefresh: true,
    });
    return true;
  } catch {
    return false;
  }
});

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
