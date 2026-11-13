'use client';

import { useState, useEffect, useRef } from 'react';

type Status = {
  folderUrl: string | null;
  lastSync: string | null;
  photoCount: number;
};

type DriveFile = {
  id: string;
  name: string;
  thumbnailUrl: string;
  viewUrl: string;
  downloadUrl: string;
};

export default function DashboardPage() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [status, setStatus] = useState<Status | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Sync / Indexing state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const faceapiRef = useRef<any>(null);
  const cancelSyncRef = useRef(false);

  // Load models dynamically on client
  useEffect(() => {
    let mounted = true;
    async function loadModels() {
      try {
        const faceapi = await import('@vladmandic/face-api');
        if (!mounted) return;
        faceapiRef.current = faceapi;

        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        if (mounted) setModelsLoaded(true);
      } catch (e) {
        console.error('Failed loading face models:', e);
      }
    }
    loadModels();
    return () => { mounted = false; };
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
      if (data.folderUrl && !folderInput) setFolderInput(data.folderUrl);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 10_000);
      return () => clearInterval(interval);
    }
  }, [loggedIn]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      setLoggedIn(true);
      setAuthError('');
    } else {
      setAuthError('Please enter the admin password');
    }
  };

  // Run face extraction in browser & save to Neon
  const startBrowserSync = async (folderUrlToSync: string) => {
    if (!modelsLoaded) {
      setMsg('⏳ Waiting for face recognition models to finish loading in browser...');
      return;
    }

    setIsSyncing(true);
    cancelSyncRef.current = false;
    setMsg('🔍 Fetching file list from Google Drive...');

    try {
      // 1. Fetch Drive files
      const listRes = await fetch(`/api/drive?folderUrl=${encodeURIComponent(folderUrlToSync)}`);
      const listData = await listRes.json();

      if (!listRes.ok) {
        throw new Error(listData.error || 'Failed to list Drive files');
      }

      const files: DriveFile[] = listData.files || [];
      if (files.length === 0) {
        setMsg('ℹ️ No images found in this Google Drive folder. Make sure the folder contains photos and is shared with the service account.');
        setIsSyncing(false);
        return;
      }

      setSyncProgress({ current: 0, total: files.length, currentName: '' });

      let successCount = 0;

      // 2. Loop through each image, detect faces using browser HTML Image/Canvas
      for (let i = 0; i < files.length; i++) {
        if (cancelSyncRef.current) {
          setMsg('🛑 Sync paused by user.');
          break;
        }

        const file = files[i];
        setSyncProgress({ current: i + 1, total: files.length, currentName: file.name });

        try {
          // Load image element via our proxy to avoid CORS issues
          const img = new Image();
          img.crossOrigin = 'anonymous';

          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (e) => reject(new Error('Failed to load image ' + file.name));
            img.src = `/api/drive/proxy?fileId=${file.id}`;
          });

          // Detect all faces & extract 128D descriptors in browser
          const faceapi = faceapiRef.current;
          if (!faceapi) continue;

          const detections = await faceapi
            .detectAllFaces(img)
            .withFaceLandmarks()
            .withFaceDescriptors();

          const embeddings = detections.map((d: any) => Array.from(d.descriptor as Float32Array));

          // Save photo + vectors into Neon database
          await fetch('/api/photos/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              password,
              photo: {
                drive_file_id: file.id,
                name: file.name,
                thumbnail_url: file.thumbnailUrl,
                view_url: file.viewUrl,
                download_url: file.downloadUrl,
              },
              embeddings,
            }),
          });

          successCount++;
        } catch (itemErr) {
          console.error(`Error processing photo ${file.name}:`, itemErr);
        }
      }

      setMsg(`✅ Sync completed! Successfully indexed ${successCount} of ${files.length} photos.`);
      fetchStatus();
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : 'Unknown error';
      setMsg(`❌ Sync error: ${errStr}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSetFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: folderInput, password }),
      });
      const data = await res.json();

      if (res.ok) {
        setMsg('✅ Folder saved. Starting browser indexing...');
        await fetchStatus();
        startBrowserSync(folderInput);
      } else {
        setMsg('❌ ' + (data.error ?? 'Error saving folder'));
        if (res.status === 401) setLoggedIn(false);
      }
    } catch (e: unknown) {
      const errStr = e instanceof Error ? e.message : 'Error';
      setMsg('❌ ' + errStr);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear ALL photos and face embeddings from database? This cannot be undone.')) return;
    setLoading(true);
    setMsg('');
    cancelSyncRef.current = true;

    try {
      const res = await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg('✅ ' + data.message);
        fetchStatus();
      } else {
        setMsg('❌ ' + (data.error ?? 'Error'));
      }
    } catch (e: unknown) {
      const errStr = e instanceof Error ? e.message : 'Error';
      setMsg('❌ ' + errStr);
    } finally {
      setLoading(false);
    }
  };

  if (!loggedIn) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 w-full max-w-sm space-y-4 shadow-2xl"
        >
          <h1 className="text-2xl font-bold text-center text-purple-300">🔐 Admin Login</h1>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />
          {authError && <p className="text-red-400 text-sm">{authError}</p>}
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3 rounded-xl transition"
          >
            Login
          </button>
          <div className="text-center pt-2">
            <a href="/" className="text-gray-500 text-sm hover:text-gray-300">← Back to Guest Page</a>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-purple-300">📊 Admin Dashboard</h1>
          <a href="/" className="text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-gray-200">
            Guest Page →
          </a>
        </div>

        {/* Stats Card */}
        {status && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-400 text-sm">Photos indexed in Neon</p>
              <p className="text-4xl font-bold text-white">{status.photoCount}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Face Model Status</p>
              <p className="text-sm font-semibold mt-2">
                {modelsLoaded ? (
                  <span className="text-green-400">● Models Loaded in Browser</span>
                ) : (
                  <span className="text-yellow-400">⏳ Loading models...</span>
                )}
              </p>
            </div>
            {status.folderUrl && (
              <div className="col-span-2">
                <p className="text-gray-400 text-sm">Current Active Folder</p>
                <a
                  href={status.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 text-sm break-all hover:underline"
                >
                  {status.folderUrl}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Sync Progress Bar */}
        {isSyncing && (
          <div className="bg-purple-950/60 border border-purple-500/40 rounded-2xl p-6 space-y-3">
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-purple-200">
                ⚡ Extracting face embeddings in browser...
              </span>
              <span className="text-purple-300">
                {syncProgress.current} / {syncProgress.total}
              </span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                style={{
                  width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            {syncProgress.currentName && (
              <p className="text-xs text-gray-400 truncate">
                Processing: {syncProgress.currentName}
              </p>
            )}
            <button
              onClick={() => { cancelSyncRef.current = true; }}
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Stop Sync
            </button>
          </div>
        )}

        {/* Set Drive Folder Form */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-white">📁 Set Google Drive Folder</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Paste your Google Drive folder link.
            <br />
            <strong className="text-yellow-300">
              ⚠️ Switching to a NEW folder link will automatically wipe previous event photos.
            </strong>
          </p>
          <form onSubmit={handleSetFolder} className="space-y-3">
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/..."
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
            />
            <button
              type="submit"
              disabled={loading || isSyncing || !folderInput}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg"
            >
              {loading || isSyncing ? 'Processing…' : '🚀 Save Folder & Start Auto-Indexing'}
            </button>
          </form>
        </div>

        {/* Clear Photos Button */}
        <div className="bg-red-950/30 border border-red-800/30 rounded-2xl p-6 space-y-3">
          <h2 className="text-xl font-semibold text-red-300">🗑️ Clear All Photos</h2>
          <p className="text-gray-400 text-sm">
            Manually purge all indexed photos and vector embeddings from Neon.
          </p>
          <button
            onClick={handleClear}
            disabled={loading || isSyncing}
            className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-xl transition-colors shadow-lg"
          >
            {loading ? 'Clearing…' : '🗑️ Clear All Photos'}
          </button>
        </div>

        {/* Status Notification Message */}
        {msg && (
          <div
            className={`p-4 rounded-xl text-sm font-medium ${
              msg.startsWith('✅')
                ? 'bg-green-900/40 text-green-300 border border-green-800/40'
                : msg.startsWith('ℹ️') || msg.startsWith('⏳')
                ? 'bg-blue-900/40 text-blue-300 border border-blue-800/40'
                : 'bg-red-900/40 text-red-300 border border-red-800/40'
            }`}
          >
            {msg}
          </div>
        )}
      </div>
    </main>
  );
}
