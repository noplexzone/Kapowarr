# -*- coding: utf-8 -*-

"""
Contains all the converters for converting from one format to another.
"""

from __future__ import annotations

from functools import lru_cache
from itertools import chain
from os import utime
from os.path import basename, dirname, exists, getmtime, join, splitext
from typing import Dict, List, Set, Tuple, Union
from zipfile import ZipFile

from backend.base.definitions import Constants, FileConstants, FileConverter
from backend.base.file_extraction import extract_filename_data
from backend.base.files import (archive_contains_issues, create_folder,
                                create_zip_archive,
                                delete_empty_parent_folders,
                                delete_file_folder, generate_archive_folder,
                                list_files, rename_file,
                                set_detected_extension)
from backend.base.helpers import run_rar
from backend.base.logging import LOGGER
from backend.implementations.file_matching import scan_files
from backend.implementations.matching import folder_extraction_filter
from backend.implementations.naming import mass_rename
from backend.implementations.volumes import Volume
from backend.internals.db_models import FilesDB
from backend.internals.settings import Settings, System


# region Helpers
def extract_files_from_folder(
    source_folder: str,
    volume_id: int
) -> List[str]:
    """Move files out of the source folder in to the volume folder, but only if
    they match to the volume. Otherwise they are deleted. The source folder
    is always deleted afterwards.

    Args:
        source_folder (str): The folder to extract files out of.
        volume_id (int): The ID of the volume for which the files should be.

    Returns:
        List[str]: The filepaths of the files that were extracted.
    """
    folder_contents = list_files(
        source_folder,
        FileConstants.SCANNABLE_EXTENSIONS
    )

    volume = Volume(volume_id)
    volume_data = volume.get_data()
    volume_issues = volume.get_issues()
    end_year = volume.get_ending_year() or volume_data.year

    relevant_files: List[str] = []
    for file in folder_contents:
        # Remove archive extraction folder name from filepath so that
        # extracted series name is correct, if series name is extracted from
        # foldername.
        efd = extract_filename_data(
            file.replace(Constants.ARCHIVE_EXTRACT_FOLDER + '_', ''),
            assume_volume_number=False
        )

        if folder_extraction_filter(efd, volume_data, volume_issues, end_year):
            relevant_files.append(file)

    if not relevant_files:
        LOGGER.warning(
            "No relevant files found in folder. Keeping all media files."
        )
        # Prefer non-archive comic formats (PDF, CBZ, CBR, etc.) over raw
        # archive packaging (.zip, .rar, .partN.rar) when both are present.
        # This prevents NZB multipart delivery artefacts from leaking into
        # the library when a direct comic payload already exists.
        _DIRECT_COMIC_EXTS = {
            '.cbz', '.cbr', '.cb7', '.cbt', '.cba',
            '.pdf', '.epub', '.mobi'
        }
        direct_comics = [
            f for f in folder_contents
            if splitext(f)[1].lower() in _DIRECT_COMIC_EXTS
        ]
        relevant_files = direct_comics if direct_comics else folder_contents

    LOGGER.debug(f'Relevant files: {relevant_files}')

    # Plan every move before touching the library. Extracted children are
    # untrusted external input and must never replace an existing artifact or
    # collapse onto the same flattened destination.
    move_plan = []
    reserved_destinations = set()
    source_paths = set(relevant_files)
    for file in relevant_files:
        if file.endswith(FileConstants.IMAGE_EXTENSIONS):
            dest = join(
                volume_data.folder,
                basename(dirname(file)),
                basename(file)
            )

        else:
            dest = join(
                volume_data.folder,
                basename(file)
            )

        dest = splitext(dest)[0] + splitext(set_detected_extension(file))[1]
        if dest in reserved_destinations:
            raise FileExistsError(
                'Multiple extracted files would use the same destination: '
                + dest
            )
        if exists(dest) and dest not in source_paths:
            raise FileExistsError(
                'Refusing to overwrite an existing extracted-file destination: '
                + dest
            )
        reserved_destinations.add(dest)
        move_plan.append((file, dest))

    moved = []
    try:
        for file, dest in move_plan:
            if file != dest:
                rename_file(file, dest)
            moved.append((file, dest))
    except Exception:
        for file, dest in reversed(moved):
            if file == dest or not exists(dest):
                continue
            try:
                rename_file(dest, file)
            except Exception:
                LOGGER.exception(
                    'Failed to roll back extracted file move from %s to %s',
                    dest,
                    file,
                )
        raise

    result = [dest for _, dest in move_plan]
    delete_file_folder(source_folder)
    return result


