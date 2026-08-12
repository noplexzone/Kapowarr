import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    useSuspenseQuery: () => ({
      data: {
        volumes,
        total: volumes.length,
        offset: 0,
        page_size: 60,
      },
    }),
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

import { runVolumeTask, setVolumeMonitored } from '../-comics.api';
import { ComicsPage } from './comics-page';

function renderPage(section: 'comic' | 'manga' = 'comic') {
  return render(<ComicsPage section={section} />);
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
    expect(screen.getByRole('button', { name: 'Auto Search Selected' })).toHaveProperty('disabled', true);
  });

  it('runs visible poster actions with text labels, then clears selected cards after success', async () => {
    renderPage('manga');

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Saga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto Search Selected' }));

    await waitFor(() => expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search'));
    expect(screen.getByTestId('bulk-toolbar').textContent).toContain('0 selected');
    expect(screen.getByText('Queued search for 1 selected volume.')).toBeTruthy();
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

  it('offers direct visible card controls for monitoring and missing searches', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Monitor Berserk' }));
    await waitFor(() => expect(setVolumeMonitored).toHaveBeenCalledWith(2, true));

    fireEvent.click(screen.getByRole('button', { name: 'Search missing issues for Saga' }));
    await waitFor(() => expect(runVolumeTask).toHaveBeenCalledWith(1, 'auto_search'));
  });
});
