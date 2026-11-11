import re
import os
import time
import shutil
import hashlib
import threading
import logging
import datetime
import random
import requests
from pathlib import Path
from typing import Optional, Dict, Any, List
from PIL import Image, ImageOps
import gdown

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

from backend.config import (
    PHOTOS_DIR,
    THUMBNAILS_DIR,
    STORAGE_DIR,
    SUPPORTED_EXTENSIONS,
    THUMBNAIL_SIZE,
    GOOGLE_DRIVE_API_KEY,
    GOOGLE_SERVICE_ACCOUNT_FILE,
    GOOGLE_SERVICE_ACCOUNT_JSON,
)
from backend import database
from backend.face_engine import get_face_engine

logger = logging.getLogger("drive_sync")

# Retry and throttle configuration for key-free Drive access
MAX_DOWNLOAD_RETRIES = 3          # Retry failed folder downloads up to 3 times
RETRY_BASE_DELAY = 5              # Base delay in seconds (doubles each retry)
DOWNLOAD_THROTTLE_DELAY = 0.5     # Seconds to wait between individual file downloads
AUTO_SYNC_QUIET_INTERVAL = 10     # Seconds between auto-sync checks


def extract_folder_id(url_or_id: str) -> Optional[str]:
    """
    Extract Google Drive folder ID from various link formats or return clean ID.
    Examples:
      - https://drive.google.com/drive/folders/1ABC123xyz?usp=sharing -> 1ABC123xyz
      - https://drive.google.com/drive/u/0/folders/1ABC123xyz -> 1ABC123xyz
      - https://drive.google.com/open?id=1ABC123xyz -> 1ABC123xyz
      - 1ABC123xyz -> 1ABC123xyz
    """
    if not url_or_id:
        return None

    cleaned = url_or_id.strip()

    # Pattern for drive.google.com/.../folders/<ID>
    match = re.search(r"folders/([a-zA-Z0-9_-]{20,})", cleaned)
    if match:
        return match.group(1)

    # Pattern for drive.google.com/open?id=<ID> or id=<ID>
    match = re.search(r"[?&]id=([a-zA-Z0-9_-]{20,})", cleaned)
    if match:
        return match.group(1)

    # Direct folder ID pattern (typically 25-45 characters alphanumeric with dashes/underscores)
    if re.match(r"^[a-zA-Z0-9_-]{20,50}$", cleaned):
        return cleaned

    return None


