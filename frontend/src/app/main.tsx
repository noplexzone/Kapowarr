import '../index.css';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './router';
import { queryClient, prefetchDashboardSummary } from './query-client';
import { DEFAULT_THEME } from '@/platform/shell/store';
import { applyRuntimeDocumentUrls, registerServiceWorker, runtimeConfig } from './runtime-config';

applyRuntimeDocumentUrls();
void registerServiceWorker();
prefetchDashboardSummary();

// Theme initialization — preserve legacy browser setting, otherwise use the premium Kapowarr default.
const savedTheme = localStorage.getItem('hero_theme') || localStorage.getItem('kapowarr-theme');
document.documentElement.dataset.theme = savedTheme || DEFAULT_THEME;

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
