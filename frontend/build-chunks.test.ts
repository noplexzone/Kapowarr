import { expect, it } from 'vitest';
import { chunkForModule } from './build-chunks';

it('splits major vendor families into stable chunks', () => {
  expect(chunkForModule('/repo/node_modules/react/index.js')).toBe('vendor-react');
  expect(chunkForModule('/repo/node_modules/@tanstack/react-query/build/index.js')).toBe('vendor-react');
  expect(chunkForModule('/repo/node_modules/recharts/es6/index.js')).toBe('vendor-charts');
  expect(chunkForModule('/repo/node_modules/@base-ui/react/index.js')).toBe('vendor-ui');
  expect(chunkForModule('/repo/node_modules/socket.io-client/build/index.js')).toBe('vendor-socket');
  expect(chunkForModule('/repo/node_modules/ky/distribution/index.js')).toBeUndefined();
  expect(chunkForModule('/repo/src/app/router.tsx')).toBeUndefined();
});
