import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutePending } from './route-state';

afterEach(() => vi.useRealTimers());
it('delays page loading feedback so quick route transitions do not flash', () => {
  vi.useFakeTimers();
  render(<RoutePending />);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(149));
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole('status').textContent).toContain('Loading');
});
