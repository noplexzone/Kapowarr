import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField, StatusBanner } from './patterns';

describe('shared UI patterns', () => {
  it('associates labels, help, and errors with the control', () => {
    render(
      <FormField label="Library path" help="Absolute path" error="Path is required">
        {(props) => <input {...props} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Library path');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain(screen.getByText('Absolute path').id);
    expect(describedBy).toContain(screen.getByText('Path is required').id);
  });

  it('uses one explicit live status surface', () => {
    render(<StatusBanner>Settings saved.</StatusBanner>);
    expect(screen.getByRole('status').textContent).toBe('Settings saved.');
  });
});
