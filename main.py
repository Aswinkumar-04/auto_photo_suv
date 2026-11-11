import os
import io
import logging
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

from fastapi import (
    FastAPI,
    Request,
    Response,
    Depends,
    HTTPException,
    status,
    UploadFile,
    File,
    Form,
)
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    FileResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

from backend.config import (
    BASE_DIR,
    PHOTOS_DIR,
    THUMBNAILS_DIR,
    SERVER_HOST,
    SERVER_PORT,
    SESSION_COOKIE_NAME,
    DEFAULT_MATCH_THRESHOLD,
    get_default_guest_url,
)
from backend import database
from backend.auth import (
    verify_password,
    create_session_token,
    require_admin,
    is_admin_authenticated,
)
from backend.face_engine import get_face_engine
from backend.drive_sync import get_sync_manager
from backend.qr_service import (
    generate_qr_base64,
    generate_qr_bytes,
    generate_printable_card_html,
)
from backend.zip_service import build_zip_archive

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("app")

# Initialize database
database.init_db()

# Pre-initialize FaceEngine (downloads models if not already present)
get_face_engine()

# Start background auto-sync worker (re-syncs Google Drive every 10 seconds)
get_sync_manager().start_auto_sync(interval_seconds=10)

app = FastAPI(title="AutoPhoto - AI Event Photo Sharing", version="1.0.0")

# Mount static asset folders
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "frontend" / "static")), name="static")
app.mount("/storage/photos", StaticFiles(directory=str(PHOTOS_DIR)), name="photos")
app.mount("/storage/thumbnails", StaticFiles(directory=str(THUMBNAILS_DIR)), name="thumbnails")

# Template helper to load HTML files
def render_template(filename: str) -> str:
    path = BASE_DIR / "frontend" / "templates" / filename
    return path.read_text(encoding="utf-8")


# -------------------------------------------------------------
# Web Page Routes
# -------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    """Redirect root to /guest or /dashboard depending on admin session."""
    if is_admin_authenticated(request):
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    return RedirectResponse(url="/guest", status_code=status.HTTP_302_FOUND)


