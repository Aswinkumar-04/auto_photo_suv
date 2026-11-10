# 📸 AutoPhoto: AI-Powered Event Photo Sharing (Key-Free)

AutoPhoto is a complete, privacy-focused, zero-cloud-cost event photo-sharing web application. A photographer or event host generates a single default QR code for display at tables or venue entrances. The host pastes a Google Drive folder link into a protected dashboard, the application syncs and indexes all photos using local face-recognition models, and guests scan the QR code, take a quick selfie, and instantly view and download **only** the photos that contain their own face.

---

## 🌟 Key Features

1. **Default Event QR Code**: Generates a single event QR code pointing directly to the mobile guest page. Includes:
   - Real-time LAN IP auto-detection for seamless local Wi-Fi mobile scanning without complex network setup.
   - 1-click PNG download for physical print banners and photo booth cards.
   - Printable A5 table sign template (`/dashboard/print-card`).
2. **Key-Free Google Drive Ingestion**:
   - Ingests public Google Drive folder links (`https://drive.google.com/drive/folders/...`) without requiring Google Cloud API keys, OAuth clients, or service-account JSON credentials.
   - SHA256 checksum deduplication allows re-syncing at any time to pick up newly added photos without duplicating existing ones.
   - Real-time background sync progress bar and status indicator.
   - Drag-and-drop direct photo upload option in the dashboard as an offline alternative.
3. **100% Local, Open-Source Face Recognition**:
   - Powered by OpenCV DNN using **YuNet** (face detection) and **SFace** (128-dimensional normalized face embeddings).
   - Zero external cloud API calls: runs entirely locally on CPU/GPU.
   - Normalized embeddings are stored in SQLite; guest selfie matching performs a sub-millisecond vectorized matrix dot-product comparison.
   - Gracefully handles photos with zero faces, multiple faces, and unreadable files without crashing.
   - Single configurable match threshold constant (`DEFAULT_MATCH_THRESHOLD = 0.363`, adjustable in the dashboard).
4. **Mobile-First Guest Experience**:
   - Built specifically for smartphones scanned from table QR codes.
   - Front/rear camera toggle with live viewfinder guide and instant fallback to photo roll upload.
   - **Privacy Isolation**: Guests only see their own matched photos; no other guest's photos or matches are exposed.
   - Individual high-resolution photo download and 1-click **Download All as ZIP**.
5. **Protected Host Dashboard**:
   - Session-based authentication using cryptographically signed HMAC tokens without external auth providers.
   - Default host password: `admin123` (customizable via `.env` or the settings dashboard).

---

## 🏗️ Architecture & Key-Free Design Decisions

```
auto_photo/
├── backend/
│   ├── __init__.py
│   ├── config.py              # Configuration constants, paths, thresholds, LAN IP
│   ├── database.py            # SQLite schema, vectorized embedding storage, CRUD
│   ├── face_engine.py         # YuNet detection, SFace 128D embedding, cosine matching
│   ├── drive_sync.py          # Public Google Drive folder parser, sync worker, deduplication
│   ├── qr_service.py          # QR code generator (PNG / Base64 / Printable Card)
│   ├── zip_service.py         # Dynamic ZIP packaging for matched photos
│   └── auth.py                # Local HMAC-signed session authentication
├── frontend/
│   ├── static/
│   │   ├── css/app.css        # Responsive mobile-first CSS styling
│   │   └── js/
│   │       ├── guest.js       # Camera WebRTC, canvas snapshot, matching, ZIP download
│   │       └── dashboard.js   # Live stats, Drive sync polling, QR, settings
│   └── templates/
│       ├── guest.html         # Mobile guest viewfinder & gallery
│       ├── dashboard.html     # Host management dashboard
│       └── login.html         # Host login screen
├── models/                    # Local OpenCV DNN ONNX models (auto-downloaded)
│   ├── face_detection_yunet_2023mar.onnx
│   └── face_recognition_sface_2021dec.onnx
├── storage/                   # Local storage directory (created automatically)
│   ├── photos/                # Synced high-res event photos
│   ├── thumbnails/            # Fast 450x450 JPEG thumbnails
│   ├── selfies/               # Temporary processing directory
│   └── event.db               # SQLite database
├── tests/                     # 27 automated unit & integration tests
│   ├── test_api.py
│   ├── test_auth.py
│   ├── test_drive_sync.py
│   ├── test_face_engine.py
│   └── test_end_to_end.py
├── .env.example
├── requirements.txt
├── main.py                    # FastAPI server entrypoint
└── README.md
```

