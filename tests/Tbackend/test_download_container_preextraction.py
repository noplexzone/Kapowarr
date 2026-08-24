import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import call, patch
from zipfile import ZipFile

from backend.features import post_processing
from backend.implementations import converters


class DownloadContainerPreextractionTests(unittest.TestCase):
    def test_expands_container_archives_before_scanning(self):
        download = SimpleNamespace(volume_id=7, files=['range.zip', 'single.cbz'])
        settings = SimpleNamespace(sv=SimpleNamespace(extract_issue_ranges=True))

        with patch.object(post_processing, 'Settings', return_value=settings), patch.object(
            post_processing,
            'extract_download_container_archive',
            side_effect=[['issue-001.cbr', 'issue-002.cbr'], None],
        ) as extract:
            post_processing.extract_download_container_archives(download)

        self.assertEqual(download.files, ['issue-001.cbr', 'issue-002.cbr', 'single.cbz'])
        self.assertEqual(
            extract.call_args_list,
            [call('range.zip', 7), call('single.cbz', 7)],
        )

    def test_disabled_setting_leaves_download_unchanged(self):
        download = SimpleNamespace(volume_id=7, files=['range.zip'])
        settings = SimpleNamespace(sv=SimpleNamespace(extract_issue_ranges=False))

        with patch.object(post_processing, 'Settings', return_value=settings), patch.object(
            post_processing,
            'extract_download_container_archive',
        ) as extract:
            post_processing.extract_download_container_archives(download)

        self.assertEqual(download.files, ['range.zip'])
        extract.assert_not_called()

    def test_direct_and_nzb_expand_before_database_scan(self):
        for processor in (post_processing.PostProcessor, post_processing.PostProcessorNZB):
            actions = [action.__name__ for action in processor.actions_success]
            self.assertLess(
                actions.index('extract_download_container_archives'),
                actions.index('add_file_to_database'),
            )

    def test_torrent_expands_before_scan_and_rename(self):
        download = SimpleNamespace(volume_id=7, files=['job-folder'])
        settings = SimpleNamespace(sv=SimpleNamespace(rename_downloaded_files=True))

        with patch.object(post_processing, 'exists', return_value=True), patch.object(
            post_processing, 'move_to_dest'
        ), patch.object(
            post_processing,
            'extract_files_from_folder',
            return_value=['range.zip'],
        ), patch.object(
            post_processing, 'extract_download_container_archives'
        ) as expand, patch.object(
            post_processing, 'scan_files'
        ) as scan, patch.object(
            post_processing, 'mass_rename', return_value=['issue.cbz']
        ) as rename, patch.object(
            post_processing, 'Settings', return_value=settings
        ):
            post_processing.move_torrent_to_dest(download)

        expand.assert_called_once_with(download)
        scan.assert_called_once_with(
            7,
            filepath_filter=['range.zip'],
            update_websocket=True,
        )
        rename.assert_called_once()


