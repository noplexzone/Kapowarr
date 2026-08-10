import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/app/api-client', () => ({ apiClient: { get: vi.fn() } }));
import { apiClient } from '@/app/api-client';
import { AuthenticatedImage } from './authenticated-resource';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:cover'), revokeObjectURL: vi.fn() });
});

it('loads protected images through the authenticated API client and revokes the blob URL', async () => {
  vi.mocked(apiClient.get).mockReturnValue({ blob: vi.fn(async () => new Blob(['cover'])) } as never);
  const view = render(<AuthenticatedImage endpoint="volumes/7/cover" alt="Cover" />);
  await waitFor(() => expect(view.getByAltText('Cover').getAttribute('src')).toBe('blob:cover'));
  expect(apiClient.get).toHaveBeenCalledWith('volumes/7/cover', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
});
