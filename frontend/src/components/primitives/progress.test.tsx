import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Progress } from './progress';

describe('Progress', () => {
  it('has an accessible name and clamps its value', () => {
    render(<Progress value={140} />);
    expect(screen.getByRole('progressbar', { name: '100% complete' }).getAttribute('aria-valuenow')).toBe('100');
  });

  it('allows a contextual accessible name', () => {
    render(<Progress value={25} aria-label="Volume download progress" />);
    expect(screen.getByRole('progressbar', { name: 'Volume download progress' })).toBeTruthy();
  });
});
