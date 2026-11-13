# SUV Photo Gallery

AI-powered event photography application that lets guests scan a QR code, snap a selfie (or upload a photo), and instantly find their photos from Google Drive via facial recognition.

## 📁 Repository Structure

```
auto_photo/
├── suv-photo-vercel/          # 🚀 Modern Production App (Next.js + Vercel + Neon)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Guest face search & camera UI (runs in browser)
│   │   │   ├── dashboard/     # Admin event management & indexing dashboard
│   │   │   └── api/           # Lightweight serverless API endpoints
│   │   │       ├── match/     # Vector similarity search with Neon pgvector
│   │   │       ├── drive/     # Google Drive folder reader & secure proxy
│   │   │       ├── photos/    # Photo & vector storage
│   │   │       ├── clear/     # Event purge endpoint
│   │   │       └── sync/      # Daily cron & health route
│   │   └── lib/
│   │       ├── db.ts          # Neon Postgres + pgvector client
│   │       └── drive.ts       # Google Drive API integration
│   ├── public/models/         # Face-API neural network model weights
│   ├── vercel.json            # Vercel deployment & daily cron configuration
│   └── package.json           # Next.js 14 LTS dependencies
│
└── archive/legacy-python/     # 📦 Archived Python Stack (FastAPI + OpenCV)
    ├── backend/               # FastAPI backend & OpenCV face engine
    ├── frontend/              # Jinja2 templates & vanilla JS
    └── models/                # ONNX models (SFace & YuNet)
```

## ⚡ Technology Stack (Current)

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 14 (App Router) + Tailwind CSS | Fast, responsive UI for mobile & desktop |
| **Face AI** | `@vladmandic/face-api` (Browser WebGL) | Runs face detection on user device with 0 server compute |
| **API** | Vercel Serverless Functions | Lightweight JSON handlers (< 100ms response) |
| **Database** | Neon Cloud Postgres + `pgvector` | Instant cosine similarity vector search |
| **Storage** | Google Drive API (Service Account) | Stream thumbnails and high-res photos without local storage |
| **Cron** | Vercel Cron Jobs | Automated daily album cleanup |

## 🛠️ Deployment

Deploy directly to **Vercel** with root directory set to `suv-photo-vercel`.
Required Environment Variables:
- `NEON_DATABASE_URL`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `ADMIN_PASSWORD`
- `FACE_MATCH_THRESHOLD` (default: `0.4`)
