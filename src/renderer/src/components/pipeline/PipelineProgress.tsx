/**
 * Pipeline Progress Display
 *
 * Shows real-time progress of the AI image production pipeline.
 * Displays stage-by-stage progress, scene status, and timing information.
 */

import React from 'react';
import type { PipelineProgress, PipelineStageName } from '../../services/ai/pipeline/PipelineTypes';

interface PipelineProgressProps {
  progress: PipelineProgress | null;
  onCancel?: () => void;
}

const STAGE_LABELS: Record<PipelineStageName, string> = {
  BACKGROUND: 'Backgrounds',
  PERSON: 'Characters',
  POSE: 'Pose Control',
  SEGMENT: 'Segmentation',
  COMPOSITE: 'Compositing',
  QUALITY: 'Quality Check',
  UPSCALE: 'Upscaling',
};

const STAGE_ICONS: Record<PipelineStageName, string> = {
  BACKGROUND: 'BG',
  PERSON: 'PR',
  POSE: 'PO',
  SEGMENT: 'SG',
  COMPOSITE: 'CP',
  QUALITY: 'QC',
  UPSCALE: 'UP',
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function PipelineProgressDisplay({ progress, onCancel }: PipelineProgressProps) {
  if (!progress) return null;

  const stages: PipelineStageName[] = [
    'BACKGROUND', 'PERSON', 'POSE', 'SEGMENT', 'COMPOSITE', 'QUALITY', 'UPSCALE',
  ];

  return (
    <div className="bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-lg p-4 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-sm font-medium text-slate-200">
            Generating Documentary Images
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {progress.completedScenes}/{progress.totalScenes}
          </span>
          {progress.elapsedTime > 0 && (
            <span className="text-xs text-slate-500">
              {formatTime(progress.elapsedTime)}
            </span>
          )}
          {onCancel && progress.pipelineStatus === 'running' && (
            <button
              onClick={onCancel}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div className="w-full bg-slate-700 rounded-full h-2 mb-4">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress.overallPercent}%` }}
        />
      </div>

      {/* Stage Progress */}
      <div className="space-y-2">
        {stages.map((stage) => {
          const sp = progress.stageProgress[stage];
          if (!sp || sp.total === 0) return null;

          const isActive = progress.currentStage === stage;
          const isComplete = sp.completed === sp.total && !sp.running;
          const hasFailed = sp.failed > 0;

          return (
            <div
              key={stage}
              className={`flex items-center gap-3 p-2 rounded ${
                isActive
                  ? 'bg-blue-500/10 border border-blue-500/30'
                  : 'bg-slate-700/30'
              }`}
            >
              {/* Stage Icon */}
              <div
                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-mono ${
                  isComplete
                    ? 'bg-green-500/20 text-green-400'
                    : hasFailed
                    ? 'bg-red-500/20 text-red-400'
                    : isActive
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-slate-600/50 text-slate-400'
                }`}
              >
                {STAGE_ICONS[stage]}
              </div>

              {/* Stage Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300">{STAGE_LABELS[stage]}</span>
                  <span className="text-xs text-slate-500">
                    {sp.completed}/{sp.total}
                    {sp.failed > 0 && (
                      <span className="text-red-400 ml-1">({sp.failed} failed)</span>
                    )}
                  </span>
                </div>
                {sp.total > 0 && (
                  <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                    <div
                      className={`h-1 rounded-full transition-all duration-300 ${
                        isComplete
                          ? 'bg-green-500'
                          : hasFailed
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                      }`}
                      style={{
                        width: `${Math.round((sp.completed / sp.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Scene Detail */}
      {progress.activeSceneId && (
        <div className="mt-3 text-xs text-slate-400 truncate">
          {progress.activeSceneDetail || `Scene ${progress.activeSceneId}`}
        </div>
      )}

      {/* Estimated Time */}
      {progress.estimatedRemaining !== undefined && progress.estimatedRemaining > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          Estimated remaining: {formatTime(progress.estimatedRemaining)}
        </div>
      )}
    </div>
  );
}
