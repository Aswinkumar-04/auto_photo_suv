# SUV Photo Gallery — Vercel Edition

AI-powered event photography app. Guests scan a QR code, snap a selfie, and instantly find their photos.

## Architecture

| Component | Tool |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Face AI | `@vladmandic/face-api` — runs **in guest's browser** |
| Styling | Tailwind CSS |
| API | Vercel Serverless Functions |
| Database | Neon Postgres + pgvector |
| Photo Storage | Google Drive (streamed directly to guest) |
| Auto-Sync | Vercel Cron Jobs (every minute) |

## Setup

### 1. Create a Neon Database
1. Go to [neon.tech](https://neon.tech) → New Project → Copy the connection string
2. It looks like: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

### 2. Download Face-API Models
```bash
node scripts/download-models.js
```
This downloads ~6 MB of model weights into `public/models/`.

### 3. Set Environment Variables
Copy `.env.local.example` → `.env.local` and fill in:
```
NEON_DATABASE_URL=postgresql://...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
ADMIN_PASSWORD=your_password
CRON_SECRET=any_random_string
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### 4. Initialize Database
```bash
NEON_DATABASE_URL=... node scripts/db-init.js
```

### 5. Run Locally
```bash
npm run dev
```

### 6. Deploy to Vercel
```bash
npx vercel --prod
```
Add all env vars in the Vercel dashboard under **Settings → Environment Variables**.

## Usage

### Admin
1. Go to `/dashboard`
2. Enter your admin password
3. Paste Google Drive folder link → Save
4. Photos auto-index within 1 minute (Vercel Cron runs every minute)

### Guests
1. Open the app URL (or scan QR code)
2. Tap "Take a Selfie"
3. Face detection runs in their browser — **nothing uploaded to any server**
4. Matching photos appear with View / Download links directly from Google Drive

## Google Drive Setup
- Create a Service Account in Google Cloud Console
- Share your Drive folder with the service account email: `photography@your-project.iam.gserviceaccount.com`
- Download the JSON key and paste its contents as `GOOGLE_SERVICE_ACCOUNT_JSON`

## Zero-Storage Design
- ✅ Full-resolution photos live only in Google Drive
- ✅ Only 128-dimensional face vectors stored in Neon (< 1 KB per face)
- ✅ Thumbnails served directly from Google Drive CDN
- ✅ Downloads redirect directly to Google Drive

