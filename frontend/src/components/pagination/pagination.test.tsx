import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('reports the visible range and changes zero-based pages', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageSize={60} total={1167} onPageChange={onPageChange} />);

    expect(screen.getByText('121–180 of 1167')).toBeTruthy();
    expect(screen.getByText('Page 3 of 20')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('disables navigation at either boundary', () => {
    const { rerender } = render(<Pagination page={0} pageSize={60} total={61} onPageChange={() => {}} />);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Pagination page={1} pageSize={60} total={61} onPageChange={() => {}} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