### Why Local OpenCV YuNet + SFace instead of Cloud APIs?
- **Zero API Keys & Cost**: Paid services like AWS Rekognition, Azure Face, or Google Cloud Vision require credit card registration, cloud projects, and recurring per-image pricing.
- **Privacy**: Event guests' faces are never uploaded to third-party cloud servers.
- **Speed & Portability**: YuNet (~230KB) and SFace (~38MB) run in pure OpenCV DNN C++/Python without heavyweight PyTorch/TensorFlow runtimes or C++ compiler build requirements (unlike `dlib` which frequently fails on modern Windows/Python 3.12+).
- **Inference Speed**: Face detection and 128-dimensional embedding extraction take ~15-30ms per photo on standard laptop CPUs.

### Key-Free Google Drive Ingestion & Limitations
Drive sync is handled unauthenticated via `gdown`, utilizing Google Drive's public folder structure:
- **Requirement**: The Google Drive folder **must** be set to:
  > **General access: "Anyone with the link can view"**
- **Limitations of Key-Free Drive Access**:
  1. **Public Permission Requirement**: Private folders or folders restricted to a specific Google Workspace organization cannot be accessed without credentials.
  2. **Google Rate Limits / Captchas**: If thousands of photos are pulled in a rapid continuous burst, Google may temporarily throttle the IP address or trigger an abuse-prevention checkpoint. For massive libraries (10,000+ photos), sync in batches or use the dashboard's Direct Upload tool.
  3. **Folder Depth**: Very deeply nested folder trees may take longer to discover than single flat folders.
  4. **HTML / API Layout Changes**: Unauthenticated scrapers rely on Google Drive's public web endpoints. If Google changes their public frontend endpoints, `gdown` updates may be required.

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- Python 3.9, 3.10, 3.11, 3.12, or 3.13
- Git

### 2. Installation
Clone the repository and install dependencies:
```bash
# Clone the repository
git clone <repo-url> auto_photo
cd auto_photo

# Create and activate a virtual environment
python -m venv venv

# On Windows:
.\venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Model Files
The required ONNX models (`face_detection_yunet_2023mar.onnx` and `face_recognition_sface_2021dec.onnx`) are automatically downloaded to `models/` on first startup if not already present.

### 4. Configuration (Optional)
Copy `.env.example` to `.env` to customize settings:
```bash
cp .env.example .env
```
Default parameters:
- `HOST=0.0.0.0`
- `PORT=8000`
- `ADMIN_PASSWORD=admin123`
- `FACE_MATCH_THRESHOLD=0.363` (Cosine similarity threshold: 0.32 = lenient, 0.40 = strict)

### 5. Launch the Application
```bash
python main.py
```
Or with Uvicorn:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 📖 Host & Guest Usage

### Host Workflow
1. Open your browser to: **`http://localhost:8000/dashboard`** (or `http://<your-ip>:8000/dashboard`).
2. Log in with the host password (default: `admin123`).
3. **QR Code**:
   - The dashboard displays the event QR code, auto-configured with your local Wi-Fi IP address (e.g. `http://192.168.1.50:8000/guest`).
   - Click **Download QR PNG** or click **Print Event Table Sign** to print out table displays for guests.
