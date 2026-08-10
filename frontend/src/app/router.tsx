import { lazy, Suspense } from 'react';
import {
  createRoute,
  createRootRouteWithContext,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import type { QueryClient } from '@tanstack/react-query';
import { PageShell } from '@/platform/shell/page-shell';
import { AuthGuard } from '@/platform/auth/auth-guard';
import { LoginPage } from '@/routes/login/-ui/login-page';
import { DashboardPage } from '@/routes/dashboard/-ui/dashboard-page';
import { ComicsPage } from '@/routes/comics/-ui/comics-page';
import { AddPage } from '@/routes/add/-ui/add-page';
import { SystemStatusPage } from '@/routes/system/-ui/system-status-page';
import { SystemTasksPage } from '@/routes/system/-ui/system-tasks-page';
import { ReaderPage } from '@/routes/reader/-ui/reader-page';
import { MismatchPage } from '@/routes/mismatch/-ui/mismatch-page';
import { RouteError, RouteNotFound, RoutePending } from '@/components/route-state/route-state';
import { volumesSearchSchema } from '@/routes/comics/-comics.types';
import { volumeListQueryOptions } from '@/routes/comics/-comics.api';
import { rootFoldersQueryOptions } from '@/routes/add/-add.api';
import { queueQueryOptions } from '@/routes/activity/queue/-queue.api';
import { historyQueryOptions } from '@/routes/activity/history/-history.api';
import { blocklistQueryOptions } from '@/routes/activity/blocklist/-blocklist.api';
import { settingsQueryOptions } from '@/routes/settings/-settings.api';
import type { SettingsCategory } from '@/routes/settings/-ui/settings-category-panels';
import { systemAboutQueryOptions } from '@/routes/system/-system.api';

export interface RouterContext {
  queryClient: QueryClient;
  shell: { profile: number };
}

const QueuePage = lazy(() => import('@/routes/activity/queue/-ui/queue-page').then(module => ({ default: module.QueuePage })));
const HistoryPage = lazy(() => import('@/routes/activity/history/-ui/history-page').then(module => ({ default: module.HistoryPage })));
const BlocklistPage = lazy(() => import('@/routes/activity/blocklist/-ui/blocklist-page').then(module => ({ default: module.BlocklistPage })));
const SettingsPage = lazy(() => import('@/routes/settings/-ui/settings-page').then(module => ({ default: module.SettingsPage })));
const DiscoveryPage = lazy(() => import('@/routes/discovery/-ui/discovery-page').then(module => ({ default: module.DiscoveryPage })));
const ImportPage = lazy(() => import('@/routes/import/-ui/import-page').then(module => ({ default: module.ImportPage })));
const VolumeDetailPage = lazy(() => import('@/routes/volumes/-ui/volume-detail-page').then(module => ({ default: module.VolumeDetailPage })));

// ── Persistence helpers ───────────────────────────────────────────────────

const STORAGE_KEYS = {
  sort: 'kapowarr_sort',
  view: 'kapowarr_view',
  filter: 'kapowarr_filter',
} as const;

const SORT_VALUES = ['title','volume_number','year','recently_added','recently_released','publisher','wanted'] as const;

/** If the Zod default (sort=title) is in play, check localStorage for the
 *  user's last saved sort and return a redirect to carry it into the URL. */
function redirectFromLocalStorage(deps: Record<string, unknown>, path: string) {
  if (deps.sort !== 'title') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sort);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored && stored !== 'title' && (SORT_VALUES as readonly string[]).includes(stored)) {
      return redirect({
        to: path,
        search: { ...deps, sort: stored },
        replace: true,
      });
    }
  } catch { /* ignore */ }
  return null;
}

// ── Root (renders <Outlet /> only — no wrapper) ────────────────────────────────
const rootRoute = createRootRouteWithContext<RouterContext>()({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  component: function RootLayout() {
    return (
      <Suspense fallback={<RoutePending />}>
        <Outlet />
      </Suspense>
    );
  },
});

// ── Login (public — no AuthGuard, no sidebar) ─────────────────────────────────
const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

// ── Protected layout (AuthGuard + PageShell) ──────────────────────────────────
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: function LayoutComponent() {
    return (
      <AuthGuard>
        <PageShell>
          <Outlet />
        </PageShell>
      </AuthGuard>
    );
  },
});

