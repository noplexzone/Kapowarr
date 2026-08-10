import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

import frontend.ui as ui_mod


class RuntimeBasePathTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.dist = Path(self.tempdir.name)
        (self.dist / 'assets').mkdir()
        (self.dist / 'assets' / 'app-123.js').write_text('console.log("app")')
        (self.dist / 'sw.js').write_text('self.addEventListener("fetch", () => {})')
        (self.dist / 'index.html').write_text(
            '<!doctype html><html><head><title>Kapowarr</title>'
            '<link rel="manifest" href="./manifest.json">'
            '</head><body><div id="root"></div>'
            '<script type="module" src="./assets/app-123.js"></script>'
            '</body></html>'
        )
        self.spa_patch = patch.object(ui_mod, 'SPA_DIR', str(self.dist))
        self.spa_patch.start()

    def tearDown(self):
        self.spa_patch.stop()
        self.tempdir.cleanup()

    def _client(self, url_base):
        app = Flask(__name__)
        ui_mod.Server.url_base = url_base
        app.register_blueprint(ui_mod.ui, url_prefix=url_base or None)
        return app.test_client()

    def _assert_index(self, client, path, base):
        response = client.get(path)
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('name="kapowarr-url-base" content="{}"'.format(base), html)
        self.assertIn('<base href="{}/">'.format(base), html)
        self.assertIn('src="./assets/app-123.js"', html)

    def test_root_index_deep_route_assets_and_runtime_config(self):
        client = self._client('')
        self._assert_index(client, '/', '')
        self._assert_index(client, '/volumes/7', '')
        response = client.get('/assets/app-123.js')
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_prefixed_index_deep_route_assets_and_runtime_config(self):
        client = self._client('/kapowarr')
        self._assert_index(client, '/kapowarr/', '/kapowarr')
        self._assert_index(client, '/kapowarr/volumes/7', '/kapowarr')
        response = client.get('/kapowarr/assets/app-123.js')
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_existing_ui_installations_receive_worker_update_and_redirect(self):
        client = self._client('/kapowarr')
        worker = client.get('/kapowarr/ui/sw.js')
        self.assertEqual(worker.status_code, 200)
        self.assertEqual(worker.headers['Service-Worker-Allowed'], '/kapowarr/')
        worker.close()
        redirect = client.get('/kapowarr/ui/')
        self.assertEqual(redirect.status_code, 308)
        self.assertEqual(redirect.headers['Location'], '/kapowarr/')

    def test_runtime_meta_escapes_the_authoritative_base(self):
        client = self._client('/kapowarr')
        ui_mod.Server.url_base = '/kapowarr" data-injected="yes'
        response = client.get('/kapowarr/')
        html = response.get_data(as_text=True)
        self.assertNotIn('data-injected="yes"', html)
        self.assertIn('&quot; data-injected=&quot;yes', html)

    def test_manifest_uses_authoritative_base_for_scope_and_icons(self):
        manifest = self._client('/kapowarr').get('/kapowarr/manifest.json').get_json()
        self.assertEqual(manifest['start_url'], '/kapowarr/')
        self.assertEqual(manifest['scope'], '/kapowarr/')
        self.assertEqual(manifest['icons'][0]['src'], '/kapowarr/icon-192.png')


if __name__ == '__main__':
    unittest.main()
