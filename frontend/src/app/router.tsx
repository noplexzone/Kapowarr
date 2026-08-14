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

import { ReaderPage } from '@/routes/reader/-ui/reader-page';
import { MismatchPage } from '@/routes/mismatch/-ui/mismatch-page';
import { SystemStatusPage } from '@/routes/system/-ui/system-status-page';
import { RouteError, RouteNotFound, RoutePending } from '@/components/route-state/route-state';
import { volumeListQueryOptions } from '@/routes/comics/-comics.api';
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
  discoverAddSearchSchema,
  discoverResultsSearchSchema,
  historySearchSchema,
  searchHistorySearchSchema,
  legacyDiscoverySearchSchema,
  legacyDiscoveryToCanonical,
  legacyLibraryToCanonical,
  librarySearchSchema,
  mediaLibrarySearchSchema,
  mediaLibraryToLegacySearch,
  scopedActivitySearchSchema,
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
const DiscoverSearchResultsPage = lazy(() => import('@/routes/discovery/-ui/discovery-page').then((module) => ({ default: module.DiscoverSearchResultsPage })));
const DiscoverExactAddPage = lazy(() => import('@/routes/discovery/-ui/discovery-page').then((module) => ({ default: module.DiscoverExactAddPage })));
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
  loader: ({ deps }) => {
    const { section: _section, ...search } = legacyLibraryToCanonical(deps.section, deps);
    throw redirect({
      to: deps.section === 'manga' ? '/manga' : '/comics',
      search,
      replace: true,
    });
  },
});

const comicsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'comics',
  validateSearch: mediaLibrarySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(
      volumeListQueryOptions(1, mediaLibraryToLegacySearch(deps), 'comic'),
    );
  },
  component: () => <ComicsPage section="comic" canonical />,
});

const mangaRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga',
  validateSearch: mediaLibrarySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(
      volumeListQueryOptions(1, mediaLibraryToLegacySearch(deps), 'manga'),
    );
  },
  component: () => <ComicsPage section="manga" canonical />,
});
const comicsAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'comics/add',
  loader: () => { throw redirect({ to: '/discover', search: { section: 'comic' }, replace: true }); },
});
const mangaAddRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'manga/add',
  loader: () => { throw redirect({ to: '/discover', search: { section: 'manga' }, replace: true }); },
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

const discoverSearchRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'discover/search',
  validateSearch: discoverResultsSearchSchema,
  component: () => {
    const search = discoverSearchRoute.useSearch();
    return <DiscoverSearchResultsPage section={search.section} q={search.q} page={search.page} />;
  },
});

const discoverAddRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'discover/add/$source/$metadataId',
  validateSearch: discoverAddSearchSchema,
  component: () => {
    const search = discoverAddRoute.useSearch();
    const params = discoverAddRoute.useParams();
    const source = params.source === 'mangadex' ? 'mangadex' : 'comicvine';
    return <DiscoverExactAddPage section={search.section} source={source} metadataId={params.metadataId} title={search.title} language={search.language} />;
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
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    if (deps.metadata_source && deps.metadata_id) {
      throw redirect({ to: '/discover/add/$source/$metadataId', params: { source: deps.metadata_source, metadataId: deps.metadata_id }, search: { section: deps.section, title: deps.title, language: deps.metadata_language }, replace: true });
    }
    throw redirect({ to: '/discover', search: { section: deps.section }, replace: true });
  },
});

// Temporary exact Add review route retained for Phase 2 replacement.
const addReviewRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'add/review',
  validateSearch: addReviewSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    throw redirect({ to: '/discover/add/$source/$metadataId', params: { source: deps.source, metadataId: deps.id }, search: { section: deps.section, title: deps.title, language: deps.language }, replace: true });
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
const volumeSettingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'volumes/$volumeId/settings',
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
    comicsRoute,
    mangaRoute,
    discoverRoute,
    discoverSearchRoute,
    discoverAddRoute,
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
    volumeSettingsRoute,
    readerRoute,
    systemRedirectRoute,
    systemStatusRoute,
    catchAllRoute,
  ]),
]);
