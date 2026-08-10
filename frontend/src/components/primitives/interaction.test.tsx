import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkActionBar, SegmentedControl, SelectionControl, Skeleton } from './interaction';

describe('shared interaction primitives', () => {
  it('renders a labelled single-select segmented control with roving keyboard selection', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Library section" value="comic" options={[{ value: 'comic', label: 'Comics' }, { value: 'manga', label: 'Manga' }]} onChange={onChange} />);
    const comics = screen.getByRole('radio', { name: 'Comics' });
    const manga = screen.getByRole('radio', { name: 'Manga' });
    expect(comics.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(comics, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('manga');
    fireEvent.click(manga);
    expect(onChange).toHaveBeenLastCalledWith('manga');
  });

  it('keeps the checkbox indicator compact while exposing an accessible control', () => {
    render(<SelectionControl checked={false} onChange={() => undefined} label="Select Akira" />);
    expect(screen.getByRole('checkbox', { name: 'Select Akira' })).toBeTruthy();
    expect(screen.getByTestId('selection-indicator')).toBeTruthy();
  });

  it('announces the selected count and exposes clear selection', () => {
    const clear = vi.fn();
    render(<BulkActionBar count={3} onClear={clear}><button>Monitor</button></BulkActionBar>);
    expect(screen.getByRole('status').textContent).toContain('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('marks skeletons as hidden presentation rather than fake content', () => {
    render(<Skeleton label="Loading covers" />);
    expect(screen.getByLabelText('Loading covers').getAttribute('aria-busy')).toBe('true');
  });
});