4. **Google Drive Sync**:
   - In Google Drive, open your event folder, click **Share**, and set General Access to **"Anyone with the link can view"**.
   - Copy the link and paste it into the **Google Drive Sync** field on the dashboard.
   - Click **Sync Photos Now**.
   - The app downloads images, generates thumbnails, detects faces, and indexes embeddings in the background.
   - When photographers add more photos later in the event, simply click **Re-sync** — previously synced photos are safely skipped.
5. **Adjust Sensitivity**:
   - If guests report missing matches, lower the slider slightly (e.g., to `0.32`).
   - If guests receive photos of lookalikes, raise the slider slightly (e.g., to `0.40`).

### Guest Workflow
1. Guest scans the QR code with their phone camera.
2. The mobile page opens (`/guest`).
3. Guest taps the shutter button to snap a selfie (or uploads an existing photo).
4. The system detects their face, compares its embedding against all event photos in under 100ms, and displays all photos containing their face.
5. The guest can tap any photo to view in full resolution or tap **Download All (ZIP)** to save all matched photos at once.

---

## 🌐 Deploying to Render (Step-by-Step Guide)

You can host AutoPhoto live on [Render](https://render.com) so that event guests anywhere can scan the QR code and view their photos in real time.

### Step 1: Push your code to GitHub

1. Create a new repository on [GitHub](https://github.com/new) (e.g., `auto_photo` or `suv-photo-gallery`). Keep it **Private** or **Public**.
2. Run the following commands in your project terminal:
   ```bash
   git add .
   git commit -m "Production release for Render"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

### Step 2: Create a Web Service on Render

1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** in the top right corner and select **Web Service**.
3. Choose **Build and deploy from a Git repository**, click **Next**, and connect your GitHub account.
4. Select the repository you just pushed.

### Step 3: Configure Service Settings

Render will ask for your service configurations:

| Field | Value |
| :--- | :--- |
| **Name** | `suv-photo-gallery` (or any name you prefer) |
| **Region** | Select the region closest to you (e.g., *Singapore*, *Frankfurt*, *Oregon*) |
| **Branch** | `main` |
| **Root Directory** | *(leave empty)* |
| **Runtime** | **Python** *(or Docker if you prefer containerized deployment)* |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `python main.py` |
| **Instance Type** | **Free** (or Starter/Standard for high event traffic) |

### Step 4: Add Environment Variables

Scroll down to **Environment Variables** and add:
- `PYTHONUNBUFFERED` = `1`
- `ADMIN_PASSWORD` = `YourCustomHostPassword123` *(change this to your private password)*
- `FACE_MATCH_THRESHOLD` = `0.363` *(default)*

> [!NOTE]
> **Automatic Public URL Detection**: When deployed on Render, the system automatically detects Render's public URL (`RENDER_EXTERNAL_URL`). The default QR code generated on the dashboard will immediately point to `https://your-service.onrender.com/guest`.

### Step 5: Click "Deploy Web Service"

Render will build and launch your application. Once the build completes:
- You will see `==> Your service is live at https://your-service.onrender.com` in the Render logs.
- Click on your public URL to open the gallery!
- Log into `https://your-service.onrender.com/dashboard` with your admin password.
- Paste your public Google Drive link and let the automatic 10-second sync populate the gallery continuously during your event!

---

## 🧪 Running Automated Tests

Run the complete test suite with pytest:
```bash
pytest tests -v
```

The 27 tests cover:
- Public and protected API route behavior.
- Google Drive link parsing and ID extraction from 6 URL variants.
- SHA256 checksum deduplication.
- FaceEngine model initialization, EXIF orientation handling, and zero-face detection.
- Vectorized cosine similarity math and threshold validation.
- End-to-end photo ingestion, face matching, and ZIP streaming.

---

## 🔒 Security & Privacy Notes

- **Guest Isolation**: The guest page has no directory browsing API. The `/api/match-face` endpoint exclusively returns photo IDs whose face embedding cosine distance exceeds the event threshold.
- **Local Storage**: All photos, thumbnails, and embeddings are stored inside the local `storage/` directory and SQLite database (`event.db`).
- **No Third-Party Tracking**: Zero telemetry, analytics, or external script CDNs.

