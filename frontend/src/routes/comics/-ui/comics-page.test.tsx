import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
let searchState: Record<string, unknown>;

const savedFilters = [
  {
    id: 8,
    section: 'comic',
    name: 'Missing comics',
    query: { filter: 'wanted', sort: 'wanted', view: 'posters' },
    created_at: 100,
    updated_at: 100,
  },
];

const queryClientMock = {
  invalidateQueries: vi.fn(() => Promise.resolve()),
};

const volumes = [
  {
    id: 1,
    title: 'Saga',
    year: 2012,
    volume_number: 1,
    publisher: 'Image',
    monitored: true,
    root_folder: '',
    folder: '',
    special_version: '',
    progress: { have: 3, total: 10 },
    cover_url: '',
  },
  {
    id: 2,
    title: 'Berserk',
    year: 1989,
    volume_number: 1,
    publisher: 'Dark Horse',
    monitored: false,
    root_folder: '',
    folder: '',
    special_version: '',
    progress: { have: 0, total: 8 },
    cover_url: '',
  },
];

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => queryClientMock,
    useSuspenseQuery: (options: any) => {
      if (options?.queryKey?.[0] === 'saved-filters') return { data: savedFilters };
      if (options?.queryKey?.[0] === 'library-facets') return {
        data: {
          publishers: [{ value: 'Image', count: 1 }, { value: 'Dark Horse', count: 1 }],
          years: [{ value: '2012', count: 1 }, { value: '1989', count: 1 }],
          status: [{ value: 'missing', label: 'Missing', filter: 'wanted' }],
        },
      };
      return {
        data: {
          volumes,
          total: volumes.length,
          offset: 0,
          page_size: 60,
        },
      };
    },
  };
});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a href="#route" {...props}>{children}</a>,
  useNavigate: () => navigateMock,
  useSearch: () => searchState,
}));

vi.mock('@/components/authenticated-resource', () => ({
  AuthenticatedImage: ({ alt }: { alt: string }) => <img alt={alt} src="/cover-test.jpg" />,
}));

vi.mock('../-comics.api', async () => {
  const actual = await vi.importActual<typeof import('../-comics.api')>('../-comics.api');
  return {
    ...actual,
    createSavedFilter: vi.fn(() => Promise.resolve(savedFilters[0])),
    deleteLibraryVolume: vi.fn(() => Promise.resolve()),
    deleteSavedFilter: vi.fn(() => Promise.resolve()),
    runLibraryTask: vi.fn(() => Promise.resolve({ id: 10 })),
    runVolumeTask: vi.fn(() => Promise.resolve({ id: 11 })),
    setVolumeMonitored: vi.fn(() => Promise.resolve()),
  };
});

import { createSavedFilter, deleteSavedFilter, runVolumeTask } from '../-comics.api';
import { ComicsPage } from './comics-page';

function renderPage(section: 'comic' | 'manga' = 'comic', canonical = false) {
  return render(<ComicsPage section={section} canonical={canonical} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  searchState = {
    sort: 'title',
    filter: '',
    view: 'posters',
    search: undefined,
    offset: 0,
  };
});

describe('ComicsPage poster-first manage mode', () => {
  it('keeps bulk operations inert until at least one visible poster is selected', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('0 selected');
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Monitor Selected' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Search Missing Selected' })).toHaveProperty('disabled', true);
  });

  it('runs visible poster actions with text labels, then clears selected cards after success', async () => {
    renderPage('manga');

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Saga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search Missing Selected' }));

    await waitFor(() => expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search'));
    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('0 selected');
    expect(screen.getByText('Queued missing search for 1 selected volume.')).toBeTruthy();
  });

  it('clears selection when the exact visible result scope changes', () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Saga' }));
    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('1 selected');

    searchState = { ...searchState, filter: 'wanted' };
    rerender(<ComicsPage section="comic" />);

    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('0 selected');
  });





  it('keeps canonical filters on the active comics or manga route', () => {
    searchState = {
      sort: 'title',
      status: 'all',
      monitoring: 'all',
      view: 'grid',
      q: undefined,
      page: 1,
    };
    renderPage('comic', true);

    fireEvent.click(screen.getByRole('button', { name: 'Missing' }));
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '/comics',
      search: expect.any(Function),
    }));
    const patchSearch = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0]?.search;
    expect(patchSearch({})).toMatchObject({ status: 'missing', monitoring: 'all', page: 1 });
  });

  it('keeps discovery shortcuts out of the library header', () => {
    renderPage();

    expect(screen.queryByText('Browse')).toBeNull();
    expect(screen.queryByRole('button', { name: /Image/ })).toBeNull();
  });

  it('keeps the phase 3 library header compact without wanted triage banners', () => {
    renderPage();

    expect(screen.queryByText(/visible volumes need attention/)).toBeNull();
    expect(screen.queryByText('Saved views')).toBeNull();
    expect(screen.getByRole('button', { name: 'Missing' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Sort library' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ascending' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descending' })).toBeTruthy();
  });

  it('only queues selected missing volumes from the manage toolbar', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Saga' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Berserk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search Missing Selected' }));

    await waitFor(() => {
      expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search');
      expect(runVolumeTask).toHaveBeenCalledWith(2, 'auto_search');
    });
    expect(screen.getByText('Queued missing search for 2 selected volumes.')).toBeTruthy();
    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('0 selected');
  });

  it('removes saved views while keeping the Missing status filter URL-backed', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Missing comics' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save View' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Missing' }));
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '/comics',
      search: expect.any(Function),
    }));
    const lastSearch = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0]?.search;
    expect(lastSearch({})).toMatchObject({ filter: 'wanted', offset: 0 });
    expect(createSavedFilter).not.toHaveBeenCalled();
    expect(deleteSavedFilter).not.toHaveBeenCalled();
  });

  it('offers a poster overlay control for missing searches only', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Monitor Berserk' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search missing issues for Saga' }));
    await waitFor(() => expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search'));
  });
});
