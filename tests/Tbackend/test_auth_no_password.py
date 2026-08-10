"""Regression tests for auth when no password is configured.

The new SPA (React/TypeScript overhaul) stores the api_key in
localStorage and sends it as the X-Api-Key header. When no auth
password is configured and the user clears browser site data,
localStorage is empty and the key header is absent.

The auth decorator should permit passwordless reads but continue to
require the provisioned installation key for state-changing requests.
"""
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from flask import request as flask_request


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
    # Make Response a real class so isinstance() works in the auth decorator
    class _FakeFlaskResponse:
        pass
    setattr(flask, 'Response', _FakeFlaskResponse)
    flask.request = MagicMock()
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


_original_api_module = sys.modules.get('frontend.api')
_original_modules = _patch_externals()
try:
    import frontend.api as api
finally:
    _restore_externals(_original_modules)
    if _original_api_module is None:
        sys.modules.pop('frontend.api', None)
    else:
        sys.modules['frontend.api'] = _original_api_module


class _Request:
    def __init__(self, values=None, headers=None, path='', method='GET'):
        self.values = values or {}
        self.headers = headers or {}
        self.path = path
        self.method = method
        self.environ = {}
        self.remote_addr = '127.0.0.1'


def _make_view(return_value=None):
    """Return a mock view function to pass through the @auth decorator.

    Real API views return (result_dict, status_code) tuples from return_api().
    """
    view = MagicMock(return_value=return_value or ({}, 200))
    view.__name__ = 'test_view'
    return view


class AuthNoPasswordTests(unittest.TestCase):
    """Auth decorator behaviour when auth_password is not configured."""

    def setUp(self):
        self.original_settings = api.Settings
        api.request = flask_request
        api.Settings = lambda: SimpleNamespace(
            sv=SimpleNamespace(
                api_key='some-key',
                auth_password='',  # no password configured
            )
        )

    def tearDown(self):
        api.Settings = self.original_settings
        api.request = flask_request

    def test_auth_passes_without_api_key_when_no_password(self):
        """No password → no api_key required."""
        request = _Request()
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        # Should return the view's result tuple (not 401)
        self.assertEqual(result, ({}, 200))

    def test_auth_passes_without_x_api_key_header_when_no_password(self):
        """No password → no X-Api-Key header required."""
        request = _Request(headers={})
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        self.assertEqual(result, ({}, 200))

    def test_passwordless_mutation_requires_api_key(self):
        request = _Request(method='DELETE')
        api.request = request
        wrapped = api.auth(_make_view())
        result = wrapped()
        self.assertEqual(result[1], 401)

    def test_passwordless_mutation_accepts_provisioned_api_key(self):
        request = _Request(method='POST', headers={'X-Api-Key': 'some-key'})
        api.request = request
        wrapped = api.auth(_make_view())
        self.assertEqual(wrapped(), ({}, 200))


class AuthWithPasswordTests(unittest.TestCase):
    """Auth decorator behaviour when auth_password IS configured."""

    def setUp(self):
        self.original_settings = api.Settings
        api.request = flask_request
        api.Settings = lambda: SimpleNamespace(
            sv=SimpleNamespace(
                api_key='secret-key',
                auth_password='hashed-password',
            )
        )

    def tearDown(self):
        api.Settings = self.original_settings
        api.request = flask_request

    def test_auth_rejects_without_api_key_when_password_set(self):
        """Password configured → api_key is required."""
        request = _Request()  # no api_key
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        # Should return a 401 error tuple
        self.assertEqual(result[0], {'error': 'ApiKeyInvalid', 'result': {}})
        self.assertEqual(result[1], 401)

    def test_auth_passes_with_valid_api_key_when_password_set(self):
        """Valid api_key in query → auth succeeds."""
        request = _Request(values={'api_key': 'secret-key'})
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        self.assertEqual(result, ({}, 200))

    def test_auth_passes_with_valid_x_api_key_header_when_password_set(self):
        """Valid X-Api-Key header → auth succeeds."""
        request = _Request(headers={'X-Api-Key': 'secret-key'})
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        self.assertEqual(result, ({}, 200))

    def test_auth_rejects_with_wrong_api_key_when_password_set(self):
        """Wrong api_key → auth fails."""
        request = _Request(values={'api_key': 'wrong-key'})
        api.request = request

        wrapped = api.auth(_make_view())
        result = wrapped()

        self.assertEqual(result[0], {'error': 'ApiKeyInvalid', 'result': {}})
        self.assertEqual(result[1], 401)


if __name__ == '__main__':
    unittest.main()
