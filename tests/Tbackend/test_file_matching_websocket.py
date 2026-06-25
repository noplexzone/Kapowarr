"""Regression tests for non-blocking file-scan websocket notifications."""


def test_downloaded_status_emit_errors_do_not_escape(monkeypatch):
    from backend.implementations import file_matching

    calls = []

    class FailingWebSocket:
        def emit(self, event):
            calls.append(event)
            raise RuntimeError('simulated websocket failure')

    class ImmediateThread:
        def __init__(self, target, name=None, daemon=None):
            self.target = target
            self.name = name
            self.daemon = daemon

        def start(self):
            self.target()

    monkeypatch.setattr(file_matching, 'WebSocket', FailingWebSocket)
    monkeypatch.setattr(file_matching, 'Thread', ImmediateThread)

    event = file_matching.DownloadedStatusEvent(
        1214, downloaded_issues=[33218]
    )

    file_matching._emit_downloaded_status_event(event)

    assert calls == [event]


def test_scan_files_uses_non_blocking_downloaded_status_helper():
    import inspect

    from backend.implementations import file_matching

    source = inspect.getsource(file_matching.scan_files)

    assert '_emit_downloaded_status_event(DownloadedStatusEvent(' in source
    assert 'WebSocket().emit(DownloadedStatusEvent(' not in source
