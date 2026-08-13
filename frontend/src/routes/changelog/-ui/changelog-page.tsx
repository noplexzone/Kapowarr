import { Fragment, type ReactNode } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { changelogQueryOptions } from '../-changelog.api';
import type { ChangelogEntry } from '../-changelog.types';
import styles from './changelog-page.module.css';

export function ChangelogPage() {
  const { data } = useSuspenseQuery(changelogQueryOptions());
  const currentVersion = data.current_version ?? 'development build';
  const currentEntry = data.entries.find((entry) => entry.version === currentVersion);
  const unreleased = data.entries.find((entry) => entry.version.toLowerCase() === 'unreleased');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Installed version</p>
        <h1 className={styles.title}>Changelog</h1>
        <p className={styles.context}>
          Running <span className={styles.currentVersion}>Kapowarr {currentVersion}</span>
          {currentEntry ? ' — highlighted below.' : unreleased ? ' with unreleased development notes available below.' : '.'}
        </p>
      </header>
      {data.error && <div className={styles.error} role="status">{data.error}</div>}
      {data.entries.length === 0 ? (
        <div className={styles.empty}>No changelog entries are available in this build.</div>
      ) : (
        <div className={styles.entries}>
          {data.entries.map((entry) => (
            <ChangelogEntryView key={entry.anchor} entry={entry} currentVersion={currentVersion} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangelogEntryView({ entry, currentVersion }: { entry: ChangelogEntry; currentVersion: string }) {
  const isCurrent = entry.version === currentVersion;
  return (
    <article id={entry.anchor} className={styles.entry} aria-labelledby={`${entry.anchor}-heading`}>
      <div className={styles.entryHeader}>
        <h2 id={`${entry.anchor}-heading`} className={styles.entryTitle}>
          <a className={styles.versionLink} href={`#${entry.anchor}`}>{entry.version}</a>
        </h2>
        {entry.date && <time className={styles.date} dateTime={entry.date}>{entry.date}</time>}
        {isCurrent && <span className={styles.badge}>Current</span>}
      </div>
      {entry.sections.length === 0 ? (
        <div className={styles.empty}>No categorized changes.</div>
      ) : entry.sections.map((section) => (
        <section key={section.title} className={styles.section} aria-labelledby={`${entry.anchor}-${section.title}`}>
          <h3 id={`${entry.anchor}-${section.title}`} className={styles.sectionTitle}>{section.title}</h3>
          {section.items.length === 0 ? <div className={styles.empty}>No entries.</div> : (
            <ul className={styles.items}>
              {section.items.map((item, index) => <li key={index}>{renderSafeMarkdown(item)}</li>)}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}

function renderSafeMarkdown(markdown: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > lastIndex) nodes.push(markdown.slice(lastIndex, match.index));
    if (match[2]) nodes.push(<code key={match.index}>{match[2]}</code>);
    else if (match[3]) nodes.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4] && match[5]) nodes.push(<a key={match.index} href={match[5]} target="_blank" rel="noopener noreferrer">{match[4]}</a>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markdown.length) nodes.push(markdown.slice(lastIndex));
  return <Fragment>{nodes}</Fragment>;
}
