# -*- coding: utf-8 -*-

"""
Setting up the database, handling connections, using it and closing it.
"""

from __future__ import annotations

from os.path import dirname, exists, isdir, join
from sqlite3 import (PARSE_DECLTYPES, Connection, Cursor, ProgrammingError,
                     Row, register_adapter, register_converter)
from threading import current_thread
from time import time
from typing import Any, Dict, Iterable, Iterator, List, Type, Union

from flask import g

from backend.base.definitions import (Constants, DateType, FileDate, ProxyType,
                                      SeedingHandling, SpecialVersion, T)
from backend.base.files import create_folder, folder_path
from backend.base.helpers import CommaList, current_thread_id
from backend.base.logging import LOGGER, set_log_level


class KapowarrCursor(Cursor):
    row_factory: Union[Type[Row], None] # type: ignore

    @property
    def lastrowid(self) -> int:
        return super().lastrowid or 1

    @property
    def connection(self) -> DBConnection:
        return super().connection # type: ignore

    def __init__(self, cursor: DBConnection, /) -> None:
        super().__init__(cursor)
        return

    def fetchonedict(self) -> Union[Dict[str, Any], None]:
        """Same as `fetchone` but convert the Row object to a dict.

        Returns:
            Union[Dict[str, Any], None]: The dict or None in case of no result.
        """
        r = self.fetchone()
        if r is None:
            return r
        return dict(r)

    def fetchmanydict(self, size: Union[int, None] = 1) -> List[Dict[str, Any]]:
        """Same as `fetchmany` but convert the Row object to a dict.

        Args:
            size (Union[int, None], optional): The amount of rows to return.
                Defaults to 1.

        Returns:
            List[Dict[str, Any]]: The rows.
        """
        return [dict(e) for e in self.fetchmany(size)]

    def fetchalldict(self) -> List[Dict[str, Any]]:
        """Same as `fetchall` but convert the Row object to a dict.

        Returns:
            List[Dict[str, Any]]: The results.
        """
        return [dict(e) for e in self]

    def exists(self) -> Union[Any, None]:
        """Return the first column of the first row, or `None` if not found.

        Returns:
            Union[Any, None]: The value of the first column of the first row,
                or `None` if not found.
        """
        r = self.fetchone()
        if r is None:
            return r
        return r[0]

    def __enter__(self):
        """Start a transaction"""
        self.connection.isolation_level = None
        self.execute("BEGIN TRANSACTION;")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Commit the transaction or rollback if an exception occurred"""
        if self.connection.in_transaction:
            if exc_type is not None:
                self.execute("ROLLBACK;")
            else:
                self.execute("COMMIT;")

        self.connection.isolation_level = "DEFERRED"
        return


class DBConnectionManager(type):
    instances: Dict[int, DBConnection] = {}

    def __call__(cls, **kwargs: Any) -> DBConnection:
        thread_id = current_thread_id()

        if (
            not thread_id in cls.instances
            or cls.instances[thread_id].closed
        ):
            cls.instances[thread_id] = super().__call__(**kwargs)

        return cls.instances[thread_id]

    @classmethod
    def close_connection_of_thread(cls) -> None:
        """Close the DB connection of the current thread"""
        thread_id = current_thread_id()
        if (
            thread_id in cls.instances
            and not cls.instances[thread_id].closed
        ):
            cls.instances[thread_id].close()
            del cls.instances[thread_id]
        return


class DBConnection(Connection, metaclass=DBConnectionManager):
    file = ''

    def __init__(
        self, *,
        timeout: float = Constants.DB_TIMEOUT
    ) -> None:
        """Create a connection with a database

        Args:
            timeout (float, optional): How long to wait before giving up
                on a command.
                Defaults to Constants.DB_TIMEOUT.
        """
        self.closed = False
        LOGGER.debug(f'Creating connection {self}')
        super().__init__(
            self.file,
            timeout=timeout,
            detect_types=PARSE_DECLTYPES
        )
        super().cursor().execute("PRAGMA foreign_keys = ON;")
        return

    def cursor( # type: ignore
        self,
        force_new: bool = False
    ) -> KapowarrCursor:
        """Get a database cursor from the connection.

        Args:
            force_new (bool, optional): Get a new cursor instead of the cached
                one.
                Defaults to False.

        Returns:
            KapowarrCursor: The database cursor.
        """
        if not hasattr(g, 'cursors'):
            g.cursors = []

        if not g.cursors:
            c = KapowarrCursor(self)
            c.row_factory = Row
            g.cursors.append(c)

        if not force_new:
            return g.cursors[0]
        else:
            c = KapowarrCursor(self)
            c.row_factory = Row
            g.cursors.append(c)
            return g.cursors[-1]

    def close(self) -> None:
        """Close the database connection"""
        LOGGER.debug(f'Closing connection {self}')
        self.closed = True
        super().close()
        return

    def __repr__(self) -> str:
        return f'<{self.__class__.__name__}; {current_thread().name}; {id(self)}; closed={self.closed}>'


def set_db_location(
    db_folder: Union[str, None]
) -> None:
    """Setup database location. Create folder for database and set location for
    `db.DBConnection`.

    Args:
        db_folder (Union[str, None], optional): The folder in which the database
            will be stored or in which a database is for Kapowarr to use. Give
            `None` for the default location.

    Raises:
        ValueError: Value of `db_folder` exists but is not a folder.
    """
    if db_folder:
        if exists(db_folder) and not isdir(db_folder):
            raise ValueError('Database location is not a folder')

    db_file_location = join(
        db_folder or folder_path(*Constants.DB_FOLDER),
        Constants.DB_NAME
    )

    LOGGER.debug(f'Setting database location: {db_file_location}')

    create_folder(dirname(db_file_location))

    DBConnection.file = db_file_location

    return


def get_db(force_new: bool = False) -> KapowarrCursor:
    """Get a database cursor instance or create a new one if needed.

    Args:
        force_new (bool, optional): Decides whether a new cursor is
            returned instead of the standard one.
            Defaults to False.

    Returns:
        KapowarrCursor: Database cursor instance that outputs Row objects.
    """
    return DBConnection().cursor(force_new=force_new)


def commit() -> None:
    """Commit the database changes"""
    get_db().connection.commit()
    return


def iter_commit(iterable: Iterable[T]) -> Iterator[T]:
    """Commit the database after yielding each value in the iterable. Also
    commits just before the first iteration starts.

    ```
    # commits
    for i in iter_commit(iterable):
        ...
        # commits
    ```

    Args:
        iterable (Iterable[T]): Iterable that will be iterated over like normal.

    Yields:
        Iterator[T]: Items of iterable.
    """
    commit = get_db().connection.commit
    commit()
    for i in iterable:
        yield i
        commit()
    return


def close_db(e: Union[BaseException, None] = None) -> None:
    """Close database cursor, commit database and close database.

    Args:
        e (Union[BaseException, None], optional): Error. Defaults to None.
    """
    if not hasattr(g, 'cursors'):
        return

    try:
        cursors = g.cursors
        db: DBConnection = cursors[0].connection
        for c in cursors:
            c.close()
        delattr(g, 'cursors')
        db.commit()
        if not current_thread().name.startswith('waitress-'):
            DBConnectionManager.close_connection_of_thread()

    except ProgrammingError:
        pass

    return


def setup_db_adapters_and_converters() -> None:
    """Add DB adapters and converters for custom types and bool"""
    register_adapter(bool, lambda b: int(b))
    register_converter("BOOL", lambda b: b == b'1')
    register_adapter(CommaList, lambda c: str(c))
    register_adapter(ProxyType, lambda e: e.value)
    register_adapter(FileDate, lambda e: e.value)
    register_adapter(SeedingHandling, lambda e: e.value)
    register_adapter(SpecialVersion, lambda e: e.value)
    register_adapter(DateType, lambda e: e.value)
    return


def setup_db() -> None:
    """Setup the default config and database connection and tables"""
    from backend.internals.db_migration import (
        DatabaseMigrationHandler,
        _ensure_metron_base_schema,
    )
    from backend.internals.settings import Settings, task_intervals

    cursor = get_db()
    cursor.execute("PRAGMA journal_mode = wal;")
    setup_db_adapters_and_converters()

    # Normalize the experimental version-58 Metron schema before the full
    # schema bootstrap creates indexes that depend on final Metron columns.
    _ensure_metron_base_schema(cursor)
    cursor.executescript(DB_SCHEMA)

    settings = Settings()
    settings_values = settings.get_settings()

    set_log_level(settings_values.log_level)

    DatabaseMigrationHandler.migrate()
    DatabaseMigrationHandler.ensure_current_invariants()

    # Generate api key
    if not settings_values.api_key:
        settings.generate_api_key()

    # Add task intervals
    LOGGER.debug(f'Inserting task intervals: {task_intervals}')
    current_time = round(time())
    cursor.executemany(
        """
        INSERT INTO task_intervals
        VALUES (?, ?, ?)
        ON CONFLICT(task_name) DO
        UPDATE
        SET
            interval = ?;
        """,
        ((k, v, current_time, v) for k, v in task_intervals.items())
    )

    return


DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS config(
    key VARCHAR(100) PRIMARY KEY,
    value BLOB
);
CREATE TABLE IF NOT EXISTS root_folders(
    id INTEGER PRIMARY KEY,
    folder VARCHAR(254) UNIQUE NOT NULL,
    section VARCHAR(10) NOT NULL DEFAULT 'comic'
);
CREATE TABLE IF NOT EXISTS volumes(
    id INTEGER PRIMARY KEY,
    comicvine_id INTEGER NOT NULL,
    metadata_source VARCHAR(50) NOT NULL DEFAULT 'comicvine',
    metadata_id TEXT NOT NULL DEFAULT '',
    metadata_language VARCHAR(20) NOT NULL DEFAULT 'en',
    title VARCHAR(255) NOT NULL,
    alt_title VARCHAR(255),
    year INTEGER(5),
    publisher VARCHAR(255),
    volume_number INTEGER(8) DEFAULT 1,
    description TEXT,
    site_url TEXT NOT NULL DEFAULT "",
    monitored BOOL NOT NULL DEFAULT 0,
    monitor_new_issues BOOL NOT NULL DEFAULT 1,
    root_folder INTEGER NOT NULL,
    folder TEXT,
    custom_folder BOOL NOT NULL DEFAULT 0,
    last_cv_fetch INTEGER(8) DEFAULT 0,
    special_version VARCHAR(255),
    special_version_locked BOOL NOT NULL DEFAULT 0,

    FOREIGN KEY (root_folder) REFERENCES root_folders(id)
);
CREATE INDEX IF NOT EXISTS volumes_root_folder_idx
    ON volumes(root_folder);
CREATE INDEX IF NOT EXISTS root_folders_section_idx
    ON root_folders(section);
CREATE TABLE IF NOT EXISTS volumes_covers(
    volume_id INTEGER UNIQUE NOT NULL,
    cover BLOB,
    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS volumes_covers_volume_id_index
    ON volumes_covers(volume_id);
CREATE TABLE IF NOT EXISTS issues(
    id INTEGER PRIMARY KEY,
    volume_id INTEGER NOT NULL,
    comicvine_id INTEGER NOT NULL UNIQUE,
    issue_number VARCHAR(20) NOT NULL,
    calculated_issue_number FLOAT(20) NOT NULL,
    title VARCHAR(255),
    date VARCHAR(10),
    description TEXT,
    monitored BOOL NOT NULL DEFAULT 1,

    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS issues_volume_number_index
    ON issues(volume_id, calculated_issue_number);
CREATE INDEX IF NOT EXISTS issues_volume_index
    ON issues(volume_id);
CREATE INDEX IF NOT EXISTS issues_date_idx
    ON issues(date);
CREATE INDEX IF NOT EXISTS issues_monitored_date_idx
    ON issues(monitored, date);
CREATE TABLE IF NOT EXISTS files(
    id INTEGER PRIMARY KEY,
    filepath TEXT UNIQUE NOT NULL,
    size INTEGER,
    exists_on_disk BOOL NOT NULL DEFAULT 1,
    missing_since INTEGER
);
CREATE TABLE IF NOT EXISTS issues_files(
    file_id INTEGER NOT NULL,
    issue_id INTEGER NOT NULL,
    forced BOOL NOT NULL DEFAULT 0,

    FOREIGN KEY (file_id) REFERENCES files(id)
        ON DELETE CASCADE,
    FOREIGN KEY (issue_id) REFERENCES issues(id),
    CONSTRAINT PK_issues_files PRIMARY KEY (
        file_id,
        issue_id
    )
);
CREATE INDEX IF NOT EXISTS issues_files_issue_id_index
    ON issues_files(issue_id);
CREATE INDEX IF NOT EXISTS issues_files_file_id_index
    ON issues_files(file_id);
CREATE TABLE IF NOT EXISTS file_match_conflicts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_id INTEGER NOT NULL,
    file_id INTEGER,
    filepath TEXT NOT NULL DEFAULT '',
    proposed_issue_id INTEGER,
    proposed_issue_numbers TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'scan',
    download_id INTEGER,
    content_hash TEXT,
    parser_result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolution TEXT,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
    FOREIGN KEY (proposed_issue_id) REFERENCES issues(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS file_match_conflicts_volume_unresolved_idx
    ON file_match_conflicts(volume_id, resolved_at, reason);
CREATE INDEX IF NOT EXISTS file_match_conflicts_file_idx
    ON file_match_conflicts(file_id);
CREATE TABLE IF NOT EXISTS volume_files(
    file_id INTEGER PRIMARY KEY,
    volume_id INTEGER NOT NULL,
    file_type VARCHAR(15) NOT NULL,
    forced BOOL NOT NULL DEFAULT 0,

    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS external_download_clients(
    id INTEGER PRIMARY KEY,
    download_type INTEGER NOT NULL,
    client_type VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    base_url TEXT NOT NULL,
    username VARCHAR(255),
    password VARCHAR(255),
    api_token VARCHAR(255),
    category VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS download_queue(
    id INTEGER PRIMARY KEY,
    volume_id INTEGER NOT NULL,
    client_type VARCHAR(255) NOT NULL,
    external_client_id INTEGER,

    download_link TEXT NOT NULL,
    covered_issues VARCHAR(255),
    force_original_name BOOL,

    source_type VARCHAR(25) NOT NULL,
    source_name VARCHAR(255) NOT NULL,

    web_link TEXT,
    web_title TEXT,
    web_sub_title TEXT,

    FOREIGN KEY (external_client_id) REFERENCES external_download_clients(id),
    FOREIGN KEY (volume_id) REFERENCES volumes(id)
);
CREATE TABLE IF NOT EXISTS download_history(
    web_link TEXT,
    web_title TEXT,
    web_sub_title TEXT,
    file_title TEXT,

    volume_id INTEGER,
    issue_id INTEGER,

    source VARCHAR(25),
    source_name TEXT,
    downloaded_at INTEGER NOT NULL CHECK (downloaded_at > 0),
    success BOOL,
    task_history_id INTEGER,
    failure_reason TEXT,

    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE SET NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
        ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS download_history_success_idx
    ON download_history(success);
CREATE TABLE IF NOT EXISTS download_postprocessing_state(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id INTEGER,
    volume_id INTEGER NOT NULL,
    issue_id INTEGER,
    covered_issues TEXT,
    source_type VARCHAR(30) NOT NULL,
    source_name TEXT,
    download_link TEXT NOT NULL,
    web_link TEXT,
    web_title TEXT,
    web_sub_title TEXT,
    state TEXT NOT NULL CHECK (state IN ('staged', 'analyzed', 'conflict', 'applying', 'completed', 'failed', 'rolled_back')),
    stage_details TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE CASCADE,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
        ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS download_postprocessing_state_download_idx
    ON download_postprocessing_state(download_id, source_type);
CREATE INDEX IF NOT EXISTS download_postprocessing_state_unresolved_idx
    ON download_postprocessing_state(volume_id, state, updated_at);
CREATE TABLE IF NOT EXISTS task_history(
    task_name NOT NULL,
    display_title NOT NULL,
    run_at INTEGER NOT NULL,
    queued_at INTEGER,
    started_at INTEGER,
    volume_id INTEGER,
    issue_id INTEGER,
    details TEXT,

    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE SET NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
        ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS task_intervals(
    task_name PRIMARY KEY,
    interval INTEGER NOT NULL,
    next_run INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blocklist(
    id INTEGER PRIMARY KEY,
    volume_id INTEGER,
    issue_id INTEGER,

    web_link TEXT,
    web_title TEXT,
    web_sub_title TEXT,

    download_link TEXT UNIQUE,
    source VARCHAR(30),

    reason INTEGER NOT NULL CHECK (reason > 0),
    added_at INTEGER NOT NULL CHECK (added_at > 0),

    FOREIGN KEY (volume_id) REFERENCES volumes(id)
        ON DELETE SET NULL,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
        ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS credentials(
    id INTEGER PRIMARY KEY,
    source VARCHAR(30) NOT NULL,
    username TEXT,
    email TEXT,
    password TEXT,
    api_key TEXT
);
CREATE TABLE IF NOT EXISTS remote_mappings(
    id INTEGER PRIMARY KEY,
    external_download_client_id INTEGER NOT NULL,
    remote_path TEXT NOT NULL,
    local_path TEXT NOT NULL,

    FOREIGN KEY (external_download_client_id)
        REFERENCES external_download_clients(id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS volume_provider_links(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    match_method TEXT NOT NULL DEFAULT '',
    match_confidence REAL,
    review_status TEXT NOT NULL DEFAULT 'linked',
    linked_at INTEGER NOT NULL,
    last_successful_enrichment INTEGER,
    last_checked INTEGER,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
    UNIQUE(volume_id, provider, resource_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS volume_provider_links_provider_external_unique_idx
    ON volume_provider_links(provider, resource_type, external_id)
    WHERE external_id != '';
CREATE INDEX IF NOT EXISTS volume_provider_links_provider_external_idx
    ON volume_provider_links(provider, resource_type, external_id);
CREATE TABLE IF NOT EXISTS provider_cache(
    provider TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER,
    PRIMARY KEY(provider, resource_type, external_id)
);
CREATE TABLE IF NOT EXISTS volume_enrichment_terms(
    volume_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    term_type TEXT NOT NULL,
    external_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
    UNIQUE(volume_id, provider, term_type, external_id, name)
);
CREATE INDEX IF NOT EXISTS volume_enrichment_terms_type_name_idx
    ON volume_enrichment_terms(term_type, name);
CREATE INDEX IF NOT EXISTS volume_enrichment_terms_provider_external_idx
    ON volume_enrichment_terms(provider, external_id);
CREATE TABLE IF NOT EXISTS metron_backfill_state(
    id INTEGER PRIMARY KEY CHECK(id = 1),
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    total_estimate INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    matched INTEGER NOT NULL DEFAULT 0,
    unmatched INTEGER NOT NULL DEFAULT 0,
    review_required INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    current_volume_id INTEGER,
    last_terminal_volume_id INTEGER NOT NULL DEFAULT 0,
    rate_limit_paused_until INTEGER,
    last_error TEXT,
    resume_time INTEGER,
    cancel_requested BOOL NOT NULL DEFAULT 0,
    started_at INTEGER,
    updated_at INTEGER,
    completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS provider_match_candidates(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    candidate_external_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    year INTEGER,
    publisher TEXT,
    cover_url TEXT,
    summary TEXT,
    confidence REAL,
    match_reason TEXT NOT NULL DEFAULT '',
    review_group_id TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'review_required',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS provider_match_candidates_unresolved_idx
    ON provider_match_candidates(provider, review_status, volume_id, created_at);
CREATE TABLE IF NOT EXISTS metron_enrichment_task_reservations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    volume_id INTEGER NOT NULL,
    candidate_id INTEGER,
    task_queue_id INTEGER,
    status TEXT NOT NULL DEFAULT 'reserved',
    safe_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES provider_match_candidates(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS metron_enrichment_task_reservations_active_idx
    ON metron_enrichment_task_reservations(volume_id, candidate_id, task_queue_id)
    WHERE status IN ('reserved', 'queued', 'running');
CREATE TABLE IF NOT EXISTS volume_metadata_enrichment(
    volume_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    field_name TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    external_provider_id TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    active BOOL NOT NULL DEFAULT 1,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
    PRIMARY KEY(volume_id, provider, field_name)
);
CREATE INDEX IF NOT EXISTS volume_metadata_enrichment_active_idx
    ON volume_metadata_enrichment(volume_id, provider, active);
CREATE TABLE IF NOT EXISTS provider_rate_limit_state(
    provider TEXT PRIMARY KEY,
    burst_limit INTEGER,
    burst_remaining INTEGER,
    burst_reset INTEGER,
    sustained_limit INTEGER,
    sustained_remaining INTEGER,
    sustained_reset INTEGER,
    retry_after INTEGER,
    resume_at INTEGER,
    last_status TEXT,
    auth_blocked BOOL NOT NULL DEFAULT 0,
    updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS comic_series_discovery_facts(
    comicvine_volume_id INTEGER PRIMARY KEY,
    first_known_issue_id INTEGER,
    first_known_issue_number TEXT NOT NULL DEFAULT '',
    first_known_issue_date TEXT,
    date_source TEXT NOT NULL DEFAULT '',
    series_started_at TEXT,
    volume_title TEXT NOT NULL DEFAULT '',
    cover_link TEXT NOT NULL DEFAULT '',
    site_url TEXT NOT NULL DEFAULT '',
    year INTEGER,
    publisher TEXT,
    is_upcoming_launch BOOL NOT NULL DEFAULT 0,
    provider_modified_at TEXT,
    metadata_modified_at INTEGER,
    fetched_at INTEGER,
    derived_at INTEGER NOT NULL DEFAULT 0,
    derivation_status TEXT NOT NULL DEFAULT 'valid',
    date_preference TEXT NOT NULL DEFAULT 'cover_date',
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_first_date_idx
    ON comic_series_discovery_facts(first_known_issue_date);
CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_upcoming_idx
    ON comic_series_discovery_facts(is_upcoming_launch, first_known_issue_date);
CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_derived_idx
    ON comic_series_discovery_facts(derived_at);
CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_volume_idx
    ON comic_series_discovery_facts(comicvine_volume_id);
CREATE TABLE IF NOT EXISTS comic_discovery_fact_sync_state(
    sync_id INTEGER PRIMARY KEY CHECK(sync_id = 1),
    scope TEXT NOT NULL DEFAULT 'comic_series_discovery',
    provider_cursor TEXT,
    last_started_at INTEGER,
    last_completed_at INTEGER,
    coverage_state TEXT NOT NULL DEFAULT 'not_started',
    coverage_complete BOOL NOT NULL DEFAULT 0,
    date_preference TEXT NOT NULL DEFAULT 'cover_date',
    last_error TEXT,
    next_resume_at INTEGER,
    last_successful_cursor TEXT,
    records_processed INTEGER NOT NULL DEFAULT 0,
    facts_created INTEGER NOT NULL DEFAULT 0,
    facts_updated INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO comic_discovery_fact_sync_state(sync_id, scope, coverage_state, coverage_complete, date_preference)
    VALUES (1, 'comic_series_discovery', 'not_started', 0, 'cover_date');
CREATE TABLE IF NOT EXISTS nzb_indexers(
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    categories VARCHAR(255) NOT NULL DEFAULT '7030,7020',
    enabled BOOL NOT NULL DEFAULT 1
);
"""
