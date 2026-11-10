import io
import zipfile
from pathlib import Path
from typing import List, Optional
import re

from backend import database


def build_zip_archive(photo_ids: List[int], zip_filename_prefix: Optional[str] = None) -> io.BytesIO:
    """
    Create a zipped archive of the specified photo IDs.
    Returns in-memory BytesIO buffer containing the zip archive.
    """
    if not photo_ids:
        raise ValueError("No photos selected for zip archive.")

    rows = database.get_photos_by_ids(photo_ids)
    if not rows:
        raise ValueError("No matching photos found on server.")

    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        seen_names = set()
        for idx, row in enumerate(rows, 1):
            file_path = Path(row["file_path"])
            if not file_path.exists():
                continue

            orig_name = row["original_name"] or file_path.name
            safe_name = re.sub(r'[\\/*?:"<>|]', "", orig_name).strip()
            if not safe_name:
                safe_name = f"photo_{idx}.jpg"

            # Avoid name collisions in zip
            entry_name = safe_name
            collision_count = 1
            while entry_name in seen_names:
                stem = Path(safe_name).stem
                suffix = Path(safe_name).suffix
                entry_name = f"{stem}_{collision_count}{suffix}"
                collision_count += 1

            seen_names.add(entry_name)
            zip_file.write(file_path, arcname=entry_name)

    buffer.seek(0)
    return buffer

