"""Regression tests for file import authentication.

The volume file-import UI sends multipart/form-data and authenticates with an
``x-api-key`` header. The shared API auth helper previously only looked in
``request.values`` (query/form values), so the upload request was rejected before
files were processed.
"""

import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock


class _StubModule(types.ModuleType):
    def __getattr__(self, attr):
        return MagicMock(name=f'{self.__name__}.{attr}')


def _stub_module(name):
    module = _StubModule(name)
    sys.modules.setdefault(name, module)
    return module


_STUBBED_MODULES = (
    'flask',
    'backend.base.helpers',
    'backend.base.logging',
    'backend.base.files',
    'backend.features.download_queue',
    'backend.features.library_import',
    'backend.features.mass_edit',
    'backend.features.search',
    'backend.features.tasks',
    'backend.implementations.blocklist',
    'backend.implementations.comicvine',
    'backend.implementations.conversion',
    'backend.implementations.converters',
    'backend.implementations.credentials',
    'backend.implementations.external_clients',
    'backend.implementations.nzb_indexers',
    'backend.implementations.file_matching',
    'backend.implementations.naming',
    'backend.implementations.remote_mapping',
    'backend.implementations.root_folders',
    'backend.implementations.volumes',
    'backend.internals.db',
    'backend.internals.db_models',
    'backend.internals.server',
    'backend.internals.settings',
)


def _patch_externals():
    originals = {
        module_name: sys.modules.get(module_name)
        for module_name in _STUBBED_MODULES
    }

    flask = _stub_module('flask')
    setattr(flask, 'Blueprint', lambda *args, **kwargs: MagicMock())
    setattr(flask, 'Response', MagicMock())
    setattr(flask, 'request', MagicMock())
    setattr(flask, 'send_file', MagicMock())
    setattr(flask, 'stream_with_context', MagicMock())

    for module_name in _STUBBED_MODULES[1:]:
        _stub_module(module_name)

    return originals


def _restore_externals(originals):
    for module_name, original in originals.items():
        if original is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original


_original_modules = _patch_externals()
try:
    import frontend.api as api
finally:
    _restore_externals(_original_modules)


class _Request:
    def __init__(self, values=None, headers=None):
        self.values = values or {}
        self.headers = headers or {}


class ImportAuthHeaderTests(unittest.TestCase):
    def setUp(self):
        api.Settings = lambda: SimpleNamespace(sv=SimpleNamespace(api_key='secret-key'))

    def test_api_key_can_be_read_from_x_api_key_header(self):
        request = _Request(headers={'x-api-key': 'secret-key'})

        self.assertEqual(api.extract_key(request, 'api_key'), 'secret-key')

    def test_query_api_key_still_works(self):
        request = _Request(values={'api_key': 'secret-key'})

        self.assertEqual(api.extract_key(request, 'api_key'), 'secret-key')


if __name__ == '__main__':
    unittest.main()
