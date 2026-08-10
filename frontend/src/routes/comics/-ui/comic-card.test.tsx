import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a href="#volume" {...props}>{children}</a>,
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
  it('provides direct named select, monitoring, and search controls', () => {
    const onSelect = vi.fn();
    const onMonitor = vi.fn();
    const onSearch = vi.fn();
    render(
      <ComicCard volume={volume} selected={false} onSelect={onSelect} onMonitor={onMonitor} onSearch={onSearch} />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Saga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmonitor Saga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto search Saga' }));
    expect(onSelect).toHaveBeenCalledWith(7);
    expect(onMonitor).toHaveBeenCalledWith(7, false);
    expect(onSearch).toHaveBeenCalledWith(7);
  });
});
