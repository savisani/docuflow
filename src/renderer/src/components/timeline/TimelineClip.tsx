import React from 'react';
import { Volume2 } from 'lucide-react';
import { AudioWaveform } from './AudioWaveform';

const PIXELS_PER_SECOND = 80;
const TRACK_HEIGHT = 32;

interface ClipData {
  id: string;
  start: number;
  end: number;
  label: string;
  layerId: string;
  commandId: string;
  zIndex: number;
  assetId?: string;
}

interface AssetData {
  id?: string;
  logicalId?: string;
  filename?: string;
  type?: string;
  url?: string;
  thumbnailUrl?: string;
  duration?: number;
}

interface DragVisualOffset {
  clipId: string;
  dx: number;
  dy: number;
}

interface DragState {
  clipId: string;
  mode: 'move' | 'resize-left' | 'resize-right';
  originalStart: number;
  originalDuration: number;
  maxDuration?: number;
}

interface TimelineClipProps {
  clip: ClipData;
  trackType: string;
  trackColor: string;
  zoom: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  asset?: AssetData;
  dragVisualOffset: DragVisualOffset | null;
  dragState: DragState | null;
  showWaveforms: boolean;
  onMouseDown: (e: React.MouseEvent, clip: ClipData, trackType: string, mode: 'move' | 'resize-left' | 'resize-right') => void;
}

const MIN_DURATION = 0.2;

export const TimelineClip: React.FC<TimelineClipProps> = React.memo(({
  clip,
  trackType,
  trackColor,
  zoom,
  isSelected,
  isMultiSelected,
  asset,
  dragVisualOffset,
  dragState,
  showWaveforms,
  onMouseDown,
}) => {
  const left = clip.start * PIXELS_PER_SECOND * zoom;
  const width = Math.max((clip.end - clip.start) * PIXELS_PER_SECOND * zoom, 4);
  const displayName = asset?.filename || clip.label || 'Untitled';
  const isImage = asset?.type === 'image';
  const isAudio = asset?.type === 'audio';

  const isDragTarget = dragVisualOffset && dragVisualOffset.clipId === clip.commandId;
  const dragDx = isDragTarget ? dragVisualOffset!.dx : 0;
  const dragDy = isDragTarget ? dragVisualOffset!.dy : 0;
  const dragDt = dragDx / (PIXELS_PER_SECOND * zoom);
  let visualLeft = left;
  let visualWidth = width;

  if (isDragTarget && dragState) {
    if (dragState.mode === 'resize-right') {
      const rawEnd = dragState.originalStart + dragState.originalDuration + dragDt;
      const maxEnd = dragState.maxDuration != null ? dragState.originalStart + dragState.maxDuration : Infinity;
      const newEnd = Math.max(dragState.originalStart + MIN_DURATION, Math.min(rawEnd, maxEnd));
      visualWidth = Math.max(4, (newEnd - dragState.originalStart) * PIXELS_PER_SECOND * zoom);
    } else if (dragState.mode === 'resize-left') {
      const rawStart = dragState.originalStart + dragDt;
      const newStart = Math.max(0, rawStart);
      const deltaStart = newStart - dragState.originalStart;
      const newDuration = Math.max(MIN_DURATION, dragState.originalDuration - deltaStart);
      visualLeft = newStart * PIXELS_PER_SECOND * zoom;
      visualWidth = Math.max(4, newDuration * PIXELS_PER_SECOND * zoom);
    }
  }

  const clipStyle: React.CSSProperties = isDragTarget && dragState?.mode === 'move'
    ? {
        left,
        width,
        backgroundColor: trackColor + 'dd',
        color: 'white',
        borderLeftWidth: '3px',
        borderLeftColor: trackColor,
        transform: `translate(${dragDx}px, ${dragDy}px)`,
        zIndex: 50,
        opacity: 0.9,
      }
    : isDragTarget
    ? {
        left: visualLeft,
        width: visualWidth,
        backgroundColor: trackColor + 'dd',
        color: 'white',
        borderLeftWidth: '3px',
        borderLeftColor: trackColor,
        zIndex: 50,
        opacity: 0.9,
      }
    : {
        left,
        width,
        backgroundColor: trackColor + 'dd',
        color: 'white',
        borderLeftWidth: '3px',
        borderLeftColor: trackColor,
      };

  // Hide clip in its original position when it's being dragged (rendered in overlay instead)
  const isBeingDragged = isDragTarget && dragState?.mode === 'move';

  return (
    <div
      className={`
        absolute top-0.5 bottom-0.5 rounded-df-sm flex items-center overflow-hidden cursor-grab active:cursor-grabbing
        border border-df-border
        ${isSelected
          ? 'ring-2 ring-df-accent/60 ring-offset-1 ring-offset-df-surface-1 z-10 border-df-accent/40'
          : isMultiSelected
          ? 'ring-1 ring-df-accent/40 border-df-accent/30'
          : 'hover:border-df-border-strong hover:brightness-110'}
        ${isBeingDragged ? 'invisible' : ''}
      `}
      style={clipStyle}
      onMouseDown={(e) => onMouseDown(e, clip, trackType, 'move')}
    >
      {isAudio && showWaveforms && width > 30 && (
        <AudioWaveform assetId={asset?.id} width={width} height={TRACK_HEIGHT - 4} />
      )}
      {(isImage || asset?.type === 'video') && (asset?.thumbnailUrl || asset?.url) && width > 40 && (
        <div
          className="h-full bg-cover bg-center shrink-0 opacity-60"
          style={{ backgroundImage: `url(${asset.thumbnailUrl || asset.url})`, width: Math.min(width * 0.3, 48) }}
        />
      )}
      {isAudio && width > 30 && (
        <div className="w-4 h-4 shrink-0 flex items-center justify-center opacity-70">
          <Volume2 size={10} />
        </div>
      )}
      <div className="flex-1 px-1 min-w-0 overflow-hidden">
        <span className="text-df-xs leading-none truncate block whitespace-nowrap">{displayName}</span>
      </div>
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30 z-20"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, clip, trackType, 'resize-left'); }}
      >
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/40 rounded-full" />
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30 z-20"
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, clip, trackType, 'resize-right'); }}
      >
        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/40 rounded-full" />
      </div>
    </div>
  );
});

TimelineClip.displayName = 'TimelineClip';
