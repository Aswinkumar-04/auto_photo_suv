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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

        console.log('Loading face-api neural net weights...');
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);

        if (mounted) {
          console.log('Face models loaded successfully!');
          setModelsReady(true);
          setState('ready');
        }
      } catch (err: unknown) {
        console.error('Model load error:', err);
        if (mounted) {
          setErrorMsg('Could not load face recognition models. Please refresh the page.');
          setState('error');
        }
      }
    }

    initFaceApi();
    return () => { mounted = false; };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg('Camera is not supported on this browser or requires HTTPS. Please use "Upload from Gallery" below.');
      setState('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setState('capturing');
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      const errName = (err as Error)?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setErrorMsg('Camera permission denied. Please allow camera in browser settings or upload a photo.');
      } else {
        setErrorMsg('Unable to open camera. Please use photo upload or check camera permissions.');
      }
      setState('error');
    }
  }, []);

  // Ensure stream connects to the video element as soon as it mounts into DOM
  useEffect(() => {
    if (state === 'capturing' && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.onloadedmetadata = () => {
        video.play().catch((e) => console.error('Video play error:', e));
      };
    }
  }, [state]);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Process face embedding and fetch matches
  const processFaceAndSearch = async (imageSource: HTMLCanvasElement | HTMLImageElement) => {
    const faceapi = faceapiRef.current;
    if (!faceapi) {
      setErrorMsg('Face recognition is still loading. Please try again.');
      setState('error');
      return;
    }

    setState('processing');
    stopCamera();

    try {
      // Detect single face with forgiving 0.3 confidence score for diverse lighting
      const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      const detection = await faceapi
        .detectSingleFace(imageSource, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        console.warn('No face detected in capture.');
        setState('no-face');
        return;
      }

      console.log('Face detected! Vector length:', detection.descriptor.length);
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
      console.error('Match search error:', err);
      setErrorMsg('Something went wrong searching for your photos. Please try again.');
      setState('error');
    }
  };

  const captureCamera = useCallback(async () => {
    if (!modelsReady) {
      setErrorMsg('AI models are still initializing. Please wait a few seconds and try again.');
      return;
    }
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    await processFaceAndSearch(canvas);
  }, [modelsReady]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!modelsReady) {
      setErrorMsg('AI models are still initializing. Please wait a few seconds and try again.');
      return;
    }

    const img = new Image();
    img.onload = async () => {
      await processFaceAndSearch(img);
    };
    img.src = URL.createObjectURL(file);
  };

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
        <h1 className="text-4xl font-extrabold bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
          📸 SUV Photo Gallery
        </h1>
        <p className="text-gray-300 mt-2 text-sm sm:text-base">
          Find all your event moments instantly with private on-device facial search
        </p>
      </div>

      {/* Loading Models */}
      {state === 'loading-models' && (
        <div className="flex flex-col items-center gap-4 mt-16">
          <div className="w-14 h-14 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-300 text-sm">Initializing face AI in your browser…</p>
        </div>
      )}

      {/* Ready — Choose Selfie Camera or Upload */}
      {state === 'ready' && (
        <div className="flex flex-col items-center gap-6 mt-8 max-w-sm w-full bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur shadow-2xl">
          <div className="text-7xl">🤳</div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-bold text-white">Find Your Photos</h2>
            <p className="text-gray-400 text-xs">
              Your photo is processed 100% on your device and is never stored on the server.
            </p>
          </div>

          <button
            onClick={startCamera}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <span>📷</span> Take a Selfie
          </button>

          <div className="flex items-center gap-3 w-full">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-gray-500 text-xs">OR</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-white/10 hover:bg-white/15 text-white font-medium py-3 px-6 rounded-2xl border border-white/15 transition flex items-center justify-center gap-2 text-sm active:scale-95"
          >
            <span>🖼️</span> Upload from Gallery
          </button>
        </div>
      )}

      {/* Camera viewfinder */}
      {state === 'capturing' && (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <div className="relative rounded-3xl overflow-hidden border-4 border-purple-500/70 shadow-2xl w-full aspect-[3/4] bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Guide oval */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-64 border-2 border-dashed border-yellow-300 rounded-full opacity-70" />
            </div>
          </div>
          <p className="text-yellow-300 text-xs font-medium">Position your face inside the guide</p>
          <div className="flex items-center gap-5">
            <button
              onClick={captureCamera}
              className="w-20 h-20 bg-white rounded-full border-4 border-purple-500 shadow-2xl flex items-center justify-center text-4xl hover:scale-105 active:scale-90 transition-transform cursor-pointer"
              title="Snap Photo"
            >
              📸
            </button>
            <button
              onClick={reset}
              className="text-xs bg-white/10 hover:bg-white/20 px-4 py-2.5 rounded-full text-gray-300 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Processing spinner */}
      {state === 'processing' && (
        <div className="flex flex-col items-center gap-4 mt-16">
          <div className="w-14 h-14 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-200 text-sm">Matching your face against event photos…</p>
        </div>
      )}

      {/* No face detected */}
      {state === 'no-face' && (
        <div className="flex flex-col items-center gap-4 mt-12 text-center max-w-xs">
          <div className="text-6xl">😶</div>
          <h3 className="text-yellow-300 text-lg font-bold">No Face Detected</h3>
          <p className="text-gray-400 text-xs">
            Please make sure your face is clearly lit and looking at the camera, then try again.
          </p>
          <button
            onClick={reset}
            className="bg-purple-700 hover:bg-purple-600 text-white py-2.5 px-6 rounded-full text-sm font-medium transition"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-4 mt-12 text-center max-w-xs">
          <div className="text-5xl">⚠️</div>
          <p className="text-red-400 text-sm">{errorMsg}</p>
          <button
            onClick={reset}
            className="bg-purple-700 hover:bg-purple-600 text-white py-2.5 px-6 rounded-full text-sm font-medium transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results Grid */}
      {state === 'results' && (
        <div className="w-full max-w-5xl">
          <div className="flex items-center justify-between mb-6 bg-white/5 border border-white/10 p-4 rounded-2xl">
            <div>
              <h2 className="text-xl font-bold text-white">
                {photos.length > 0
                  ? `🎉 Found ${photos.length} Photo${photos.length > 1 ? 's' : ''}`
                  : '😕 No Matched Photos'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {photos.length > 0
                  ? 'Click any photo to view full resolution or download'
                  : 'No event photos matched your face. Try another selfie with clearer lighting or check back once photos are indexed!'}
              </p>
            </div>
            <button
              onClick={reset}
              className="text-xs font-semibold bg-purple-600 hover:bg-purple-500 py-2 px-4 rounded-xl transition"
            >
              🔄 New Search
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {photos.map((photo) => (
              <div
                key={photo.drive_file_id}
                className="group relative rounded-2xl overflow-hidden bg-white/5 border border-white/10 shadow-md hover:shadow-purple-500/20 transition-all"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbnail_url}
                  alt={photo.name}
                  className="w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                  <p className="text-white text-xs truncate font-medium">{photo.name}</p>
                  <div className="flex gap-2">
                    <a
                      href={photo.view_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs py-1.5 rounded-lg text-center font-medium"
                    >
                      👁️ View
                    </a>
                    <a
                      href={photo.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-green-700 hover:bg-green-600 text-white text-xs py-1.5 rounded-lg text-center font-medium"
                    >
                      ⬇️ Save
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer / Admin Link */}
      <footer className="mt-auto pt-16 text-center text-xs text-gray-500">
        <a href="/dashboard" className="hover:text-gray-300 transition underline underline-offset-4">
          Host Admin Dashboard
        </a>
      </footer>
    </main>
  );
}
