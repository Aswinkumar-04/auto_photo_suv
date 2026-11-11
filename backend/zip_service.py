import io
import zipfile
import urllib.request
from pathlib import Path
from typing import List, Optional
import re
import logging

from backend import database

logger = logging.getLogger("zip_service")


def build_zip_archive(photo_ids: List[int], zip_filename_prefix: Optional[str] = None) -> io.BytesIO:
    """
    Create a zipped archive of the specified photo IDs.
    Directly streams photos from Google Drive or local storage into zip in memory.
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
            file_data = None
            orig_name = row["original_name"] or f"photo_{idx}.jpg"
            drive_id = row["drive_file_id"]

            # Direct stream from Google Drive
            if drive_id:
                try:
                    drive_url = f"https://drive.google.com/uc?export=download&id={drive_id}"
                    req = urllib.request.Request(drive_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        file_data = resp.read()
                except Exception as e:
                    logger.warning(f"Could not fetch drive photo {drive_id} for zip: {e}")

            # Local fallback if available
            if file_data is None and row["file_path"]:
                local_p = Path(row["file_path"])
                if local_p.exists():
                    file_data = local_p.read_bytes()

            if file_data is None:
                continue

            safe_name = re.sub(r'[\\/*?:"<>|]', "", orig_name).strip() or f"photo_{idx}.jpg"

            # Avoid name collisions in zip
            entry_name = safe_name
            collision_count = 1
            while entry_name in seen_names:
                stem = Path(safe_name).stem
                suffix = Path(safe_name).suffix
                entry_name = f"{stem}_{collision_count}{suffix}"
                collision_count += 1

            seen_names.add(entry_name)
            zip_file.writestr(entry_name, file_data)

    buffer.seek(0)
    return buffer

