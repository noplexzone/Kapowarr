import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const routerSource = readFileSync('src/app/router.tsx', 'utf8');

it('does not register the stale system tasks page', () => {
  expect(routerSource).not.toContain('SystemTasksPage');
  expect(routerSource).not.toContain("path: 'system/tasks'");
  expect(routerSource).not.toContain('systemTasksRoute');
});


it('redirects obsolete generic add URLs while retaining exact add review temporarily', () => {
  expect(routerSource).toContain("path: 'add'");
  expect(routerSource).toContain("Temporary exact Add review route retained for Phase 2 replacement");
  expect(routerSource).toContain("to: '/discover'");
  expect(routerSource).not.toContain('component: AddPage');
});

it('does not register obsolete story arcs routes or PageHeader chrome', () => {
  expect(routerSource).not.toContain('StoryArcs');
  const patternsSource = readFileSync('src/components/patterns/patterns.tsx', 'utf8');
  expect(patternsSource).not.toContain('PageHeader');
});
