import { z } from 'zod';
import type { AllSettings } from './-settings.types';

const settingsSchema = z.object({
  host: z.string().min(1, 'Host is required.'),
  port: z.number().int('Port must be a whole number.').min(1, 'Port must be between 1 and 65535.').max(65535, 'Port must be between 1 and 65535.'),
  proxy_port: z.number().int('Proxy port must be a whole number.').min(0, 'Proxy port cannot be negative.').max(65535, 'Proxy port must not exceed 65535.'),
  volume_as_issue_padding: z.number().int().min(0, 'Padding cannot be negative.').max(10, 'Padding must not exceed 10.'),
  volume_padding: z.number().int().min(1, 'Padding must be at least 1.').max(10, 'Padding must not exceed 10.'),
  issue_padding: z.number().int().min(1, 'Padding must be at least 1.').max(10, 'Padding must not exceed 10.'),
  concurrent_direct_downloads: z.number().int().min(1, 'At least one direct download is required.'),
  failing_download_timeout: z.number().min(0, 'Timeout cannot be negative.'),
}).partial().passthrough();

export function validateChangedSettings(changed: Partial<AllSettings>) {
  const result = settingsSchema.safeParse(changed);
  if (result.success) return { data: changed, errors: {} as Partial<Record<keyof AllSettings, string>> };
  const errors: Partial<Record<keyof AllSettings, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof AllSettings | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { data: null, errors };
}
