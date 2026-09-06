import React, { useRef, useState, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { JobManager } from '../../../../core/jobs/JobManager';
import { WorkerManager } from '../../workers/core/workerManager';
import type { ExtractPeaksResult } from '../../workers/core/types';

export const AudioWaveform: React.FC<{
  assetId: string | undefined;
  width: number;
  height: number;
}> = ({ assetId, width, height }) => {
  const assets = useDocuFlowStore((s) => s.assets);
  const asset = assetId ? assets.find((a) => a.id === assetId) : null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const jobManagerRef = useRef<JobManager>(new JobManager());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset?.url || width <= 0) return;

    const jobManager = jobManagerRef.current;
    let cancelled = false;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    const job = jobManager.run<ExtractPeaksResult>({
      type: 'extract-peaks',
      execute: async ({ signal, reportProgress }: { signal: AbortSignal; reportProgress: (p: number) => void }) => {
        reportProgress(0);

        const response = await fetch(asset.url!);
        const arrayBuffer = await response.arrayBuffer();
        if (signal.aborted) throw new Error('Cancelled');

        reportProgress(0.2);
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (signal.aborted) throw new Error('Cancelled');

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
      if (cancelled) { audioContext.close(); return; }

      const ctx = canvas.getContext('2d');
      if (!ctx) { audioContext.close(); return; }

      canvas.width = width;
      canvas.height = height;
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

      audioContext.close();
      setReady(true);
    }).catch(() => {
      audioContext.close();
    });

    return () => {
      cancelled = true;
      job.cancel();
      audioContext.close();
    };
  }, [asset?.url, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height, opacity: ready ? 1 : 0, transition: 'opacity 0.2s' }}
    />
  );
};
