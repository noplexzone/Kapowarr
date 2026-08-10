import type { SectionType, VolumesSearch, VolumeSummary } from './-comics.types';
import { getUrlBase } from '@/app/api-client';

export function formatVolumeTitle(volume: VolumeSummary): string {
  return volume.title;
}

export function getSelectionScopeKey(section: SectionType, search: VolumesSearch): string {
  return [
    section,
    search.search ?? '',
    search.filter ?? '',
    search.sort ?? '',
    search.offset ?? 0,
    search.view ?? '',
  ].join('|');
}

export function formatVolumeSubtitle(volume: VolumeSummary): string {
  const parts: string[] = [];
  if (volume.volume_number) {
    parts.push(`Vol. ${volume.volume_number}`);
  }
  if (volume.year) {
    parts.push(String(volume.year));
  }
  return parts.join(' · ');
}

export function getProgressLabel(progress: { have: number; total: number }): string {
  return `${progress.have} of ${progress.total}`;
}

export function getProgressPercent(progress: { have: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.round((progress.have / progress.total) * 100);
}

export function getCoverUrl(volumeId: number): string {
  const base = getUrlBase();
  return `${base}/api/volumes/${volumeId}/cover`;
}

export function getVolumeLink(volumeId: number): string {
  return `/comics/${volumeId}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
