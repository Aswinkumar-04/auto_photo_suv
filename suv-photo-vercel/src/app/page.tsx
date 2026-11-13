'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

type Photo = {
  drive_file_id: string;
  name: string;
  thumbnail_url: string;
  view_url: string;
  download_url: string;
  distance: number;
};

type AppState = 'idle' | 'loading-models' | 'ready' | 'capturing' | 'processing' | 'results' | 'no-face' | 'error';

export default function GuestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceapiRef = useRef<any>(null);

  const [state, setState] = useState<AppState>('idle');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [modelsReady, setModelsReady] = useState(false);

  // Dynamically load face-api in browser only (bypasses SSR)
  useEffect(() => {
    let mounted = true;
    setState('loading-models');

    async function initFaceApi() {
      try {
        const faceapi = await import('@vladmandic/face-api');
        if (!mounted) return;
        faceapiRef.current = faceapi;

        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);

        if (mounted) {
          setModelsReady(true);
          setState('ready');
        }
      } catch (err) {
        console.error('Model load error:', err);
        if (mounted) {
          setErrorMsg('Could not load face recognition models. Please reload.');
          setState('error');
        }
      }
    }

    initFaceApi();
    return () => { mounted = false; };
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('capturing');
    } catch (err) {
      setErrorMsg('Camera access denied. Please allow camera and reload.');
      setState('error');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const capture = useCallback(async () => {
    const faceapi = faceapiRef.current;
    if (!videoRef.current || !canvasRef.current || !modelsReady || !faceapi) return;

    setState('processing');
    stopCamera();

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    try {
      // Detect face & extract 128D descriptor — runs entirely in browser
      const detection = await faceapi
        .detectSingleFace(canvas)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setState('no-face');
        return;
      }

      const embedding = Array.from(detection.descriptor);

      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding }),
      });

      const data = await res.json();
      setPhotos(data.matches ?? []);
      setState('results');
    } catch (err) {
      console.error(err);
      setErrorMsg('Something went wrong. Please try again.');
      setState('error');
    }
  }, [modelsReady, stopCamera]);

  const reset = useCallback(() => {
    stopCamera();
    setPhotos([]);
    setErrorMsg('');
    setState('ready');
  }, [stopCamera]);

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          📸 SUV Photo Gallery
        </h1>
        <p className="text-gray-400 mt-2">Take a selfie — find your event photos instantly</p>
      </div>

      {/* Loading Models */}
      {state === 'loading-models' && (
        <div className="flex flex-col items-center gap-4 mt-16">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-300">Loading face recognition models…</p>
        </div>
      )}

      {/* Ready — show Take Selfie button */}
      {state === 'ready' && (
        <div className="flex flex-col items-center gap-6 mt-12">
          <div className="text-8xl">🤳</div>
          <p className="text-gray-300 text-center max-w-xs">
            Your selfie is processed <strong>only in your browser</strong> and never uploaded to any server.
          </p>
          <button
            onClick={startCamera}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-4 px-10 rounded-full text-lg shadow-lg transition-all"
          >
            📷 Take a Selfie
          </button>
        </div>
      )}

      {/* Camera viewfinder */}
      {state === 'capturing' && (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <div className="relative rounded-2xl overflow-hidden border-4 border-purple-500 shadow-2xl w-full">
            <video
              ref={videoRef}
              className="w-full object-cover"
              playsInline
              muted
            />
            {/* Face guide oval */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-60 border-4 border-yellow-400 rounded-full opacity-60" />
            </div>
          </div>
          <p className="text-yellow-300 text-sm">Centre your face in the oval</p>
          <button
            onClick={capture}
            className="w-20 h-20 bg-white rounded-full border-4 border-purple-500 shadow-xl flex items-center justify-center text-3xl hover:scale-105 transition-transform"
          >
            📸
          </button>
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Processing spinner */}
      {state === 'processing' && (
        <div className="flex flex-col items-center gap-4 mt-16">
          <div className="w-16 h-16 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-300">Analysing your face & searching photos…</p>
        </div>
      )}

      {/* No face detected */}
      {state === 'no-face' && (
        <div className="flex flex-col items-center gap-6 mt-12 text-center">
          <div className="text-6xl">😶</div>
          <p className="text-yellow-300 text-lg">No face detected!</p>
          <p className="text-gray-400 max-w-xs">Make sure your face is clearly visible and well-lit.</p>
          <button onClick={reset} className="bg-purple-700 hover:bg-purple-600 text-white py-3 px-8 rounded-full">
            Try Again
          </button>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-6 mt-12 text-center">
          <div className="text-6xl">❌</div>
          <p className="text-red-400">{errorMsg}</p>
          <button onClick={reset} className="bg-purple-700 hover:bg-purple-600 text-white py-3 px-8 rounded-full">
            Retry
          </button>
        </div>
      )}

      {/* Results */}
      {state === 'results' && (
        <div className="w-full max-w-4xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-purple-300">
              {photos.length > 0
                ? `🎉 Found ${photos.length} photo${photos.length > 1 ? 's' : ''}!`
                : '😕 No photos found'}
            </h2>
            <button
              onClick={reset}
              className="text-sm bg-white/10 hover:bg-white/20 py-2 px-5 rounded-full"
            >
              New Search
            </button>
          </div>

          {photos.length === 0 && (
            <p className="text-gray-400 text-center mt-8">
              Your face wasn't matched in the event photos. Try retaking your selfie in better lighting.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {photos.map((photo) => (
              <div
                key={photo.drive_file_id}
                className="relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-purple-400 transition-all"
              >
                {/* Thumbnail — streamed directly from Google Drive */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbnail_url}
                  alt={photo.name}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                  <a
                    href={photo.view_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-purple-600 hover:bg-purple-500 text-white text-xs py-1.5 px-4 rounded-full w-full text-center"
                  >
                    👁️ View Full
                  </a>
                  <a
                    href={photo.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-green-700 hover:bg-green-600 text-white text-xs py-1.5 px-4 rounded-full w-full text-center"
                  >
                    ⬇️ Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin link at bottom */}
      <div className="mt-auto pt-16 text-center">
        <a href="/dashboard" className="text-gray-600 hover:text-gray-400 text-xs">
          Admin Dashboard
        </a>
      </div>
    </main>
  );
}

