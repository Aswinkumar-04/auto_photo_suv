import sqlite3
import datetime
from typing import Optional, List, Dict, Any, Tuple
import numpy as np

from backend.config import DB_PATH, DEFAULT_MATCH_THRESHOLD, get_default_guest_url


def get_connection() -> sqlite3.Connection:
    """Return a configured SQLite database connection with row factory enabled."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initialize database tables and default configuration settings."""
    conn = get_connection()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL UNIQUE,
                original_name TEXT,
                file_path TEXT NOT NULL,
                thumbnail_path TEXT NOT NULL,
                file_size INTEGER DEFAULT 0,
                file_hash TEXT UNIQUE,
                drive_file_id TEXT,
                source TEXT DEFAULT 'drive',
                faces_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS faces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                photo_id INTEGER NOT NULL,
                bbox_x INTEGER,
                bbox_y INTEGER,
                bbox_w INTEGER,
                bbox_h INTEGER,
                confidence REAL DEFAULT 0.0,
                embedding BLOB NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
            )
        """)

        # Indexes for fast querying
        conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_hash ON photos(file_hash)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_drive_id ON photos(drive_file_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id)")

        # Initialize default settings if not present
        defaults = {
            "event_name": "SUV Photography | Wedding & Events Gallery",
            "drive_folder_url": "",
            "drive_folder_id": "",
            "match_threshold": str(DEFAULT_MATCH_THRESHOLD),
            "guest_base_url": get_default_guest_url(),
            "sync_status": "idle",
            "sync_message": "Ready to sync",
            "last_synced_at": "",
            "auto_sync_enabled": "true",
            "auto_sync_interval": "10",
        }
        for k, v in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v)
            )
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    """Fetch setting value by key."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    """Update or insert setting value."""
    conn = get_connection()
    with conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
    conn.close()


def clear_all_photos():
    """Wipe all photo records, face embeddings, and local image files."""
    from backend.config import PHOTOS_DIR, THUMBNAILS_DIR, STORAGE_DIR
    import shutil
    import os

    conn = get_connection()
    with conn:
        conn.execute("DELETE FROM faces")
        conn.execute("DELETE FROM photos")
        # Reset autoincrement counters
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('photos', 'faces')")

    # Clean storage directories
    for directory in (PHOTOS_DIR, THUMBNAILS_DIR):
        if directory.exists():
            for item in directory.iterdir():
                if item.name != ".gitkeep":
                    try:
                        if item.is_file():
                            item.unlink()
                        elif item.is_dir():
                            shutil.rmtree(item)
                    except Exception:
                        pass

    # Clean drive temp
    temp_dir = STORAGE_DIR / "drive_temp"
    if temp_dir.exists():
        for item in temp_dir.iterdir():
            if item.name != ".gitkeep":
                try:
                    if item.is_file():
                        item.unlink()
                    elif item.is_dir():
                        shutil.rmtree(item)
                except Exception:
                    pass


def get_all_settings() -> Dict[str, str]:
    """Retrieve all current system settings."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return {row["key"]: row["value"] for row in rows}


def add_photo(
    filename: str,
    original_name: str,
    file_path: str,
    thumbnail_path: str,
    file_size: int,
    file_hash: str,
    drive_file_id: Optional[str] = None,
    source: str = "drive",
) -> int:
    """Insert a photo record and return its ID."""
    conn = get_connection()
    now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO photos (
                filename, original_name, file_path, thumbnail_path,
                file_size, file_hash, drive_file_id, source, faces_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                filename,
                original_name,
                file_path,
                thumbnail_path,
                file_size,
                file_hash,
                drive_file_id,
                source,
                now_str,
            ),
        )
        photo_id = cursor.lastrowid
    conn.close()
    return photo_id


def update_photo_faces_count(photo_id: int, count: int):
    """Update detected faces count for a photo."""
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE photos SET faces_count = ? WHERE id = ?", (count, photo_id)
        )
    conn.close()


