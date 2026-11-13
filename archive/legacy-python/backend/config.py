import os
import socket
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env file automatically if present
env_file = BASE_DIR / ".env"
if env_file.exists():
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val
STORAGE_DIR = BASE_DIR / "storage"
PHOTOS_DIR = STORAGE_DIR / "photos"
THUMBNAILS_DIR = STORAGE_DIR / "thumbnails"
SELFIES_DIR = STORAGE_DIR / "selfies"
MODELS_DIR = BASE_DIR / "models"
DB_PATH = STORAGE_DIR / "event.db"

# Ensure essential directories exist
for directory in (STORAGE_DIR, PHOTOS_DIR, THUMBNAILS_DIR, SELFIES_DIR, MODELS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

# Face Recognition Configuration
# SFace default cosine similarity threshold is typically 0.363
# Higher = stricter (fewer false positives), Lower = more lenient (more false positives)
DEFAULT_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.363"))

# OpenCV DNN Models
YUNET_MODEL_PATH = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
SFACE_MODEL_PATH = MODELS_DIR / "face_recognition_sface_2021dec.onnx"

YUNET_DOWNLOAD_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
SFACE_DOWNLOAD_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
)

# Server & Auth Configuration
SERVER_HOST = os.getenv("HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("PORT", "8000"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SECRET_KEY = os.getenv("SECRET_KEY", "auto-photo-session-secret-key-change-in-prod-2026")
SESSION_COOKIE_NAME = "auto_photo_session"

# Google Drive Configuration
GOOGLE_DRIVE_API_KEY = os.getenv("GOOGLE_DRIVE_API_KEY", "")
GOOGLE_SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")

# Auto-detect service account credentials file in project root if present
if not GOOGLE_SERVICE_ACCOUNT_FILE:
    candidate_files = list(BASE_DIR.glob("*hale-trilogy*.json")) + list(BASE_DIR.glob("*service_account*.json"))
    if candidate_files:
        GOOGLE_SERVICE_ACCOUNT_FILE = str(candidate_files[0])

# Image processing configuration
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

MAX_IMAGE_DIMENSION = 1920  # Resize oversized photos before detection if needed
THUMBNAIL_SIZE = (450, 450)
SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".heic",
    ".heif",
    ".tiff",
    ".tif",
}


def get_lan_ip() -> str:
    """Auto-detect local area network IP for convenient mobile QR scanning."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Using a public DNS IP to find active outbound route without sending actual packets
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_default_guest_url() -> str:
    """Return default URL pointing to the guest page using Render/Public URL or LAN IP."""
    public_url = os.getenv("RENDER_EXTERNAL_URL") or os.getenv("PUBLIC_URL") or os.getenv("BASE_URL")
    if public_url:
        return f"{public_url.rstrip('/')}/guest"
    lan_ip = get_lan_ip()
    port_part = f":{SERVER_PORT}" if SERVER_PORT != 80 else ""
    return f"http://{lan_ip}{port_part}/guest"

