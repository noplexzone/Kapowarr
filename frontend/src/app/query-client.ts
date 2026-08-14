import { QueryClient } from '@tanstack/react-query';
import { dashboardSummaryQueryOptions } from '@/routes/dashboard/-dashboard.api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function prefetchDashboardSummary(): void {
  const run = () => { void queryClient.prefetchQuery(dashboardSummaryQueryOptions()); };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 });
    return;
  }
  globalThis.setTimeout(run, 0);
}
