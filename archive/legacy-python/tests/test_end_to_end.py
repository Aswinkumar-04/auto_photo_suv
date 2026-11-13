import io
import zipfile
import pytest
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from main import app
from backend import database
from backend.face_engine import get_face_engine
from backend.drive_sync import get_sync_manager
from backend.config import PHOTOS_DIR, THUMBNAILS_DIR


@pytest.fixture
def client():
    return TestClient(app)


def test_full_pipeline_ingest_match_and_zip(tmp_path, client):
    # 1. Clear database to start clean
    database.clear_all_photos()
    assert database.get_stats()["total_photos"] == 0

    sync_mgr = get_sync_manager()

    # 2. Ingest a scenic photo with 0 faces (a landscape canvas)
    scenic_path = tmp_path / "scenic_sunset.jpg"
    scenic_img = Image.new("RGB", (640, 480), color=(255, 120, 60))
    scenic_img.save(scenic_path)

    res_scenic = sync_mgr.process_image_file(scenic_path, source="upload")
    assert res_scenic["is_new"] is True
    assert res_scenic["faces_count"] == 0
    scenic_photo_id = res_scenic["photo_id"]

    # 3. Add two mock photos with distinct face embeddings in database
    # Person A's face embedding vector
    person_a_emb = np.random.randn(128).astype(np.float32)
    person_a_emb = person_a_emb / np.linalg.norm(person_a_emb)

    # Person B's face embedding vector
    person_b_emb = np.random.randn(128).astype(np.float32)
    person_b_emb = person_b_emb / np.linalg.norm(person_b_emb)

    # Photo A (contains Person A)
    photo_a_file = PHOTOS_DIR / "test_person_a.jpg"
    thumb_a_file = THUMBNAILS_DIR / "test_person_a.jpg"
    Image.new("RGB", (400, 400), color="green").save(photo_a_file)
    Image.new("RGB", (100, 100), color="green").save(thumb_a_file)

    photo_a_id = database.add_photo(
        filename="test_person_a.jpg",
        original_name="person_a_solo.jpg",
        file_path=str(photo_a_file),
        thumbnail_path=str(thumb_a_file),
        file_size=photo_a_file.stat().st_size,
        file_hash="mock_hash_person_a",
        source="upload",
    )
    database.add_face(photo_a_id, (50, 50, 100, 100), 0.95, person_a_emb)
    database.update_photo_faces_count(photo_a_id, 1)

    # Photo B (contains Person B)
    photo_b_file = PHOTOS_DIR / "test_person_b.jpg"
    thumb_b_file = THUMBNAILS_DIR / "test_person_b.jpg"
    Image.new("RGB", (400, 400), color="red").save(photo_b_file)
    Image.new("RGB", (100, 100), color="red").save(thumb_b_file)

    photo_b_id = database.add_photo(
        filename="test_person_b.jpg",
        original_name="person_b_solo.jpg",
        file_path=str(photo_b_file),
        thumbnail_path=str(thumb_b_file),
        file_size=photo_b_file.stat().st_size,
        file_hash="mock_hash_person_b",
        source="upload",
    )
    database.add_face(photo_b_id, (60, 60, 120, 120), 0.98, person_b_emb)
    database.update_photo_faces_count(photo_b_id, 1)

    # 4. Verify database stats
    stats = database.get_stats()
    assert stats["total_photos"] == 3
    assert stats["total_faces"] == 2
    assert stats["zero_face_photos"] == 1

    # 5. Verify Deduplication (Re-syncing scenic photo)
    res_duplicate = sync_mgr.process_image_file(scenic_path, source="upload")
    assert res_duplicate["is_new"] is False
    assert res_duplicate["photo_id"] == scenic_photo_id
    assert database.get_stats()["total_photos"] == 3  # Count did not increase!

    # 6. Test Face Matching Vector Comparison
    face_engine = get_face_engine()

    # Query with Person A's face embedding (slightly perturbed with noise, e.g. 0.05 noise)
    query_a = person_a_emb + np.random.normal(0, 0.02, size=128).astype(np.float32)
    query_a = query_a / np.linalg.norm(query_a)

    # Cosine similarity matching directly using FaceEngine matching logic
    face_ids, photo_ids, embeddings_matrix = database.get_all_face_embeddings()
    scores = np.dot(embeddings_matrix, query_a)

    matched = []
    for pid, s in zip(photo_ids, scores):
        if s >= 0.363:
            matched.append((pid, s))

    # Should match Photo A only!
    matched_pids = [m[0] for m in matched]
    assert photo_a_id in matched_pids
    assert photo_b_id not in matched_pids
    assert scenic_photo_id not in matched_pids

    # 7. Test Zip Download API
    zip_resp = client.post("/api/download-zip", json={"photo_ids": [photo_a_id]})
    assert zip_resp.status_code == 200
    assert zip_resp.headers["content-type"] == "application/zip"

    # Inspect zip contents
    zip_buffer = io.BytesIO(zip_resp.content)
    with zipfile.ZipFile(zip_buffer, "r") as zf:
        file_list = zf.namelist()
        assert len(file_list) == 1
        assert "person_a_solo.jpg" in file_list[0]

    # Cleanup test files so storage stays pristine
    for f in [photo_a_file, thumb_a_file, photo_b_file, thumb_b_file]:
        if f.exists():
            f.unlink()
    database.clear_all_photos()

