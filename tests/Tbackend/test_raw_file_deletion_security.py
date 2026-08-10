import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask, request as flask_request

import frontend.api as api_mod
from backend.base.custom_exceptions import InvalidKeyValue


class RawFileDeletionSecurityTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.base = Path(self.tempdir.name)
        self.root = self.base / 'media' / 'comics'
        self.volume = self.root / 'Saga (2012)'
        self.volume.mkdir(parents=True)
        self.settings = MagicMock()
        self.settings.sv.api_key = 'test-api-key'
        self.settings.sv.auth_password = None

    def tearDown(self):
        self.tempdir.cleanup()

    def _patches(self):
        volume = MagicMock()
        volume.get_data.return_value = SimpleNamespace(root_folder=7, folder=str(self.volume))
        roots = MagicMock()
        roots.__getitem__.return_value = str(self.root)
        return (patch.object(api_mod.Library, 'get_volume', return_value=volume),
                patch.object(api_mod, 'RootFolders', return_value=roots),
                patch.object(api_mod, 'Settings', return_value=self.settings))

    def _client(self):
        app = Flask(__name__)
        app.register_blueprint(api_mod.api, url_prefix='/api')
        return app.test_client()

    def _assert_rejected(self, target):
        volume_patch, roots_patch, settings_patch = self._patches()
        with volume_patch, roots_patch, settings_patch, self.assertRaises(InvalidKeyValue):
            api_mod._validate_unmatched_deletion_target(1, str(target))

    def test_valid_regular_unmatched_file_is_resolved(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        volume_patch, roots_patch, settings_patch = self._patches()
        with volume_patch, roots_patch, settings_patch:
            resolved = api_mod._validate_unmatched_deletion_target(1, str(target))
        self.assertEqual(resolved.path, str(target.resolve()))
        self.assertEqual(resolved.volume_stat.st_ino, self.volume.stat().st_ino)
        self.assertEqual(resolved.target_stat.st_ino, target.stat().st_ino)

    def test_rejects_parent_traversal_outside_volume(self):
        target = self.root / 'outside.cbz'
        target.write_bytes(b'comic')
        self._assert_rejected(self.volume / '..' / 'outside.cbz')

    def test_rejects_similar_prefix_volume(self):
        backup = self.base / 'media' / 'comics-backup'
        backup.mkdir(parents=True)
        target = backup / 'outside.cbz'
        target.write_bytes(b'comic')
        self._assert_rejected(target)

    def test_rejects_symlink_escape(self):
        outside = self.base / 'outside.cbz'
        outside.write_bytes(b'comic')
        link = self.volume / 'escape.cbz'
        os.symlink(str(outside), str(link))
        self._assert_rejected(link)

    def test_rejects_directory(self):
        directory = self.volume / 'folder.cbz'
        directory.mkdir()
        self._assert_rejected(directory)

    def test_rejects_special_file(self):
        fifo = self.volume / 'named-pipe.cbz'
        os.mkfifo(str(fifo))
        self._assert_rejected(fifo)

    def test_rejects_hardlink_to_actual_database_path(self):
        database = self.base / 'database-location' / 'application-state'
        database.parent.mkdir()
        database.write_bytes(b'database')
        alias = self.volume / 'innocent-looking.cbz'
        os.link(str(database), str(alias))
        volume_patch, roots_patch, settings_patch = self._patches()
        with volume_patch, roots_patch, settings_patch, patch.object(
            api_mod.DBConnection, 'file', str(database)
        ), self.assertRaises(InvalidKeyValue):
            api_mod._validate_unmatched_deletion_target(1, str(alias))

    def test_rejects_database_and_configuration_files(self):
        for name in ('Kapowarr.db', 'config.ini', '.env'):
            with self.subTest(name=name):
                target = self.volume / name
                target.write_bytes(b'secret')
                self._assert_rejected(target)

    def test_identifier_is_scoped_to_volume_and_api_key(self):
        path = str(self.volume / 'Saga 001.cbz')
        first = api_mod._unmatched_file_id(1, path, 'key-a')
        self.assertNotEqual(first, api_mod._unmatched_file_id(2, path, 'key-a'))
        self.assertNotEqual(first, api_mod._unmatched_file_id(1, path, 'key-b'))
        self.assertNotIn(path, first)

    def _delete(self, requested_volume, file_id, matches, api_key=None):
        volume_patch, roots_patch, settings_patch = self._patches()
        headers = {'X-Api-Key': api_key} if api_key else None
        with patch.object(api_mod, 'request', flask_request), volume_patch, roots_patch, settings_patch, patch.object(api_mod.StartTypeHandlers, 'diffuse_timer'), patch.object(api_mod, 'get_file_matching', return_value=matches):
            return self._client().delete('/api/files/raw', json={'volume_id': requested_volume, 'unmatched_file_id': file_id}, headers=headers)

    def test_delete_requires_api_key_even_when_passwordless(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        response = self._delete(1, file_id, matches)
        self.assertEqual(response.status_code, 401)
        self.assertTrue(target.exists())

    def test_delete_rejects_wrong_api_key(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        response = self._delete(1, file_id, matches, 'wrong-key')
        self.assertEqual(response.status_code, 401)
        self.assertTrue(target.exists())

    def test_delete_rejects_stale_identifier(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        stale_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        renamed = self.volume / 'Saga 001 renamed.cbz'
        target.rename(renamed)
        matches = [{'filepath': str(renamed), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': api_mod._unmatched_file_id(1, str(renamed), 'test-api-key')}]
        response = self._delete(1, stale_id, matches, 'test-api-key')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(renamed.exists())

    def test_delete_rejects_identifier_owned_by_another_volume(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        response = self._delete(2, file_id, matches, 'test-api-key')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(target.exists())

    def test_parent_symlink_swap_cannot_escape_validated_directory(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'inside')
        outside_dir = self.base / 'outside'
        outside_dir.mkdir()
        outside_target = outside_dir / target.name
        outside_target.write_bytes(b'outside')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        original_volume = self.base / 'original-volume'

        validate = api_mod._validate_unmatched_deletion_target

        def swap_parent(*args, **kwargs):
            validated = validate(*args, **kwargs)
            self.volume.rename(original_volume)
            os.symlink(str(outside_dir), str(self.volume))
            return validated

        with patch.object(api_mod, '_validate_unmatched_deletion_target', side_effect=swap_parent):
            response = self._delete(1, file_id, matches, 'test-api-key')

        self.assertEqual(response.status_code, 400)
        self.assertTrue(outside_target.exists())
        self.assertTrue((original_volume / target.name).exists())

    def test_ordinary_volume_directory_replacement_is_rejected(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'validated')
        replacement_target = self.base / 'replacement-target.cbz'
        replacement_target.write_bytes(b'replacement')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        original_volume = self.base / 'original-volume'
        validate = api_mod._validate_unmatched_deletion_target

        def replace_volume(*args, **kwargs):
            validated = validate(*args, **kwargs)
            self.volume.rename(original_volume)
            self.volume.mkdir()
            replacement_target.rename(self.volume / target.name)
            return validated

        with patch.object(api_mod, '_validate_unmatched_deletion_target', side_effect=replace_volume):
            response = self._delete(1, file_id, matches, 'test-api-key')

        self.assertEqual(response.status_code, 400)
        self.assertEqual((original_volume / target.name).read_bytes(), b'validated')
        self.assertEqual((self.volume / target.name).read_bytes(), b'replacement')

    def test_target_inode_substitution_is_rejected(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'validated')
        original_target = self.volume / 'validated-original.cbz'
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        validate = api_mod._validate_unmatched_deletion_target

        def replace_target(*args, **kwargs):
            validated = validate(*args, **kwargs)
            target.rename(original_target)
            target.write_bytes(b'replacement')
            return validated

        with patch.object(api_mod, '_validate_unmatched_deletion_target', side_effect=replace_target):
            response = self._delete(1, file_id, matches, 'test-api-key')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(original_target.read_bytes(), b'validated')
        self.assertEqual(target.read_bytes(), b'replacement')

    def test_delete_succeeds_with_current_identifier_and_api_key(self):
        target = self.volume / 'Saga 001.cbz'
        target.write_bytes(b'comic')
        file_id = api_mod._unmatched_file_id(1, str(target), 'test-api-key')
        matches = [{'filepath': str(target), 'issue_ids': [], 'general_file': False, 'forced_match': False, 'unmatched_file_id': file_id}]
        response = self._delete(1, file_id, matches, 'test-api-key')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
