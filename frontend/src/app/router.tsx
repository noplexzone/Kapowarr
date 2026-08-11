import { lazy, Suspense } from 'react';
import {
  createRoute,
  createRootRouteWithContext,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { z } from 'zod';
import type { QueryClient } from '@tanstack/react-query';
import { PageShell } from '@/platform/shell/page-shell';
import { AuthGuard } from '@/platform/auth/auth-guard';
import { LoginPage } from '@/routes/login/-ui/login-page';
import { DashboardPage } from '@/routes/dashboard/-ui/dashboard-page';
import { ComicsPage } from '@/routes/comics/-ui/comics-page';
import { AddPage, ExactAddReview } from '@/routes/add/-ui/add-page';
import { ReaderPage } from '@/routes/reader/-ui/reader-page';
import { MismatchPage } from '@/routes/mismatch/-ui/mismatch-page';
import { SystemStatusPage } from '@/routes/system/-ui/system-status-page';
import { RouteError, RouteNotFound, RoutePending } from '@/components/route-state/route-state';
import { volumeListQueryOptions } from '@/routes/comics/-comics.api';
import { rootFoldersQueryOptions } from '@/routes/add/-add.api';
import { queueQueryOptions } from '@/routes/activity/queue/-queue.api';
import { historyQueryOptions } from '@/routes/activity/history/-history.api';
import { searchHistoryQueryOptions } from '@/routes/activity/search-history/-search-history.api';
import { blocklistQueryOptions } from '@/routes/activity/blocklist/-blocklist.api';
import { settingsQueryOptions } from '@/routes/settings/-settings.api';
import type { SettingsCategory } from '@/routes/settings/-ui/settings-category-panels';
import { systemAboutQueryOptions } from '@/routes/system/-system.api';
import {
  activitySearchSchema,
  blocklistSearchSchema,
  discoverySearchSchema,
  historySearchSchema,
  searchHistorySearchSchema,
  legacyDiscoverySearchSchema,
  legacyDiscoveryToCanonical,
  legacyLibrarySearchSchema,
  legacyLibraryToCanonical,
  librarySearchSchema,
  scopedActivitySearchSchema,
  toLegacyLibrarySearch,
} from './route-search';

export interface RouterContext {
  queryClient: QueryClient;
  shell: { profile: number };
}

const QueuePage = lazy(() => import('@/routes/activity/queue/-ui/queue-page').then((module) => ({ default: module.QueuePage })));
const HistoryPage = lazy(() => import('@/routes/activity/history/-ui/history-page').then((module) => ({ default: module.HistoryPage })));
const SearchHistoryPage = lazy(() => import('@/routes/activity/search-history/-ui/search-history-page').then((module) => ({ default: module.SearchHistoryPage })));
const BlocklistPage = lazy(() => import('@/routes/activity/blocklist/-ui/blocklist-page').then((module) => ({ default: module.BlocklistPage })));
const SettingsPage = lazy(() => import('@/routes/settings/-ui/settings-page').then((module) => ({ default: module.SettingsPage })));
const DiscoveryPage = lazy(() => import('@/routes/discovery/-ui/discovery-page').then((module) => ({ default: module.DiscoveryPage })));
const ImportPage = lazy(() => import('@/routes/import/-ui/import-page').then((module) => ({ default: module.ImportPage })));
const VolumeDetailPage = lazy(() => import('@/routes/volumes/-ui/volume-detail-page').then((module) => ({ default: module.VolumeDetailPage })));

const rootRoute = createRootRouteWithContext<RouterContext>()({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  component: LoginPage,
});

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: () => (
    <AuthGuard>
      <PageShell>
        <Suspense fallback={<RoutePending />}><Outlet /></Suspense>
      </PageShell>
    </AuthGuard>
  ),
});

const rootRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  loader: () => { throw redirect({ to: '/home', replace: true }); },
});

const homeRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'home',
  component: DashboardPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'library',
  validateSearch: librarySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(
      volumeListQueryOptions(1, toLegacyLibrarySearch(deps), deps.section),
    );
  },
  component: () => {
    const search = libraryRoute.useSearch();
    return <ComicsPage section={search.section} canonical />;
  },
});