# region Manager
class ProposedConversion:
    def __init__(
        self,
        filepath: str,
        converter: FileConverter,
        target_format: str
    ) -> None:
        """Create a proposal for a conversion of a file.

        Args:
            filepath (str): The file to convert.
            converter (FileConverter): The converter that will convert the file.
            target_format (str): The format that the file will end up being in.
        """
        self.filepath = filepath
        self.source_format = splitext(filepath)[1].lower().lstrip('.')
        self.target_format = target_format
        self.converter = converter

        if target_format == 'folder':
            self.new_filepath = None
        else:
            self.new_filepath = splitext(filepath)[0] + '.' + target_format

        return

    def perform_conversion(self) -> List[str]:
        """Actually do the conversion that is proposed.

        Returns:
            List[str]: The resulting files or directories, in target_format.
        """
        LOGGER.info(
            "Converting file from %s to %s: %s",
            self.source_format, self.target_format, self.filepath
        )
        return self.converter(self.filepath)


class ConvertersManager:
    converters: Dict[str, Dict[str, Tuple[FileConverter, bool]]] = {}

    @classmethod
    def register_converter(
        cls,
        source_format: str,
        target_format: str,
        supports_32bit: bool = True
    ):
        """Register a file converter.

        Args:
            source_format (str): The file type that it converts _from_. The
                value is the extension in lowercase without the dot-prefix
                (e.g. 'zip').

            target_format (str): The file type that it converts _to_. The value
                is the extension in lowercase without the dot-prefix
                (e.g. 'cbr').

            supports_32bit (bool, optional): Whether the converter works on
                32bit systems.

        Raises:
            RuntimeError: The file format is not recognised by Kapowarr, so it
                can't be converted from or to either.
            RuntimeError: A converter from the given source format to the given
                target format is already registered.
        """
        def wrapper(converter: FileConverter):
            if not (
                source_format == 'folder'
                or '.' + source_format in FileConstants.SCANNABLE_EXTENSIONS
            ):
                raise RuntimeError(
                    f"The source format {source_format} is invalid"
                )

            if not (
                target_format == 'folder'
                or '.' + target_format in FileConstants.SCANNABLE_EXTENSIONS
            ):
                raise RuntimeError(
                    f"The target format {target_format} is invalid"
                )

            if (
                source_format in cls.converters
                and target_format in cls.converters[source_format]
            ):
                raise RuntimeError(
                    f"File converter with source format {source_format} "
                    f"and target format {target_format} "
                    "registered multiple times"
                )

            cls.converters.setdefault(
                source_format, {}
            )[target_format] = (converter, supports_32bit)

            return converter

        return wrapper

    @classmethod
    @lru_cache(1)
    def formats_convertible_to_folder(cls) -> List[str]:
        """Get all source formats that can be converted into a folder.

        Returns:
            List[str]: The source formats.
        """
        runs_64bit = System.runs_64bit

        return [
            source_format
            for source_format, target_format in cls.converters.items()
            if (
                'folder' in target_format
                and (runs_64bit or target_format['folder'][1])
            )
        ]

    @classmethod
    @lru_cache(1)
    def get_available_formats(cls) -> Set[str]:
        """Get all available formats that can be converted to.

        Returns:
            Set[str]: The list with all formats.
        """
        return set(chain.from_iterable(cls.converters.values()))

    @classmethod
    def select_converter(cls, filepath: str) -> Union[ProposedConversion, None]:
        """Get a proposed conversion for the file, based on the current format
        and the format preference.

        Args:
            filepath (str): The filepath to convert for.

        Returns:
            Union[ProposedConversion, None]: The selected conversion that should
                happen, or `None` if the file should be kept in the current
                format.
        """
        settings = Settings().get_settings()
        runs_64bit = System.runs_64bit
        source_format = splitext(filepath)[1].lower().lstrip('.')

        if (
            settings.extract_issue_ranges
            and source_format in cls.formats_convertible_to_folder()
            and archive_contains_issues(filepath)
        ):
            # Extract issue files from archive
            return ProposedConversion(
                filepath, cls.converters[source_format]['folder'][0], 'folder'
            )

        if source_format not in cls.converters:
            return None

        for potential_format in settings.format_preference:
            if source_format == potential_format:
                # File already is most desired, possible, format
                return None

            if (
                potential_format in cls.converters[source_format]
                and (
                    runs_64bit
                    or cls.converters[source_format][potential_format][1]
                )
            ):
                # Found format to convert to
                return ProposedConversion(
                    filepath,
                    cls.converters[source_format][potential_format][0],
                    potential_format
                )

        # Can't convert file to anything that is desired
        return None


