# -*- coding: utf-8 -*-

from typing import Any, Dict, Union

from requests.exceptions import RequestException

from backend.base.custom_exceptions import ClientNotWorking, CredentialInvalid
from backend.base.definitions import (BrokenClientReason, Constants,
                                      DownloadState, DownloadType)
from backend.base.helpers import Session
from backend.base.logging import LOGGER
from backend.implementations.external_clients import BaseExternalClient


class SABnzbd(BaseExternalClient):
    client_type = 'SABnzbd'
    download_type = DownloadType.USENET

    required_tokens = ('title', 'base_url', 'api_token')

    state_mapping = {
        'Queued': DownloadState.QUEUED_STATE,
        'Paused': DownloadState.PAUSED_STATE,
        'Downloading': DownloadState.DOWNLOADING_STATE,
        'Fetching': DownloadState.DOWNLOADING_STATE,
        'Verifying': DownloadState.IMPORTING_STATE,
        'Repairing': DownloadState.IMPORTING_STATE,
        'Extracting': DownloadState.IMPORTING_STATE,
        'Moving': DownloadState.IMPORTING_STATE,
        'Completed': DownloadState.IMPORTING_STATE,
        'Failed': DownloadState.FAILED_STATE,
    }

    def __init__(self, client_id: int) -> None:
        super().__init__(client_id)
        self.ssn: Union[Session, None] = None
        return

    def _get_session(self) -> Session:
        if not self.ssn:
            self.ssn = Session()
        return self.ssn

    def _api(self, **params: Any) -> Dict[str, Any]:
        ssn = self._get_session()
        try:
            r = ssn.get(
                f'{self.base_url}/api',
                params={'output': 'json', 'apikey': self.api_token, **params}
            )
        except RequestException:
            LOGGER.exception("Can't connect to SABnzbd instance: ")
            raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

        if r.status_code in (401, 403):
            raise CredentialInvalid

        if not r.ok:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        try:
            data = r.json()
        except Exception:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)

        if isinstance(data, dict) and data.get('status') is False:
            err = data.get('error', '')
            if 'api key' in str(err).lower() or 'apikey' in str(err).lower():
                raise CredentialInvalid
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        return data

    def add_download(
        self,
        download_link: str,
        target_folder: str,
        download_name: Union[str, None]
    ) -> str:
        params: Dict[str, Any] = {
            'mode': 'addurl',
            'name': download_link,
            'cat': self.category or Constants.TORRENT_TAG,
        }
        if download_name:
            params['nzbname'] = download_name
        if target_folder:
            params['dir'] = target_folder

        data = self._api(**params)
        nzo_ids = data.get('nzo_ids', [])
        if not nzo_ids:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)
        return nzo_ids[0]

    def get_download(self, download_id: str) -> Union[Dict[str, Any], None]:
        # Check active queue first
        data = self._api(mode='queue')
        queue = data.get('queue', {})
        slots = queue.get('slots', [])
        for slot in slots:
            if slot.get('nzo_id') == download_id:
                status_str = slot.get('status', 'Downloading')
                state = self.state_mapping.get(
                    status_str, DownloadState.DOWNLOADING_STATE
                )
                mb_total = float(slot.get('mb', 0) or 0)
                mb_left = float(slot.get('mbleft', 0) or 0)
                mb_done = mb_total - mb_left
                size = int(mb_total * 1024 * 1024)
                progress = round((mb_done / mb_total * 100), 2) if mb_total else 0.0
                speed_str = queue.get('speed', '0')
                try:
                    speed = float(speed_str.split()[0]) * 1024 * 1024
                except (ValueError, IndexError):
                    speed = 0.0
                return {'size': size, 'progress': progress, 'speed': speed, 'state': state}

        # Check history for completed/failed jobs
        hist = self._api(mode='history', limit=100)
        slots_hist = hist.get('history', {}).get('slots', [])
        for slot in slots_hist:
            if slot.get('nzo_id') == download_id:
                status_str = slot.get('status', '')
                size = int(slot.get('bytes', 0) or 0)
                if status_str == 'Completed':
                    state = DownloadState.IMPORTING_STATE
                elif status_str == 'Failed':
                    state = DownloadState.FAILED_STATE
                else:
                    # Transitional history state: SABnzbd is still post-processing
                    # (e.g. "Running" for scripts, "Extracting", "Moving").
                    # Keep polling rather than incorrectly treating as failed.
                    state = DownloadState.DOWNLOADING_STATE
                return {'size': size, 'progress': 100.0, 'speed': 0.0, 'state': state}

        # Not found anywhere — client deleted it
        return None

    def delete_download(self, download_id: str, delete_files: bool) -> None:
        del_files = 1 if delete_files else 0
        # Remove from active queue if still present (in-progress or pending)
        try:
            self._api(mode='queue', name='delete', value=download_id)
        except ClientNotWorking:
            pass  # Job may have completed and moved to history
        # Remove from history if present (completed or failed)
        try:
            self._api(mode='history', name='delete', value=download_id, del_files=del_files)
        except ClientNotWorking:
            pass  # Job may not be in history either
        return

    @staticmethod
    def test(
        base_url: str,
        username: Union[str, None] = None,
        password: Union[str, None] = None,
        api_token: Union[str, None] = None
    ) -> None:
        if not api_token:
            raise CredentialInvalid

        ssn = Session()
        try:
            r = ssn.get(
                f'{base_url}/api',
                params={'mode': 'version', 'output': 'json', 'apikey': api_token}
            )
        except RequestException:
            LOGGER.exception("Can't connect to SABnzbd instance: ")
            raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

        if r.status_code in (401, 403):
            raise CredentialInvalid

        if not r.ok:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        try:
            data = r.json()
        except Exception:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)

        if isinstance(data, dict) and data.get('status') is False:
            err = data.get('error', '')
            if 'api key' in str(err).lower() or 'apikey' in str(err).lower():
                raise CredentialInvalid
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        if 'version' not in data:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        return
