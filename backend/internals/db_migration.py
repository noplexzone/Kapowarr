# -*- coding: utf-8 -*-

from asyncio import run
from typing import Callable, Dict, List, Set

from backend.base.logging import LOGGER
from backend.internals.db import get_db, iter_commit


# region Handler
class DatabaseMigrationHandler:
    """Handles the registration of all migrators and running them if needed.
    To add a migration, simply write the funtion and decorate it with
    `register_handler(...)`. The `migrate(...)` method will take care of running
    it.
    """

    handlers: Dict[int, Callable[[], None]] = {}

    @classmethod
    def register_handler(cls, start_version: int):
        """Register a database migrator.

        Args:
            start_version (int): The database version that it migrates _from_.
                So start_version=2 means migrating from 2 to 3.

        Raises:
            RuntimeError: A database migration with the given start_version is
                already registered.
        """
        def wrapper(migrator: Callable[[], None]):
            if start_version in cls.handlers:
                raise RuntimeError(
                    f"Database migration with start version {start_version} "
                    "registered multiple times"
                )
            cls.handlers[start_version] = migrator
            return migrator
        return wrapper

    @classmethod
    def latest_db_version(cls) -> int:
        """Get the latest database version supported.

        Returns:
            int: The version.
        """
        return max(cls.handlers) + 1

    @classmethod
    def migrate(cls) -> None:
        """
        Migrate a Kapowarr database from its current version to the newest
        version supported by the Kapowarr version installed.
        """
        from backend.internals.settings import Settings

        s = Settings()
        current_db_version = s.sv.database_version
        newest_version = cls.latest_db_version()

        if current_db_version > newest_version:
            LOGGER.warning(
                "Database is for newer version of Kapowarr"
            )
            return

        if current_db_version == newest_version:
            return

        LOGGER.info("Migrating database to newer version...")
        LOGGER.debug(
            "Database migration: %d -> %d",
            current_db_version, newest_version
        )

        for start_version in iter_commit(
            range(current_db_version, newest_version)
        ):
            if start_version not in cls.handlers:
                continue

            cls.handlers[start_version]()
            s.update({"database_version": start_version + 1})

        get_db().execute("VACUUM;")
        s.clear_cache()

        return


# region Migrators
# Please name all of the migrators with an underscore prefix. This way they
# won't show up as importable functions in other files by IDEs.

@DatabaseMigrationHandler.register_handler(1)
def _migrate_clear_download_queue():
    get_db().executescript("DELETE FROM download_queue;")
    return


@DatabaseMigrationHandler.register_handler(2)
def _migrate_update_issues_and_files():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        -- Issues
        CREATE TEMPORARY TABLE temp_issues_3 AS
            SELECT * FROM issues;
        DROP TABLE issues;

        CREATE TABLE issues(
            id INTEGER PRIMARY KEY,
            volume_id INTEGER NOT NULL,
            comicvine_id INTEGER NOT NULL,
            issue_number VARCHAR(20) NOT NULL,
            calculated_issue_number FLOAT(20) NOT NULL,
            title VARCHAR(255),
            date VARCHAR(10),
            description TEXT,
            monitored BOOL NOT NULL DEFAULT 1,

            FOREIGN KEY (volume_id) REFERENCES volumes(id)
                ON DELETE CASCADE
        );
        INSERT INTO issues
            SELECT * FROM temp_issues_3;

        -- Issues files
        CREATE TEMPORARY TABLE temp_issues_files_3 AS
            SELECT * FROM issues_files;
        DROP TABLE issues_files;

        CREATE TABLE issues_files(
            file_id INTEGER NOT NULL,
            issue_id INTEGER NOT NULL,

            FOREIGN KEY (file_id) REFERENCES files(id)
                ON DELETE CASCADE,
            FOREIGN KEY (issue_id) REFERENCES issues(id),
            CONSTRAINT PK_issues_files PRIMARY KEY (
                file_id,
                issue_id
            )
        );
        INSERT INTO issues_files
            SELECT * FROM temp_issues_files_3;

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(3)
def _migrate_remove_unmatched_files():
    from backend.internals.db_models import FilesDB

    FilesDB.delete_unmatched_files()

    return


@DatabaseMigrationHandler.register_handler(4)
def _migrate_recalculate_issue_number():
    from backend.base.file_extraction import extract_issue_number

    cursor = get_db()
    iter_cursor = get_db(force_new=True)
    iter_cursor.execute("SELECT id, issue_number FROM issues;")
    for result in iter_cursor:
        calc_issue_number = extract_issue_number(result[1])
        cursor.execute(
            "UPDATE issues SET calculated_issue_number = ? WHERE id = ?;",
            (calc_issue_number, result[0])
        )
    return


