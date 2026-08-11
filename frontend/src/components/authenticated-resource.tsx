import { useEffect, useState, type ComponentProps } from 'react';
import { apiClient } from '@/app/api-client';

export function useAuthenticatedObjectUrl(endpoint: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!endpoint) { setObjectUrl(null); return; }
    const controller = new AbortController();
    let created: string | null = null;
    apiClient.get(endpoint, { signal: controller.signal })
      .blob()
      .then((blob) => {
        if (controller.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('Authenticated resource failed to load', error);
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [endpoint]);
  return objectUrl;
}

type AuthenticatedImageProps = Omit<ComponentProps<'img'>, 'src'> & { endpoint: string };
export function AuthenticatedImage({ endpoint, alt, ...props }: AuthenticatedImageProps) {
  const src = useAuthenticatedObjectUrl(endpoint);
  return src ? <img {...props} src={src} alt={alt} /> : null;
}
