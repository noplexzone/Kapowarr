import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { PageShell } from '@/platform/shell/page-shell';

interface RouterContext {
  queryClient: QueryClient;
  shell: { profile: number };
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <PageShell>
      <Outlet />
    </PageShell>
  );
}
