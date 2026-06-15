import { useState, useDeferredValue, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import {
  discoveryVolumeQueryOptions,
  storyArcsQueryOptions,
  storyArcDetailQueryOptions,
} from '../-discovery.api';
import type { DiscoveryVolume, StoryArc, DiscoveryType, DiscoverySection } from '../-discovery.types';
import styles from './discovery-page.module.css';

interface DiscoveryPageProps {
  section: DiscoverySection;
  type: DiscoveryType;
}

export function DiscoveryPage({ section, type }: DiscoveryPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [arcId, setArcId] = useState<number | null>(null);
  const [rawArcSearch, setRawArcSearch] = useState('');
  const arcSearch = useDeferredValue(rawArcSearch);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
    // Brief visual feedback — the refetch will update isFetching
    setTimeout(() => setRefreshing(false), 600);
  }, [queryClient]);

  const setSection = (s: DiscoverySection) =>
    navigate({ to: '/discovery', search: (prev: Record<string, unknown>) => ({ ...prev, section: s }) });
  const setType = (t: DiscoveryType) =>
    navigate({ to: '/discovery', search: (prev: Record<string, unknown>) => ({ ...prev, type: t }) });

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab}${type === 'upcoming' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('upcoming')}
          >
            Upcoming
          </button>
          <button
            className={`${styles.tab}${type === 'new' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('new')}
          >
            New
          </button>
          <button
            className={`${styles.tab}${type === 'story-arcs' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setType('story-arcs')}
          >
            Story Arcs
          </button>
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.sectionToggle}>
            <button
              className={`${styles.sectionBtn}${section === 'comic' ? ` ${styles.sectionActive}` : ''}`}
              onClick={() => setSection('comic')}
            >
              Comics
            </button>
            <button
              className={`${styles.sectionBtn}${section === 'manga' ? ` ${styles.sectionActive}` : ''}`}
              onClick={() => setSection('manga')}
            >
              Manga
            </button>
          </div>
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh from ComicVine"
          >
            ↻
          </button>
        </div>
      </div>

      {type === 'story-arcs' ? (
        <StoryArcsView
          section={section}
          query={arcSearch}
          rawQuery={rawArcSearch}
          onQueryChange={setRawArcSearch}
          onSelectArc={setArcId}
        />
      ) : (
        <VolumeGridView type={type} section={section} />
      )}

      {arcId != null && (
        <ArcDetailModal id={arcId} section={section} onClose={() => setArcId(null)} />
      )}
    </div>
  );
}

function VolumeGridView({ type, section }: { type: 'upcoming' | 'new'; section: DiscoverySection }) {
  const navigate = useNavigate();
  const { data: volumes = [], isFetching } = useQuery(discoveryVolumeQueryOptions(type, section));

  const handleClick = (_vol: DiscoveryVolume) => {
    navigate({ to: '/add', search: { section } });
  };

  if (isFetching && volumes.length === 0) {
    return <div className={styles.empty}>Loading…</div>;
  }

  if (volumes.length === 0) {
    return <div className={styles.empty}>No {type} titles found</div>;
  }

  return (
    <div className={styles.grid}>
      {volumes.map((vol) => (
        <VolumeCard key={vol.comicvine_id} volume={vol} onClick={handleClick} />
      ))}
    </div>
  );
}

function VolumeCard({ volume, onClick }: { volume: DiscoveryVolume; onClick: (v: DiscoveryVolume) => void }) {
  const isAdded = volume.already_added != null;
  const coverSrc = volume.cover_link || null;

  return (
    <div className={styles.volumeCard}>
      <div className={styles.coverWrap}>
        {coverSrc ? (
          <img src={coverSrc} alt={volume.title} className={styles.cover} loading="lazy" />
        ) : (
          <div className={styles.coverPlaceholder}>📚</div>
        )}
        <div className={styles.overlayActions}>
          {isAdded ? (
            <span className={styles.overlayInLibrary}>✓ In Library</span>
          ) : (
            <button className={styles.overlayAddBtn} onClick={() => onClick(volume)}>+ Add</button>
          )}
        </div>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{volume.title}</div>
        {volume.issue_number != null ? (
          <div className={styles.cardMeta}>
            {volume.issue_number ? `#${volume.issue_number}` : ''}
            {volume.cover_date ? ` · ${volume.cover_date}` : ''}
          </div>
        ) : (
          <div className={styles.cardMeta}>
            {[
              volume.year,
              volume.publisher,
              volume.issue_count != null ? `${volume.issue_count} issue${volume.issue_count !== 1 ? 's' : ''}` : null,
              volume.date_added,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

interface StoryArcsViewProps {
  section: DiscoverySection;
  query: string;
  rawQuery: string;
  onQueryChange: (q: string) => void;
  onSelectArc: (id: number) => void;
}

function StoryArcsView({ section, query, rawQuery, onQueryChange, onSelectArc }: StoryArcsViewProps) {
  const { data: arcs = [], isFetching } = useQuery(storyArcsQueryOptions(query, section));

  return (
    <div className={styles.arcsView}>
      <input
        className={styles.searchInput}
        type="search"
        placeholder="Search story arcs…"
        value={rawQuery}
        onChange={e => onQueryChange(e.target.value)}
        autoFocus
      />

      {rawQuery.length < 2 ? (
        <div className={styles.empty}>Type at least 2 characters to search</div>
      ) : isFetching ? (
        <div className={styles.empty}>Searching…</div>
      ) : arcs.length === 0 ? (
        <div className={styles.empty}>No story arcs found for &ldquo;{rawQuery}&rdquo;</div>
      ) : (
        <div className={styles.arcList}>
          {(arcs as StoryArc[]).map((arc) => (
            <div
              key={arc.id}
              className={styles.arcItem}
              onClick={() => onSelectArc(arc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelectArc(arc.id)}
            >
              <span className={styles.arcName}>{arc.name}</span>
              {arc.issue_count != null && (
                <Badge tone="neutral">{arc.issue_count} issues</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArcDetailModal({ id, section, onClose }: { id: number; section: DiscoverySection; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(storyArcDetailQueryOptions(id));

  return (
    <DialogFrame open onOpenChange={open => !open && onClose()}>
      <DialogHeader title="Story Arc Volumes" onClose={onClose} />
      <DialogBody>
        {isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : !data || data.volumes.length === 0 ? (
          <div className={styles.empty}>No volumes found for this arc</div>
        ) : (
          <div className={styles.grid}>
            {data.volumes.map((vol) => (
              <VolumeCard
                key={vol.comicvine_id}
                volume={vol}
                onClick={() => {
                  onClose();
                  navigate({ to: '/add', search: { section } });
                }}
              />
            ))}
          </div>
        )}
      </DialogBody>
    </DialogFrame>
  );
}