function createLegacyLibraryRoute(path: 'comics' | 'manga', section: 'comic' | 'manga') {
  return createRoute({
    getParentRoute: () => layoutRoute,
    path,
    validateSearch: legacyLibrarySearchSchema,
    loaderDeps: ({ search }) => search,
    loader: ({ deps }) => {
      throw redirect({
        to: '/library',
        search: legacyLibraryToCanonical(section, deps),
        replace: true,
      });
    },
  });
}

const comicsRedirectRoute = createLegacyLibraryRoute('comics', 'comic');
const mangaRedirectRoute = createLegacyLibraryRoute('manga', 'manga');
const comicsAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'comics/add',
  loader: () => { throw redirect({ to: '/add', search: { section: 'comic' }, replace: true }); },
});
const mangaAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga/add',
  loader: () => { throw redirect({ to: '/add', search: { section: 'manga' }, replace: true }); },
});

const discoverRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'discover',
  validateSearch: discoverySearchSchema,
  component: () => {
    const search = discoverRoute.useSearch();
    return <DiscoveryPage section={search.section} type={search.category} canonical />;
  },
});

const discoveryRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'discovery',
  validateSearch: legacyDiscoverySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    throw redirect({
      to: '/discover',
      search: legacyDiscoveryToCanonical(deps),
      replace: true,
    });
  },
});

const activityRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity',
  loader: () => { throw redirect({ to: '/activity/queue', replace: true }); },
});

const queueRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/queue',
  validateSearch: activitySearchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(queueQueryOptions());
  },
  component: QueuePage,
});

const historyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/history',
  validateSearch: historySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(historyQueryOptions(deps.page - 1, deps.status));
  },
  component: () => {
    const search = historyRoute.useSearch();
    return <HistoryPage offset={search.page - 1} state={search.status} />;
  },
});

const searchHistoryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/search-history',
  validateSearch: searchHistorySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(searchHistoryQueryOptions(deps.page - 1));
  },
  component: () => <SearchHistoryPage offset={searchHistoryRoute.useSearch().page - 1} />,
});

const mismatchRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/mismatches',
  validateSearch: scopedActivitySearchSchema,
  component: () => <MismatchPage section={mismatchRoute.useSearch().section} />,
});

const importsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/imports',
  validateSearch: scopedActivitySearchSchema,
  component: () => <ImportPage section={importsRoute.useSearch().section} />,
});

const blocklistRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'activity/blocklist',
  validateSearch: blocklistSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(blocklistQueryOptions(deps.page - 1));
  },
  component: () => <BlocklistPage offset={blocklistRoute.useSearch().page - 1} />,
});

const mismatchLegacyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'mismatch-review',
  validateSearch: scopedActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    throw redirect({ to: '/activity/mismatches', search: deps, replace: true });
  },
});

const mangaMismatchLegacyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga/mismatch-review',
  loader: () => {
    throw redirect({ to: '/activity/mismatches', search: { section: 'manga' }, replace: true });
  },
});

const importLegacyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'import',
  validateSearch: scopedActivitySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    throw redirect({ to: '/activity/imports', search: deps, replace: true });
  },
});

const SETTINGS_CATEGORIES = [
  'general',
  'media-management',
  'root-folders',
  'download',
  'metadata',
  'indexers',
  'download-clients',
  'remote-mappings',
  'proxy',
] as const satisfies readonly SettingsCategory[];
const settingsCategorySchema = z.enum(SETTINGS_CATEGORIES);
const settingsLegacySearchSchema = z.object({
  category: settingsCategorySchema.default('general').catch('general'),
});

const settingsRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings',
  validateSearch: settingsLegacySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    throw redirect({
      to: '/settings/$category',
      params: { category: deps.category },
      replace: true,
    });
  },
});

const settingsMediaManagementLegacyRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/mediamanagement',
  loader: () => {
    throw redirect({
      to: '/settings/$category',
      params: { category: 'media-management' },
      replace: true,
    });
  },
});

const settingsCategoryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'settings/$category',
  loader: async ({ context, params }) => {
    const category = settingsCategorySchema.safeParse(params.category);
    if (!category.success) {
      throw redirect({
        to: '/settings/$category',
        params: { category: 'general' },
        replace: true,
      });
    }
    await context.queryClient.ensureQueryData(settingsQueryOptions());
  },
  component: function SettingsCategoryRoute() {
    const navigate = useNavigate();
    const result = settingsCategorySchema.safeParse(settingsCategoryRoute.useParams().category);
    const category = result.success ? result.data : 'general';
    return (
      <SettingsPage
        category={category}
        onCategoryChange={(nextCategory) => {
          void navigate({
            to: '/settings/$category',
            params: { category: nextCategory },
          });
        }}
      />
    );
  },
});

export const addSearchSchema = z.object({
  section: z.enum(['comic', 'manga']).default('comic').catch('comic'),
  metadata_source: z.enum(['comicvine', 'mangadex']).optional().catch(undefined),
  metadata_id: z.string().min(1).optional().catch(undefined),
  title: z.string().min(1).optional().catch(undefined),
  metadata_language: z.string().min(2).max(16).optional().catch(undefined),
});

export const addReviewSearchSchema = z.object({
  section: z.enum(['comic', 'manga']),
  source: z.enum(['comicvine', 'mangadex']),
  id: z.string().min(1),
  title: z.string().min(1).optional().catch(undefined),
  language: z.string().min(2).max(16).optional().catch(undefined),
});

const addRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'add',
  validateSearch: addSearchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(rootFoldersQueryOptions());
  },
  component: () => {
    const search = addRoute.useSearch();
    if (search.metadata_source && search.metadata_id) {
      return <ExactAddReview section={search.section} selection={{
        metadata_source: search.metadata_source,
        metadata_id: search.metadata_id,
        title: search.title,
        metadata_language: search.metadata_language,
      }} />;
    }
    return <AddPage section={search.section} initialQuery={search.title} />;
  },
});

const addReviewRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'add/review',
  validateSearch: addReviewSearchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(rootFoldersQueryOptions());
  },
  component: function AddReviewRouteComponent() {
    const search = addReviewRoute.useSearch();
    return <ExactAddReview section={search.section} selection={{
      metadata_source: search.source,
      metadata_id: search.id,
      title: search.title,
      metadata_language: search.language,
    }} />;
  },
});

const volumeRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId',
  component: VolumeDetailPage,
});

const volumeIssuesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId/issues',
  component: VolumeDetailPage,
});
const volumeFilesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId/files',
  component: VolumeDetailPage,
});
const volumeHistoryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId/history',
  component: VolumeDetailPage,
});

const readerRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'read/$fileId',
  component: ReaderPage,
});

const systemRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'system',
  loader: () => { throw redirect({ to: '/system/status', replace: true }); },
});
const systemStatusRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'system/status',
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(systemAboutQueryOptions());
  },
  component: SystemStatusPage,
});

const catchAllRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '$',
  component: RouteNotFound,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    rootRedirectRoute,
    homeRoute,
    libraryRoute,
    comicsAddRedirectRoute,
    mangaAddRedirectRoute,
    comicsRedirectRoute,
    mangaRedirectRoute,
    discoverRoute,
    discoveryRedirectRoute,
    activityRedirectRoute,
    queueRoute,
    historyRoute,
    searchHistoryRoute,
    mismatchRoute,
    importsRoute,
    blocklistRoute,
    mismatchLegacyRoute,
    mangaMismatchLegacyRoute,
    importLegacyRoute,
    settingsRedirectRoute,
    settingsMediaManagementLegacyRoute,
    settingsCategoryRoute,
    addRoute,
    addReviewRoute,
    volumeRoute,
    volumeIssuesRoute,
    volumeFilesRoute,
    volumeHistoryRoute,
    readerRoute,
    systemRedirectRoute,
    systemStatusRoute,
    catchAllRoute,
  ]),
]);
