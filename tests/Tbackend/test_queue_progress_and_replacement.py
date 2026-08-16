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


def test_suwayomi_volume_download_phase_uses_half_progress_scale():
    import inspect

    from backend.implementations.download_clients import SuwayomiVolumeDownload

    source = inspect.getsource(SuwayomiVolumeDownload.run)

    assert "idx / total_chapters * 100" not in source
    assert "idx / total_chapters * 50" in source
    assert "(idx + 1) / total_chapters * 50" in source


def test_replace_existing_issue_files_deletes_old_linked_file(monkeypatch):
    from backend.features import post_processing

    deleted_paths = []
    deleted_ids = []
    commits = []
    rollbacks = []
    renames = []

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

    class FakeConnection:
        def commit(self):
            commits.append(True)

        def rollback(self):
            rollbacks.append(True)

    class FakeDB:
        connection = FakeConnection()

    monkeypatch.setattr(post_processing, 'FilesDB', FakeFilesDB)
    monkeypatch.setattr(post_processing, 'get_db', lambda: FakeDB())
    monkeypatch.setattr(post_processing, 'exists', lambda path: path.endswith('old.cbz') or '.kapowarr-replaced-' in path)
    monkeypatch.setattr(post_processing, 'rename_file', lambda source, dest: renames.append((source, dest)))
    monkeypatch.setattr(post_processing, 'delete_file_folder', deleted_paths.append)
    monkeypatch.setattr(post_processing, 'commit', lambda: commits.append(True))

    download = SimpleNamespace(
        issue_id=33046,
        covered_issues=28.0,
        files=['/library/Jujutsu Kaisen new.pdf'],
    )

    post_processing.replace_existing_issue_files(download)

    assert len(renames) == 1
    assert renames[0][0] == '/library/Jujutsu Kaisen old.cbz'
    assert renames[0][1].startswith('/library/Jujutsu Kaisen old.cbz.kapowarr-replaced-')
    assert deleted_paths == [renames[0][1]]
    assert deleted_ids == [7]
    assert commits == [True]
    assert rollbacks == []


def test_suwayomi_queue_entry_exposes_source_detail_from_display_title():
    from backend.base.definitions import DownloadSource, DownloadState
    from backend.implementations.download_clients import BaseDirectDownload

    download = BaseDirectDownload.__new__(BaseDirectDownload)
    download.identifier = 'suwayomi_volume'
    download._id = 1
    download._volume_id = 1214
    download._issue_id = 33047
    download._web_link = None
    download._web_title = None
    download._web_sub_title = 'Jujutsu Kaisen - Vol. 29 (Ch. 255–263) [Atsumaru]'
    download._download_link = 'suwayomi:1756:10524,10525'
    download._pure_link = download._download_link
    download._source_type = DownloadSource.SUWAYOMI
    download._source_name = 'Suwayomi'
    download._files = ['/tmp/Jujutsu Kaisen 029.pdf']
    download._title = 'Jujutsu Kaisen 029 (2019)'
    download._download_folder = '/tmp'
    download._size = 1000
    download._state = DownloadState.DOWNLOADING_STATE
    download._progress = 50
    download._speed = 100
    download._task_label = 'Assembling PDF'

    assert download.as_dict()['source_detail'] == 'Atsumaru'


def test_process_queue_ignores_canceled_downloads_and_starts_waiting_slots():
    from backend.base.definitions import DownloadState
    from backend.features.download_queue import DownloadHandler

    starts = []

    class FakeThread:
        def __init__(self, name):
            self.name = name
            self.started = False

        def is_alive(self):
            return self.started

        def start(self):
            starts.append(self.name)
            self.started = True

    canceled = SimpleNamespace(
        state=DownloadState.CANCELED_STATE,
        download_thread=FakeThread('canceled'),
    )
    active = SimpleNamespace(
        state=DownloadState.DOWNLOADING_STATE,
        download_thread=FakeThread('active'),
    )
    queued_a = SimpleNamespace(
        state=DownloadState.QUEUED_STATE,
        download_thread=FakeThread('queued-a'),
    )
    queued_b = SimpleNamespace(
        state=DownloadState.QUEUED_STATE,
        download_thread=FakeThread('queued-b'),
    )

    handler = DownloadHandler.__new__(DownloadHandler)
    handler.settings = SimpleNamespace(
        sv=SimpleNamespace(concurrent_direct_downloads=3)
    )
    handler.queue = [canceled, active, queued_a, queued_b]

    DownloadHandler._process_queue(handler)

    assert starts == ['queued-a', 'queued-b']