def calculate_sha256(file_path: Path) -> str:
    """Calculate SHA256 checksum of a file for exact duplicate detection."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()


def create_thumbnail(src_path: Path, dest_path: Path) -> bool:
    """Generate an optimized thumbnail with EXIF orientation correction."""
    try:
        with Image.open(src_path) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            img.save(dest_path, "JPEG", quality=85, optimize=True)
            return True
    except Exception as e:
        logger.warning(f"Could not create thumbnail for {src_path.name}: {e}")
        return False


class SyncManager:
    """
    Manages background Google Drive folder synchronization and photo ingestion.
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(SyncManager, cls).__new__(cls)
                    cls._instance.is_syncing = False
                    cls._instance.progress = {
                        "status": "idle",
                        "message": "Ready to sync",
                        "total_files": 0,
                        "processed_files": 0,
                        "new_photos": 0,
                        "new_faces": 0,
                        "errors": [],
                    }
        return cls._instance

    def get_status(self) -> Dict[str, Any]:
        """Return current sync progress state."""
        return self.progress.copy()

    def start_sync(self, drive_url_or_id: str) -> Dict[str, Any]:
        """Trigger background synchronization for a Google Drive folder."""
        if self.is_syncing:
            return {"status": "busy", "message": "A sync is already in progress."}

        folder_id = extract_folder_id(drive_url_or_id)
        if not folder_id:
            return {
                "status": "error",
                "message": (
                    "Invalid Google Drive folder link. Please provide a valid link "
                    "(e.g., https://drive.google.com/drive/folders/YOUR_FOLDER_ID)."
                ),
            }

        # Save the folder URL & ID to DB settings
        database.set_setting("drive_folder_url", drive_url_or_id)
        database.set_setting("drive_folder_id", folder_id)
        database.set_setting("sync_status", "syncing")
        database.set_setting("sync_message", "Starting download from Google Drive...")

        # Run sync in background thread
        thread = threading.Thread(
            target=self._run_sync_pipeline,
            args=(folder_id,),
            daemon=True,
        )
        thread.start()

        return {"status": "started", "message": "Sync started in background.", "folder_id": folder_id}

    def start_auto_sync(self, interval_seconds: int = 10):
        """
        Start continuous background auto-sync worker that re-checks Google Drive
        every N seconds (default 10s) and automatically ingests newly uploaded photos.
        """
        if hasattr(self, "_auto_sync_thread") and self._auto_sync_thread and self._auto_sync_thread.is_alive():
            return

        self.auto_sync_interval = interval_seconds
        self._stop_auto_sync = False

        def _auto_sync_loop():
            logger.info(
                f"AutoSyncWorker active. Checking Google Drive folder every {interval_seconds}s for newly added photos..."
            )
            while not getattr(self, "_stop_auto_sync", False):
                time.sleep(getattr(self, "auto_sync_interval", 10))
                try:
                    folder_id = database.get_setting("drive_folder_id", "").strip()
                    auto_enabled = database.get_setting("auto_sync_enabled", "true")

                    if folder_id and auto_enabled.lower() == "true":
                        if not self.is_syncing:
                            self._run_sync_pipeline(folder_id)
                except Exception as e:
                    logger.warning(f"AutoSync background tick error: {e}")

        self._auto_sync_thread = threading.Thread(target=_auto_sync_loop, daemon=True)
        self._auto_sync_thread.start()

    def stop_auto_sync(self):
        """Stop the background auto-sync worker."""
        self._stop_auto_sync = True

    def _sync_via_service_account(self, folder_id: str, temp_download_dir: Path, sa_path_or_json: str) -> List[Path]:
        """Direct Google Drive v3 sync using Service Account credentials JSON."""
        logger.info(f"Using Google Service Account for direct Drive connection to folder {folder_id}...")
        self.progress["message"] = "Connecting to Google Drive via Service Account..."

        try:
            import json
            import io
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaIoBaseDownload

            scopes = ["https://www.googleapis.com/auth/drive.readonly"]

            if sa_path_or_json.strip().startswith("{"):
                info = json.loads(sa_path_or_json)
                creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            else:
                creds = service_account.Credentials.from_service_account_file(sa_path_or_json, scopes=scopes)

            service = build("drive", "v3", credentials=creds, cache_discovery=False)

            # List files in folder
            files = []
            page_token = None
            query = f"'{folder_id}' in parents and trashed = false"

            while True:
                res = service.files().list(
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType, size)",
                    pageSize=100,
                    pageToken=page_token,
                ).execute()

                for item in res.get("files", []):
                    ext = Path(item["name"]).suffix.lower()
                    if ext in SUPPORTED_EXTENSIONS or item.get("mimeType", "").startswith("image/"):
                        files.append(item)

                page_token = res.get("nextPageToken")
                if not page_token:
                    break

            logger.info(f"Service Account discovered {len(files)} image files in Google Drive folder.")
            downloaded_paths = []

            for idx, file_meta in enumerate(files, 1):
                file_id = file_meta["id"]
                file_name = file_meta["name"]
                dest_file = temp_download_dir / file_name

                self.progress["message"] = f"Directly downloading photo {idx}/{len(files)}: {file_name}"

                if not dest_file.exists():
                    request = service.files().get_media(fileId=file_id)
                    with open(dest_file, "wb") as fh:
                        downloader = MediaIoBaseDownload(fh, request, chunksize=1024 * 1024)
                        done = False
                        while not done:
                            status, done = downloader.next_chunk()

                downloaded_paths.append(dest_file)

            return downloaded_paths

        except Exception as e:
            logger.error(f"Service account sync error: {e}", exc_info=True)
            raise

    def _sync_via_google_api(self, folder_id: str, temp_download_dir: Path, api_key: str) -> List[Path]:
        """Direct official Google Drive API v3 sync: fast, paginated, zero-intermediate."""
        logger.info(f"Using direct Google Drive API v3 with provided API Key for folder {folder_id}...")
        self.progress["message"] = "Fetching file list via Google Drive API..."
        
        # 1. List files in folder with pagination
        files = []
        page_token = None
        base_url = "https://www.googleapis.com/drive/v3/files"

        while True:
            params = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "fields": "nextPageToken, files(id, name, mimeType, size)",
                "pageSize": 100,
                "key": api_key,
            }
            if page_token:
                params["pageToken"] = page_token

            res = requests.get(base_url, params=params, timeout=20)
            if res.status_code != 200:
                raise RuntimeError(f"Google Drive API error ({res.status_code}): {res.text}")

            data = res.json()
            for item in data.get("files", []):
                ext = Path(item["name"]).suffix.lower()
                if ext in SUPPORTED_EXTENSIONS or item.get("mimeType", "").startswith("image/"):
                    files.append(item)

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        logger.info(f"Google Drive API discovered {len(files)} image files.")
        downloaded_paths = []

        # 2. Download files directly via alt=media
        for idx, file_meta in enumerate(files, 1):
            file_id = file_meta["id"]
            file_name = file_meta["name"]
            dest_file = temp_download_dir / file_name

            self.progress["message"] = f"API downloading photo {idx}/{len(files)}: {file_name}"

            # If file already downloaded in temp and intact, skip re-download
            if not dest_file.exists():
                download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
                resp = requests.get(download_url, stream=True, timeout=60)
                if resp.status_code == 200:
                    with open(dest_file, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=65536):
                            if chunk:
                                f.write(chunk)
                else:
                    logger.warning(f"Could not download {file_name} via API: status {resp.status_code}")
                    continue

            downloaded_paths.append(dest_file)

        return downloaded_paths

    def _run_sync_pipeline(self, folder_id: str):
        """Worker thread executing Google Drive download (API or unauthenticated) and face indexing."""
        self.is_syncing = True
        self.progress = {
            "status": "syncing",
            "message": "Connecting to Google Drive folder...",
            "total_files": 0,
            "processed_files": 0,
            "new_photos": 0,
            "new_faces": 0,
            "skipped_existing": 0,
            "errors": [],
        }

        temp_download_dir = STORAGE_DIR / "drive_temp" / folder_id
        temp_download_dir.mkdir(parents=True, exist_ok=True)

        try:
            sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", GOOGLE_SERVICE_ACCOUNT_JSON).strip()
            sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", GOOGLE_SERVICE_ACCOUNT_FILE).strip()
            api_key = os.getenv("GOOGLE_DRIVE_API_KEY", GOOGLE_DRIVE_API_KEY).strip()

            if sa_json or (sa_file and os.path.exists(sa_file)):
                # Highest priority: Google Cloud Service Account (Direct authenticated connection)
                target_sa = sa_json if sa_json else sa_file
                image_files = self._sync_via_service_account(folder_id, temp_download_dir, target_sa)
            elif api_key:
                # Direct Google Cloud Drive API v3 path
                image_files = self._sync_via_google_api(folder_id, temp_download_dir, api_key)
            else:
                # Key-free direct download fallback with exponential backoff
                self.progress["message"] = "Downloading files from public Google Drive folder..."
                logger.info(f"Syncing Google Drive folder {folder_id} into {temp_download_dir}...")

                downloaded_paths = None
                last_error = None

                for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
                    try:
                        downloaded_paths = gdown.download_folder(
                            id=folder_id,
                            output=str(temp_download_dir),
                            quiet=True,
                            resume=True,
                            use_cookies=False,
                        )
                        if downloaded_paths is not None:
                            break  # Success
                    except Exception as e:
                        last_error = e
                        if attempt < MAX_DOWNLOAD_RETRIES:
                            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 2)
                            logger.warning(
                                f"Drive download attempt {attempt}/{MAX_DOWNLOAD_RETRIES} failed: {e}. Retrying in {delay:.1f}s..."
                            )
                            self.progress["message"] = f"Download attempt {attempt} failed, retrying in {delay:.0f}s..."
                            time.sleep(delay)
                        else:
                            logger.error(f"All {MAX_DOWNLOAD_RETRIES} download attempts failed.")

                if downloaded_paths is None:
                    error_detail = str(last_error) if last_error else "Unknown error"
                    raise RuntimeError(
                        f"Could not access Google Drive folder after {MAX_DOWNLOAD_RETRIES} attempts. "
                        f"Last error: {error_detail}. "
                        f"Please verify the folder link and ensure sharing is set to 'Anyone with the link can view'."
                    )

                image_files: List[Path] = []
                for root, _, files in os.walk(temp_download_dir):
                    for f in files:
                        ext = Path(f).suffix.lower()
                        if ext in SUPPORTED_EXTENSIONS:
                            image_files.append(Path(root) / f)

            self.progress["total_files"] = len(image_files)
            logger.info(f"Found {len(image_files)} image files in Google Drive folder.")

            if len(image_files) == 0:
                self.progress["status"] = "completed"
                self.progress["message"] = (
                    "No image files (.jpg, .png, .webp) found in the Google Drive folder."
                )
                database.set_setting("sync_status", "completed")
                database.set_setting("sync_message", self.progress["message"])
                return

            # 3. Pre-filter: skip files whose SHA256 already exists in DB to save processing time
            new_image_files: List[Path] = []
            for img_path in image_files:
                try:
                    file_hash = calculate_sha256(img_path)
                    existing = database.get_photo_by_hash(file_hash)
                    if existing:
                        self.progress["skipped_existing"] += 1
                    else:
                        new_image_files.append(img_path)
                except Exception:
                    new_image_files.append(img_path)  # Process it anyway, let process_image_file handle errors

            if len(new_image_files) == 0:
                summary = (
                    f"Sync complete. All {len(image_files)} photos already indexed. "
                    f"No new photos to process."
                )
                self.progress["status"] = "completed"
                self.progress["message"] = summary
                database.set_setting("sync_status", "completed")
                database.set_setting("sync_message", summary)
                now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
                database.set_setting("last_synced_at", now_iso)
                logger.info(summary)
                return

            self.progress["total_files"] = len(new_image_files)
            logger.info(f"{len(new_image_files)} new photos to process ({self.progress['skipped_existing']} already indexed).")

            # 4. Process each NEW image for face detection and embeddings
            face_engine = get_face_engine()

            for idx, img_path in enumerate(new_image_files, 1):
                self.progress["processed_files"] = idx
                self.progress["message"] = f"Processing new photo {idx} of {len(new_image_files)}: {img_path.name}"

                try:
                    result = self.process_image_file(img_path, source="drive", face_engine=face_engine)
                    if result.get("is_new"):
                        self.progress["new_photos"] += 1
                        self.progress["new_faces"] += result.get("faces_count", 0)
                except Exception as e:
                    err_msg = f"Failed processing {img_path.name}: {str(e)}"
                    logger.warning(err_msg)
                    self.progress["errors"].append(err_msg)

                # Small throttle delay between files to avoid overwhelming resources
                if idx < len(new_image_files) and DOWNLOAD_THROTTLE_DELAY > 0:
                    time.sleep(DOWNLOAD_THROTTLE_DELAY)

            # 5. Finalize
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            summary = (
                f"Sync complete. {self.progress['new_photos']} new photos added, "
                f"{self.progress['new_faces']} faces indexed, "
                f"{self.progress['skipped_existing']} already existed."
            )
            if self.progress["errors"]:
                summary += f" ({len(self.progress['errors'])} errors)"

            self.progress["status"] = "completed"
            self.progress["message"] = summary
            database.set_setting("sync_status", "completed")
            database.set_setting("sync_message", summary)
            database.set_setting("last_synced_at", now_iso)
            logger.info(summary)

        except Exception as e:
            err = f"Sync failed: {str(e)}"
            logger.error(err, exc_info=True)
            self.progress["status"] = "error"
            self.progress["message"] = err
            database.set_setting("sync_status", "error")
            database.set_setting("sync_message", err)

        finally:
            self.is_syncing = False

    def process_image_file(
        self,
        src_path: Path,
        source: str = "drive",
        original_name: Optional[str] = None,
        face_engine=None,
    ) -> Dict[str, Any]:
        """
        Ingest a single photo:
        1. Check SHA256 to deduplicate existing records.
        2. Copy to storage/photos and generate thumbnail.
        3. Detect faces and store embeddings.
        Returns dict with info: {'is_new': bool, 'photo_id': int, 'faces_count': int}
        """
        if face_engine is None:
            face_engine = get_face_engine()

        orig_name = original_name or src_path.name
        file_hash = calculate_sha256(src_path)

        # Check if photo already exists in DB
        existing = database.get_photo_by_hash(file_hash)
        if existing:
            return {"is_new": False, "photo_id": existing["id"], "faces_count": existing["faces_count"]}

        # Create unique filename based on hash and original name
        clean_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", orig_name)
        ext = src_path.suffix.lower()
        if not ext:
            ext = ".jpg"

        is_heic = ext in {".heic", ".heif"}
        if is_heic:
            unique_filename = f"{file_hash[:12]}_{Path(clean_name).stem}.jpg"
            dest_photo_path = PHOTOS_DIR / unique_filename
            dest_thumb_path = THUMBNAILS_DIR / unique_filename

            # Convert HEIC to high-quality JPEG for universal browser display
            with Image.open(src_path) as img:
                img = ImageOps.exif_transpose(img)
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.save(dest_photo_path, "JPEG", quality=95, optimize=True)
        else:
            unique_filename = f"{file_hash[:12]}_{clean_name}"
            if not unique_filename.lower().endswith(ext):
                unique_filename = f"{unique_filename}{ext}"

            dest_photo_path = PHOTOS_DIR / unique_filename
            dest_thumb_path = THUMBNAILS_DIR / unique_filename

            # Copy original photo to persistent photos directory
            shutil.copy2(src_path, dest_photo_path)

        # Generate thumbnail
        create_thumbnail(dest_photo_path, dest_thumb_path)

        file_size = dest_photo_path.stat().st_size

        # Insert photo record into DB
        photo_id = database.add_photo(
            filename=unique_filename,
            original_name=orig_name,
            file_path=str(dest_photo_path),
            thumbnail_path=str(dest_thumb_path),
            file_size=file_size,
            file_hash=file_hash,
            source=source,
        )

        # Detect faces and compute embeddings
        try:
            detected_faces = face_engine.detect_and_extract_faces(dest_photo_path)
            for face in detected_faces:
                database.add_face(
                    photo_id=photo_id,
                    bbox=face["bbox"],
                    confidence=face["confidence"],
                    embedding=face["embedding"],
                )

            database.update_photo_faces_count(photo_id, len(detected_faces))
            faces_count = len(detected_faces)
        except Exception as e:
            logger.warning(f"Face extraction failed for {orig_name}: {e}")
            faces_count = 0

        return {"is_new": True, "photo_id": photo_id, "faces_count": faces_count}


def get_sync_manager() -> SyncManager:
    """Return the singleton instance of SyncManager."""
    return SyncManager()

