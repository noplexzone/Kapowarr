# -*- coding: utf-8 -*-

from html import escape
from io import BytesIO
from json import dumps
from os.path import isfile, join

from flask import Blueprint, Response, redirect, send_file, send_from_directory

from backend.base.files import folder_path
from backend.internals.server import Server

ui = Blueprint('ui', __name__)
methods = ['GET']
SPA_DIR = folder_path('frontend', 'dist')


def _url_base() -> str:
    """Return Server.url_base in the canonical external URL form."""
    value = (Server.url_base or '').strip()
    if not value or value == '/':
        return ''
    return '/' + value.strip('/')


def _base_url(path: str = '') -> str:
    base = _url_base()
    return f'{base}/{path.lstrip("/")}' if path else f'{base}/'


def _serve_index():
    index_path = join(SPA_DIR, 'index.html')
    if not isfile(index_path):
        return 'SPA not built. Run "cd frontend && npm run build" to build the React UI.', 503

    with open(index_path, 'r', encoding='utf-8') as index_file:
        html = index_file.read()

    url_base = _url_base()
    runtime_tags = (
        f'<base href="{escape(_base_url(), quote=True)}">\n'
        f'    <meta name="kapowarr-url-base" '
        f'content="{escape(url_base, quote=True)}">'
    )
    html = html.replace('<head>', f'<head>\n    {runtime_tags}', 1)
    response = Response(html, mimetype='text/html')
    response.headers['Cache-Control'] = 'no-store'
    return response


def _serve_static(path: str):
    response = send_from_directory(SPA_DIR, path)
    if path == 'sw.js':
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Service-Worker-Allowed'] = _base_url()
    return response


@ui.route('/manifest.json', methods=methods)
def ui_manifest():
    base_url = _base_url()
    response = send_file(
        BytesIO(dumps(
            {
                'name': 'Kapowarr',
                'short_name': 'Kapowarr',
                'description': 'Comic and manga library manager',
                'display': 'standalone',
                'orientation': 'any',
                'start_url': base_url,
                'scope': base_url,
                'id': base_url,
                'theme_color': '#1a1a1a',
                'background_color': '#1a1a1a',
                'icons': [
                    {
                        'src': _base_url('icon-192.png'),
                        'sizes': '192x192',
                        'type': 'image/png'
                    },
                    {
                        'src': _base_url('icon-512.png'),
                        'sizes': '512x512',
                        'type': 'image/png'
                    },
                    {
                        'src': _base_url('favicon.svg'),
                        'sizes': 'any',
                        'type': 'image/svg+xml',
                        'purpose': 'any maskable'
                    }
                ]
            },
            indent=4
        ).encode('utf-8')),
        mimetype='application/manifest+json',
        download_name='manifest.json'
    )
    response.headers['Cache-Control'] = 'no-cache'
    return response, 200


# Keep the former /ui service worker reachable so existing installations receive
# the safe worker and then follow the navigation redirect to the new root scope.
@ui.route('/ui/sw.js', methods=methods)
def ui_legacy_service_worker():
    return _serve_static('sw.js')


@ui.route('/ui/', defaults={'path': ''}, methods=methods)
@ui.route('/ui/<path:path>', methods=methods)
def ui_legacy_spa(path: str):
    return redirect(_base_url(path), code=308)


@ui.route('/', defaults={'path': ''}, methods=methods)
@ui.route('/<path:path>', methods=methods)
def ui_spa(path: str):
    if path and isfile(join(SPA_DIR, path)):
        return _serve_static(path)
    return _serve_index()
