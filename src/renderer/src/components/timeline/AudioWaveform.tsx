import React, { useRef, useState, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { JobManager } from '../../../../core/jobs/JobManager';
import { WorkerManager } from '../../workers/core/workerManager';
import type { ExtractPeaksResult } from '../../workers/core/types';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function loadAudioData(asset: { url?: string; filePath?: string }): Promise<ArrayBuffer> {
  if (asset.filePath && window.docuflow?.readFileBuffer) {
    const result = await window.docuflow.readFileBuffer(asset.filePath);
    if (result.success && result.base64) {
      return base64ToArrayBuffer(result.base64);
    }
  }
  if (asset.url) {
    const response = await fetch(asset.url);
    return response.arrayBuffer();
  }
  throw new Error('No file path or URL available for audio asset');
}

const audioBufferCache = new Map<string, AudioBuffer>();

export const AudioWaveform: React.FC<{
  assetId: string | undefined;
  width: number;
  height: number;
}> = ({ assetId, width, height }) => {
  const asset = useDocuFlowStore((s) => assetId ? s.assets.find((a) => a.id === assetId) : null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const jobManagerRef = useRef<JobManager>(new JobManager());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset || width <= 0) return;

    const cacheKey = asset.filePath || asset.url || '';
    if (audioBufferCache.has(cacheKey)) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cached = audioBufferCache.get(cacheKey)!;
      drawWaveform(ctx, cached, width, height);
      setReady(true);
      return;
    }

    const jobManager = jobManagerRef.current;
    let cancelled = false;
    let audioContext: AudioContext | null = null;

    const job = jobManager.run<ExtractPeaksResult>({
      type: 'extract-peaks',
      execute: async ({ signal, reportProgress }: { signal: AbortSignal; reportProgress: (p: number) => void }) => {
        reportProgress(0);

        const arrayBuffer = await loadAudioData(asset);
        if (signal.aborted) throw new Error('Cancelled');

        reportProgress(0.2);
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (signal.aborted) throw new Error('Cancelled');

        if (cacheKey) {
          audioBufferCache.set(cacheKey, audioBuffer);
        }

        reportProgress(0.4);
        const channelData = audioBuffer.getChannelData(0);
        const numBars = Math.max(1, Math.floor(width / 3));
        const channelDataCopy = new Float32Array(channelData);

        const workerManager = new WorkerManager(
          new URL('../../workers/audio/audio.worker.ts', import.meta.url)
        );

        try {
          const result = await workerManager.run<{ channelData: Float32Array; numBars: number }, ExtractPeaksResult>({
            type: 'extract-peaks',
            payload: { channelData: channelDataCopy, numBars },
            transfer: [channelDataCopy.buffer],
          }).promise;

          reportProgress(0.9);
          return result;
        } finally {
          workerManager.terminate();
        }
      },
    });

    job.promise.then((result: ExtractPeaksResult) => {
      if (cancelled) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      drawWaveform(ctx, result, width, height);
      setReady(true);
    }).catch(() => {
      // silently ignore waveform errors
    });

    return () => {
      cancelled = true;
      job.cancel();
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }
    };
  }, [asset?.filePath, asset?.url, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height, opacity: ready ? 1 : 0, transition: 'opacity 0.2s' }}
    />
  );
};

function drawWaveform(ctx: CanvasRenderingContext2D, result: ExtractPeaksResult, width: number, height: number): void {
  ctx.canvas.width = width;
  ctx.canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  const numBars = Math.max(1, Math.floor(width / 3));
  const barW = Math.max(1, width / numBars - 1);
  const midY = height / 2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let i = 0; i < numBars; i++) {
    const amp = result.peaks[i] / result.peakMax;
    const barH = Math.max(1, amp * height * 0.85);
    const x = i * (barW + 1);
    ctx.fillRect(x, midY - barH / 2, barW, barH);
  }
}