// Dashboard (index)
const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: DashboardPage,
});

// Comics library
const comicsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'comics',
  validateSearch: volumesSearchSchema,
  loaderDeps: ({ search }: any) => ({
    sort: search.sort,
    filter: search.filter,
    view: search.view,
    offset: search.offset,
    search: search.search,
  }),
  loader: async ({ context, deps }: any) => {
    // If sort is still the Zod default, check localStorage for a saved preference
    // and redirect to persist it in the URL so it survives navigation.
    if (deps.sort === 'title') {
      const redirectTo = redirectFromLocalStorage(deps, '/comics');
      if (redirectTo) throw redirectTo;
    }
    await context.queryClient.ensureQueryData(
      volumeListQueryOptions(1, deps, 'comic'),
    );
  },
  component: ComicsPage,
});

const comicsAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'comics/add',
  loader: () => {
    throw redirect({ to: '/add', search: { section: 'comic' as const } });
  },
});

// Volume detail
const volumeDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId',
  component: VolumeDetailPage,
});

// Comic reader
const readerRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'read/$fileId',
  component: ReaderPage,
});

// Manga library
const mangaRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga',
  validateSearch: volumesSearchSchema,
  loaderDeps: ({ search }: any) => ({
    sort: search.sort,
    filter: search.filter,
    view: search.view,
    offset: search.offset,
    search: search.search,
  }),
  loader: async ({ context, deps }: any) => {
    if (deps.sort === 'title') {
      const redirectTo = redirectFromLocalStorage(deps, '/manga');
      if (redirectTo) throw redirectTo;
    }
    await context.queryClient.ensureQueryData(
      volumeListQueryOptions(1, deps, 'manga'),
    );
  },
  component: () => <ComicsPage section="manga" />,
});

const mangaAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga/add',
  loader: () => {
    throw redirect({ to: '/add', search: { section: 'manga' as const } });
  },
});

// Add volume
export const addSearchSchema = z.object({
  section: z.enum(['comic', 'manga']).default('comic').catch('comic'),
  metadata_source: z.enum(['comicvine', 'mangadex']).optional().catch(undefined),
  metadata_id: z.string().min(1).optional().catch(undefined),
  title: z.string().min(1).optional().catch(undefined),
  metadata_language: z.string().min(2).max(16).optional().catch(undefined),
});

const addRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'add',
  validateSearch: addSearchSchema,
  loader: async ({ context }: any) => {
    await context.queryClient.ensureQueryData(rootFoldersQueryOptions());
  },
  component: function AddRouteComponent() {
    const search = addRoute.useSearch();
    const selection = search.metadata_source && search.metadata_id && search.title ? { metadata_source: search.metadata_source, metadata_id: search.metadata_id, title: search.title, metadata_language: search.metadata_language } : undefined;
    return <AddPage section={search.section} selection={selection} />;
  },
});

// Activity — Queue
const queueRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/queue',
  loader: async ({ context }: any) => {
    await context.queryClient.ensureQueryData(queueQueryOptions());
  },
  component: QueuePage,
});

// Activity — History
const historySearchSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  state: z.enum(['all', 'downloaded', 'failed', 'cancelled']).default('all').catch('all'),
});

const historyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/history',
  validateSearch: historySearchSchema,
  loaderDeps: ({ search }: any) => ({ offset: search.offset, state: search.state }),
  loader: async ({ context, deps }: any) => {
    await context.queryClient.ensureQueryData(historyQueryOptions(deps.offset, deps.state));
  },
  component: function HistoryRouteComponent() {
    const search = historyRoute.useSearch();
    return <HistoryPage offset={search.offset} state={search.state} />;
  },
});

// Activity — Blocklist
const blocklistSearchSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
});

const blocklistRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/blocklist',
  validateSearch: blocklistSearchSchema,
  loaderDeps: ({ search }: any) => ({ offset: search.offset }),
  loader: async ({ context, deps }: any) => {
    await context.queryClient.ensureQueryData(blocklistQueryOptions(deps.offset));
  },
  component: function BlocklistRouteComponent() {
    const search = blocklistRoute.useSearch();
    return <BlocklistPage offset={search.offset} />;
  },
});