def test_remove_active_download_releases_slot_for_next_download(monkeypatch):
    from backend.base.definitions import DownloadState
    from backend.features import download_queue
    from backend.features.download_queue import DownloadHandler

    events = []
    starts = []
    canceled = []

    class FakeWebSocket:
        def emit(self, event):
            events.append(event)

    class FakePostProcessor:
        @staticmethod
        def canceled(download):
            canceled.append(download.id)

    class FakeThread:
        def __init__(self, name, alive=False):
            self.name = name
            self.alive = alive

        def is_alive(self):
            return self.alive

        def start(self):
            starts.append(self.name)
            self.alive = True

    class FakeDownload:
        def __init__(self, download_id, state, thread):
            self.id = download_id
            self.state = state
            self.download_thread = thread
            self.web_link = None
            self.web_title = None
            self.web_sub_title = None
            self.download_link = 'suwayomi:test'
            self.source_type = None
            self.volume_id = 1
            self.issue_id = 1

        def stop(self, state=DownloadState.CANCELED_STATE):
            self.state = state

    monkeypatch.setattr(download_queue, 'WebSocket', FakeWebSocket)
    monkeypatch.setattr(download_queue, 'PostProcessor', FakePostProcessor)

    active = FakeDownload(
        1, DownloadState.DOWNLOADING_STATE, FakeThread('active', alive=True)
    )
    queued = FakeDownload(
        2, DownloadState.QUEUED_STATE, FakeThread('queued')
    )

    handler = DownloadHandler.__new__(DownloadHandler)
    handler.settings = SimpleNamespace(
        sv=SimpleNamespace(concurrent_direct_downloads=3)
    )
    handler.queue = [active, queued]

    DownloadHandler.remove(handler, 1)

    assert handler.queue == [queued]
    assert canceled == [1]
    assert starts == ['queued']
    assert events


def test_direct_download_post_processing_not_blocked_by_websocket_emit(monkeypatch):
    from backend.base.definitions import DownloadState
    from backend.features import download_queue
    from backend.features.download_queue import DownloadHandler

    successes = []
    starts = []

    class BlockingWebSocket:
        def emit(self, event):
            raise RuntimeError('simulated blocked websocket')

    class FakePostProcessor:
        @staticmethod
        def success(download):
            successes.append(download.id)

        @staticmethod
        def shutdown(download):  # pragma: no cover - defensive
            raise AssertionError('unexpected shutdown')

        @staticmethod
        def canceled(download):  # pragma: no cover - defensive
            raise AssertionError('unexpected cancel')

        @staticmethod
        def failed(download):  # pragma: no cover - defensive
            raise AssertionError('unexpected fail')

    class FakeThread:
        def __init__(self, name, alive=False):
            self.name = name
            self.alive = alive

        def is_alive(self):
            return self.alive

        def start(self):
            starts.append(self.name)
            self.alive = True

    class FakeDownload:
        def __init__(self, download_id, state, thread):
            self.id = download_id
            self.state = state
            self.download_thread = thread
            self.volume_id = 1
            self.issue_id = 1
            self.source_type = None
            self.source_name = None
            self.web_link = None
            self.web_title = None
            self.web_sub_title = None
            self.download_link = 'suwayomi:test'
            self.files = ['/tmp/test.pdf']
            self.title = 'test'
            self.progress = 0
            self.progress_is_percent = True
            self.size = -1
            self.speed = 0
            self.task_label = 'Queued'

        def run(self):
            self.state = DownloadState.DOWNLOADING_STATE

        def stop(self, state=DownloadState.CANCELED_STATE):
            self.state = state

        def as_dict(self):
            return {'id': self.id, 'status': self.state.value}

    monkeypatch.setattr(download_queue, 'WebSocket', BlockingWebSocket)
    monkeypatch.setattr(download_queue, 'PostProcessor', FakePostProcessor)

    finished = FakeDownload(
        1, DownloadState.QUEUED_STATE, FakeThread('finished', alive=True)
    )
    queued = SimpleNamespace(
        state=DownloadState.QUEUED_STATE,
        download_thread=FakeThread('queued'),
    )

    handler = DownloadHandler.__new__(DownloadHandler)
    handler.settings = SimpleNamespace(
        sv=SimpleNamespace(concurrent_direct_downloads=1)
    )
    handler.queue = [finished, queued]

    DownloadHandler._DownloadHandler__run_download(handler, finished)

    assert successes == [1]
    assert handler.queue == [queued]
    assert starts == ['queued']
