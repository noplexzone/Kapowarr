"""Test that mass_rename respects stop_fn for early cancellation."""

from contextlib import contextmanager, ExitStack
from unittest.mock import patch
from backend.implementations.naming import mass_rename


@contextmanager
def _rename_mocks():
    with ExitStack() as stack:
        mock_preview = stack.enter_context(patch(
            'backend.implementations.naming.preview_mass_rename',
        ))
        mock_rename = stack.enter_context(patch(
            'backend.implementations.naming.rename_file',
        ))
        for target in (
            'FilesDB',
            'Volume',
            'RootFolders',
            'delete_empty_child_folders',
            'delete_empty_parent_folders',
            'mass_process_files',
        ):
            stack.enter_context(patch(
                f'backend.implementations.naming.{target}',
            ))
        yield mock_preview, mock_rename


def test_mass_rename_stops_when_stop_fn_returns_true():
    """mass_rename should stop renaming when stop_fn returns True."""
    stop_called = []

    def stop_fn():
        stop_called.append(True)
        return True  # stop immediately

    with _rename_mocks() as (mock_preview, mock_rename):
        # Setup: 5 files to rename, all different
        mock_preview.return_value = (
            {
                '/old/file1.cbz': '/new/file1.cbz',
                '/old/file2.cbz': '/new/file2.cbz',
                '/old/file3.cbz': '/new/file3.cbz',
                '/old/file4.cbz': '/new/file4.cbz',
                '/old/file5.cbz': '/new/file5.cbz',
            },
            None,  # no volume folder change
        )

        result = mass_rename(1, stop_fn=stop_fn)

        # stop_fn should have been called
        assert len(stop_called) >= 1

        # rename_file should be called at most once (stopped on first iteration)
        assert mock_rename.call_count <= 1

        # should still return filenames
        assert len(result) == 5


def test_mass_rename_continues_when_stop_fn_returns_false():
    """mass_rename should continue renaming when stop_fn returns False."""
    calls = []

    def stop_fn():
        calls.append(True)
        return False

    with _rename_mocks() as (mock_preview, mock_rename):
        mock_preview.return_value = (
            {
                '/old/file1.cbz': '/new/file1.cbz',
                '/old/file2.cbz': '/new/file2.cbz',
            },
            None,
        )

        result = mass_rename(1, stop_fn=stop_fn)

        # stop_fn checked twice (once per file)
        assert len(calls) == 2
        # both files renamed
        assert mock_rename.call_count == 2


def test_mass_rename_no_stop_fn_renames_all():
    """Without stop_fn, all files should be renamed (backward compat)."""
    with _rename_mocks() as (mock_preview, mock_rename):
        mock_preview.return_value = (
            {
                '/old/file1.cbz': '/new/file1.cbz',
                '/old/file2.cbz': '/new/file2.cbz',
                '/old/file3.cbz': '/new/file3.cbz',
            },
            None,
        )

        result = mass_rename(1)

        # all 3 files renamed
        assert mock_rename.call_count == 3
        assert len(result) == 3
