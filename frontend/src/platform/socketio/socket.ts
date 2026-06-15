import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { getUrlBase } from '@/app/api-client';

const socket: Socket = io(window.location.origin, {
  path: `${getUrlBase()}/socket.io`,
  autoConnect: true,
});

window.addEventListener('beforeunload', () => {
  socket.disconnect();
});

export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void): void {
  useEffect(() => {
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler]);
}

export { socket };
