"""Regression tests for best-effort file-scan websocket notifications."""


def test_downloaded_status_emit_errors_do_not_escape(monkeypatch):
    from backend.implementations import file_matching

    calls = []

    class FailingWebSocket:
        def emit(self, event):
            calls.append(event)
            raise RuntimeError('simulated websocket failure')

    monkeypatch.setattr(file_matching, 'WebSocket', FailingWebSocket)

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
