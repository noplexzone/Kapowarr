import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const assetsDir = new URL('../dist/assets/', import.meta.url);
const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
if (files.length === 0) throw new Error('No built JavaScript assets found; run npm run build first.');

const RAW_BUDGET = 400 * 1024;
const GZIP_BUDGET = 120 * 1024;
const results = files.map((name) => {
  const content = readFileSync(join(assetsDir.pathname, name));
  return { name, raw: content.byteLength, gzip: gzipSync(content).byteLength };
});
const violations = results.filter(({ raw, gzip }) => raw > RAW_BUDGET || gzip > GZIP_BUDGET);
for (const result of results.sort((a, b) => b.raw - a.raw)) {
  console.log(`${result.name}: ${(result.raw / 1024).toFixed(2)} KiB raw, ${(result.gzip / 1024).toFixed(2)} KiB gzip`);
}
if (violations.length) {
  throw new Error(`Build budget exceeded by: ${violations.map(({ name }) => name).join(', ')}`);
}
