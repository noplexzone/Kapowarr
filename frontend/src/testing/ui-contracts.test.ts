import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const indexCss = read('../index.css');
const buttonCss = read('../components/primitives/button.module.css');
const volumeCss = read('../routes/volumes/-ui/volume-detail-page.module.css');
const dashboardCss = read('../routes/dashboard/-ui/dashboard-page.module.css');
const historyCss = read('../routes/activity/history/-ui/history-page.module.css');
const blocklistCss = read('../routes/activity/blocklist/-ui/blocklist-page.module.css');
const routerSource = read('../app/router.tsx');

describe('responsive and accessibility contracts', () => {
  it('keeps keyboard focus, reduced motion, and touch targets explicit', () => {
    expect(indexCss).toContain(':focus-visible');
    expect(indexCss).toContain('prefers-reduced-motion: reduce');
    expect(indexCss).toContain('--touch-target: 2.75rem');
    expect(buttonCss).toContain('var(--touch-target');
    expect(indexCss).not.toMatch(/@media[^}]+html\s*\{[^}]*font-size/s);
  });

  it('turns the primary issue table into labelled mobile cards', () => {
    expect(volumeCss).toContain('.issueRow td::before');
    expect(volumeCss).toContain('content: attr(data-label)');
    expect(volumeCss).toMatch(/@media \(max-width: 700px\)[\s\S]*\.tableWrap\s*\{[\s\S]*overflow: visible/);
  });

  it('uses a mobile poster grid instead of nested horizontal scrolling', () => {
    const mobileDashboard = dashboardCss.slice(dashboardCss.indexOf('@media (max-width: 768px)'));
    expect(mobileDashboard).toContain('grid-template-columns: repeat(2');
    expect(mobileDashboard).not.toContain('overflow-x: auto');
  });

  it('turns activity tables into labelled mobile cards', () => {
    for (const css of [historyCss, blocklistCss]) {
      const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
      expect(mobile).toContain('overflow-x: visible');
      expect(mobile).toContain('content: attr(data-label)');
      expect(mobile).toContain('.table thead { display: none; }');
    }
  });

  it('keeps route resilience and heavy-page splitting configured', () => {
    expect(routerSource).toContain('pendingComponent: RoutePending');
    expect(routerSource).toContain('errorComponent: RouteError');
    expect(routerSource).toContain("lazy(() => import('@/routes/volumes/-ui/volume-detail-page')");
    expect(routerSource).toContain("lazy(() => import('@/routes/settings/-ui/settings-page')");
  });
});
