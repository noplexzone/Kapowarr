import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
let searchState: Record<string, unknown>;

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
    deleteLibraryVolume: vi.fn(() => Promise.resolve()),
    runLibraryTask: vi.fn(() => Promise.resolve({ id: 10 })),
    runVolumeTask: vi.fn(() => Promise.resolve({ id: 11 })),
    setVolumeMonitored: vi.fn(() => Promise.resolve()),
  };
});

import { runVolumeTask } from '../-comics.api';
import { ComicsPage } from './comics-page';

function renderPage(section: 'comic' | 'manga' = 'comic', canonical = false) {
  return render(<ComicsPage section={section} canonical={canonical} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear(),
    },
  });
  window.history.replaceState({}, '', '/');
  searchState = {
    sort: 'title',
    filter: '',
    view: 'posters',
    search: undefined,
    offset: 0,
  };
});

afterEach(() => {
  vi.useRealTimers();
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





  it('keeps canonical filters on the canonical library route', () => {
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
      to: '/library',
      search: expect.any(Function),
    }));
    const patchSearch = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0]?.search;
    expect(patchSearch({})).toMatchObject({ section: 'comic', status: 'missing', monitoring: 'all', page: 1 });
  });

  it('switches directly between comic and manga library sections', () => {
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: 'Saga', page: 3,
    };
    renderPage('comic', true);

    expect(screen.getByRole('button', { name: 'Comics' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Manga' }));

    const navigation = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0];
    expect(navigation.to).toBe('/library');
    expect(navigation.search(searchState)).toMatchObject({
      section: 'manga', q: 'Saga', page: 1,
    });
  });

  it('persists the active library section for primary navigation', () => {
    renderPage('manga', true);

    expect(window.localStorage.getItem('kapowarr_section')).toBe(JSON.stringify('manga'));
  });

  it('keeps canonical search text on the library route', async () => {
    searchState = {
      section: 'manga', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 1,
    };
    renderPage('manga', true);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search library' }), {
      target: { value: 'Berserk' },
    });
    await waitFor(() => {
      const navigation = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0];
      expect(navigation.to).toBe('/library');
      expect(navigation.search({})).toMatchObject({ section: 'manga', q: 'Berserk', page: 1 });
    });
  });

  it('keeps a newer focused draft when an earlier debounced route value settles', () => {
    vi.useFakeTimers();
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 3,
    };
    const { rerender } = renderPage('comic', true);
    const input = screen.getByRole('searchbox', { name: 'Search library' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Bat' } });
    act(() => vi.advanceTimersByTime(350));
    const firstNavigation = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0];
    expect(firstNavigation.search({})).toMatchObject({ section: 'comic', q: 'Bat', page: 1 });

    fireEvent.change(input, { target: { value: 'Batman' } });
    searchState = { ...searchState, q: 'Bat', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);

    expect(input).toHaveProperty('value', 'Batman');
    act(() => vi.advanceTimersByTime(350));
    const finalNavigation = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0];
    expect(finalNavigation.search({})).toMatchObject({ section: 'comic', q: 'Batman', page: 1 });
  });

  it('ignores and repairs an older route settlement that arrives after the newest one', () => {
    vi.useFakeTimers();
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 3,
    };
    const { rerender } = renderPage('comic', true);
    const input = screen.getByRole('searchbox', { name: 'Search library' });

    fireEvent.change(input, { target: { value: 'Bat' } });
    act(() => vi.advanceTimersByTime(350));
    fireEvent.change(input, { target: { value: 'Batman' } });
    act(() => vi.advanceTimersByTime(350));

    searchState = { ...searchState, q: 'Batman', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);
    expect(input).toHaveProperty('value', 'Batman');

    searchState = { ...searchState, q: 'Bat', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);

    expect(input).toHaveProperty('value', 'Batman');
    const repairNavigation = navigateMock.mock.calls[navigateMock.mock.calls.length - 1]?.[0];
    expect(repairNavigation.search({})).toMatchObject({
      section: 'comic', q: 'Batman', page: 1,
    });
  });

  it('accepts browser back navigation even when it matches an abandoned local value', () => {
    vi.useFakeTimers();
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 3,
    };
    const { rerender } = renderPage('comic', true);
    const input = screen.getByRole('searchbox', { name: 'Search library' });

    fireEvent.change(input, { target: { value: 'Bat' } });
    act(() => vi.advanceTimersByTime(350));
    fireEvent.change(input, { target: { value: 'Batman' } });
    act(() => vi.advanceTimersByTime(350));
    searchState = { ...searchState, q: 'Batman', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);

    const navigationCount = navigateMock.mock.calls.length;
    window.history.replaceState({}, '', '/library?q=Bat');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    searchState = { ...searchState, q: 'Bat', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);

    expect(input).toHaveProperty('value', 'Bat');
    expect(navigateMock).toHaveBeenCalledTimes(navigationCount);
  });

  it('does not let a non-search popstate disable later settlement sequencing', () => {
    vi.useFakeTimers();
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 1,
    };
    const { rerender } = renderPage('comic', true);
    const input = screen.getByRole('searchbox', { name: 'Search library' });

    window.history.replaceState({}, '', '/library?page=2');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    fireEvent.change(input, { target: { value: 'Bat' } });
    act(() => vi.advanceTimersByTime(350));
    fireEvent.change(input, { target: { value: 'Batman' } });
    act(() => vi.advanceTimersByTime(350));
    searchState = { ...searchState, q: 'Batman', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);
    searchState = { ...searchState, q: 'Bat', page: 1 };
    rerender(<ComicsPage section="comic" canonical />);

    expect(input).toHaveProperty('value', 'Batman');
  });

  it('syncs a genuine external URL search while the settled input remains focused', () => {
    vi.useFakeTimers();
    searchState = {
      section: 'comic', sort: 'title', status: 'all', monitoring: 'all',
      view: 'grid', q: undefined, page: 1,
    };
    const { rerender } = renderPage('comic', true);
    const input = screen.getByRole('searchbox', { name: 'Search library' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Saga' } });
    act(() => vi.advanceTimersByTime(350));
    searchState = { ...searchState, q: 'Saga' };
    rerender(<ComicsPage section="comic" canonical />);

    searchState = { ...searchState, q: 'Berserk' };
    rerender(<ComicsPage section="comic" canonical />);

    expect(input).toHaveProperty('value', 'Berserk');
  });

  it('keeps discovery shortcuts out of the library header', () => {
    renderPage();

    expect(screen.queryByText('Browse')).toBeNull();
    expect(screen.queryByRole('button', { name: /Image/ })).toBeNull();
  });

  it('starts with library controls and does not render the obsolete attention banner', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Comic Library' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search library' })).toBeTruthy();
    expect(screen.queryByText(/visible volumes need attention/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Missing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Missing' })).toBeTruthy();
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

  it('does not render saved views controls or empty saved-view spacing', () => {
    renderPage();

    expect(screen.queryByText(/Saved views/i)).toBeNull();
    expect(screen.queryByText(/No saved views/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save View' })).toBeNull();
  });

  it('offers a poster overlay control for missing searches only', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Monitor Berserk' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search missing issues for Saga' }));
    await waitFor(() => expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search'));
  });
});