@DatabaseMigrationHandler.register_handler(5)
def _migrate_add_cv_fetch_time():
    from backend.implementations.comicvine import ComicVine

    cursor = get_db()
    cursor.executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        -- Issues
        CREATE TEMPORARY TABLE temp_issues_6 AS
            SELECT * FROM issues;
        DROP TABLE issues;

        CREATE TABLE IF NOT EXISTS issues(
            id INTEGER PRIMARY KEY,
            volume_id INTEGER NOT NULL,
            comicvine_id INTEGER UNIQUE NOT NULL,
            issue_number VARCHAR(20) NOT NULL,
            calculated_issue_number FLOAT(20) NOT NULL,
            title VARCHAR(255),
            date VARCHAR(10),
            description TEXT,
            monitored BOOL NOT NULL DEFAULT 1,

            FOREIGN KEY (volume_id) REFERENCES volumes(id)
                ON DELETE CASCADE
        );
        INSERT INTO issues
            SELECT * FROM temp_issues_6;

        -- Volumes
        ALTER TABLE volumes
            ADD last_cv_update VARCHAR(255);
        ALTER TABLE volumes
            ADD last_cv_fetch INTEGER(8) DEFAULT 0;

        COMMIT;
    """)

    volume_ids = [
        str(v[0])
        for v in cursor.execute("SELECT comicvine_id FROM volumes;")
    ]
    updates = (
        ('', r['comicvine_id'])
        for r in run(ComicVine().fetch_volumes(volume_ids))
    )
    cursor.executemany(
        "UPDATE volumes SET last_cv_update = ? WHERE comicvine_id = ?;",
        updates
    )

    return


@DatabaseMigrationHandler.register_handler(6)
def _migrate_add_custom_folder():
    get_db().execute("""
        ALTER TABLE volumes
            ADD custom_folder BOOL NOT NULL DEFAULT 0;
    """)
    return


@DatabaseMigrationHandler.register_handler(7)
def _migrate_add_special_version():
    from backend.implementations.volumes import (Library,
                                                 determine_special_version)

    cursor = get_db()
    cursor.execute("""
        ALTER TABLE volumes
            ADD special_version VARCHAR(255);
    """)

    updates = (
        (
            determine_special_version(v_id),
            v_id
        )
        for v_id in Library.get_volumes()
    )

    cursor.executemany(
        "UPDATE volumes SET special_version = ? WHERE id = ?;",
        updates
    )
    return


@DatabaseMigrationHandler.register_handler(8)
def _migrate_update_volume_table():
    get_db().executescript("""
        PRAGMA foreign_keys = OFF;

        CREATE TABLE new_volumes(
            id INTEGER PRIMARY KEY,
            comicvine_id INTEGER NOT NULL,
            title VARCHAR(255) NOT NULL,
            year INTEGER(5),
            publisher VARCHAR(255),
            volume_number INTEGER(8) DEFAULT 1,
            description TEXT,
            cover BLOB,
            monitored BOOL NOT NULL DEFAULT 0,
            root_folder INTEGER NOT NULL,
            folder TEXT,
            custom_folder BOOL NOT NULL DEFAULT 0,
            last_cv_fetch INTEGER(8) DEFAULT 0,
            special_version VARCHAR(255),

            FOREIGN KEY (root_folder) REFERENCES root_folders(id)
        );

        INSERT INTO new_volumes
            SELECT
                id, comicvine_id, title, year, publisher,
                volume_number, description, cover, monitored,
                root_folder, folder, custom_folder,
                0 AS last_cv_fetch, special_version
            FROM volumes;

        DROP TABLE volumes;

        ALTER TABLE new_volumes RENAME TO volumes;

        PRAGMA foreign_keys = ON;
    """)
    return


@DatabaseMigrationHandler.register_handler(9)
def _migrate_update_manifest():

    # There used to be a migration here that fixed the manifest file.
    # That has since been replaced by the dynamic endpoint serving the JSON.
    # So the migration doesn't do anything anymore, and a function used
    # doesn't exist anymore, so the whole migration is just removed.

    return


@DatabaseMigrationHandler.register_handler(10)
def _migrate_update_special_version():
    from backend.implementations.volumes import (Library,
                                                 determine_special_version)

    updates = (
        (
            determine_special_version(v_id),
            v_id
        )
        for v_id in Library.get_volumes()
    )

    get_db().executemany(
        "UPDATE volumes SET special_version = ? WHERE id = ?;",
        updates
    )

    return


@DatabaseMigrationHandler.register_handler(11)
def _migrate_add_torrent_client_to_download_queue():
    get_db().executescript("""
        DROP TABLE download_queue;

        CREATE TABLE download_queue(
            id INTEGER PRIMARY KEY,
            client_type VARCHAR(255) NOT NULL,
            torrent_client_id INTEGER,

            link TEXT NOT NULL,
            filename_body TEXT NOT NULL,
            source VARCHAR(25) NOT NULL,

            volume_id INTEGER NOT NULL,
            issue_id INTEGER,
            page_link TEXT,

            FOREIGN KEY (torrent_client_id) REFERENCES torrent_clients(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );
    """)
    return


@DatabaseMigrationHandler.register_handler(12)
def _migrate_unzip_to_format_preference():
    cursor = get_db()
    unzip = cursor.execute(
        "SELECT value FROM config WHERE key = 'unzip' LIMIT 1;"
    ).fetchone()[0]

    cursor.execute(
        "DELETE FROM config WHERE key = 'unzip';"
    )

    if unzip:
        cursor.executescript("""
            UPDATE config
            SET value = 'folder'
            WHERE key = 'format_preference';

            UPDATE config
            SET value = 1
            WHERE key = 'convert';
            """
        )
    return


@DatabaseMigrationHandler.register_handler(13)
def _migrate_folder_conversion_to_own_setting():
    cursor = get_db()
    format_preference: List[str] = cursor.execute("""
        SELECT value
        FROM config
        WHERE key = 'format_preference'
        LIMIT 1;
    """).fetchone()[0].split(',')

    if 'folder' in format_preference:
        cursor.execute("""
            UPDATE config
            SET value = 1
            WHERE key = 'extract_issue_ranges';
            """
        )
        format_preference.remove('folder')
        cursor.execute("""
            UPDATE config
            SET value = ?
            WHERE key = 'format_preference';
            """,
            (",".join(format_preference),)
        )
    return


@DatabaseMigrationHandler.register_handler(14)
def _migrate_service_preference_to_setting():
    cursor = get_db()
    service_preference = ','.join([
        source[0] for source in cursor.execute(
            "SELECT source FROM service_preference ORDER BY pref;"
        )
    ])

    # UPDATE, not INSERT,
    # because first default settings are entered and only then is the db
    # migration done, so the key will already exist.
    cursor.execute(
        "UPDATE config SET value = ? WHERE key = 'service_preference';",
        (service_preference,)
    )
    cursor.execute(
        "DROP TABLE service_preference;"
    )
    return


@DatabaseMigrationHandler.register_handler(15)
def _migrate_update_blocklist_table():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        DROP TABLE blocklist_reasons;

        CREATE TEMPORARY TABLE temp_blocklist_16 AS
            SELECT * FROM blocklist;
        DROP TABLE blocklist;

        CREATE TABLE blocklist(
            id INTEGER PRIMARY KEY,
            link TEXT NOT NULL UNIQUE,
            reason INTEGER NOT NULL CHECK (reason > 0),
            added_at INTEGER NOT NULL
        );
        INSERT INTO blocklist
            SELECT * FROM temp_blocklist_16;

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(16)
def _migrate_log_level_to_int():
    from backend.internals.settings import Settings

    s = Settings()
    log_number = 20 if s.sv.log_level == 'info' else 10
    s.update({"log_level": log_number})

    return


@DatabaseMigrationHandler.register_handler(17)
def _migrate_add_special_version_lock():
    get_db().execute("""
        ALTER TABLE volumes ADD
            special_version_locked BOOL NOT NULL DEFAULT 0
    """)
    return


@DatabaseMigrationHandler.register_handler(18)
def _migrate_tpb_naming_to_special_version_naming():
    from re import IGNORECASE, compile

    cursor = get_db()

    format: str = cursor.execute(
        "SELECT value FROM config WHERE key = 'file_naming_tpb' LIMIT 1;"
    ).fetchone()[0]

    cursor.execute(
        "DELETE FROM config WHERE key = 'file_naming_tpb';"
    )

    tpb_replacer = compile(
        r'\b(tpb|trade[\s\.\-]?paper[\s\.\-]?back)\b',
        IGNORECASE
    )
    format = tpb_replacer.sub('{special_version}', format)

    cursor.execute(
        "UPDATE config SET value = ? WHERE key = 'file_naming_special_version';",
        (format,))

    return


@DatabaseMigrationHandler.register_handler(19)
def _migrate_add_we_transfer_to_preference():
    from backend.internals.settings import Settings

    service_preference = Settings().sv.service_preference
    service_preference.append("wetransfer")
    get_db().execute(
        "UPDATE config SET value = ? WHERE key = 'service_preference';",
        (service_preference,)
    )
    return


@DatabaseMigrationHandler.register_handler(20)
def _migrate_clear_unsupported_source_blocklist_entries():
    get_db().execute(
        "DELETE FROM blocklist WHERE reason = ?;",
        (2,) # Source not supported
    )
    return


@DatabaseMigrationHandler.register_handler(21)
def _migrate_add_pixel_drain_to_preference():
    from backend.internals.settings import Settings

    service_preference = Settings().sv.service_preference
    service_preference.append("pixeldrain")
    get_db().execute(
        "UPDATE config SET value = ? WHERE key = 'service_preference';",
        (service_preference,)
    )

    return


@DatabaseMigrationHandler.register_handler(22)
def _migrate_add_links_in_download_queue():
    get_db().executescript("""
        DROP TABLE download_queue;
        CREATE TABLE download_queue(
            id INTEGER PRIMARY KEY,
            client_type VARCHAR(255) NOT NULL,
            torrent_client_id INTEGER,

            download_link TEXT NOT NULL,
            filename_body TEXT NOT NULL,
            source VARCHAR(25) NOT NULL,

            volume_id INTEGER NOT NULL,
            issue_id INTEGER,
            web_link TEXT,
            web_title TEXT,
            web_sub_title TEXT,

            FOREIGN KEY (torrent_client_id) REFERENCES torrent_clients(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );
    """)
    return


@DatabaseMigrationHandler.register_handler(23)
def _migrate_service_preference_to_enum_values():
    from backend.base.definitions import GCDownloadSource
    from backend.base.helpers import CommaList
    from backend.internals.settings import Settings

    source_string_to_enum = {
        'mega': GCDownloadSource.MEGA.value,
        'mediafire': GCDownloadSource.MEDIAFIRE.value,
        'wetransfer': GCDownloadSource.WETRANSFER.value,
        'pixeldrain': GCDownloadSource.PIXELDRAIN.value,
        'getcomics': GCDownloadSource.GETCOMICS.value,
        'getcomics (torrent)': GCDownloadSource.GETCOMICS_TORRENT.value
    }

    new_service_preference = CommaList((
        source_string_to_enum[service.lower()]
        for service in Settings().sv.service_preference
    ))

    get_db().execute(
        "UPDATE config SET value = ? WHERE key = 'service_preference';",
        (new_service_preference,)
    )

    return


@DatabaseMigrationHandler.register_handler(24)
def _migrate_add_links_in_blocklist():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_blocklist_25 AS
            SELECT * FROM blocklist;
        DROP TABLE blocklist;

        CREATE TABLE blocklist(
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

            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );

        INSERT INTO blocklist
            SELECT
                id,
                NULL AS volume_id,
                NULL AS issue_id,
                NULL AS web_link,
                NULL AS web_title,
                NULL AS web_sub_title,
                link AS download_link,
                NULL AS source,
                reason,
                added_at
            FROM temp_blocklist_25
            WHERE link LIKE 'https://getcomics.org/dlds%';

        INSERT INTO blocklist
            SELECT
                id,
                NULL AS volume_id,
                NULL AS issue_id,
                link AS web_link,
                NULL AS web_title,
                NULL AS web_sub_title,
                NULL AS download_link,
                NULL AS source,
                reason,
                added_at
            FROM temp_blocklist_25
            WHERE NOT link LIKE 'https://getcomics.org/dlds%';

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(25)
def _migrate_add_links_in_history():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_download_history_26 AS
            SELECT * FROM download_history;
        DROP TABLE download_history;

        CREATE TABLE download_history(
            web_link TEXT,
            web_title TEXT,
            web_sub_title TEXT,
            file_title TEXT,

            volume_id INTEGER,
            issue_id INTEGER,

            source VARCHAR(25),
            downloaded_at INTEGER NOT NULL CHECK (downloaded_at > 0),

            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );

        INSERT INTO download_history
            SELECT
                original_link AS web_link,
                title AS web_title,
                NULL AS web_sub_title,
                NULL AS file_title,
                NULL AS volume_id,
                NULL AS issue_id,
                NULL AS source,
                downloaded_at
            FROM temp_download_history_26;

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(26)
def _migrate_add_foreign_keys_to_history_and_blocklist():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_download_history_27 AS
            SELECT * FROM download_history;
        DROP TABLE download_history;

        CREATE TABLE download_history(
            web_link TEXT,
            web_title TEXT,
            web_sub_title TEXT,
            file_title TEXT,

            volume_id INTEGER,
            issue_id INTEGER,

            source VARCHAR(25),
            downloaded_at INTEGER NOT NULL CHECK (downloaded_at > 0),

            FOREIGN KEY (volume_id) REFERENCES volumes(id)
                ON DELETE SET NULL,
            FOREIGN KEY (issue_id) REFERENCES issues(id)
                ON DELETE SET NULL
        );

        INSERT INTO download_history
            SELECT *
            FROM temp_download_history_27;

        CREATE TEMPORARY TABLE temp_blocklist_27 AS
            SELECT * FROM blocklist;
        DROP TABLE blocklist;

        CREATE TABLE blocklist(
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

        INSERT INTO blocklist
            SELECT *
            FROM temp_blocklist_27;

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(27)
def _migrate_add_site_url_to_volumes():
    get_db().execute("""
        ALTER TABLE volumes ADD
            site_url TEXT NOT NULL DEFAULT "";
    """)
    return


@DatabaseMigrationHandler.register_handler(28)
def _migrate_add_alt_title_to_volumes():
    get_db().execute("""
        ALTER TABLE volumes ADD
            alt_title VARCHAR(255);
    """)
    return


@DatabaseMigrationHandler.register_handler(29)
def _migrate_none_to_string_flare_solverr():
    cursor = get_db()
    value = cursor.execute("""
        SELECT value
        FROM config
        WHERE key = 'flaresolverr_base_url'
        LIMIT 1;
        """
    ).fetchone()['value']

    if not value:
        cursor.execute("""
            UPDATE config
            SET value = ''
            WHERE key = 'flaresolverr_base_url';
        """)
    return


@DatabaseMigrationHandler.register_handler(30)
def _migrate_remove_unused_settings():

    # This migration would remove unused settings, but one of those was
    # used in migration V31 -> V32, so removing the unused settings was
    # moved to that migration, after using the setting. But because people
    # already ran this migration, their database version already updated to
    # 31, so this migration couldn't be removed.

    return


@DatabaseMigrationHandler.register_handler(31)
def _migrate_vai_naming():
    from backend.internals.settings import SettingsValues

    cursor = get_db()

    volume_as_empty = (cursor.execute(
        "SELECT value FROM config WHERE key = 'volume_as_empty' LIMIT 1;"
    ).fetchone() or (None,))[0]
    if volume_as_empty:
        cursor.execute(
            "UPDATE config SET value = ? WHERE key = 'file_naming_vai';",
            ('{series_name} ({year}) Volume {volume_number} Issue {issue_number}',)
        )

    cursor.execute("SELECT key FROM config")
    delete_keys = [
        key
        for key in cursor
        if key[0] not in SettingsValues.__dataclass_fields__
    ]
    cursor.executemany(
        "DELETE FROM config WHERE key = ?;",
        delete_keys
    )

    return


@DatabaseMigrationHandler.register_handler(32)
def _migrate_credentials():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_credentials_33 AS
            SELECT * FROM credentials;
        DROP TABLE credentials;

        DROP TABLE credentials_sources;

        CREATE TABLE IF NOT EXISTS credentials(
            id INTEGER PRIMARY KEY,
            source VARCHAR(30) NOT NULL UNIQUE,
            username TEXT,
            email TEXT,
            password TEXT,
            api_key TEXT
        );

        INSERT INTO credentials(id, source, email, password)
            SELECT id, 'mega' AS source, email, password
            FROM temp_credentials_33;

        COMMIT;
    """)

    return


@DatabaseMigrationHandler.register_handler(33)
def _migrate_external_download_clients():
    get_db().executescript(
        """
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_download_queue_34 AS
            SELECT * FROM download_queue;
        DROP TABLE download_queue;

        CREATE TABLE IF NOT EXISTS download_queue(
            id INTEGER PRIMARY KEY,
            client_type VARCHAR(255) NOT NULL,
            external_client_id INTEGER,

            download_link TEXT NOT NULL,
            filename_body TEXT NOT NULL,
            source VARCHAR(25) NOT NULL,

            volume_id INTEGER NOT NULL,
            issue_id INTEGER,
            web_link TEXT,
            web_title TEXT,
            web_sub_title TEXT,

            FOREIGN KEY (external_client_id) REFERENCES external_download_clients(id),
            FOREIGN KEY (volume_id) REFERENCES volumes(id),
            FOREIGN KEY (issue_id) REFERENCES issues(id)
        );

        INSERT INTO download_queue(
            id, client_type, external_client_id,
            download_link, filename_body, source,
            volume_id, issue_id,
            web_link, web_title, web_sub_title
        )
            SELECT
                id, client_type, torrent_client_id AS external_client_id,
                download_link, filename_body, source,
                volume_id, issue_id,
                web_link, web_title, web_sub_title
            FROM temp_download_queue_34;

        CREATE TEMPORARY TABLE temp_torrent_clients_34 AS
            SELECT * FROM torrent_clients;
        DROP TABLE torrent_clients;

        INSERT INTO external_download_clients(
            id, download_type, client_type, title, base_url,
            username, password, api_token
        )
            SELECT
                id, 2 AS download_type, type AS client_type, title, base_url,
                username, password, api_token
            FROM temp_torrent_clients_34;

        COMMIT;
    """)

    return


@DatabaseMigrationHandler.register_handler(34)
def _migrate_type_hosting_settings():
    from backend.internals.settings import Settings

    cursor = get_db()
    port = cursor.execute(
        "SELECT value FROM config WHERE key = 'port' LIMIT 1;"
    ).fetchone()[0]

    cursor.execute(
        "UPDATE config SET value=? WHERE key = 'port';",
        (int(port),)
    )

    settings = Settings()
    settings.clear_cache()
    settings.backup_hosting_settings()
    return


@DatabaseMigrationHandler.register_handler(35)
def _migrate_download_queue_to_refactor():
    get_db().executescript("""
        DROP TABLE download_queue;
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
    """)
    return


@DatabaseMigrationHandler.register_handler(36)
def _migrate_multiple_credentials():
    get_db().executescript("""
        BEGIN TRANSACTION;
        PRAGMA defer_foreign_keys = ON;

        CREATE TEMPORARY TABLE temp_credentials_37 AS
            SELECT * FROM credentials;
        DROP TABLE credentials;

        CREATE TABLE IF NOT EXISTS credentials(
            id INTEGER PRIMARY KEY,
            source VARCHAR(30) NOT NULL,
            username TEXT,
            email TEXT,
            password TEXT,
            api_key TEXT
        );

        INSERT INTO credentials
            SELECT * FROM temp_credentials_37;

        COMMIT;
    """)
    return


@DatabaseMigrationHandler.register_handler(37)
def _migrate_add_monitor_new_issues_to_volumes():
    get_db().execute("""
        ALTER TABLE volumes ADD COLUMN
            monitor_new_issues BOOL NOT NULL DEFAULT 1;
    """)
    return


@DatabaseMigrationHandler.register_handler(38)
def _migrate_torrent_timeout_to_download_timeout():
    cursor = get_db()

    old_value = cursor.execute(
        "SELECT value FROM config WHERE key = 'failing_torrent_timeout' LIMIT 1;"
    ).fetchone()[0]

    cursor.execute(
        "UPDATE config SET value = ? WHERE key = 'failing_download_timeout';",
        (old_value,))

    cursor.execute(
        "DELETE FROM config WHERE key = 'failing_torrent_timeout';"
    )

    return


@DatabaseMigrationHandler.register_handler(39)
def _migrate_delete_completed_torrents_to_downloads():
    cursor = get_db()

    old_value = cursor.execute(
        "SELECT value FROM config WHERE key = 'delete_completed_torrents' LIMIT 1;"
    ).fetchone()[0]

    cursor.execute(
        "UPDATE config SET value = ? WHERE key = 'delete_completed_downloads';",
        (old_value,))

    cursor.execute(
        "DELETE FROM config WHERE key = 'delete_completed_torrents';"
    )

    return


@DatabaseMigrationHandler.register_handler(40)
def _migrate_hash_password():
    from backend.internals.settings import Settings

    s = Settings()
    settings = s.get_settings()

    if settings.auth_password:
        s.update({"auth_password": settings.auth_password})

    return


@DatabaseMigrationHandler.register_handler(41)
def _migrate_add_success_to_download_history():
    get_db().execute("""
        ALTER TABLE download_history ADD COLUMN
            success BOOL;
    """)

    return


@DatabaseMigrationHandler.register_handler(42)
def _migrate_seperate_covers_table():
    cursor = get_db()

    cursor.executescript("""
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;

        INSERT OR IGNORE INTO volumes_covers(volume_id, cover)
            SELECT id, cover
            FROM volumes;

        CREATE TEMPORARY TABLE temp_volumes_43 AS SELECT
            id,
            comicvine_id,
            title,
            alt_title,
            year,
            publisher,
            volume_number,
            description,
            site_url,
            monitored,
            monitor_new_issues,
            root_folder,
            folder,
            custom_folder,
            last_cv_fetch,
            special_version,
            special_version_locked
        FROM volumes;
        DROP TABLE volumes;

        CREATE TABLE volumes(
            id INTEGER PRIMARY KEY,
            comicvine_id INTEGER NOT NULL,
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

        INSERT INTO volumes
            SELECT *
            FROM temp_volumes_43;

        COMMIT;
        PRAGMA foreign_keys = ON;
    """)

    return


@DatabaseMigrationHandler.register_handler(43)
def _migrate_remove_unsupported_source_blocklist_entries():
    get_db().execute(
        "DELETE FROM blocklist WHERE reason = ?;",
        (2,) # Source not supported
    )
    return


@DatabaseMigrationHandler.register_handler(44)
def _migrate_add_forced_file_match_column():
    get_db().executescript("""
        ALTER TABLE issues_files ADD COLUMN
            forced BOOL NOT NULL DEFAULT 0;

        ALTER TABLE volume_files ADD COLUMN
            forced BOOL NOT NULL DEFAULT 0;
    """)

    return


@DatabaseMigrationHandler.register_handler(45)
def _migrate_add_nzb_indexers():
    get_db().executescript("""
        CREATE TABLE IF NOT EXISTS nzb_indexers(
            id INTEGER PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            categories VARCHAR(255) NOT NULL DEFAULT '7030,7020',
            enabled BOOL NOT NULL DEFAULT 1
        );
    """)
    return


@DatabaseMigrationHandler.register_handler(46)
def _migrate_add_client_category():
    get_db().executescript("""
        ALTER TABLE external_download_clients ADD COLUMN category VARCHAR(255);
    """)
    return


@DatabaseMigrationHandler.register_handler(47)
def _migrate_add_root_folder_section():
    get_db().execute(
        "ALTER TABLE root_folders ADD COLUMN section VARCHAR(10) NOT NULL DEFAULT 'comic';"
    )
    return


@DatabaseMigrationHandler.register_handler(48)
def _migrate_add_task_history_timestamps():
    get_db().executescript("""
        ALTER TABLE task_history ADD COLUMN queued_at INTEGER;
        ALTER TABLE task_history ADD COLUMN started_at INTEGER;
        ALTER TABLE task_history ADD COLUMN volume_id INTEGER;
        ALTER TABLE task_history ADD COLUMN issue_id INTEGER;
    """)
    return


@DatabaseMigrationHandler.register_handler(49)
def _migrate_add_task_history_details():
    get_db().executescript("""
        ALTER TABLE task_history ADD COLUMN details TEXT;
    """)
    return


@DatabaseMigrationHandler.register_handler(50)
def _migrate_add_download_history_task_link():
    get_db().executescript("""
        ALTER TABLE download_history ADD COLUMN task_history_id INTEGER;
        ALTER TABLE download_history ADD COLUMN failure_reason TEXT;
    """)
    return


@DatabaseMigrationHandler.register_handler(51)
def _migrate_add_ufile_to_preference():
    from backend.internals.settings import Settings

    service_preference = Settings().sv.service_preference
    service_preference.append("UFile")
    get_db().execute(
        "UPDATE config SET value = ? WHERE key = 'service_preference';",
        (service_preference,)
    )
    return


@DatabaseMigrationHandler.register_handler(52)
def _migrate_add_source_name_to_download_history():
    get_db().executescript("""
        ALTER TABLE download_history ADD COLUMN source_name TEXT;
    """)
    return


@DatabaseMigrationHandler.register_handler(53)
def _migrate_backfill_source_name():
    """Backfill source_name for existing download_history rows that were
    created before migration 52 added the column. New entries get source_name
    set at queue time; old ones have it NULL."""
    db = get_db()

    # 1. Non-Usenet entries: source IS the source_name
    #    GetComics, Pixeldrain, MediaFire, Mega, Suwayomi all store their
    #    display name directly in the source column.
    db.execute("""
        UPDATE download_history
        SET source_name = source
        WHERE source_name IS NULL
          AND source IS NOT NULL
          AND source != 'Usenet';
    """)

    # 2. Usenet entries: match web_link prefix against configured NZB indexers
    #    to recover the indexer name (e.g. 'NZBGeek').
    db.execute("""
        UPDATE download_history
        SET source_name = (
            SELECT ni.name
            FROM nzb_indexers ni
            WHERE download_history.web_link LIKE ni.base_url || '%'
            LIMIT 1
        )
        WHERE source_name IS NULL
          AND source = 'Usenet'
          AND web_link IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM nzb_indexers
              WHERE download_history.web_link LIKE nzb_indexers.base_url || '%'
          );
    """)

    db.connection.commit()
    return


@DatabaseMigrationHandler.register_handler(54)
def _migrate_add_metadata_source_to_volumes():
    cursor = get_db()
    cursor.executescript("""
        ALTER TABLE volumes
            ADD COLUMN metadata_source VARCHAR(50) NOT NULL DEFAULT 'comicvine';
        ALTER TABLE volumes
            ADD COLUMN metadata_id TEXT NOT NULL DEFAULT '';
    """)
    cursor.execute("""
        UPDATE volumes
        SET metadata_id = CAST(comicvine_id AS TEXT)
        WHERE metadata_source = 'comicvine'
            AND (metadata_id IS NULL OR metadata_id = '');
    """)
    return


@DatabaseMigrationHandler.register_handler(55)
def _migrate_add_metadata_language_to_volumes():
    cursor = get_db()
    cursor.execute("""
        ALTER TABLE volumes
            ADD COLUMN metadata_language VARCHAR(20) NOT NULL DEFAULT 'en';
    """)
    return


@DatabaseMigrationHandler.register_handler(56)
def _migrate_add_saved_filters():
    cursor = get_db()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS saved_filters(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section TEXT NOT NULL CHECK(section IN ('comic', 'manga')),
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(section, name)
        );
    """)
    return


_METRON_TABLE_DEFINITIONS = {
    'volume_provider_links': """
        CREATE TABLE volume_provider_links(
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
    """,
    'provider_cache': """
        CREATE TABLE provider_cache(
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
    """,
    'volume_enrichment_terms': """
        CREATE TABLE volume_enrichment_terms(
            volume_id INTEGER NOT NULL,
            provider TEXT NOT NULL,
            term_type TEXT NOT NULL,
            external_id TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
            UNIQUE(volume_id, provider, term_type, external_id, name)
        );
    """,
    'metron_backfill_state': """
        CREATE TABLE metron_backfill_state(
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
    """,
    'provider_match_candidates': """
        CREATE TABLE provider_match_candidates(
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
    """,
    'volume_metadata_enrichment': """
        CREATE TABLE volume_metadata_enrichment(
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
    """,
    'provider_rate_limit_state': """
        CREATE TABLE provider_rate_limit_state(
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
    """,
    'metron_enrichment_task_reservations': """
        CREATE TABLE metron_enrichment_task_reservations(
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
    """,
}

_METRON_TABLE_COLUMNS = {
    'volume_provider_links': ('id', 'volume_id', 'provider', 'resource_type', 'external_id', 'match_method', 'match_confidence', 'review_status', 'linked_at', 'last_successful_enrichment', 'last_checked'),
    'provider_cache': ('provider', 'resource_type', 'external_id', 'payload', 'etag', 'last_modified', 'fetched_at', 'expires_at'),
    'volume_enrichment_terms': ('volume_id', 'provider', 'term_type', 'external_id', 'name'),
    'metron_backfill_state': ('id', 'status', 'total', 'total_estimate', 'processed', 'matched', 'unmatched', 'review_required', 'failed', 'skipped', 'current_volume_id', 'last_terminal_volume_id', 'rate_limit_paused_until', 'last_error', 'resume_time', 'cancel_requested', 'started_at', 'updated_at', 'completed_at'),
    'provider_match_candidates': ('id', 'volume_id', 'provider', 'resource_type', 'candidate_external_id', 'title', 'year', 'publisher', 'cover_url', 'summary', 'confidence', 'match_reason', 'review_group_id', 'review_status', 'payload', 'created_at', 'updated_at'),
    'volume_metadata_enrichment': ('volume_id', 'provider', 'field_name', 'normalized_value', 'external_provider_id', 'updated_at', 'active'),
    'provider_rate_limit_state': ('provider', 'burst_limit', 'burst_remaining', 'burst_reset', 'sustained_limit', 'sustained_remaining', 'sustained_reset', 'retry_after', 'resume_at', 'last_status', 'auth_blocked', 'updated_at'),
    'metron_enrichment_task_reservations': ('id', 'volume_id', 'candidate_id', 'task_queue_id', 'status', 'safe_error', 'created_at', 'updated_at'),
}


def _table_exists(cursor, table_name: str) -> bool:
    return cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (table_name,)).fetchone() is not None


def _table_columns(cursor, table_name: str) -> List[str]:
    return [row[1] for row in cursor.execute(f"PRAGMA table_info({table_name});")]


def _index_columns(cursor, table_name: str, index_name: str) -> tuple:
    return tuple(row[2] for row in cursor.execute(f'PRAGMA index_info({index_name});'))


def _has_unique_index(cursor, table_name: str, expected_columns: tuple) -> bool:
    for row in cursor.execute(f'PRAGMA index_list({table_name});'):
        if int(row[2] or 0) and _index_columns(cursor, table_name, row[1]) == expected_columns:
            return True
    return False


def _fk_matches(cursor, table_name: str, target_table: str, on_delete: str = 'CASCADE') -> bool:
    return any(row[2] == target_table and str(row[6]).upper() == on_delete for row in cursor.execute(f'PRAGMA foreign_key_list({table_name});'))


def _metron_table_compatible(cursor, table_name: str, logical_table_name: str | None = None) -> bool:
    logical_table_name = logical_table_name or table_name
    if not _table_exists(cursor, table_name):
        return False
    info = cursor.execute(f"PRAGMA table_info({table_name});").fetchall()
    columns = {row[1]: {'type': str(row[2] or '').upper(), 'notnull': int(row[3] or 0), 'default': row[4], 'pk': int(row[5] or 0)} for row in info}
    if set(_METRON_TABLE_COLUMNS[logical_table_name]) - set(columns):
        return False
    required_types = {
        'volume_provider_links': {'id': 'INTEGER', 'volume_id': 'INTEGER', 'provider': 'TEXT', 'resource_type': 'TEXT', 'external_id': 'TEXT', 'match_method': 'TEXT', 'review_status': 'TEXT', 'linked_at': 'INTEGER'},
        'provider_cache': {'provider': 'TEXT', 'resource_type': 'TEXT', 'external_id': 'TEXT', 'payload': 'TEXT', 'fetched_at': 'INTEGER'},
        'volume_enrichment_terms': {'volume_id': 'INTEGER', 'provider': 'TEXT', 'term_type': 'TEXT', 'external_id': 'TEXT', 'name': 'TEXT'},
        'metron_backfill_state': {'id': 'INTEGER', 'status': 'TEXT', 'total': 'INTEGER', 'processed': 'INTEGER', 'cancel_requested': 'BOOL'},
        'provider_match_candidates': {'id': 'INTEGER', 'volume_id': 'INTEGER', 'provider': 'TEXT', 'resource_type': 'TEXT', 'candidate_external_id': 'TEXT', 'title': 'TEXT', 'review_group_id': 'TEXT', 'review_status': 'TEXT', 'payload': 'TEXT', 'created_at': 'INTEGER', 'updated_at': 'INTEGER'},
        'volume_metadata_enrichment': {'volume_id': 'INTEGER', 'provider': 'TEXT', 'field_name': 'TEXT', 'normalized_value': 'TEXT', 'external_provider_id': 'TEXT', 'updated_at': 'INTEGER', 'active': 'BOOL'},
        'provider_rate_limit_state': {'provider': 'TEXT', 'auth_blocked': 'BOOL'},
        'metron_enrichment_task_reservations': {'id': 'INTEGER', 'volume_id': 'INTEGER', 'status': 'TEXT', 'created_at': 'INTEGER', 'updated_at': 'INTEGER'},
    }
    for column, expected in required_types.get(logical_table_name, {}).items():
        if expected not in columns[column]['type']:
            return False
    required_notnull = {
        'volume_provider_links': ('volume_id', 'provider', 'resource_type', 'external_id', 'match_method', 'review_status', 'linked_at'),
        'provider_cache': ('provider', 'resource_type', 'external_id', 'payload', 'fetched_at'),
        'volume_enrichment_terms': ('volume_id', 'provider', 'term_type', 'external_id', 'name'),
        'metron_backfill_state': ('status', 'total', 'total_estimate', 'processed', 'matched', 'unmatched', 'review_required', 'failed', 'skipped', 'last_terminal_volume_id', 'cancel_requested'),
        'provider_match_candidates': ('volume_id', 'provider', 'resource_type', 'candidate_external_id', 'title', 'match_reason', 'review_group_id', 'review_status', 'payload', 'created_at', 'updated_at'),
        'volume_metadata_enrichment': ('volume_id', 'provider', 'field_name', 'normalized_value', 'external_provider_id', 'updated_at', 'active'),
        'provider_rate_limit_state': ('auth_blocked',),
        'metron_enrichment_task_reservations': ('volume_id', 'status', 'created_at', 'updated_at'),
    }
    if any(columns[column]['notnull'] != 1 for column in required_notnull.get(logical_table_name, ())):
        return False
    if logical_table_name == 'provider_cache':
        if tuple(columns[c]['pk'] for c in ('provider', 'resource_type', 'external_id')) != (1, 2, 3):
            return False
    if logical_table_name == 'volume_provider_links':
        if columns['id']['pk'] != 1 or not _fk_matches(cursor, table_name, 'volumes'):
            return False
        if not _has_unique_index(cursor, table_name, ('volume_id', 'provider', 'resource_type')):
            return False
    if logical_table_name == 'volume_enrichment_terms':
        if not _fk_matches(cursor, table_name, 'volumes') or not _has_unique_index(cursor, table_name, ('volume_id', 'provider', 'term_type', 'external_id', 'name')):
            return False
    if logical_table_name == 'provider_match_candidates':
        if columns['id']['pk'] != 1 or not _fk_matches(cursor, table_name, 'volumes'):
            return False
    if logical_table_name == 'volume_metadata_enrichment':
        if tuple(columns[c]['pk'] for c in ('volume_id', 'provider', 'field_name')) != (1, 2, 3) or not _fk_matches(cursor, table_name, 'volumes'):
            return False
    if logical_table_name == 'provider_rate_limit_state':
        if columns['provider']['pk'] != 1:
            return False
    if logical_table_name == 'metron_enrichment_task_reservations':
        if columns['id']['pk'] != 1 or not _fk_matches(cursor, table_name, 'volumes') or not _fk_matches(cursor, table_name, 'provider_match_candidates', 'SET NULL'):
            return False
    return True



def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _migration_58_source_names(cursor, table_name: str) -> List[str]:
    """Return the canonical table plus every interrupted migration-58 variant."""
    names = []
    if _table_exists(cursor, table_name):
        names.append(table_name)
    prefix = f'{table_name}_migration_58_%'
    for row in cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ESCAPE '\\' ORDER BY name;",
        (prefix,)
    ):
        if row[0] not in names:
            names.append(row[0])
    return names




def _migration_source_key(table_name: str, source_name: str) -> str:
    prefix = f'{table_name}_migration_58_'
    return source_name[len(prefix):] if source_name.startswith(prefix) else ''

def _unique_migration_table_name(cursor, table_name: str, suffix: str) -> str:
    index = 1
    while True:
        candidate = f'{table_name}_migration_58_{suffix}_{index}'
        if not _table_exists(cursor, candidate):
            return candidate
        index += 1


def _metron_table_definition_for(table_name: str, destination_name: str) -> str:
    return _METRON_TABLE_DEFINITIONS[table_name].replace(
        f'CREATE TABLE {table_name}(',
        f'CREATE TABLE {_quote_identifier(destination_name)}(',
        1,
    )


def _build_metron_source_union(cursor, table_name: str, include_source: bool = False) -> str:
    columns = list(_METRON_TABLE_COLUMNS[table_name])
    selects = []
    for name in _migration_58_source_names(cursor, table_name):
        source_columns = set(_table_columns(cursor, name))
        exprs = [column if column in source_columns else f"NULL AS {column}" for column in columns]
        if include_source:
            exprs.append(f"'{name.replace("'", "''")}' AS _migration_source")
            exprs.append(f"'{_migration_source_key(table_name, name).replace("'", "''")}' AS _migration_source_key")
        selects.append(f'SELECT {", ".join(exprs)} FROM {_quote_identifier(name)}')
    fallback_columns = [f'NULL AS {column}' for column in columns]
    if include_source:
        fallback_columns.append("'' AS _migration_source")
        fallback_columns.append("'' AS _migration_source_key")
    return ' UNION ALL '.join(selects) if selects else 'SELECT ' + ', '.join(fallback_columns) + ' WHERE 0'


def _normalize_metron_table(cursor, table_name: str) -> None:
    """Normalize Metron tables with source-preserving interrupted recovery.

    The recovery state machine treats the live table and every
    ``<table>_migration_58_%`` table as independent possible sources.  It builds
    and validates a unique destination before mutating the canonical table or
    deleting any source variant, so an interrupted retry never discards the only
    copy of unreconciled rows.
    """
    source_names = _migration_58_source_names(cursor, table_name)
    if source_names == [table_name] and _metron_table_compatible(cursor, table_name):
        return

    destination_name = _unique_migration_table_name(cursor, table_name, 'reconciled')
    cursor.execute(_metron_table_definition_for(table_name, destination_name))
    if not _metron_table_compatible(cursor, destination_name, table_name):
        raise RuntimeError(f'Failed to create normalized Metron table {table_name}')
    if not source_names:
        cursor.execute(f'ALTER TABLE {_quote_identifier(destination_name)} RENAME TO {_quote_identifier(table_name)};')
        return

    all_source_columns = {name: set(_table_columns(cursor, name)) for name in source_names}
    copy_columns = list(_METRON_TABLE_COLUMNS[table_name])
    if not any(all_source_columns.values()):
        raise RuntimeError(f'No recoverable columns found for Metron table {table_name}')
    source_id_rows = []
    for name, columns in all_source_columns.items():
        if 'id' in columns:
            source_id_rows.extend((name, row[0]) for row in cursor.execute(f'SELECT id FROM {_quote_identifier(name)} WHERE id IS NOT NULL;').fetchall())
    preserve_source_ids = len([row[1] for row in source_id_rows]) == len({row[1] for row in source_id_rows})

    def select_for_source(source_name: str) -> str:
        source_columns = all_source_columns[source_name]
        expressions = []
        for column in copy_columns:
            if column == 'id':
                if column in source_columns and preserve_source_ids:
                    expressions.append(column)
                else:
                    expressions.append('NULL AS id')
            elif column in source_columns:
                expressions.append(column)
            elif column in ('match_confidence', 'last_successful_enrichment', 'last_checked', 'expires_at', 'year', 'current_volume_id', 'rate_limit_paused_until', 'resume_time', 'started_at', 'completed_at', 'publisher', 'cover_url', 'summary', 'confidence', 'candidate_id', 'task_queue_id', 'safe_error', 'burst_limit', 'burst_remaining', 'burst_reset', 'sustained_limit', 'sustained_remaining', 'sustained_reset', 'retry_after', 'resume_at', 'last_status'):
                expressions.append(f'NULL AS {column}')
            elif column in ('total', 'total_estimate', 'processed', 'matched', 'unmatched', 'review_required', 'failed', 'skipped', 'last_terminal_volume_id', 'cancel_requested', 'auth_blocked'):
                expressions.append(f'0 AS {column}')
            elif column == 'active':
                expressions.append('1 AS active')
            elif column in ('linked_at', 'fetched_at', 'created_at', 'updated_at'):
                expressions.append(f'0 AS {column}')
            elif column == 'payload':
                expressions.append("'{}' AS payload")
            elif column == 'review_status':
                expressions.append("'linked' AS review_status" if table_name == 'volume_provider_links' else "'review_required' AS review_status")
            elif column == 'status':
                expressions.append("'reserved' AS status" if table_name == 'metron_enrichment_task_reservations' else "'' AS status")
            else:
                expressions.append(f"'' AS {column}")
        expressions.append(f"'{source_name.replace("'", "''")}' AS _migration_source")
        expressions.append(f"'{_migration_source_key(table_name, source_name).replace("'", "''")}' AS _migration_source_key")
        volume_filter = ''
        if table_name in ('volume_provider_links', 'volume_enrichment_terms', 'volume_metadata_enrichment', 'provider_match_candidates', 'metron_enrichment_task_reservations') and _table_exists(cursor, 'volumes') and 'volume_id' in source_columns:
            volume_filter = ' WHERE volume_id IN (SELECT id FROM volumes)'
        return f'SELECT {", ".join(expressions)} FROM {_quote_identifier(source_name)}{volume_filter}'

    union_sql = ' UNION ALL '.join(select_for_source(name) for name in source_names)
    column_sql = ', '.join(copy_columns)
    destination_sql = _quote_identifier(destination_name)
    considered_count = sum(cursor.execute(f'SELECT COUNT(*) FROM {_quote_identifier(name)};').fetchone()[0] for name in source_names)

    if table_name == 'volume_provider_links' and {'volume_id', 'provider', 'resource_type', 'external_id'} <= set(copy_columns):
        cursor.execute(f"""INSERT INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY volume_id, provider, resource_type
                    ORDER BY (external_id IS NOT NULL AND external_id != '') DESC,
                             (review_status = 'linked') DESC,
                             COALESCE(last_successful_enrichment, 0) DESC,
                             COALESCE(last_checked, 0) DESC,
                             COALESCE(linked_at, 0) DESC,
                             COALESCE(id, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'provider_cache' and {'provider', 'resource_type', 'external_id'} <= set(copy_columns):
        cursor.execute(f"""INSERT INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY provider, resource_type, external_id
                    ORDER BY COALESCE(fetched_at, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'metron_backfill_state' and 'id' in copy_columns:
        cursor.execute(f"""INSERT OR REPLACE INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY id ORDER BY COALESCE(updated_at, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'provider_match_candidates':
        cursor.execute(f"""INSERT INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY review_group_id, volume_id, provider, resource_type, candidate_external_id
                    ORDER BY COALESCE(updated_at, 0) DESC, COALESCE(created_at, 0) DESC, COALESCE(id, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'volume_metadata_enrichment':
        cursor.execute(f"""INSERT OR REPLACE INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY volume_id, provider, field_name
                    ORDER BY COALESCE(active, 0) DESC, COALESCE(updated_at, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'provider_rate_limit_state':
        cursor.execute(f"""INSERT OR REPLACE INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY provider ORDER BY COALESCE(updated_at, 0) DESC, COALESCE(resume_at, 0) DESC
                ) AS rn
                FROM ({union_sql})
            )
            WHERE rn = 1;""")
    elif table_name == 'metron_enrichment_task_reservations':
        candidate_map_sql = """
            SELECT old_source_key, old_id, new_id FROM (
                SELECT source._migration_source_key AS old_source_key, source.id AS old_id, dest.id AS new_id,
                    ROW_NUMBER() OVER (PARTITION BY source._migration_source_key, source.id ORDER BY dest.id) AS rn
                FROM (
                    SELECT id, volume_id, provider, resource_type, candidate_external_id, review_group_id, _migration_source, _migration_source_key
                    FROM (""" + _build_metron_source_union(cursor, 'provider_match_candidates', include_source=True) + """)
                    WHERE id IS NOT NULL
                ) AS source
                JOIN provider_match_candidates AS dest
                  ON dest.volume_id = source.volume_id
                 AND dest.provider = source.provider
                 AND dest.resource_type = source.resource_type
                 AND dest.candidate_external_id = source.candidate_external_id
                 AND dest.review_group_id = source.review_group_id
            ) WHERE rn = 1
        """ if _table_exists(cursor, 'provider_match_candidates') else "SELECT NULL AS old_source_key, NULL AS old_id, NULL AS new_id WHERE 0"
        remapped_columns = "source.id, source.volume_id, COALESCE(candidate_map.new_id, source.candidate_id) AS candidate_id, source.task_queue_id, source.status, source.safe_error, source.created_at, source.updated_at"
        cursor.execute(f"""INSERT INTO {destination_sql} ({column_sql})
            SELECT {column_sql}
            FROM (
                SELECT {remapped_columns}, ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN source.status IN ('reserved', 'queued', 'running') THEN 'active:' || source.volume_id ELSE 'history:' || source.volume_id || ':' || COALESCE(candidate_map.new_id, source.candidate_id, -1) || ':' || source.status || ':' || COALESCE(source.created_at, 0) || ':' || COALESCE(source.updated_at, 0) || ':' || COALESCE(source.safe_error, '') END
                    ORDER BY COALESCE(source.updated_at, 0) DESC, COALESCE(source.created_at, 0) DESC, COALESCE(source.id, 0) DESC
                ) AS rn
                FROM ({union_sql}) AS source
                LEFT JOIN ({candidate_map_sql}) AS candidate_map ON candidate_map.old_source_key = source._migration_source_key AND candidate_map.old_id = source.candidate_id
            )
            WHERE status NOT IN ('reserved', 'queued', 'running') OR rn = 1;""")
    else:
        cursor.execute(f'INSERT OR IGNORE INTO {destination_sql} ({column_sql}) SELECT DISTINCT {column_sql} FROM ({union_sql});')

    dest_count = cursor.execute(f'SELECT COUNT(*) FROM {destination_sql};').fetchone()[0]
    if dest_count > considered_count:
        raise RuntimeError(f'Normalized Metron table {table_name} inserted more records than it considered')
    expected_identity_sql = {
        'volume_provider_links': "SELECT volume_id || ':' || provider || ':' || resource_type AS natural_id FROM ({union_sql}) WHERE volume_id IS NOT NULL AND provider != '' AND resource_type != ''",
        'provider_cache': "SELECT provider || ':' || resource_type || ':' || external_id AS natural_id FROM ({union_sql}) WHERE provider != '' AND resource_type != '' AND external_id != ''",
        'provider_match_candidates': "SELECT review_group_id || ':' || volume_id || ':' || provider || ':' || resource_type || ':' || candidate_external_id AS natural_id FROM ({union_sql}) WHERE volume_id IS NOT NULL AND provider != '' AND resource_type != '' AND candidate_external_id != '' AND review_group_id != ''",
        'volume_metadata_enrichment': "SELECT volume_id || ':' || provider || ':' || field_name AS natural_id FROM ({union_sql}) WHERE volume_id IS NOT NULL AND provider != '' AND field_name != ''",
        'volume_enrichment_terms': "SELECT volume_id || ':' || provider || ':' || term_type || ':' || external_id || ':' || name AS natural_id FROM ({union_sql}) WHERE volume_id IS NOT NULL AND provider != '' AND term_type != '' AND name != ''",
        'provider_rate_limit_state': "SELECT provider AS natural_id FROM ({union_sql}) WHERE provider != ''",
        'metron_enrichment_task_reservations': "SELECT CASE WHEN status IN ('reserved', 'queued', 'running') THEN 'active:' || volume_id ELSE 'history:' || volume_id || ':' || COALESCE(candidate_id, -1) || ':' || status || ':' || COALESCE(created_at, 0) || ':' || COALESCE(updated_at, 0) || ':' || COALESCE(safe_error, '') END AS natural_id FROM ({union_sql}) WHERE volume_id IS NOT NULL AND status != ''",
    }.get(table_name)
    if expected_identity_sql:
        expected_identity_sql = expected_identity_sql.format(union_sql=union_sql)
        expected_identities = cursor.execute(f"SELECT COUNT(*) FROM (SELECT DISTINCT natural_id FROM ({expected_identity_sql}) WHERE natural_id IS NOT NULL);").fetchone()[0]
        if dest_count < expected_identities:
            raise RuntimeError(f'Unexplained row loss while normalizing {table_name}: destination_rows={dest_count} distinct_valid_source_identities={expected_identities}')
    if dest_count != considered_count:
        LOGGER.warning('Normalized %s during migration: source_rows=%s destination_rows=%s merged_or_rejected=%s', table_name, considered_count, dest_count, considered_count - dest_count)
    if not _metron_table_compatible(cursor, destination_name, table_name):
        raise RuntimeError(f'Normalized Metron table {table_name} failed schema validation')

    if _table_exists(cursor, table_name):
        cursor.execute(f'DROP TABLE {_quote_identifier(table_name)};')
    cursor.execute(f'ALTER TABLE {_quote_identifier(destination_name)} RENAME TO {_quote_identifier(table_name)};')
    fk_errors = cursor.execute('PRAGMA foreign_key_check;').fetchall()
    if fk_errors:
        raise RuntimeError(f'Foreign key validation failed while normalizing {table_name}: {fk_errors[:3]}')
    if table_name != 'provider_match_candidates':
        for source_name in source_names:
            if source_name != table_name and _table_exists(cursor, source_name):
                cursor.execute(f'DROP TABLE {_quote_identifier(source_name)};')


def _ensure_metron_base_schema(cursor) -> None:
    for table_name in _METRON_TABLE_DEFINITIONS:
        _normalize_metron_table(cursor, table_name)
    for source_name in _migration_58_source_names(cursor, 'provider_match_candidates'):
        if source_name != 'provider_match_candidates' and _table_exists(cursor, source_name):
            cursor.execute(f'DROP TABLE {_quote_identifier(source_name)};')
    if _table_exists(cursor, 'volumes'):
        duplicate_count = cursor.execute("""SELECT COUNT(*) FROM volume_provider_links WHERE external_id != ''""").fetchone()[0]
        cursor.execute("""DELETE FROM volume_provider_links
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY provider, resource_type, external_id
                        ORDER BY COALESCE(last_successful_enrichment, 0) DESC,
                                 COALESCE(linked_at, 0) DESC,
                                 id DESC
                    ) AS rn
                    FROM volume_provider_links
                    WHERE external_id != ''
                ) WHERE rn = 1
            ) AND external_id != '';""")
        remaining_count = cursor.execute("""SELECT COUNT(*) FROM volume_provider_links WHERE external_id != ''""").fetchone()[0]
        if remaining_count != duplicate_count:
            LOGGER.warning('Merged duplicate Metron provider links during migration: before=%s after=%s merged=%s', duplicate_count, remaining_count, duplicate_count - remaining_count)
    cursor.executescript("""
        CREATE UNIQUE INDEX IF NOT EXISTS volume_provider_links_provider_external_unique_idx
            ON volume_provider_links(provider, resource_type, external_id)
            WHERE external_id != '';
        CREATE INDEX IF NOT EXISTS volume_provider_links_provider_external_idx
            ON volume_provider_links(provider, resource_type, external_id);
        CREATE INDEX IF NOT EXISTS volume_enrichment_terms_type_name_idx
            ON volume_enrichment_terms(term_type, name);
        CREATE INDEX IF NOT EXISTS volume_enrichment_terms_provider_external_idx
            ON volume_enrichment_terms(provider, external_id);
        CREATE INDEX IF NOT EXISTS provider_match_candidates_unresolved_idx
            ON provider_match_candidates(provider, review_status, volume_id, created_at);
        CREATE INDEX IF NOT EXISTS volume_metadata_enrichment_active_idx
            ON volume_metadata_enrichment(volume_id, provider, active);
        DROP INDEX IF EXISTS metron_enrichment_task_reservations_active_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS metron_enrichment_task_reservations_active_idx
            ON metron_enrichment_task_reservations(volume_id)
            WHERE status IN ('reserved', 'queued', 'running');
    """)


@DatabaseMigrationHandler.register_handler(57)
def _migrate_drop_saved_filters():
    cursor = get_db()
    cursor.execute('DROP TABLE IF EXISTS saved_filters;')
    return


@DatabaseMigrationHandler.register_handler(58)
def _migrate_normalize_metron_schema_after_version_collision():
    cursor = get_db()
    cursor.execute('DROP TABLE IF EXISTS saved_filters;')
    _ensure_metron_base_schema(cursor)
    return


@DatabaseMigrationHandler.register_handler(59)
def _migrate_harden_metron_enrichment_state():
    cursor = get_db()
    _ensure_metron_base_schema(cursor)
    cursor.executescript("""
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
    """)
    existing = [row[1] for row in cursor.execute('PRAGMA table_info(metron_backfill_state);')]
    additions = {
        'total_estimate': 'INTEGER NOT NULL DEFAULT 0',
        'skipped': 'INTEGER NOT NULL DEFAULT 0',
        'last_terminal_volume_id': 'INTEGER NOT NULL DEFAULT 0',
        'last_error': 'TEXT',
        'resume_time': 'INTEGER',
    }
    for column, ddl in additions.items():
        if column not in existing:
            cursor.execute(f'ALTER TABLE metron_backfill_state ADD COLUMN {column} {ddl};')
    return

@DatabaseMigrationHandler.register_handler(60)
def _migrate_add_file_validity_state():
    cursor = get_db()
    existing = [row[1] for row in cursor.execute('PRAGMA table_info(files);')]
    if 'exists_on_disk' not in existing:
        cursor.execute('ALTER TABLE files ADD COLUMN exists_on_disk BOOL NOT NULL DEFAULT 1;')
    if 'missing_since' not in existing:
        cursor.execute('ALTER TABLE files ADD COLUMN missing_since INTEGER;')
    cursor.execute('CREATE INDEX IF NOT EXISTS files_exists_on_disk_idx ON files(exists_on_disk);')
    return

@DatabaseMigrationHandler.register_handler(61)
def _migrate_add_metron_task_reservations():
    cursor = get_db()
    _ensure_metron_base_schema(cursor)
    cursor.executescript("""
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
        DROP INDEX IF EXISTS metron_enrichment_task_reservations_active_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS metron_enrichment_task_reservations_active_idx
            ON metron_enrichment_task_reservations(volume_id)
            WHERE status IN ('reserved', 'queued', 'running');
    """)
    return



_COMIC_DISCOVERY_FACT_COLUMNS = (
    'comicvine_volume_id', 'first_known_issue_id', 'first_known_issue_number',
    'first_known_issue_date', 'date_source', 'series_started_at', 'volume_title',
    'cover_link', 'site_url', 'year', 'publisher', 'is_upcoming_launch',
    'provider_modified_at', 'metadata_modified_at', 'fetched_at', 'derived_at',
    'derivation_status', 'date_preference', 'last_error'
)

_COMIC_DISCOVERY_SYNC_COLUMNS = (
    'sync_id', 'scope', 'provider_cursor', 'last_started_at', 'last_completed_at',
    'coverage_state', 'coverage_complete', 'date_preference', 'last_error',
    'next_resume_at', 'last_successful_cursor', 'records_processed',
    'facts_created', 'facts_updated'
)

_COMIC_DISCOVERY_FACT_DEFINITION = """
    CREATE TABLE {table_name}(
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
"""

_COMIC_DISCOVERY_SYNC_DEFINITION = """
    CREATE TABLE {table_name}(
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
"""


def _create_comic_discovery_indexes(cursor) -> None:
    cursor.executescript("""
        CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_first_date_idx
            ON comic_series_discovery_facts(first_known_issue_date);
        CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_upcoming_idx
            ON comic_series_discovery_facts(is_upcoming_launch, first_known_issue_date);
        CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_derived_idx
            ON comic_series_discovery_facts(derived_at);
        CREATE INDEX IF NOT EXISTS comic_series_discovery_facts_volume_idx
            ON comic_series_discovery_facts(comicvine_volume_id);
    """)


def _discovery_table_compatible(cursor, table_name: str, expected_columns: tuple, required_notnull: tuple, pk_columns: tuple) -> bool:
    if not _table_exists(cursor, table_name):
        return False
    info = cursor.execute(f'PRAGMA table_info({_quote_identifier(table_name)});').fetchall()
    columns = {row[1]: row for row in info}
    if tuple(columns) != expected_columns:
        return False
    for column in required_notnull:
        if int(columns[column][3] or 0) != 1:
            return False
    for position, column in enumerate(pk_columns, start=1):
        if int(columns[column][5] or 0) != position:
            return False
    return True


def _discovery_default_expression(table_name: str, column: str) -> str:
    if table_name == 'comic_series_discovery_facts':
        defaults = {
            'first_known_issue_number': "''", 'date_source': "''", 'volume_title': "''",
            'cover_link': "''", 'site_url': "''", 'is_upcoming_launch': '0',
            'derived_at': '0', 'derivation_status': "'valid'", 'date_preference': "'cover_date'",
        }
    else:
        defaults = {
            'sync_id': '1', 'scope': "'comic_series_discovery'", 'coverage_state': "'not_started'",
            'coverage_complete': '0', 'date_preference': "'cover_date'",
            'records_processed': '0', 'facts_created': '0', 'facts_updated': '0',
        }
    return defaults.get(column, f'NULL AS {column}')


def _normalize_discovery_table(cursor, table_name: str, definition: str, expected_columns: tuple, required_notnull: tuple, pk_columns: tuple) -> None:
    if _discovery_table_compatible(cursor, table_name, expected_columns, required_notnull, pk_columns):
        return
    destination_name = _unique_migration_table_name(cursor, table_name, 'migration_62_reconciled')
    cursor.execute(definition.format(table_name=_quote_identifier(destination_name)))
    if _table_exists(cursor, table_name):
        source_columns: Set[str] = set(_table_columns(cursor, table_name))
        expressions = []
        for column in expected_columns:
            if column in source_columns:
                if column in required_notnull:
                    expressions.append(f'COALESCE({column}, {_discovery_default_expression(table_name, column)}) AS {column}')
                else:
                    expressions.append(column)
            else:
                expressions.append(f'{_discovery_default_expression(table_name, column)} AS {column}')
        if table_name == 'comic_series_discovery_facts':
            copy_sql = f"""
                INSERT OR REPLACE INTO {_quote_identifier(destination_name)} ({', '.join(expected_columns)})
                SELECT {', '.join(expected_columns)} FROM (
                    SELECT {', '.join(expressions)}, ROW_NUMBER() OVER (
                        PARTITION BY comicvine_volume_id ORDER BY COALESCE(derived_at, 0) DESC, COALESCE(fetched_at, 0) DESC
                    ) AS rn
                    FROM {_quote_identifier(table_name)}
                    WHERE comicvine_volume_id IS NOT NULL
                ) WHERE rn = 1;
            """
        else:
            copy_sql = f"""
                INSERT OR REPLACE INTO {_quote_identifier(destination_name)} ({', '.join(expected_columns)})
                SELECT {', '.join(expected_columns)} FROM (
                    SELECT {', '.join(expressions)}, ROW_NUMBER() OVER (
                        PARTITION BY sync_id ORDER BY COALESCE(last_completed_at, 0) DESC, COALESCE(last_started_at, 0) DESC
                    ) AS rn
                    FROM {_quote_identifier(table_name)}
                    WHERE sync_id IS NOT NULL
                ) WHERE rn = 1;
            """
        cursor.execute(copy_sql)
        cursor.execute(f'DROP TABLE {_quote_identifier(table_name)};')
    cursor.execute(f'ALTER TABLE {_quote_identifier(destination_name)} RENAME TO {_quote_identifier(table_name)};')
    if not _discovery_table_compatible(cursor, table_name, expected_columns, required_notnull, pk_columns):
        raise RuntimeError(f'Failed to normalize {table_name} schema')


@DatabaseMigrationHandler.register_handler(62)
def _migrate_add_comic_discovery_facts():
    cursor = get_db()
    _normalize_discovery_table(
        cursor,
        'comic_series_discovery_facts',
        _COMIC_DISCOVERY_FACT_DEFINITION,
        _COMIC_DISCOVERY_FACT_COLUMNS,
        ('first_known_issue_number', 'date_source', 'volume_title', 'cover_link', 'site_url', 'is_upcoming_launch', 'derived_at', 'derivation_status', 'date_preference'),
        ('comicvine_volume_id',),
    )
    _create_comic_discovery_indexes(cursor)
    _normalize_discovery_table(
        cursor,
        'comic_discovery_fact_sync_state',
        _COMIC_DISCOVERY_SYNC_DEFINITION,
        _COMIC_DISCOVERY_SYNC_COLUMNS,
        ('scope', 'coverage_state', 'coverage_complete', 'date_preference', 'records_processed', 'facts_created', 'facts_updated'),
        ('sync_id',),
    )
    cursor.execute("""
        INSERT OR IGNORE INTO comic_discovery_fact_sync_state(sync_id, scope, coverage_state, coverage_complete, date_preference)
            VALUES (1, 'comic_series_discovery', 'not_started', 0, 'cover_date');
    """)
    return
