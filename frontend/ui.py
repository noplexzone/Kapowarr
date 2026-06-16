# -*- coding: utf-8 -*-

from io import BytesIO
from json import dumps
from os.path import exists, join

from flask import Blueprint, redirect, send_file, send_from_directory

from backend.base.files import folder_path
from backend.internals.server import Server

ui = Blueprint('ui', __name__)
methods = ['GET']


def spa_redirect(path: str = ''):
    """Redirect a legacy URL to the equivalent SPA path under /ui/."""
    base = Server.url_base
    target = f'{base}/ui/{path}' if path else f'{base}/ui/'
    return redirect(target)


@ui.route('/manifest.json', methods=methods)
def ui_manifest():
    return send_file(
        BytesIO(dumps(
            {
                "name": "Kapowarr",
                "short_name": "Kapowarr",
                "description": "Comic and manga library manager",
                "display": "standalone",
                "orientation": "any",
                "start_url": f"{Server.url_base}/",
                "scope": f"{Server.url_base}/",
                "id": f"{Server.url_base}/",
                "theme_color": "#1a1a1a",
                "background_color": "#1a1a1a",
                "icons": [
                    {
                        "src": f"{Server.url_base}/ui/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png"
                    },
                    {
                        "src": f"{Server.url_base}/ui/icon-512.png",
                        "sizes": "512x512",
                        "type": "image/png"
                    },
                    {
                        "src": f"{Server.url_base}/ui/favicon.svg",
                        "sizes": "any",
                        "type": "image/svg+xml",
                        "purpose": "any maskable"
                    }
                ]
            },
            indent=4
        ).encode('utf-8')),
        mimetype="application/manifest+json",
        download_name="manifest.json"
    ), 200


# Root → SPA dashboard
@ui.route('/', methods=methods)
def ui_root():
    return spa_redirect()


# Dashboard redirect
@ui.route('/dashboard', methods=methods)
def ui_dashboard():
    return spa_redirect()


# Legacy login → SPA login
@ui.route('/login', methods=methods)
def ui_login():
    return spa_redirect('login')


# Comics
@ui.route('/comics', methods=methods)
def ui_volumes():
    return spa_redirect('comics')


@ui.route('/add', methods=methods)
def ui_add_volume():
    return spa_redirect('add')


# Library import
@ui.route('/library-import', methods=methods)
def ui_library_import():
    return spa_redirect('import')


# Mismatch review
@ui.route('/mismatch-review', methods=methods)
def ui_mismatch_review():
    return spa_redirect('mismatch-review')


@ui.route('/manga/mismatch-review', methods=methods)
def ui_manga_mismatch_review():
    return spa_redirect('mismatch-review?section=manga')


# Discovery
@ui.route('/discovery', methods=methods)
def ui_discovery():
    return spa_redirect('discovery')


@ui.route('/story-arcs', methods=methods)
def ui_story_arcs():
    return spa_redirect('discovery?type=story-arcs')


# Manga
@ui.route('/manga', methods=methods)
def ui_manga_library():
    return spa_redirect('manga')


@ui.route('/manga/add', methods=methods)
def ui_manga_add():
    return spa_redirect('add?section=manga')


@ui.route('/manga/discovery', methods=methods)
def ui_manga_discovery():
    return spa_redirect('discovery?section=manga')


@ui.route('/manga/story-arcs', methods=methods)
def ui_manga_story_arcs():
    return spa_redirect('discovery?section=manga&type=story-arcs')


# Volume detail
@ui.route('/volumes/<id>', methods=methods)
def ui_view_volume(id):
    return spa_redirect(f'volumes/{id}')


# Activity
@ui.route('/activity/queue', methods=methods)
def ui_queue():
    return spa_redirect('activity/queue')


@ui.route('/activity/history', methods=methods)
def ui_history():
    return spa_redirect('activity/history')


@ui.route('/activity/blocklist', methods=methods)
def ui_blocklist():
    return spa_redirect('activity/blocklist')


# System
@ui.route('/system/status', methods=methods)
def ui_status():
    return spa_redirect('system/status')


@ui.route('/system/tasks', methods=methods)
def ui_tasks():
    return spa_redirect('system/tasks')


# Settings
@ui.route('/settings', methods=methods)
def ui_settings():
    return spa_redirect('settings')


@ui.route('/settings/mediamanagement', methods=methods)
def ui_mediamanagement():
    return spa_redirect('settings')


@ui.route('/settings/download', methods=methods)
def ui_download():
    return spa_redirect('settings')


@ui.route('/settings/downloadclients', methods=methods)
def ui_download_clients():
    return spa_redirect('settings')


@ui.route('/settings/indexers', methods=methods)
def ui_indexers():
    return spa_redirect('settings')


@ui.route('/settings/metadata', methods=methods)
def ui_metadata():
    return spa_redirect('settings')


@ui.route('/settings/general', methods=methods)
def ui_general():
    return spa_redirect('settings')


# ── SPA entry point ───────────────────────────────────────────────────────────
SPA_DIR = folder_path('frontend', 'dist')


@ui.route('/ui/', defaults={'path': ''}, methods=methods)
@ui.route('/ui/<path:path>', methods=methods)
def ui_spa(path: str):
    index_path = join(SPA_DIR, 'index.html')

    # Serve static assets directly
    if path and exists(join(SPA_DIR, path)):
        return send_from_directory(SPA_DIR, path)

    # All other paths → index.html for client-side routing
    if exists(index_path):
        return send_file(index_path)

    # Fallback: dev mode message
    return 'SPA not built. Run "cd frontend && npm run build" to build the React UI.', 503
