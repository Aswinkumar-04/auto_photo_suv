import os
import shutil
import threading
import urllib.request
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Union
import cv2
import numpy as np
from PIL import Image, ImageOps
import io

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

from backend.config import (
    YUNET_MODEL_PATH,
    SFACE_MODEL_PATH,
    YUNET_DOWNLOAD_URL,
    SFACE_DOWNLOAD_URL,
    DEFAULT_MATCH_THRESHOLD,
    MAX_IMAGE_DIMENSION,
)
from backend import database

logger = logging.getLogger("face_engine")


class FaceEngine:
    """
    Open-source, key-free Face Detection and Recognition engine powered by OpenCV DNN.
    - Detector: YuNet (lightweight, state-of-the-art CNN face detector)
    - Recognizer: SFace (128-dimensional normalized face embeddings)
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(FaceEngine, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self._ensure_models_exist()
            self._init_models()
            self._infer_lock = threading.Lock()
            self._initialized = True

    def _ensure_models_exist(self):
        """Download OpenCV Zoo ONNX models if not present on disk."""
        YUNET_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)

        if not YUNET_MODEL_PATH.exists() or YUNET_MODEL_PATH.stat().st_size == 0:
            logger.info("Downloading YuNet face detection model...")
            req = urllib.request.Request(
                YUNET_DOWNLOAD_URL, headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp, open(
                YUNET_MODEL_PATH, "wb"
            ) as f:
                shutil.copyfileobj(resp, f)
            logger.info(f"YuNet model downloaded ({YUNET_MODEL_PATH.stat().st_size} bytes)")

        if not SFACE_MODEL_PATH.exists() or SFACE_MODEL_PATH.stat().st_size == 0:
            logger.info("Downloading SFace face recognition model (~38MB)...")
            req = urllib.request.Request(
                SFACE_DOWNLOAD_URL, headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=60) as resp, open(
                SFACE_MODEL_PATH, "wb"
            ) as f:
                shutil.copyfileobj(resp, f)
            logger.info(f"SFace model downloaded ({SFACE_MODEL_PATH.stat().st_size} bytes)")

    def _init_models(self):
        """Create OpenCV FaceDetectorYN and FaceRecognizerSF instances."""
        try:
            self.detector = cv2.FaceDetectorYN.create(
                model=str(YUNET_MODEL_PATH),
                config="",
                input_size=(320, 320),
                score_threshold=0.6,
                nms_threshold=0.3,
                top_k=5000,
            )
            self.recognizer = cv2.FaceRecognizerSF.create(
                model=str(SFACE_MODEL_PATH),
                config="",
            )
            logger.info("Face detector (YuNet) and recognizer (SFace) initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize face recognition models: {e}")
            raise

    def load_image(self, source: Union[str, Path, bytes, np.ndarray]) -> Optional[np.ndarray]:
        """
        Load and normalize an image into BGR format for OpenCV.
        Automatically applies EXIF rotation (so portrait camera photos are upright).
        """
        try:
            if isinstance(source, np.ndarray):
                return source

            if isinstance(source, (str, Path)):
                with open(source, "rb") as f:
                    image_bytes = f.read()
            elif isinstance(source, bytes):
                image_bytes = source
            else:
                return None

            # Use PIL for robust decoding and EXIF orientation handling
            pil_img = Image.open(io.BytesIO(image_bytes))
            pil_img = ImageOps.exif_transpose(pil_img)

            # Convert to RGB (handles RGBA, grayscale, etc.)
            if pil_img.mode != "RGB":
                pil_img = pil_img.convert("RGB")

            # Convert RGB PIL to BGR OpenCV
            rgb_arr = np.array(pil_img)
            bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
            return bgr_arr

        except Exception as e:
            logger.warning(f"Could not decode image: {e}")
            return None

    def detect_and_extract_faces(
        self, image_source: Union[str, Path, bytes, np.ndarray]
    ) -> List[Dict[str, Any]]:
        """
        Detect faces in image and extract 128D normalized embeddings.
        Returns list of dicts: [
            {'bbox': (x, y, w, h), 'confidence': float, 'embedding': np.ndarray}
        ]
        """
        img = self.load_image(image_source)
        if img is None:
            return []

        h, w = img.shape[:2]
        if h == 0 or w == 0:
            return []

        # Downscale oversized images for fast detection without excessive memory usage
        scale = 1.0
        det_img = img
        if max(h, w) > MAX_IMAGE_DIMENSION:
            scale = MAX_IMAGE_DIMENSION / float(max(h, w))
            new_w, new_h = int(w * scale), int(h * scale)
            det_img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        det_h, det_w = det_img.shape[:2]

        with self._infer_lock:
            self.detector.setInputSize((det_w, det_h))
            _, faces = self.detector.detect(det_img)

        if faces is None or len(faces) == 0:
            return []

        extracted_faces = []

        for face in faces:
            # face format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rc, y_rc, x_lc, y_lc, score]
            # Rescale coordinates and landmarks back to original image size if scaled
            scaled_face = face.copy()
            if scale != 1.0:
                scaled_face[:-1] = scaled_face[:-1] / scale

            x, y, fw, fh = (
                int(scaled_face[0]),
                int(scaled_face[1]),
                int(scaled_face[2]),
                int(scaled_face[3]),
            )
            score = float(scaled_face[14])

            # Ensure bounding box is within image bounds
            x = max(0, x)
            y = max(0, y)
            fw = min(w - x, fw)
            fh = min(h - y, fh)

            if fw <= 10 or fh <= 10:
                continue

            try:
                # Align and crop the face using original high-res image and landmarks
                with self._infer_lock:
                    aligned_face = self.recognizer.alignCrop(img, scaled_face)
                    feature = self.recognizer.feature(aligned_face)

                # Flatten and normalize to unit length for cosine dot product
                feat_vec = feature.flatten().astype(np.float32)
                norm = np.linalg.norm(feat_vec)
                if norm > 0:
                    feat_vec = feat_vec / norm

                extracted_faces.append(
                    {
                        "bbox": (x, y, fw, fh),
                        "confidence": score,
                        "embedding": feat_vec,
                    }
                )
            except Exception as e:
                logger.warning(f"Error computing face feature: {e}")
                continue

        return extracted_faces

    def extract_selfie_embedding(self, selfie_bytes: bytes) -> np.ndarray:
        """
        Process a guest's selfie, detect the primary face, and return its 128D embedding.
        Raises ValueError if no clear face is detected.
        """
        faces = self.detect_and_extract_faces(selfie_bytes)
        if not faces:
            raise ValueError(
                "No face detected in your photo. Please take a clear, well-lit selfie looking toward the camera."
            )

        # If multiple faces detected (e.g. photobomb or background), pick the largest face by area
        primary_face = max(faces, key=lambda f: f["bbox"][2] * f["bbox"][3])
        return primary_face["embedding"]

    def match_selfie(
        self, selfie_bytes: bytes, threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Match guest selfie against all indexed event photos.
        Returns matched photos with scores, sorted from highest similarity.
        """
        selfie_emb = self.extract_selfie_embedding(selfie_bytes)

        if threshold is None:
            threshold_str = database.get_setting("match_threshold", str(DEFAULT_MATCH_THRESHOLD))
            try:
                threshold = float(threshold_str)
            except ValueError:
                threshold = DEFAULT_MATCH_THRESHOLD

        face_ids, photo_ids, embeddings_matrix = database.get_all_face_embeddings()

        if len(photo_ids) == 0 or embeddings_matrix.shape[0] == 0:
            return []

        # Vectorized cosine similarity: dot product of normalized embeddings
        # embeddings_matrix is (N, 128), selfie_emb is (128,)
        # similarity scores is (N,)
        similarities = np.dot(embeddings_matrix, selfie_emb)

        # Aggregate highest match score per photo_id
        matched_photo_scores: Dict[int, float] = {}
        for photo_id, score in zip(photo_ids, similarities):
            if score >= threshold:
                score_val = float(score)
                if photo_id not in matched_photo_scores or score_val > matched_photo_scores[photo_id]:
                    matched_photo_scores[photo_id] = score_val

        if not matched_photo_scores:
            return []

        # Retrieve matched photo details from database
        matched_ids = list(matched_photo_scores.keys())
        photo_rows = database.get_photos_by_ids(matched_ids)
        photo_dict = {r["id"]: r for r in photo_rows}

        results = []
        for photo_id, score in matched_photo_scores.items():
            row = photo_dict.get(photo_id)
            if not row:
                continue

            results.append(
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "original_name": row["original_name"],
                    "thumbnail_url": f"/storage/thumbnails/{row['filename']}",
                    "photo_url": f"/storage/photos/{row['filename']}",
                    "download_url": f"/api/download-photo/{row['id']}",
                    "match_score": round(score, 3),
                    "confidence_percent": int(min(100, max(0, score * 100))),
                    "faces_count": row["faces_count"],
                    "created_at": row["created_at"],
                }
            )

        # Sort descending by match score
        results.sort(key=lambda x: x["match_score"], reverse=True)
        return results


def get_face_engine() -> FaceEngine:
    """Return the singleton instance of FaceEngine."""
    return FaceEngine()
