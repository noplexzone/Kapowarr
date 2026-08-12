import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PWA_THEME_COLOR } from './runtime-config';

describe('PWA manifest identity', () => {
  it('uses Kapowarr Noir install colors and relative install assets', () => {
    const manifest = JSON.parse(fs.readFileSync('./public/manifest.json', 'utf8')) as {
      name: string;
      description: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; purpose?: string }>;
    };

    expect(manifest.name).toBe('Kapowarr');
    expect(manifest.description).toMatch(/Premium comic and manga media manager/);
    expect(manifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(manifest.background_color).toBe(PWA_THEME_COLOR);
    expect(manifest.icons.map(icon => icon.src)).toEqual(expect.arrayContaining(['./icon-192.png', './icon-512.png', './favicon.svg']));
    expect(manifest.icons.every(icon => icon.src.startsWith('./'))).toBe(true);
  });
});
