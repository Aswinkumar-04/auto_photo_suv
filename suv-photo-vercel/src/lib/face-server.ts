import * as faceapi from '@vladmandic/face-api';
import * as canvas from 'canvas';
import { join } from 'path';

// Point face-api at Node.js canvas implementation (for server-side use)
// @ts-ignore
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as never);

let modelsLoaded = false;

async function ensureModels() {
  if (modelsLoaded) return;
  const modelPath = join(process.cwd(), 'public', 'models');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  modelsLoaded = true;
}

/**
 * Extract 128D face embeddings from an image buffer.
 * Returns one embedding per face detected (most photos have 1–5 faces).
 */
export async function extractEmbeddings(imageBuffer: Buffer): Promise<number[][]> {
  await ensureModels();

  const img = await canvas.loadImage(imageBuffer);
  // @ts-ignore
  const detections = await faceapi
    .detectAllFaces(img as never)
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map((d) => Array.from(d.descriptor));
}

