import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SidebarSearch } from './sidebar';

it('makes collapsed search a keyboard-operable expansion action', () => {
  const onExpand = vi.fn();
  render(
    <SidebarSearch
      collapsed
      query=""
      onQueryChange={vi.fn()}
      onSubmit={vi.fn()}
      onExpand={onExpand}
    />,
  );

  const button = screen.getByRole('button', { name: 'Open library search' });
  fireEvent.click(button);
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it('labels expanded library search and submits its value', () => {
  const onSubmit = vi.fn();
  render(
    <SidebarSearch
      collapsed={false}
      query="Saga"
      onQueryChange={vi.fn()}
      onSubmit={onSubmit}
      onExpand={vi.fn()}
    />,
  );
  const input = screen.getByRole('searchbox', { name: 'Search library' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
