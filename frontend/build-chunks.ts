export function chunkForModule(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined;
  if (id.includes('/@base-ui/')) return 'vendor-ui';
  if (
    id.includes('/react/')
    || id.includes('/react-dom/')
    || id.includes('/scheduler/')
    || id.includes('/@tanstack/')
  ) return 'vendor-react';
  if (id.includes('/recharts/') || id.includes('/d3-')) return 'vendor-charts';
  if (id.includes('/socket.io-client/') || id.includes('/engine.io-client/')) return 'vendor-socket';
  return undefined;
}