@app.get("/guest", response_class=HTMLResponse)
async def guest_page():
    """Guest photo discovery page."""
    return HTMLResponse(content=render_template("guest.html"))


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Host dashboard login page."""
    if is_admin_authenticated(request):
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    return HTMLResponse(content=render_template("login.html"))


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    """Protected Host dashboard page."""
    if not is_admin_authenticated(request):
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
    return HTMLResponse(content=render_template("dashboard.html"))


@app.get("/dashboard/print-card", response_class=HTMLResponse)
async def print_card_page(request: Request):
    """Printable physical event sign with QR code."""
    if not is_admin_authenticated(request):
        return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)
    return HTMLResponse(content=generate_printable_card_html())


# -------------------------------------------------------------
# Public Guest APIs
# -------------------------------------------------------------

@app.get("/api/event-info")
async def get_event_info():
    """Public event details for guest header."""
    return {
        "event_name": database.get_setting("event_name", "Event Photos"),
        "total_photos": database.get_stats()["total_photos"],
    }


@app.post("/api/match-face")
async def match_face(selfie: UploadFile = File(...)):
    """
    Accept guest selfie, detect face, extract 128D embedding,
    and return all matching photos. Guest only sees their own photos!
    """
    try:
        selfie_bytes = await selfie.read()
        if not selfie_bytes:
            raise HTTPException(status_code=400, detail="Empty selfie file uploaded.")

        face_engine = get_face_engine()
        matches = face_engine.match_selfie(selfie_bytes)

        return {
            "success": True,
            "matched_count": len(matches),
            "photos": matches,
        }

    except ValueError as e:
        # User-correctable error (e.g. no face detected in selfie)
        return JSONResponse(
            status_code=400,
            content={"success": False, "detail": str(e)},
        )
    except Exception as e:
        logger.error(f"Error in face matching: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"success": False, "detail": "An internal error occurred while analyzing your photo."},
        )


@app.get("/api/download-photo/{photo_id}")
async def download_photo(photo_id: int):
    """Download individual high-resolution photo file."""
    row = database.get_photo(photo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found.")

    file_path = Path(row["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found on disk.")

    download_name = row["original_name"] or file_path.name
    return FileResponse(
        path=str(file_path),
        filename=download_name,
        media_type="application/octet-stream",
    )


class ZipDownloadRequest(BaseModel):
    photo_ids: List[int]


@app.post("/api/download-zip")
async def download_zip(payload: ZipDownloadRequest):
    """Download all matched photos as a single zip archive."""
    if not payload.photo_ids:
        raise HTTPException(status_code=400, detail="No photos specified for download.")

    try:
        event_name = database.get_setting("event_name", "event")
        safe_prefix = "".join(c for c in event_name if c.isalnum() or c in ("-", "_")).strip() or "event"
        zip_buffer = build_zip_archive(payload.photo_ids)

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_prefix}_my_photos.zip"'
            },
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to generate zip: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not create zip archive.")


# -------------------------------------------------------------
# Host Auth APIs
# -------------------------------------------------------------

class LoginRequest(BaseModel):
    password: str


@app.post("/api/auth/login")
async def login(payload: LoginRequest, response: Response):
    """Authenticate host and set session cookie."""
    if not verify_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid password.")

    token = create_session_token()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600,
    )
    return {"success": True, "token": token}


@app.post("/api/auth/logout")
async def logout(response: Response):
    """Log out host session."""
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"success": True}


# -------------------------------------------------------------
# Protected Host Dashboard APIs
# -------------------------------------------------------------

@app.get("/api/dashboard/stats", dependencies=[Depends(require_admin)])
async def dashboard_stats():
    """Return dashboard summary stats and status."""
    return database.get_stats()


@app.get("/api/dashboard/qr", dependencies=[Depends(require_admin)])
async def dashboard_qr():
    """Return QR code image data URI and current guest URL."""
    guest_url = database.get_setting("guest_base_url", get_default_guest_url())
    qr_b64 = generate_qr_base64(guest_url)
    return {
        "guest_url": guest_url,
        "qr_base64": qr_b64,
    }


@app.get("/api/dashboard/qr/download")
async def download_qr_png():
    """Direct PNG download of event QR code."""
    guest_url = database.get_setting("guest_base_url", get_default_guest_url())
    png_bytes = generate_qr_bytes(guest_url, box_size=16)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="event_qr_code.png"'},
    )


class SyncRequest(BaseModel):
    drive_url: str


@app.post("/api/dashboard/sync", dependencies=[Depends(require_admin)])
async def trigger_sync(payload: SyncRequest):
    """Trigger background Google Drive folder synchronization."""
    sync_manager = get_sync_manager()
    result = sync_manager.start_sync(payload.drive_url)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@app.get("/api/dashboard/sync-status", dependencies=[Depends(require_admin)])
async def sync_status():
    """Fetch live status of running or completed sync."""
    sync_manager = get_sync_manager()
    return sync_manager.get_status()


@app.post("/api/dashboard/upload", dependencies=[Depends(require_admin)])
async def upload_photos(files: List[UploadFile] = File(...)):
    """
    Allow host to upload photos directly to the event
    (in addition to Google Drive sync).
    """
    sync_manager = get_sync_manager()
    face_engine = get_face_engine()
    results = []

    for upload_file in files:
        try:
            content = await upload_file.read()
            if not content:
                continue

            # Save temporary file to pass to process_image_file
            temp_path = BASE_DIR / "storage" / "selfies" / f"temp_{upload_file.filename}"
            with open(temp_path, "wb") as f:
                f.write(content)

            info = sync_manager.process_image_file(
                src_path=temp_path,
                source="upload",
                original_name=upload_file.filename,
                face_engine=face_engine,
            )

            # Cleanup temp file
            if temp_path.exists():
                temp_path.unlink()

            results.append({"filename": upload_file.filename, "result": info})
        except Exception as e:
            logger.warning(f"Direct upload error for {upload_file.filename}: {e}")
            results.append({"filename": upload_file.filename, "error": str(e)})

    return {"success": True, "processed": len(results), "details": results}


@app.post("/api/dashboard/photos/reset", dependencies=[Depends(require_admin)])
async def reset_event_photos():
    """Wipe all synced event photos, faces, and thumbnails for a clean event slate."""
    sync_manager = get_sync_manager()
    if sync_manager.is_syncing:
        raise HTTPException(status_code=400, detail="Cannot reset while a sync is actively in progress.")
    database.clear_all_photos()
    database.set_setting("drive_folder_id", "")
    database.set_setting("drive_folder_url", "")
    database.set_setting("sync_status", "idle")
    database.set_setting("sync_message", "All photos cleared. Ready for new Drive link.")
    return {"success": True, "message": "All previous photos and data have been wiped."}


@app.get("/api/dashboard/photos", dependencies=[Depends(require_admin)])
async def list_dashboard_photos(page: int = 1, per_page: int = 40):
    """Paginated list of all synced event photos for dashboard viewer."""
    offset = (page - 1) * per_page
    rows = database.get_all_photos(limit=per_page, offset=offset)

    photos = []
    for r in rows:
        photos.append(
            {
                "id": r["id"],
                "filename": r["filename"],
                "original_name": r["original_name"],
                "thumbnail_url": f"/storage/thumbnails/{r['filename']}",
                "photo_url": f"/storage/photos/{r['filename']}",
                "download_url": f"/api/download-photo/{r['id']}",
                "faces_count": r["faces_count"],
                "source": r["source"],
                "file_size": r["file_size"],
                "created_at": r["created_at"],
            }
        )

    return {"photos": photos, "page": page, "per_page": per_page}


@app.delete("/api/dashboard/photos/{photo_id}", dependencies=[Depends(require_admin)])
async def delete_photo_endpoint(photo_id: int):
    """Delete a photo and associated face embeddings from the event."""
    row = database.get_photo(photo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found.")

    # Remove files from disk
    p1 = Path(row["file_path"])
    p2 = Path(row["thumbnail_path"])
    if p1.exists():
        p1.unlink(missing_ok=True)
    if p2.exists():
        p2.unlink(missing_ok=True)

    database.delete_photo(photo_id)
    return {"success": True, "deleted_id": photo_id}


class SettingsUpdate(BaseModel):
    event_name: Optional[str] = None
    match_threshold: Optional[float] = None
    guest_base_url: Optional[str] = None
    new_password: Optional[str] = None


@app.post("/api/dashboard/settings", dependencies=[Depends(require_admin)])
async def update_settings(payload: SettingsUpdate):
    """Update event metadata, match threshold, guest URL, or admin password."""
    if payload.event_name is not None and payload.event_name.strip():
        database.set_setting("event_name", payload.event_name.strip())

    if payload.match_threshold is not None:
        if 0.1 <= payload.match_threshold <= 0.9:
            database.set_setting("match_threshold", str(payload.match_threshold))
        else:
            raise HTTPException(status_code=400, detail="Threshold must be between 0.1 and 0.9.")

    if payload.guest_base_url is not None and payload.guest_base_url.strip():
        url = payload.guest_base_url.strip().rstrip("/")
        if not url.endswith("/guest"):
            url = f"{url}/guest"
        database.set_setting("guest_base_url", url)

    if payload.new_password is not None and payload.new_password.strip():
        if len(payload.new_password.strip()) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
        database.set_setting("admin_password", payload.new_password.strip())

    return {"success": True, "settings": database.get_all_settings()}


if __name__ == "__main__":
    import uvicorn
    reload_flag = os.getenv("RELOAD", "false").lower() in ("true", "1", "yes")
    print(f"Starting AutoPhoto server on http://{SERVER_HOST}:{SERVER_PORT}")
    print(f"Guest page available at: {get_default_guest_url()}")
    print(f"Host dashboard available at: http://127.0.0.1:{SERVER_PORT}/dashboard (Default password: {os.getenv('ADMIN_PASSWORD', 'admin123')})")
    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=reload_flag)