def get_photo_by_hash(file_hash: str) -> Optional[sqlite3.Row]:
    """Find photo by SHA256 file hash to prevent duplicate syncs."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM photos WHERE file_hash = ?", (file_hash,))
    row = cursor.fetchone()
    conn.close()
    return row


def get_photo_by_drive_id(drive_file_id: str) -> Optional[sqlite3.Row]:
    """Find photo by original Google Drive file ID."""
    if not drive_file_id:
        return None
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM photos WHERE drive_file_id = ?", (drive_file_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def add_face(
    photo_id: int,
    bbox: Tuple[int, int, int, int],
    confidence: float,
    embedding: np.ndarray,
) -> int:
    """Store face coordinates and normalized 128D float32 embedding."""
    conn = get_connection()
    now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # Normalize embedding vector before serialization for ultra-fast dot product
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    embedding_bytes = embedding.astype(np.float32).tobytes()

    x, y, w, h = bbox
    with conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO faces (photo_id, bbox_x, bbox_y, bbox_w, bbox_h, confidence, embedding, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (photo_id, x, y, w, h, float(confidence), embedding_bytes, now_str),
        )
        face_id = cursor.lastrowid
    conn.close()
    return face_id


def get_all_face_embeddings() -> Tuple[List[int], List[int], np.ndarray]:
    """
    Retrieve all face embeddings as a 2D numpy matrix for fast vectorized comparison.
    Returns: (face_ids, photo_ids, embeddings_matrix)
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, photo_id, embedding FROM faces")
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return [], [], np.empty((0, 128), dtype=np.float32)

    face_ids = []
    photo_ids = []
    vectors = []

    for r in rows:
        face_ids.append(r["id"])
        photo_ids.append(r["photo_id"])
        vec = np.frombuffer(r["embedding"], dtype=np.float32)
        vectors.append(vec)

    embeddings_matrix = np.array(vectors, dtype=np.float32)
    return face_ids, photo_ids, embeddings_matrix


def get_photo(photo_id: int) -> Optional[sqlite3.Row]:
    """Fetch photo record by primary ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM photos WHERE id = ?", (photo_id,))
    row = cursor.fetchone()
    conn.close()
    return row


def get_photos_by_ids(photo_ids: List[int]) -> List[sqlite3.Row]:
    """Fetch photo records for a given list of IDs."""
    if not photo_ids:
        return []
    placeholders = ",".join("?" * len(photo_ids))
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM photos WHERE id IN ({placeholders})", photo_ids)
    rows = cursor.fetchall()
    conn.close()
    return rows


def get_all_photos(limit: int = 50, offset: int = 0) -> List[sqlite3.Row]:
    """Fetch all photos ordered by newest first with pagination."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM photos ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def delete_photo(photo_id: int) -> bool:
    """Delete a photo and cascade delete its face records."""
    conn = get_connection()
    with conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        deleted = cursor.rowcount > 0
    conn.close()
    return deleted


def get_stats() -> Dict[str, Any]:
    """Calculate dashboard summary statistics."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) AS count FROM photos")
    total_photos = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) AS count FROM faces")
    total_faces = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) AS count FROM photos WHERE faces_count = 0")
    zero_face_photos = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(*) AS count FROM photos WHERE faces_count > 1")
    multi_face_photos = cursor.fetchone()["count"]

    conn.close()

    settings = get_all_settings()

    return {
        "total_photos": total_photos,
        "total_faces": total_faces,
        "zero_face_photos": zero_face_photos,
        "multi_face_photos": multi_face_photos,
        "event_name": settings.get("event_name", "Event Photos"),
        "sync_status": settings.get("sync_status", "idle"),
        "sync_message": settings.get("sync_message", "Ready"),
        "last_synced_at": settings.get("last_synced_at", ""),
        "drive_folder_url": settings.get("drive_folder_url", ""),
        "match_threshold": float(
            settings.get("match_threshold", DEFAULT_MATCH_THRESHOLD)
        ),
        "guest_base_url": settings.get("guest_base_url", get_default_guest_url()),
        "auto_sync_enabled": settings.get("auto_sync_enabled", "true") == "true",
        "auto_sync_interval": int(settings.get("auto_sync_interval", "10")),
    }