// Settings
const settingsSearchSchema = z.object({
  category: z.enum(['general', 'media-management', 'root-folders', 'download', 'metadata', 'indexers', 'download-clients', 'remote-mappings', 'proxy']).default('general').catch('general'),
});

const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings',
  validateSearch: settingsSearchSchema,
  loader: async ({ context }: any) => {
    await context.queryClient.ensureQueryData(settingsQueryOptions());
  },
  component: function SettingsRouteComponent() {
    const search = settingsRoute.useSearch();
    const navigate = settingsRoute.useNavigate();
    return <SettingsPage category={search.category} onCategoryChange={(category: SettingsCategory) => void navigate({ search: { category } })} />;
  },
});

const settingsMediaManagementRedirect = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/mediamanagement',
  loader: () => { throw redirect({ to: '/settings', search: { category: 'media-management' as const } }); },
});

const settingsDownloadRedirect = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/download',
  loader: () => { throw redirect({ to: '/settings', search: { category: 'download' as const } }); },
});

const settingsGeneralRedirect = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/general',
  loader: () => { throw redirect({ to: '/settings', search: { category: 'general' as const } }); },
});

const settingsMetadataRedirect = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/metadata',
  loader: () => { throw redirect({ to: '/settings', search: { category: 'metadata' as const } }); },
});

const settingsIndexersRedirect = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/indexers',
  loader: () => { throw redirect({ to: '/settings', search: { category: 'indexers' as const } }); },
});

// System
const systemRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'system',
  loader: () => { throw redirect({ to: '/system/status' }); },
});

const systemStatusRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'system/status',
  loader: async ({ context }: any) => {
    await context.queryClient.ensureQueryData(systemAboutQueryOptions());
  },
  component: SystemStatusPage,
});

const systemTasksRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'system/tasks',
  component: SystemTasksPage,
});

// Discovery
const discoverySearchSchema = z.object({
  section: z.enum(['comic', 'manga']).default('comic').catch('comic'),
  type: z.enum(['upcoming', 'new', 'story-arcs']).default('upcoming').catch('upcoming'),
});

const discoveryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'discovery',
  validateSearch: discoverySearchSchema,
  component: function DiscoveryRouteComponent() {
    const search = discoveryRoute.useSearch();
    return <DiscoveryPage section={search.section} type={search.type} />;
  },
});

// Library import
const importSearchSchema = z.object({
  section: z.enum(['comic', 'manga']).default('comic').catch('comic'),
});

const importRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'import',
  validateSearch: importSearchSchema,
  component: function ImportRouteComponent() {
    const search = importRoute.useSearch();
    return <ImportPage section={search.section} />;
  },
});

// Mismatch review
const mismatchSearchSchema = z.object({
  section: z.enum(['comic', 'manga']).default('comic').catch('comic'),
});

const mismatchRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/mismatches',
  validateSearch: mismatchSearchSchema,
  component: function MismatchRouteComponent() {
    const search = mismatchRoute.useSearch();
    return <MismatchPage section={search.section} />;
  },
});

const comicMismatchRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'mismatch-review',
  loader: () => { throw redirect({ to: '/activity/mismatches', search: { section: 'comic' as const } }); },
});

const mangaMismatchRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga/mismatch-review',
  loader: () => {
    throw redirect({ to: '/activity/mismatches', search: { section: 'manga' as const } });
  },
});

// 404
const catchAllRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '$',
  component: RouteNotFound,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    indexRoute,
    comicsRoute,
    comicsAddRedirectRoute,
    volumeDetailRoute,
    readerRoute,
    mangaRoute,
    mangaAddRedirectRoute,
    addRoute,
    queueRoute,
    historyRoute,
    blocklistRoute,
    settingsRoute,
    settingsMediaManagementRedirect,
    settingsDownloadRedirect,
    settingsGeneralRedirect,
    settingsMetadataRedirect,
    settingsIndexersRedirect,
    systemRedirectRoute,
    systemStatusRoute,
    systemTasksRoute,
    discoveryRoute,
    importRoute,
    mismatchRoute,
    comicMismatchRedirectRoute,
    mangaMismatchRedirectRoute,
    catchAllRoute,
  ]),
]);
