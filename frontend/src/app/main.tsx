import './register-service-worker';
import '../index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './router';
import { applyRuntimeDocumentUrls, registerServiceWorker, runtimeConfig } from './runtime-config';

applyRuntimeDocumentUrls();
void registerServiceWorker();

// Theme initialization — uses 'kapowarr-theme' in localStorage
const savedTheme = localStorage.getItem('kapowarr-theme');
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
} else {
  document.documentElement.dataset.theme = 'batman-mode';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  basepath: runtimeConfig.routerBasePath,
  context: {
    queryClient,
    shell: { profile: 1 },
  },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
