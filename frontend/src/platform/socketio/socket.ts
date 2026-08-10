import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { runtimeConfig } from '@/app/runtime-config';

const socket: Socket = io(window.location.origin, {
  path: runtimeConfig.socketPath,
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