def extract_download_container_archive(
    file: str,
    volume_id: int
) -> Union[List[str], None]:
    """Extract a downloaded archive that contains complete child issues.

    Downloaded range containers must be expanded before the final-library
    one-file/one-issue matching gate. Return ``None`` for ordinary single-issue
    archives so callers can leave them on the normal scan path.
    """
    source_format = splitext(file)[1].lower().lstrip('.')
    if not archive_contains_issues(file):
        return None

    if source_format == 'zip':
        return _zip_to_folder(file, volume_id)
    if source_format == 'rar':
        return _rar_to_folder(file, volume_id)
    return None


# region ZIP
@ConvertersManager.register_converter("zip", "cbz")
def zip_to_cbz(file: str) -> List[str]:
    target = splitext(file)[0] + '.cbz'
    rename_file(
        file,
        target
    )
    return [target]


@ConvertersManager.register_converter("zip", "rar", supports_32bit=False)
def zip_to_rar(file: str) -> List[str]:
    volume_id = FilesDB.volume_of_file(file)
    if not volume_id:
        # File not matched to volume
        return [file]

    volume_folder = Volume(volume_id).vd.folder
    archive_folder = generate_archive_folder(volume_folder, file)

    with ZipFile(file, 'r') as zip:
        zip.extractall(archive_folder)

    run_rar([
        'a', # Add files to archive
        '-ep', # Exclude paths from names
        '-inul', # Disable all messages
        splitext(file)[0], # Ext-less target filename of created archive
        archive_folder # Source folder
    ])

    delete_file_folder(archive_folder)
    delete_file_folder(file)
    delete_empty_parent_folders(dirname(file), volume_folder)

    return [splitext(file)[0] + '.rar']


@ConvertersManager.register_converter("zip", "cbr", supports_32bit=False)
def zip_to_cbr(file: str) -> List[str]:
    rar_file = zip_to_rar(file)[0]
    if rar_file == file:
        # File not matched to volume
        return [file]
    cbr_file = rar_to_cbr(rar_file)
    return cbr_file


def _zip_to_folder(file: str, volume_id: int) -> List[str]:
    volume_folder = Volume(volume_id).vd.folder
    archive_folder = generate_archive_folder(volume_folder, file)

    with ZipFile(file, 'r') as zip:
        zip.extractall(archive_folder)

    resulting_files = extract_files_from_folder(
        archive_folder,
        volume_id
    )

    if resulting_files:
        scan_files(volume_id, filepath_filter=resulting_files)
        renamed_files = mass_rename(
            volume_id,
            filepath_filter=resulting_files
        )
        # Strict matching intentionally leaves unresolved files unlinked. Keep
        # their concrete paths in the downstream filter instead of turning an
        # empty rename result into unrestricted full-volume processing.
        resulting_files = list(dict.fromkeys(
            [path for path in resulting_files if exists(path)] + renamed_files
        ))

    delete_file_folder(file)
    delete_empty_parent_folders(dirname(file), volume_folder)

    return resulting_files


@ConvertersManager.register_converter("zip", "folder")
def zip_to_folder(file: str) -> List[str]:
    volume_id = FilesDB.volume_of_file(file)
    if not volume_id:
        # File not matched to volume
        return [file]
    return _zip_to_folder(file, volume_id)


# region CBZ
@ConvertersManager.register_converter("cbz", "zip")
def cbz_to_zip(file: str) -> List[str]:
    target = splitext(file)[0] + '.zip'
    rename_file(
        file,
        target
    )
    return [target]


@ConvertersManager.register_converter("cbz", "rar", supports_32bit=False)
def cbz_to_rar(file: str) -> List[str]:
    return zip_to_rar(file)


