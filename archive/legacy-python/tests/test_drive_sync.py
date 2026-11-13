import pytest
from pathlib import Path
from backend.drive_sync import extract_folder_id, calculate_sha256


def test_extract_folder_id_standard():
    url = "https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345"
    assert extract_folder_id(url) == "1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345"


def test_extract_folder_id_with_user_prefix():
    url = "https://drive.google.com/drive/u/0/folders/1ZXEhzbLRLU1giKKRJkjm8N04cO_JoYE2"
    assert extract_folder_id(url) == "1ZXEhzbLRLU1giKKRJkjm8N04cO_JoYE2"


def test_extract_folder_id_with_query_params():
    url = "https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345?usp=sharing&authuser=0"
    assert extract_folder_id(url) == "1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345"


def test_extract_folder_id_open_id_format():
    url = "https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345"
    assert extract_folder_id(url) == "1aBcDeFgHiJkLmNoPqRsTuVwXyZ_12345"


def test_extract_folder_id_raw():
    folder_id = "1ZXEhzbLRLU1giKKRJkjm8N04cO_JoYE2"
    assert extract_folder_id(folder_id) == folder_id


def test_extract_folder_id_invalid():
    assert extract_folder_id("") is None
    assert extract_folder_id("not-a-folder-link") is None
    assert extract_folder_id("https://google.com") is None


def test_calculate_sha256(tmp_path: Path):
    test_file = tmp_path / "sample.txt"
    test_file.write_text("Hello AutoPhoto 2026", encoding="utf-8")

    import hashlib
    expected_hash = hashlib.sha256(b"Hello AutoPhoto 2026").hexdigest()
    assert calculate_sha256(test_file) == expected_hash

