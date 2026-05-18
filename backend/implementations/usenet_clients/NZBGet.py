# -*- coding: utf-8 -*-

from typing import Any, Dict, List, Union

from requests.exceptions import RequestException

from backend.base.custom_exceptions import ClientNotWorking, CredentialInvalid
from backend.base.definitions import (BrokenClientReason, DownloadState,
                                      DownloadType)
from backend.base.helpers import Session
from backend.base.logging import LOGGER
from backend.implementations.external_clients import BaseExternalClient


class NZBGet(BaseExternalClient):
    client_type = 'NZBGet'
    download_type = DownloadType.USENET

    required_tokens = ('title', 'base_url', 'username', 'password')

    state_mapping = {
        'QUEUED': DownloadState.QUEUED_STATE,
        'PAUSED': DownloadState.PAUSED_STATE,
        'DOWNLOADING': DownloadState.DOWNLOADING_STATE,
        'FETCHING': DownloadState.DOWNLOADING_STATE,
        'LOADING': DownloadState.DOWNLOADING_STATE,
        'PPQ': DownloadState.IMPORTING_STATE,
        'PP': DownloadState.IMPORTING_STATE,
        'PPPAUSED': DownloadState.IMPORTING_STATE,
    }

    def __init__(self, client_id: int) -> None:
        super().__init__(client_id)
        self.ssn: Union[Session, None] = None
        return

    def _rpc(self, base_url: str, username: Union[str, None], password: Union[str, None], method: str, params: List[Any]) -> Any:
        ssn = self.ssn or Session()
        try:
            r = ssn.post(
                f'{base_url}/jsonrpc',
                json={'version': '1.1', 'method': method, 'params': params},
                auth=(username or '', password or '') if username else None
            )
        except RequestException:
            LOGGER.exception("Can't connect to NZBGet instance: ")
            raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

        if r.status_code in (401, 403):
            raise CredentialInvalid

        if not r.ok:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        try:
            data = r.json()
        except Exception:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)

        return data.get('result')

    def _call(self, method: str, params: List[Any]) -> Any:
        if not self.ssn:
            self.ssn = Session()
        return self._rpc(self.base_url, self.username, self.password, method, params)

    def add_download(
        self,
        download_link: str,
        target_folder: str,
        download_name: Union[str, None]
    ) -> str:
        name = download_name or ''
        result = self._call(
            'appendurl',
            [name, 'kapowarr', 0, 0, download_link, False, False, 0, 0, 'N']
        )
        if not result:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)
        return str(result)

    def get_download(self, download_id: str) -> Union[Dict[str, Any], None]:
        groups = self._call('listgroups', [0]) or []
        nzb_id = int(download_id)
        for group in groups:
            if group.get('NZBID') == nzb_id:
                status_str = group.get('Status', 'DOWNLOADING')
                state = self.state_mapping.get(status_str, DownloadState.DOWNLOADING_STATE)
                size = int(group.get('FileSizeMB', 0) or 0) * 1024 * 1024
                remaining = int(group.get('RemainingSizeMB', 0) or 0) * 1024 * 1024
                done = size - remaining
                progress = round(done / size * 100, 2) if size else 0.0
                speed = float(group.get('DownloadRate', 0) or 0)
                return {'size': size, 'progress': progress, 'speed': speed, 'state': state}

        # Check history
        history = self._call('history', [False]) or []
        for entry in history:
            if entry.get('NZBID') == nzb_id:
                status = entry.get('Status', '')
                size = int(entry.get('FileSizeMB', 0) or 0) * 1024 * 1024
                if 'SUCCESS' in status:
                    state = DownloadState.IMPORTING_STATE
                elif 'FAILURE' in status:
                    state = DownloadState.FAILED_STATE
                else:
                    # Unknown or transitional status — keep polling
                    state = DownloadState.DOWNLOADING_STATE
                return {'size': size, 'progress': 100.0, 'speed': 0.0, 'state': state}

        return None

    def delete_download(self, download_id: str, delete_files: bool) -> None:
        self._call('editqueue', ['GroupDelete', '', [int(download_id)]])
        return

    @staticmethod
    def test(
        base_url: str,
        username: Union[str, None] = None,
        password: Union[str, None] = None,
        api_token: Union[str, None] = None
    ) -> None:
        ssn = Session()
        try:
            r = ssn.post(
                f'{base_url}/jsonrpc',
                json={'version': '1.1', 'method': 'version', 'params': []},
                auth=(username or '', password or '') if username else None
            )
        except RequestException:
            LOGGER.exception("Can't connect to NZBGet instance: ")
            raise ClientNotWorking(BrokenClientReason.CONNECTION_ERROR)

        if r.status_code in (401, 403):
            raise CredentialInvalid

        if not r.ok:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        try:
            data = r.json()
        except Exception:
            raise ClientNotWorking(BrokenClientReason.FAILED_PROCESSING_RESPONSE)

        if 'result' not in data:
            raise ClientNotWorking(BrokenClientReason.NOT_CLIENT_INSTANCE)

        return
