import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const routerSource = readFileSync('src/app/router.tsx', 'utf8');

it('does not register the stale system tasks page', () => {
  expect(routerSource).not.toContain('SystemTasksPage');
  expect(routerSource).not.toContain("path: 'system/tasks'");
  expect(routerSource).not.toContain('systemTasksRoute');
});
