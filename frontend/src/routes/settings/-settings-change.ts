import type { AllSettings } from './-settings.types';

const HOSTING_KEYS = new Set<keyof AllSettings>([
  'host', 'port', 'url_base',
  'proxy_type', 'proxy_host', 'proxy_port',
  'proxy_username', 'proxy_password', 'proxy_ignored_addresses',
]);

export function getChangedSettings(
  current: AllSettings,
  saved: AllSettings,
): Partial<AllSettings> {
  const changed: Partial<AllSettings> = {};
  for (const key of Object.keys(current) as (keyof AllSettings)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(saved[key])) {
      (changed as Record<string, unknown>)[key] = current[key];
    }
  }
  return changed;
}

export function requiresRestart(changed: Partial<AllSettings>): boolean {
  return (Object.keys(changed) as (keyof AllSettings)[]).some((key) => HOSTING_KEYS.has(key));
}
