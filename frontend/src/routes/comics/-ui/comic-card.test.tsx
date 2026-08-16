import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a href="#volume" {...props}>{children}</a>,
}));
vi.mock('@/components/authenticated-resource', () => ({
  AuthenticatedImage: ({ alt }: { alt: string }) => <img alt={alt} src="/cover-test.jpg" />,
}));

import { ComicCard } from './comic-card';

const volume = {
  id: 7,
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
};

describe('ComicCard actions', () => {
  it('provides compact named action tray controls in browse mode', () => {
    const onSelect = vi.fn();
    const onSearch = vi.fn();
    const onMonitor = vi.fn();
    render(
      <ComicCard volume={volume} selected={false} onSelect={onSelect} onSearch={onSearch} onMonitor={onMonitor} />,
    );

    expect(screen.queryByRole('checkbox', { name: 'Select Saga' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search missing issues for Saga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmonitor Saga' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSearch).toHaveBeenCalledWith(7);
    expect(onMonitor).toHaveBeenCalledWith(7, false);
  });

  it('keeps a compact indicator inside an accessible hit target', () => {
    render(<ComicCard volume={volume} selected selectionVisible onSelect={vi.fn()} onSearch={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select Saga' });
    const target = screen.getByTestId('selection-hit-target');
    expect(getComputedStyle(checkbox).width).toBe('22px');
    expect(getComputedStyle(checkbox).height).toBe('22px');
    expect(getComputedStyle(target).width).toBe('44px');
    expect(getComputedStyle(target).height).toBe('44px');
  });

  it('hides the poster search affordance when the volume is complete', () => {
    render(
      <ComicCard
        volume={{ ...volume, progress: { have: 10, total: 10 } }}
        selected={false}
        onSelect={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Search missing issues for Saga' })).toBeNull();
    expect(screen.getByText('Complete')).toBeTruthy();
  });

});