@ConvertersManager.register_converter("cbz", "cbr", supports_32bit=False)
def cbz_to_cbr(file: str) -> List[str]:
    rar_file = zip_to_rar(file)[0]
    if rar_file == file:
        # File not matched to volume
        return [file]
    cbr_file = rar_to_cbr(rar_file)
    return cbr_file


@ConvertersManager.register_converter("cbz", "folder")
def cbz_to_folder(file: str) -> List[str]:
    return zip_to_folder(file)


# region RAR
@ConvertersManager.register_converter("rar", "cbr")
def rar_to_cbr(file: str) -> List[str]:
    target = splitext(file)[0] + '.cbr'
    rename_file(
        file,
        target
    )
    return [target]


@ConvertersManager.register_converter("rar", "zip", supports_32bit=False)
def rar_to_zip(file: str) -> List[str]:
    volume_id = FilesDB.volume_of_file(file)
    if not volume_id:
        # File not matched to volume
        return [file]

    volume_folder = Volume(volume_id).vd.folder
    archive_folder = generate_archive_folder(volume_folder, file)
    create_folder(archive_folder)

    run_rar([
        'x', # Extract files with full path
        '-inul', # Disable all messages
        file, # Source archive file
        archive_folder # Target folder to extract into
    ])

    # Files that are put in a ZIP file have to have a minimum last
    # modification time.
    for f in list_files(archive_folder):
        if getmtime(f) <= Constants.ZIP_MIN_MOD_TIME:
            utime(
                f,
                (Constants.ZIP_MIN_MOD_TIME, Constants.ZIP_MIN_MOD_TIME)
            )

    target_file = splitext(file)[0] + '.zip'
    create_zip_archive(archive_folder, target_file)

    delete_file_folder(archive_folder)
    delete_file_folder(file)
    delete_empty_parent_folders(dirname(file), volume_folder)

    return [target_file]


@ConvertersManager.register_converter("rar", "cbz", supports_32bit=False)
def rar_to_cbz(file: str) -> List[str]:
    zip_file = rar_to_zip(file)[0]
    if zip_file == file:
        # File not matched to volume
        return [file]
    cbz_file = zip_to_cbz(zip_file)
    return cbz_file


def _rar_to_folder(file: str, volume_id: int) -> List[str]:
    volume_folder = Volume(volume_id).vd.folder
    archive_folder = generate_archive_folder(volume_folder, file)
    create_folder(archive_folder)

    run_rar([
        'x', # Extract files with full path
        '-inul', # Disable all messages
        file, # Source archive file
        archive_folder # Target folder to extract into
    ])

    resulting_files = extract_files_from_folder(
        archive_folder,
        volume_id
    )

    if resulting_files:
        scan_files(volume_id, filepath_filter=resulting_files)
        renamed_files = mass_rename(
            volume_id,
            filepath_filter=resulting_files
        )
        # Strict matching intentionally leaves unresolved files unlinked. Keep
        # their concrete paths in the downstream filter instead of turning an
        # empty rename result into unrestricted full-volume processing.
        resulting_files = list(dict.fromkeys(
            [path for path in resulting_files if exists(path)] + renamed_files
        ))

    delete_file_folder(file)
    delete_empty_parent_folders(dirname(file), volume_folder)

    return resulting_files


@ConvertersManager.register_converter("rar", "folder", supports_32bit=False)
def rar_to_folder(file: str) -> List[str]:
    volume_id = FilesDB.volume_of_file(file)
    if not volume_id:
        # File not matched to volume
        return [file]
    return _rar_to_folder(file, volume_id)


# region CBR
@ConvertersManager.register_converter("cbr", "rar")
def cbr_to_rar(file: str) -> List[str]:
    target = splitext(file)[0] + '.rar'
    rename_file(
        file,
        target
    )
    return [target]


@ConvertersManager.register_converter("cbr", "zip", supports_32bit=False)
def cbr_to_zip(file: str) -> List[str]:
    return rar_to_zip(file)


@ConvertersManager.register_converter("cbr", "cbz", supports_32bit=False)
def cbr_to_cbz(file: str) -> List[str]:
    zip_file = rar_to_zip(file)[0]
    if zip_file == file:
        # File not matched to volume
        return [file]
    cbz_file = zip_to_cbz(zip_file)
    return cbz_file


@ConvertersManager.register_converter("cbr", "folder")
def cbr_to_folder(file: str) -> List[str]:
    return rar_to_folder(file)
