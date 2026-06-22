"""Regression tests for queue progress reporting and issue-download replacement."""

from types import SimpleNamespace


def test_direct_download_progress_percent_flag_defaults_from_known_size():
    from backend.base.definitions import DownloadSource, DownloadState
    from backend.implementations.download_clients import BaseDirectDownload

    download = BaseDirectDownload.__new__(BaseDirectDownload)
    download.identifier = 'direct'
    download._id = 1
    download._volume_id = 10
    download._issue_id = 20
    download._web_link = None
    download._web_title = None
    download._web_sub_title = None
    download._download_link = 'https://example.invalid/file.cbz'
    download._pure_link = download._download_link
    download._source_type = DownloadSource.MEDIAFIRE
    download._source_name = 'MediaFire'
    download._files = ['/tmp/file.cbz']
    download._title = 'file'
    download._download_folder = '/tmp'
    download._size = 1000
    download._state = DownloadState.DOWNLOADING_STATE
    download._progress = 50
    download._speed = 100
    download._task_label = 'Downloading'

    assert download.as_dict()['progress_is_percent'] is True


def test_direct_download_progress_flag_false_when_size_unknown():
    from backend.base.definitions import DownloadSource, DownloadState
    from backend.implementations.download_clients import BaseDirectDownload

    download = BaseDirectDownload.__new__(BaseDirectDownload)
    download.identifier = 'direct'
    download._id = 1
    download._volume_id = 10
    download._issue_id = 20
    download._web_link = None
    download._web_title = None
    download._web_sub_title = None
    download._download_link = 'https://example.invalid/file.cbz'
    download._pure_link = download._download_link
    download._source_type = DownloadSource.MEDIAFIRE
    download._source_name = 'MediaFire'
    download._files = ['/tmp/file.cbz']
    download._title = 'file'
    download._download_folder = '/tmp'
    download._size = -1
    download._state = DownloadState.DOWNLOADING_STATE
    download._progress = 500
    download._speed = 100
    download._task_label = 'Downloading'

    assert download.as_dict()['progress_is_percent'] is False


def test_queue_status_event_includes_progress_percent_flag():
    from backend.base.definitions import DownloadSource, DownloadState
    from backend.implementations.download_clients import BaseDirectDownload
    from backend.internals.server import QueueStatusEvent

    download = BaseDirectDownload.__new__(BaseDirectDownload)
    download.identifier = 'suwayomi_volume'
    download._id = 1
    download._volume_id = 10
    download._issue_id = 20
    download._source_type = DownloadSource.SUWAYOMI
    download._source_name = 'Suwayomi'
    download._size = -1
    download._state = DownloadState.DOWNLOADING_STATE
    download._progress = 25
    download._progress_is_percent = True
    download._speed = 100
    download._task_label = 'Downloading 1/4'

    body = QueueStatusEvent(download).get_body()

    assert body['progress_is_percent'] is True
    assert body['task_label'] == 'Downloading 1/4'


def test_replace_existing_issue_files_deletes_old_linked_file(monkeypatch):
    from backend.features import post_processing

    deleted_paths = []
    deleted_ids = []
    commits = []

    class FakeFilesDB:
        @staticmethod
        def fetch(issue_id):
            assert issue_id == 33046
            return [
                {'id': 7, 'filepath': '/library/Jujutsu Kaisen old.cbz', 'size': 10},
                {'id': 8, 'filepath': '/library/Jujutsu Kaisen new.pdf', 'size': 20},
            ]

        @staticmethod
        def delete_file(file_id):
            deleted_ids.append(file_id)

        @staticmethod
        def delete_filepath(filepath):  # pragma: no cover - fallback path
            raise AssertionError(filepath)

    monkeypatch.setattr(post_processing, 'FilesDB', FakeFilesDB)
    monkeypatch.setattr(post_processing, 'exists', lambda path: path.endswith('old.cbz'))
    monkeypatch.setattr(post_processing, 'delete_file_folder', deleted_paths.append)
    monkeypatch.setattr(post_processing, 'commit', lambda: commits.append(True))

    download = SimpleNamespace(
        issue_id=33046,
        covered_issues=28.0,
        files=['/library/Jujutsu Kaisen new.pdf'],
    )

    post_processing.replace_existing_issue_files(download)

    assert deleted_paths == ['/library/Jujutsu Kaisen old.cbz']
    assert deleted_ids == [7]
    assert commits == [True]