class DownloadContainerExtractionIntegrityTests(unittest.TestCase):
    def test_real_zip_container_is_expanded_before_database_linking(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            outer = root / 'The Punisher - War Zone 001 - 002.zip'
            archive_folder = root / 'archive'
            with ZipFile(outer, 'w') as archive:
                archive.writestr('The Punisher - War Zone 001.cbz', b'issue-one')
                archive.writestr('The Punisher - War Zone 002.cbz', b'issue-two')

            extracted = [
                str(root / 'The Punisher - War Zone 001.cbz'),
                str(root / 'The Punisher - War Zone 002.cbz'),
            ]

            def inspect_extraction(folder, volume_id):
                self.assertEqual(folder, str(archive_folder))
                self.assertEqual(volume_id, 7)
                self.assertEqual(
                    sorted(path.name for path in archive_folder.iterdir()),
                    [
                        'The Punisher - War Zone 001.cbz',
                        'The Punisher - War Zone 002.cbz',
                    ],
                )
                return extracted

            volume = SimpleNamespace(vd=SimpleNamespace(folder=str(root)))
            with patch.object(converters, 'Volume', return_value=volume), patch.object(
                converters, 'generate_archive_folder', return_value=str(archive_folder)
            ), patch.object(
                converters, 'extract_files_from_folder', side_effect=inspect_extraction
            ), patch.object(
                converters, 'scan_files'
            ) as scan, patch.object(
                converters, 'mass_rename', return_value=extracted
            ), patch.object(
                converters, 'delete_file_folder'
            ), patch.object(
                converters, 'delete_empty_parent_folders'
            ):
                result = converters.extract_download_container_archive(str(outer), 7)

            self.assertEqual(result, extracted)
            scan.assert_called_once_with(7, filepath_filter=extracted)

    def test_empty_rename_result_preserves_extracted_filter_paths(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            outer = root / 'range.zip'
            archive_folder = root / 'archive'
            extracted_file = root / 'unmatched-range.cbz'
            extracted_file.write_bytes(b'range')
            with ZipFile(outer, 'w') as archive:
                archive.writestr('unmatched-range.cbz', b'range')

            volume = SimpleNamespace(vd=SimpleNamespace(folder=str(root)))
            with patch.object(converters, 'Volume', return_value=volume), patch.object(
                converters, 'generate_archive_folder', return_value=str(archive_folder)
            ), patch.object(
                converters, 'extract_files_from_folder', return_value=[str(extracted_file)]
            ), patch.object(
                converters, 'scan_files'
            ), patch.object(
                converters, 'mass_rename', return_value=[]
            ), patch.object(
                converters, 'delete_file_folder'
            ), patch.object(
                converters, 'delete_empty_parent_folders'
            ):
                result = converters._zip_to_folder(str(outer), 7)

            self.assertEqual(result, [str(extracted_file)])

    def test_existing_library_destination_is_never_overwritten(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / 'archive'
            source.mkdir()
            incoming = source / 'The Punisher - War Zone 001.cbz'
            incoming.write_bytes(b'new-issue')
            existing = root / incoming.name
            existing.write_bytes(b'existing-issue')

            volume_data = SimpleNamespace(
                folder=str(root), year=1992, title='The Punisher - War Zone'
            )
            volume = SimpleNamespace(
                get_data=lambda: volume_data,
                get_issues=lambda: [],
                get_ending_year=lambda: None,
            )
            with patch.object(converters, 'Volume', return_value=volume), patch.object(
                converters, 'extract_filename_data', return_value={}
            ), patch.object(
                converters, 'folder_extraction_filter', return_value=True
            ), patch.object(
                converters, 'set_detected_extension', side_effect=lambda path: path
            ):
                with self.assertRaises(FileExistsError):
                    converters.extract_files_from_folder(str(source), 7)

            self.assertEqual(existing.read_bytes(), b'existing-issue')
            self.assertEqual(incoming.read_bytes(), b'new-issue')


class DownloadRenameFilterIntegrityTests(unittest.TestCase):
    def test_shared_download_rename_preserves_unmatched_paths(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            renamed = root / 'issue-001.cbz'
            renamed.write_bytes(b'one')
            old_path = root / 'old-issue-001.cbz'
            unmatched = root / 'unmatched-range.cbz'
            unmatched.write_bytes(b'range')
            download = SimpleNamespace(
                volume_id=7, files=[str(old_path), str(unmatched)]
            )
            settings = SimpleNamespace(
                sv=SimpleNamespace(rename_downloaded_files=True)
            )

            with patch.object(
                post_processing, 'Settings', return_value=settings
            ), patch.object(
                post_processing, 'mass_rename', return_value=[str(renamed)]
            ) as mass_rename:
                post_processing.rename_download_files(download)

            self.assertEqual(download.files, [str(unmatched), str(renamed)])
            mass_rename.assert_called_once_with(
                7,
                filepath_filter=[str(old_path), str(unmatched)],
                process_individual_files=False,
            )
