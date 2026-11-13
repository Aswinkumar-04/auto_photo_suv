'use client';

import { useState, useEffect } from 'react';

type Status = {
  folderUrl: string | null;
  lastSync: string | null;
  photoCount: number;
};

export default function DashboardPage() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [status, setStatus] = useState<Status | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    const res = await fetch('/api/status');
    const data = await res.json();
    setStatus(data);
    if (data.folderUrl) setFolderInput(data.folderUrl);
  };

  useEffect(() => {
    if (loggedIn) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 15_000);
      return () => clearInterval(interval);
    }
  }, [loggedIn]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple client-side check — real validation happens on API calls
    if (password.trim()) {
      setLoggedIn(true);
      setAuthError('');
    } else {
      setAuthError('Please enter the admin password');
    }
  };

  const handleSetFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderUrl: folderInput, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg('✅ ' + data.message);
      fetchStatus();
    } else {
      setMsg('❌ ' + (data.error ?? 'Error'));
      if (res.status === 401) setLoggedIn(false);
    }
    setLoading(false);
  };

  const handleClear = async () => {
    if (!confirm('Clear ALL photos from the database? This cannot be undone.')) return;
    setLoading(true);
    setMsg('');
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
    setLoading(false);
  };

  // ── Login Screen ──────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 w-full max-w-sm space-y-4"
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
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3 rounded-xl"
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

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-purple-300">📊 Admin Dashboard</h1>
          <a href="/" className="text-sm text-gray-400 hover:text-white">Guest Page →</a>
        </div>

        {/* Stats Card */}
        {status && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-400 text-sm">Photos indexed</p>
              <p className="text-4xl font-bold text-white">{status.photoCount}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Last sync</p>
              <p className="text-sm text-gray-200 mt-1">
                {status.lastSync
                  ? new Date(status.lastSync).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            {status.folderUrl && (
              <div className="col-span-2">
                <p className="text-gray-400 text-sm">Current folder</p>
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

        {/* Set Drive Folder */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-white">📁 Set Google Drive Folder</h2>
          <p className="text-gray-400 text-sm">
            Paste the Google Drive folder link. Photos will be indexed automatically within 1 minute.
            <br />
            <strong className="text-yellow-300">⚠️ Setting a NEW folder will erase all previous photos.</strong>
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
              disabled={loading || !folderInput}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
            >
              {loading ? 'Saving…' : '💾 Save Folder & Start Sync'}
            </button>
          </form>
        </div>

        {/* Clear Photos */}
        <div className="bg-red-950/40 border border-red-800/40 rounded-2xl p-6 space-y-3">
          <h2 className="text-xl font-semibold text-red-300">🗑️ Clear All Photos</h2>
          <p className="text-gray-400 text-sm">
            Removes all photos and face data from the database. Use this to start a fresh event.
          </p>
          <button
            onClick={handleClear}
            disabled={loading}
            className="bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-xl transition-colors"
          >
            {loading ? 'Clearing…' : '🗑️ Clear All Photos'}
          </button>
        </div>

        {/* Message */}
        {msg && (
          <div className={`p-4 rounded-xl text-sm font-medium ${msg.startsWith('✅') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
            {msg}
          </div>
        )}

        {/* QR Code Hint */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-2">
          <h2 className="text-lg font-semibold text-gray-300">📱 Guest QR Code</h2>
          <p className="text-gray-400 text-sm">Share your Vercel app URL with guests:</p>
          <p className="text-purple-300 font-mono text-sm break-all">
            {process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-app.vercel.app'}
          </p>
          <p className="text-gray-500 text-xs">
            Guests open this URL, tap "Take a Selfie", and find their photos instantly.
          </p>
        </div>
      </div>
    </main>
  );
}

