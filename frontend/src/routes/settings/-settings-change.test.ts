import { describe, expect, it } from 'vitest';
import { getChangedSettings, requiresRestart } from './-settings-change';
import type { AllSettings } from './-settings.types';

const saved = { host: '0.0.0.0', port: 5656, url_base: '', log_level: 'INFO' } as AllSettings;

describe('settings change detection', () => {
  it('returns only changed values', () => {
    expect(getChangedSettings({ ...saved, log_level: 'DEBUG' }, saved)).toEqual({ log_level: 'DEBUG' });
  });

  it('identifies restart-causing hosting changes', () => {
    expect(requiresRestart({ port: 5657 })).toBe(true);
    expect(requiresRestart({ log_level: 'DEBUG' })).toBe(false);
  });
});
