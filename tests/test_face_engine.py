import pytest
import numpy as np
from backend.face_engine import get_face_engine


def test_face_engine_singleton():
    engine1 = get_face_engine()
    engine2 = get_face_engine()
    assert engine1 is engine2


def test_detect_zero_faces_on_blank_image():
    engine = get_face_engine()
    blank = np.zeros((400, 400, 3), dtype=np.uint8)
    faces = engine.detect_and_extract_faces(blank)
    assert faces == []


def test_detect_corrupt_bytes():
    engine = get_face_engine()
    corrupt_data = b"not_an_image_at_all_123456"
    faces = engine.detect_and_extract_faces(corrupt_data)
    assert faces == []


def test_selfie_no_face_raises_value_error():
    engine = get_face_engine()
    blank = np.zeros((300, 300, 3), dtype=np.uint8)

    # Encode to JPEG bytes
    import cv2
    _, encoded = cv2.imencode(".jpg", blank)

    with pytest.raises(ValueError) as excinfo:
        engine.extract_selfie_embedding(encoded.tobytes())
    assert "No face detected" in str(excinfo.value)


def test_vector_cosine_math():
    v1 = np.random.randn(128).astype(np.float32)
    v1 = v1 / np.linalg.norm(v1)

    # Same vector similarity is exactly 1.0
    sim_same = np.dot(v1, v1)
    assert abs(sim_same - 1.0) < 1e-5

    # Orthogonal or different vector similarity is much lower
    v2 = np.random.randn(128).astype(np.float32)
    v2 = v2 / np.linalg.norm(v2)
    sim_diff = np.dot(v1, v2)
    assert sim_diff < 0.8

