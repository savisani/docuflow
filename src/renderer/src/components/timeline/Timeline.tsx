import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { formatTime } from '../../utils/format';
import { Play, Pause, Eye, EyeOff, Volume2, Type, Film, Magnet, Undo2, Redo2, Copy, Maximize2, ZoomIn, ZoomOut, Scissors, Trash2, Clipboard, ClipboardCopy, ClipboardX } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Panel, IconButton, Tooltip, Divider, Badge } from '../ui';
import { TimelineClip } from './TimelineClip';

const PIXELS_PER_SECOND = 80;
const TRACK_HEIGHT = 32;
const LABEL_WIDTH = 128;
const RULER_HEIGHT = 28;
const SNAP_THRESHOLD_PX = 5;
const MIN_DURATION = 0.2;
// Dynamic layer model: visible tracks are based on actual content.
// Hidden drop layers are computed on-the-fly during drag operations.

function hasOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && aStart + aDur > bStart;
}

function resolveCollision(
  commands: { id: string; start: number; duration: number; layer: number; type: string }[],
  candidate: { id: string; start: number; duration: number; layer: number; type: string }
): { start: number; layer: number } {
  if (candidate.type !== 'show') return { start: candidate.start, layer: candidate.layer };

  let start = candidate.start;
  let layer = candidate.layer;
  const dur = candidate.duration;

  for (let iter = 0; iter < 50; iter++) {
    const layerClips = commands
      .filter(c => c.id !== candidate.id && c.type === 'show' && c.layer === layer)
      .sort((a, b) => a.start - b.start);

    let pushed = false;
    for (const clip of layerClips) {
      if (hasOverlap(start, dur, clip.start, clip.duration)) {
        if (layer === candidate.layer) {
          // Same track: push forward
          start = clip.start + clip.duration;
          pushed = true;
          break;
        } else {
          // Different track: move up
          const maxZ = Math.max(...commands.map(c => c.layer), 0);
          layer = maxZ + 1;
          pushed = true;
          break;
        }
      }
    }
    if (!pushed) break;
  }

  return { start, layer };
}

interface PlaybackClockSample {
  time: number;
  frame: number;
  timestamp: number;
}

interface DragState {
  clipId: string;
  trackType: string;
  startX: number;
  startY: number;
  startPointerLocalY: number;
  originalStart: number;
  originalDuration: number;
  originalZIndex: number;
  originalTrackId: string | null;
  originalTrackTop: number;
  originalClipTop: number;
  grabOffsetY: number;
  mode: 'move' | 'resize-left' | 'resize-right';
  hasMoved: boolean;
  maxDuration?: number;
  offsetToCenterX: number;
}

export const Timeline: React.FC = () => {
  // Narrow selectors to prevent full rerenders on unrelated state changes
  const assets = useDocuFlowStore((s) => s.assets);
  const commands = useDocuFlowStore((s) => s.commands);
  const settings = useDocuFlowStore((s) => s.settings);
  const storeTimeline = useDocuFlowStore((s) => s.timeline);
  const currentTime = useDocuFlowStore((s) => s.currentTime);
  const playing = useDocuFlowStore((s) => s.playing);
  const setCurrentTime = useDocuFlowStore((s) => s.setCurrentTime);
  const selectedCommandId = useDocuFlowStore((s) => s.selectedCommandId);
  const selectCommand = useDocuFlowStore((s) => s.selectCommand);
  const updateCommand = useDocuFlowStore((s) => s.updateCommand);
  const addCommand = useDocuFlowStore((s) => s.addCommand);
  const removeCommand = useDocuFlowStore((s) => s.removeCommand);
  const trackVisibility = useDocuFlowStore((s) => s.trackVisibility);
  const setTrackVisibility = useDocuFlowStore((s) => s.setTrackVisibility);
  const hiddenAssetIds = useDocuFlowStore((s) => s.hiddenAssetIds);
  const snapEnabled = useDocuFlowStore((s) => s.snapEnabled);
  const setSnapEnabled = useDocuFlowStore((s) => s.setSnapEnabled);
  const undo = useDocuFlowStore((s) => s.undo);
  const redo = useDocuFlowStore((s) => s.redo);
  const duplicateCommand = useDocuFlowStore((s) => s.duplicateCommand);
  const voiceover = useDocuFlowStore((s) => s.voiceover);
  const transcript = useDocuFlowStore((s) => s.transcript);
  const history = useDocuFlowStore((s) => s.history);
  const historyIndex = useDocuFlowStore((s) => s.historyIndex);
  const beginBatch = useDocuFlowStore((s) => s.beginBatch);
  const endBatch = useDocuFlowStore((s) => s.endBatch);
  const selectedCommandIds = useDocuFlowStore((s) => s.selectedCommandIds);
  const toggleCommandSelection = useDocuFlowStore((s) => s.toggleCommandSelection);
  const setSelectedCommandIds = useDocuFlowStore((s) => s.setSelectedCommandIds);
  const splitCommandAtPlayhead = useDocuFlowStore((s) => s.splitCommandAtPlayhead);
  const deleteSelectedCommands = useDocuFlowStore((s) => s.deleteSelectedCommands);
  const copySelectedCommands = useDocuFlowStore((s) => s.copySelectedCommands);
  const cutSelectedCommands = useDocuFlowStore((s) => s.cutSelectedCommands);
  const pasteCommands = useDocuFlowStore((s) => s.pasteCommands);
  const selectAllCommands = useDocuFlowStore((s) => s.selectAllCommands);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const trackRowsRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTime, setDropTime] = useState<number | null>(null);
  const [showWaveforms, setShowWaveforms] = useState(false);
  const prevDragStateRef = useRef<DragState | null>(null);
  const playheadDragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [dragDestinationMessage, setDragDestinationMessage] = useState<string | null>(null);
  const dragDestinationMessageRef = useRef<string | null>(null);
  // Visual-only drag offset: pixels moved during drag, not committed to store yet
  const [dragVisualOffset, setDragVisualOffset] = useState<{ clipId: string; dx: number; dy: number } | null>(null);
  const dragVisualOffsetRef = useRef<{ clipId: string; dx: number; dy: number } | null>(null);
  // Marquee selection state
  const [marqueeActive, setMarqueeActive] = useState(false);
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marqueeOverlayRef = useRef<HTMLDivElement>(null);
  // Snap guide visual line position (ref to avoid re-renders during drag)
  const snapGuideXRef = useRef<number | null>(null);
  const snapGuideElementRef = useRef<HTMLDivElement>(null);
  // Pending drag state: stores mousedown info before threshold is crossed
  const pendingDragRef = useRef<{
    clipId: string;
    trackType: string;
    startX: number;
    startY: number;
    startPointerLocalY: number;
    originalStart: number;
    originalDuration: number;
    originalZIndex: number;
    originalTrackId: string | null;
    originalTrackTop: number;
    originalClipTop: number;
    grabOffsetY: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    maxDuration?: number;
    offsetToCenterX: number;
  } | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveTimeline = useMemo(() => {
    if (storeTimeline) return storeTimeline;
    if (commands.length > 0) {
      const voiceoverAsset = voiceover ? assets.find(a => a.id === voiceover.assetId) : undefined;
      return buildTimeline(commands, assets, settings, voiceoverAsset?.duration);
    }
    return null;
  }, [storeTimeline, commands, assets, settings, voiceover]);

  const voiceoverDuration = useMemo(() => {
    if (!voiceover) return 0;
    const asset = assets.find((a) => a.id === voiceover.assetId);
    return asset?.duration || 0;
  }, [voiceover, assets]);

  const fps = settings.fps;

  const maxEndTime = useMemo(() => {
    let max = 0;
    for (const cmd of commands) {
      if (cmd.id === '__placeholder__') continue;
      const dur = (cmd as any).duration;
      if (typeof dur === 'number' && dur > 0) {
        const end = cmd.start + dur;
        if (end > max) max = end;
      } else {
        if (cmd.start > max) max = cmd.start;
      }
    }
    return max;
  }, [commands]);

  const totalSeconds = useMemo(() => {
    const fromTimeline = effectiveTimeline
      ? effectiveTimeline.totalFrames / settings.fps
      : 0;
    return Math.max(fromTimeline, maxEndTime, voiceoverDuration);
  }, [effectiveTimeline, maxEndTime, voiceoverDuration, settings.fps]);

  const maxFrames = useMemo(() => {
    if (commands.length === 0) return 150;
    return Math.max(150, Math.ceil(maxEndTime * fps));
  }, [maxEndTime, fps, commands.length]);

  const hardStopRef = useRef(false);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playbackTimeRef = useRef(0);


  const scrollInnerWidth = useMemo(() => {
    const durationPixels = maxEndTime * PIXELS_PER_SECOND * zoom;
    return Math.max(containerWidth, durationPixels + 400);
  }, [containerWidth, maxEndTime, zoom]);

  const videoTracks = useMemo(() => {
    if (!effectiveTimeline) return [];
    // Only include layers with actual content — no empty phantom rows.
    // Hidden drop layers are computed dynamically during drag operations.
    return Object.values(effectiveTimeline.layers)
      .filter((l) => l.visible && !hiddenAssetIds.has(l.assetId))
      .sort((a, b) => b.zIndex - a.zIndex);
  }, [effectiveTimeline, hiddenAssetIds]);

  const trackLayerMap = useMemo(() => {
    // Direct map from populated video tracks: trackLayerMap[i] = zIndex of i-th visible track
    return videoTracks.map((t) => t.zIndex);
  }, [videoTracks]);

  const snap = useCallback(
    (t: number, excludeClipId?: string) => {
      if (!snapEnabled) return Math.max(0, t);
      const snapThreshold = SNAP_THRESHOLD_PX / (PIXELS_PER_SECOND * zoom);
      const frameDuration = 1 / fps;
      const snapPoints: number[] = [];

      snapPoints.push(Math.round(t / frameDuration) * frameDuration);
      snapPoints.push(currentTime);

      for (const cmd of commands) {
        if (excludeClipId && cmd.id === excludeClipId) continue;
        if (cmd.id === '__placeholder__') continue;
        snapPoints.push(cmd.start);
        if ('duration' in cmd && (cmd as any).duration) {
          snapPoints.push(cmd.start + (cmd as any).duration);
        }
      }

      let closest = t;
      let minDist = snapThreshold;
      for (const point of snapPoints) {
        const dist = Math.abs(t - point);
        if (dist < minDist) {
          minDist = dist;
          closest = point;
        }
      }
      return Math.max(0, closest);
    },
    [snapEnabled, fps, currentTime, commands, zoom]
  );

  const seekToPosition = useCallback(
    (clientX: number, container: HTMLElement) => {
      const rect = container.getBoundingClientRect();
      const scrollLeft = scrollContainerRef.current?.scrollLeft ?? 0;
      const x = clientX - rect.left + scrollLeft - LABEL_WIDTH;
      const time = x / (PIXELS_PER_SECOND * zoom);
      const clamped = Math.max(0, Math.min(time, maxEndTime || totalSeconds));
      const snapped = snap(clamped);
      setCurrentTime(snapped);
      const frame = Math.round(snapped * fps);
      window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
    },
    [zoom, maxEndTime, totalSeconds, setCurrentTime, fps, snap]
  );

  const handleTimelineBodyClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragState || isDraggingPlayhead) return;
      seekToPosition(e.clientX, e.currentTarget);
    },
    [dragState, isDraggingPlayhead, seekToPosition]
  );

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      playheadDragRef.current = { startX: e.clientX, startTime: currentTime };
      setIsDraggingPlayhead(true);
    },
    [currentTime]
  );

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    let rafId: number | null = null;
    let lastMouseEvent: MouseEvent | null = null;

    const processMove = () => {
      const drag = playheadDragRef.current;
      const e = lastMouseEvent;
      if (!drag || !e) { rafId = null; return; }
      const dx = e.clientX - drag.startX;
      const dt = dx / (PIXELS_PER_SECOND * zoom);
      const newTime = Math.max(0, Math.min(drag.startTime + dt, maxEndTime || totalSeconds));
      const snapped = snap(newTime);
      setCurrentTime(snapped);
      const frame = Math.round(snapped * fps);
      window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
      rafId = null;
    };

    const onMove = (e: MouseEvent) => {
      lastMouseEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(processMove);
      }
    };

    const onUp = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      playheadDragRef.current = null;
      setIsDraggingPlayhead(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isDraggingPlayhead, zoom, maxEndTime, totalSeconds, setCurrentTime, fps, snap]);

  const handlePlayPause = useCallback(() => {
    window.dispatchEvent(new CustomEvent('docuflow:toggle-play'));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
        return;
      }

      // Frame stepping
      if (e.code === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const frameDuration = 1 / fps;
        const newTime = Math.max(0, currentTime - frameDuration);
        setCurrentTime(newTime);
        const frame = Math.round(newTime * fps);
        window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
        return;
      }
      if (e.code === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const frameDuration = 1 / fps;
        const newTime = Math.min(maxEndTime || totalSeconds, currentTime + frameDuration);
        setCurrentTime(newTime);
        const frame = Math.round(newTime * fps);
        window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
        return;
      }

      // Previous/Next clip boundary
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        const sortedCmds = [...commands].filter(c => c.id !== '__placeholder__').sort((a, b) => a.start - b.start);
        const prev = [...sortedCmds].reverse().find(c => c.start < currentTime - 0.001);
        if (prev) {
          setCurrentTime(prev.start);
          const frame = Math.round(prev.start * fps);
          window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
        }
        return;
      }
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        const sortedCmds = [...commands].filter(c => c.id !== '__placeholder__').sort((a, b) => a.start - b.start);
        const next = sortedCmds.find(c => c.start > currentTime + 0.001);
        if (next) {
          setCurrentTime(next.start);
          const frame = Math.round(next.start * fps);
          window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
        }
        return;
      }

      // Undo/Redo
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        redo();
        return;
      }

      // Split at playhead
      if (e.code === 'KeyB' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedCommandId) splitCommandAtPlayhead(selectedCommandId);
        return;
      }

      // Delete
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        deleteSelectedCommands();
        return;
      }

      // Duplicate
      if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedCommandId) duplicateCommand(selectedCommandId);
        return;
      }

      // Copy
      if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        copySelectedCommands();
        return;
      }

      // Cut
      if (e.code === 'KeyX' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        cutSelectedCommands();
        return;
      }

      // Paste
      if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pasteCommands();
        return;
      }

      // Select all
      if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAllCommands();
        return;
      }

      // Deselect
      if (e.code === 'Escape') {
        e.preventDefault();
        selectCommand(null);
        setSelectedCommandIds([]);
        return;
      }

      // Zoom
      if (e.code === 'Equal' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom((z) => Math.min(8, z * 1.25));
        return;
      }
      if (e.code === 'Minus' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom((z) => Math.max(0.25, z * 0.8));
        return;
      }
      if (e.code === 'Digit0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom(1);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, selectedCommandId, undo, redo, duplicateCommand, splitCommandAtPlayhead, deleteSelectedCommands, copySelectedCommands, cutSelectedCommands, pasteCommands, selectAllCommands, selectCommand, setSelectedCommandIds, currentTime, fps, maxEndTime, totalSeconds, setCurrentTime, commands]);

  useEffect(() => {
    if (!playing || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const playheadX = LABEL_WIDTH + currentTime * PIXELS_PER_SECOND * zoom;
    const containerWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;
    const visibleLeft = scrollLeft;
    const visibleRight = scrollLeft + containerWidth;

    const margin = 100;
    if (playheadX < visibleLeft + margin || playheadX > visibleRight - margin) {
      const target = Math.max(0, playheadX - containerWidth / 2);
      container.scrollTo({ left: target, behavior: 'smooth' });
    }
  }, [currentTime, playing, zoom]);

  // Lightweight playhead update during playback: update DOM directly, avoid store updates
  useEffect(() => {
    const onPlaybackFrame = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail.time !== 'number') return;
      playbackTimeRef.current = detail.time;
      // Update playhead DOM directly (no React re-render)
      if (playheadRef.current) {
        const x = detail.time * PIXELS_PER_SECOND * zoom;
        playheadRef.current.style.left = `${x}px`;
      }
      // Update time display via DOM (avoid store update)
      const timeEl = document.querySelector('[data-timeline-time]');
      if (timeEl) timeEl.textContent = formatTime(detail.time);
      // Scroll into view if playhead goes offscreen
      const container = scrollContainerRef.current;
      if (container) {
        const playheadX = LABEL_WIDTH + detail.time * PIXELS_PER_SECOND * zoom;
        const scrollLeft = container.scrollLeft;
        const containerWidth = container.clientWidth;
        if (playheadX < scrollLeft + 100 || playheadX > scrollLeft + containerWidth - 100) {
          const target = Math.max(0, playheadX - containerWidth / 2);
          container.scrollTo({ left: target, behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('docuflow:playback-frame', onPlaybackFrame);
    return () => window.removeEventListener('docuflow:playback-frame', onPlaybackFrame);
  }, [zoom]);

  // Sync playhead DOM position when NOT playing (seek, manual change, stop).
  // During playback, the docuflow:playback-frame handler above takes over via direct DOM writes,
  // avoiding React re-renders. This effect only fires when playing is false (or on mount).
  const playheadSyncRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (playing) return; // playback-frame handler owns the position during playback
    const syncPlayhead = () => {
      if (playheadRef.current) {
        playheadRef.current.style.left = `${currentTime * PIXELS_PER_SECOND * zoom}px`;
      }
      // Also sync the time display
      const timeEl = document.querySelector('[data-timeline-time]');
      if (timeEl) timeEl.textContent = formatTime(currentTime);
    };
    // Use rAF to batch with any pending layout
    playheadSyncRafRef.current = requestAnimationFrame(syncPlayhead);
    return () => {
      if (playheadSyncRafRef.current !== null) {
        cancelAnimationFrame(playheadSyncRafRef.current);
        playheadSyncRafRef.current = null;
      }
    };
  }, [playing, currentTime, zoom]);

  useEffect(() => {
    if (!playing) {
      hardStopRef.current = false;
      return;
    }
    if (hardStopRef.current) return;
    if (commands.length === 0) return;

    const effectiveEnd = Math.max(maxEndTime, voiceoverDuration);
    if (effectiveEnd <= 0) return;

    const currentFrame = Math.round(currentTime * fps);
    const endFrame = Math.ceil(effectiveEnd * fps);
    if (currentFrame >= endFrame) {
      hardStopRef.current = true;
      setCurrentTime(effectiveEnd);
      window.dispatchEvent(new CustomEvent('docuflow:toggle-play'));
    }
  }, [currentTime, playing, fps, commands.length, maxEndTime, voiceoverDuration, setCurrentTime]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const container = scrollContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const scrollRatio = (container.scrollLeft + mouseX) / (container.scrollWidth || 1);

        const delta = e.deltaY > 0 ? 0.92 : 1.08;
        setZoom((z) => {
          const newZoom = Math.max(0.25, Math.min(8, z * delta));
          const newTotalWidth = totalSeconds * PIXELS_PER_SECOND * newZoom;
          const newScrollX = scrollRatio * newTotalWidth - mouseX;

          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollLeft = Math.max(0, newScrollX);
            }
          });

          return newZoom;
        });
      }
    },
    [totalSeconds]
  );

  const handleScroll = useCallback(() => {}, []);

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: any, trackType: string, mode: 'move' | 'resize-left' | 'resize-right') => {
      e.stopPropagation();
      e.preventDefault();
      const cmdId = clip.commandId || clip.id;

      if (e.ctrlKey || e.metaKey) {
        toggleCommandSelection(cmdId);
      } else {
        selectCommand(cmdId === selectedCommandId ? null : cmdId);
      }

      const cmd = commands.find((c) => c.id === cmdId);
      const duration = cmd && 'duration' in cmd ? (cmd as any).duration : (clip.end - clip.start);

      const layerIndex = trackLayerMap.indexOf(clip.zIndex ?? 0);

      let maxDuration: number | undefined;
      if (trackType === 'music' || trackType === 'sfx' || trackType === 'ambient' || trackType === 'voiceover') {
        const assetName = cmd && 'asset' in cmd ? (cmd as any).asset : clip.label;
        const asset = assets.find((a) => a.logicalId === assetName || a.id === assetName);
        if (asset?.duration) {
          maxDuration = asset.duration;
        }
      }

      // Calculate offset from mouse to clip's grab point (preserves grab position during drag)
      let offsetToCenterX = 0;
      let offsetToCenterY = 0;
      if (mode === 'move') {
        // For move mode, offset is 0: clip moves by the same delta as the mouse.
        // This preserves the grab point position — no teleport on drag start.
        offsetToCenterX = 0;
        offsetToCenterY = 0;
      } else {
        // For resize modes, use the mouse position relative to clip edge
        const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (mode === 'resize-left') {
          offsetToCenterX = e.clientX - clipRect.left;
        } else {
          offsetToCenterX = e.clientX - clipRect.right;
        }
        offsetToCenterY = 0;
      }

      // Store pending drag info - drag state is set only after movement threshold is crossed
      pendingDragRef.current = {
        clipId: cmdId,
        trackType,
        startX: e.clientX,
        startY: e.clientY,
        originalStart: clip.start,
        originalDuration: duration || (clip.end - clip.start),
        originalLayerIndex: layerIndex >= 0 ? layerIndex : 0,
        originalZIndex: clip.zIndex ?? 0,
        mode,
        currentTrackIndex: layerIndex >= 0 ? layerIndex : 0,
        maxDuration,
        offsetToCenterX,
        offsetToCenterY,
      };
    },
    [selectedCommandId, selectCommand, toggleCommandSelection, commands, trackLayerMap, assets]
  );

  const dragStateRef = useRef<DragState | null>(null);
  const commandsRef = useRef(commands);
  const updateCommandRef = useRef(updateCommand);
  const removeCommandRef = useRef(removeCommand);
  const snapRef = useRef(snap);
  const trackLayerMapRef = useRef(trackLayerMap);
  const beginBatchRef = useRef(beginBatch);
  const endBatchRef = useRef(endBatch);
  const zoomRef = useRef(zoom);
  const fpsRef = useRef(fps);

  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);
  useEffect(() => {
    updateCommandRef.current = updateCommand;
  }, [updateCommand]);
  useEffect(() => {
    removeCommandRef.current = removeCommand;
  }, [removeCommand]);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    trackLayerMapRef.current = trackLayerMap;
  }, [trackLayerMap]);
  useEffect(() => {
    beginBatchRef.current = beginBatch;
  }, [beginBatch]);
  useEffect(() => {
    endBatchRef.current = endBatch;
  }, [endBatch]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    // Reset refs when drag ends (but do NOT return early — we must always register handlers)
    if (!dragState) {
      dragStateRef.current = null;
      prevDragStateRef.current = null;
      dragVisualOffsetRef.current = null;
      setDragVisualOffset(null);
    } else {
      dragStateRef.current = dragState;

      if (prevDragStateRef.current === null) {
        beginBatchRef.current();
      }
      prevDragStateRef.current = dragState;

      {
        const state = useDocuFlowStore.getState();
        const voiceoverAsset = state.voiceover ? state.assets.find(a => a.id === state.voiceover!.assetId) : undefined;
        const tl = state.timeline || buildTimeline(state.commands, state.assets, state.settings, voiceoverAsset?.duration);
        const needsLayer = state.commands.filter(c => c.type === 'show' && (c as any).layer === undefined);
        // Diagnostic: store layer lookup info for test debugging
        (window as any).__needsLayerDiag = {
          stateTimelineExists: !!state.timeline,
          tlLayerKeys: Object.keys(tl.layers),
          tlLayerEntries: Object.entries(tl.layers).map(([k, v]) => ({ key: k, zIndex: (v as any).zIndex })),
          cmdsWithoutLayer: needsLayer.map(c => c.id),
          allCmdLayers: state.commands.filter(c => c.type === 'show').map(c => ({ id: c.id, layer: (c as any).layer })),
        };
        if (needsLayer.length > 0) {
          // Build a lookup: commandId → zIndex by scanning all layer segments.
          // buildTimeline keys layers by the FIRST command's ID, so tl.layers[cmd.id]
          // only works for the first command in each zIndex group. For others, we must
          // search assetSegments to find which layer they belong to.
          const cmdToZIndex = new Map<string, number>();
          for (const layer of Object.values(tl.layers)) {
            for (const seg of layer.assetSegments) {
              if (seg.commandId) cmdToZIndex.set(seg.commandId, layer.zIndex);
            }
          }
          const newCmds = state.commands.map(c => {
            if (c.type === 'show' && (c as any).layer === undefined) {
              const z = cmdToZIndex.get(c.id) ?? 0;
              return { ...c, layer: z } as any;
            }
            return c;
          });
          (window as any).__needsLayerResult = newCmds.filter(c => c.type === 'show').map(c => ({ id: c.id, layer: (c as any).layer }));
          useDocuFlowStore.setState({ commands: newCmds });
        }
      }
    }

    // ALWAYS register mouse handlers — needed for the pendingDrag → activeDrag transition.
    // When dragState is null, handleMouseMove checks pendingDragRef to detect threshold crossing.
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      // Check if we have a pending drag that hasn't started yet
      const pending = pendingDragRef.current;
      if (pending && !dragStateRef.current) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        const hasMovedEnough = Math.abs(dx) > 3 || Math.abs(dy) > 3;

        if (hasMovedEnough) {
          // Threshold crossed - start the drag
          const newDragState: DragState = {
            ...pending,
            hasMoved: true,
          };
          pendingDragRef.current = null;
          // Compute initial visual offset immediately so handleMouseUp has it
          const initialVisualDx = dx + pending.offsetToCenterX;
          const initialVisualDy = dy + pending.offsetToCenterY;
          dragVisualOffsetRef.current = { clipId: pending.clipId, dx: initialVisualDx, dy: initialVisualDy };
          rafId = requestAnimationFrame(() => {
            setDragVisualOffset(dragVisualOffsetRef.current);
          });
          setDragState(newDragState);
          // The drag state effect will register proper handlers on re-render
          return;
        }
        // Not enough movement yet - don't start drag
        return;
      }

      const state = dragStateRef.current;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const hasMoved = Math.abs(dx) > 3 || Math.abs(dy) > 3;

      if (hasMoved) {
        // Apply offset to preserve grab point position during drag
        const visualDx = dx + state.offsetToCenterX;
        const visualDy = dy + state.offsetToCenterY;
        dragVisualOffsetRef.current = { clipId: state.clipId, dx: visualDx, dy: visualDy };
      }

      const currentZoom = zoomRef.current;
      const dt = dx / (PIXELS_PER_SECOND * currentZoom);
      const currentSnap = snapRef.current;
      let newSnapX: number | null = null;
      if (state.mode === 'move') {
        const rawStart = state.originalStart + dt;
        const snappedTime = currentSnap(rawStart, state.clipId);
        if (Math.abs(rawStart - snappedTime) < 0.05) {
          newSnapX = snappedTime * PIXELS_PER_SECOND * currentZoom;
        }
      } else if (state.mode === 'resize-right') {
        const rawEnd = state.originalStart + state.originalDuration + dt;
        const snappedTime = currentSnap(rawEnd, state.clipId);
        if (Math.abs(rawEnd - snappedTime) < 0.05) {
          newSnapX = snappedTime * PIXELS_PER_SECOND * currentZoom;
        }
      } else if (state.mode === 'resize-left') {
        const rawStart = state.originalStart + dt;
        const snappedTime = currentSnap(rawStart, state.clipId);
        if (Math.abs(rawStart - snappedTime) < 0.05) {
          newSnapX = snappedTime * PIXELS_PER_SECOND * currentZoom;
        }
      }
      snapGuideXRef.current = newSnapX;
      if (snapGuideElementRef.current) {
        if (newSnapX !== null) {
          snapGuideElementRef.current.style.left = `${LABEL_WIDTH + newSnapX}px`;
          snapGuideElementRef.current.style.display = '';
        } else {
          snapGuideElementRef.current.style.display = 'none';
        }
      }

      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (hasMoved) {
          setDragVisualOffset(dragVisualOffsetRef.current);
        }
        setDragState((prev) => prev && !prev.hasMoved && hasMoved ? { ...prev, hasMoved } : prev);
        rafId = null;
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

      // If there's a pending drag that never started, clean it up (was just a click)
      if (pendingDragRef.current && !dragStateRef.current) {
        pendingDragRef.current = null;
        return;
      }

      const visualOffset = dragVisualOffsetRef.current;
      dragVisualOffsetRef.current = null;
      setDragVisualOffset(null);

      const state = dragStateRef.current;
      if (!state) return;

      // For move mode with no visual offset, this was just a click - don't commit
      if (!visualOffset && state.mode === 'move') return;

      const dx = visualOffset?.dx ?? 0;
      const dy = visualOffset?.dy ?? 0;
      const rawDx = dx - state.offsetToCenterX;
        const rawDy = dy - ((state as any).offsetToCenterY || 0);
      const dt = rawDx / (PIXELS_PER_SECOND * zoomRef.current);
      const currentSnap = snapRef.current;
      const currentTrackLayerMap = trackLayerMapRef.current;
      const currentUpdateCommand = updateCommandRef.current;
      const currentRemoveCommand = removeCommandRef.current;
      const currentCommands = commandsRef.current;

      if (state.mode === 'move') {
        const rawStart = state.originalStart + dt;
        const newStart = Math.max(0, currentSnap(rawStart, state.clipId));
        // Calculate target track by accounting for group headers in the visual layout.
        // Build a flat list of all track rows with their DOM Y positions, then find the
        // row closest to where the pointer has moved. This works symmetrically in both
        // directions and handles edge cases (pointer in header area, above/below all tracks).
        const currentTrackGroups = trackGroupsRef.current;

        // Build flat list of track rows: { y (top of row), flatIdx, height }
        const trackRows: { y: number; flatIdx: number }[] = [];
        let firstTrackY = 0;
        {
          let y = 0;
          let count = 0;
          for (const g of currentTrackGroups) {
            y += TRACK_HEIGHT; // group header
            for (let i = 0; i < g.tracks.length; i++) {
              trackRows.push({ y, flatIdx: count });
              if (count === 0) firstTrackY = y;
              y += TRACK_HEIGHT;
              count++;
            }
          }
        }

        // Use the native mouseup event position to determine target track.
        let targetLayerIndex = state.originalLayerIndex;
        if (trackRows.length > 0 && e) {
          const scrollContainer = scrollContainerRef.current;
          if (scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const localY = e.clientY - containerRect.top + scrollContainer.scrollTop - RULER_HEIGHT;

            // Identify real content tracks (not group headers).
            // A real track is one that belongs to a group with at least one track.
            const realTrackRows: { flatIdx: number; y: number }[] = [];
            for (const row of trackRows) {
              // Check if this flatIdx corresponds to an actual track (not a header)
              let cumIdx = 0;
              let isRealTrack = false;
              for (const g of currentTrackGroups) {
                if (row.flatIdx >= cumIdx && row.flatIdx < cumIdx + g.tracks.length) {
                  isRealTrack = true;
                  break;
                }
                cumIdx += g.tracks.length;
              }
              if (isRealTrack) {
                realTrackRows.push({ flatIdx: row.flatIdx, y: row.y });
              }
            }

            // Build drop targets: real tracks + unlimited virtual layers above.
            interface DropTarget { flatIdx: number; y: number; }
            const dropTargets: DropTarget[] = [];

            for (const row of realTrackRows) {
              dropTargets.push({ flatIdx: row.flatIdx, y: row.y });
            }

            // Add virtual layers above the highest visible track.
            // Each virtual layer occupies one TRACK_HEIGHT slot above the previous.
            // realTrackRows[0] is the topmost track (highest zIndex, smallest Y).
            const highestRealY = realTrackRows.length > 0
              ? realTrackRows[0].y
              : 0;
            for (let i = 0; i < 100; i++) {
              const virtualFlatIdx = currentTrackLayerMap.length + i;
              const virtualY = highestRealY - (i + 1) * TRACK_HEIGHT;
              dropTargets.push({ flatIdx: virtualFlatIdx, y: virtualY });
            }

            let bestFlatIdx = state.originalLayerIndex;
            let bestDist = Infinity;
            for (const target of dropTargets) {
              const rowCenter = target.y + TRACK_HEIGHT / 2;
              const dist = Math.abs(localY - rowCenter);
              if (dist < bestDist) {
                bestDist = dist;
                bestFlatIdx = target.flatIdx;
              }
            }
            targetLayerIndex = bestFlatIdx;
          }
        } else if (trackRows.length > 0) {
          const originalRow = trackRows[state.originalLayerIndex];
          if (originalRow) {
            const pointerDomY = originalRow.y + rawDy;
            let bestFlatIdx = state.originalLayerIndex;
            let bestDist = Infinity;
            for (const row of trackRows) {
              const rowCenter = row.y + TRACK_HEIGHT / 2;
              const dist = Math.abs(pointerDomY - rowCenter);
              if (dist <= bestDist) {
                bestDist = dist;
                bestFlatIdx = row.flatIdx;
              }
            }
            targetLayerIndex = bestFlatIdx;
          }
        }

        // Compute target zIndex from the flat index.
        // Indices 0..trackLayerMap.length-1 map to existing visible tracks.
        // Indices >= trackLayerMap.length map to virtual layers above highest zIndex.
        const clampedTrackIndex = Math.max(0, targetLayerIndex);
        let targetZIndex = state.originalZIndex;
        if (clampedTrackIndex !== state.originalLayerIndex && currentTrackLayerMap.length > 0) {
          if (clampedTrackIndex < currentTrackLayerMap.length) {
            targetZIndex = currentTrackLayerMap[clampedTrackIndex];
          } else {
            const maxZ = Math.max(...currentTrackLayerMap);
            targetZIndex = maxZ + (clampedTrackIndex - currentTrackLayerMap.length + 1);
          }
        }
        // Diagnostic: track what mouseup commits
        (window as any).__mouseUpDiag = {
          clipId: state.clipId,
          mode: state.mode,
          originalZIndex: state.originalZIndex,
          originalLayerIndex: state.originalLayerIndex,
          clampedTrackIndex,
          targetLayerIndex,
          targetZIndex,
          trackLayerMapLen: currentTrackLayerMap.length,
          trackLayerMapValues: currentTrackLayerMap,
          trackRowsCount: trackRows.length,
          dx, dy, rawDx, rawDy,
          newStart,
          clientY: e?.clientY,
        };

        // Resolve collision before applying
        const storeCmds = useDocuFlowStore.getState().commands;
        const candidate = { id: state.clipId, start: newStart, duration: state.originalDuration, layer: targetZIndex, type: 'show' as const };
        const resolved = resolveCollision(storeCmds, candidate);
        currentUpdateCommand(state.clipId, { start: resolved.start, layer: resolved.layer });
      } else if (state.mode === 'resize-right') {
        const rawEnd = state.originalStart + state.originalDuration + dt;
        const maxEnd = state.maxDuration != null
          ? state.originalStart + state.maxDuration
          : Infinity;
        const newEnd = Math.max(state.originalStart + MIN_DURATION, Math.min(currentSnap(rawEnd, state.clipId), maxEnd));
        const newDuration = Math.max(MIN_DURATION, newEnd - state.originalStart);
        if (isFinite(newDuration) && newDuration > 0) {
          currentUpdateCommand(state.clipId, { duration: newDuration });
        }
      } else if (state.mode === 'resize-left') {
        const rawStart = state.originalStart + dt;
        const newStart = Math.max(0, currentSnap(rawStart, state.clipId));
        const deltaStart = newStart - state.originalStart;
        const newDuration = Math.max(MIN_DURATION, state.originalDuration - deltaStart);
        if (isFinite(newDuration) && newDuration > 0 && isFinite(newStart) && newStart >= 0 && Math.abs(newStart - state.originalStart) > 0.001) {
          currentUpdateCommand(state.clipId, { start: newStart, duration: newDuration });
        }
      }

      setDragState(null);
      snapGuideXRef.current = null;
      if (snapGuideElementRef.current) snapGuideElementRef.current.style.display = 'none';
      endBatchRef.current();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
      // Clean up pending drag if effect unmounts before drag starts
      pendingDragRef.current = null;
    };
  }, [dragState, beginBatch, endBatch]);

  const getDropTimeFromEvent = useCallback((e: React.DragEvent | MouseEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft - LABEL_WIDTH;
    return Math.max(0, x / (PIXELS_PER_SECOND * zoom));
  }, [zoom]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if actually leaving the scroll container (not entering a child)
    const related = e.relatedTarget as HTMLElement;
    if (related && e.currentTarget.contains(related)) return;
    setDropTime(null);
    setDragOverTrackId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropTime(null);
    setDragOverTrackId(null);

    const data = e.dataTransfer.getData('application/docuflow-asset');
    if (!data) return;

    const asset = JSON.parse(data);
    const dropTime = getDropTimeFromEvent(e);
    const snapped = snap(dropTime);

    if (asset.type === 'image' || asset.type === 'video') {
      const state = useDocuFlowStore.getState();
      const voiceoverAsset = state.voiceover ? state.assets.find(a => a.id === state.voiceover!.assetId) : undefined;
      const tl = state.timeline || buildTimeline(state.commands, state.assets, state.settings, voiceoverAsset?.duration);

      let targetLayer = dragOverTrackId ? tl.layers[dragOverTrackId] : null;

      let nextZIndex: number;
      if (targetLayer) {
        nextZIndex = targetLayer.zIndex;
      } else {
        const existingZIndices = Object.values(tl.layers).map(l => l.zIndex);
        nextZIndex = existingZIndices.length > 0 ? Math.max(...existingZIndices) + 1 : 0;
      }

      const cmdDuration = asset.duration && asset.duration > 0 ? Math.min(asset.duration, 30) : 5;

      // Resolve collision before adding
      const cmdId = uuidv4();
      const candidateForCollision = { id: cmdId, start: snapped, duration: cmdDuration, layer: nextZIndex, type: 'show' as const };
      const resolved = resolveCollision(state.commands, candidateForCollision);

      const cmd = {
        id: cmdId,
        type: 'show' as const,
        asset: asset.logicalId,
        start: resolved.start,
        duration: cmdDuration,
        layer: resolved.layer,
      };
      addCommand(cmd);
    } else if (asset.type === 'audio') {
      let cmdType: 'sfx' | 'music' | 'ambient' = 'music';
      if (asset.audioRole === 'sfx') cmdType = 'sfx';
      else if (asset.audioRole === 'ambient') cmdType = 'ambient';
      else if (asset.audioRole === 'music') cmdType = 'music';
      else if (asset.audioRole === 'voiceover') cmdType = 'music';

      const audioDuration = asset.duration && asset.duration > 0 ? asset.duration : 5;
      const cmd = {
        id: uuidv4(),
        type: cmdType,
        asset: asset.logicalId,
        start: snapped,
        duration: audioDuration,
        volume: 0.7,
      };
      addCommand(cmd);
    } else if (asset.type === 'text') {
      const cmd = {
        id: uuidv4(),
        type: 'text' as const,
        content: asset.logicalId,
        start: snapped,
        duration: asset.duration && asset.duration > 0 ? asset.duration : 5,
        fontSize: 32,
        fontFamily: 'Arial',
        color: '#ffffff',
        x: 0,
        y: 0,
      };
      addCommand(cmd);
    }

    const state = useDocuFlowStore.getState();
    const tl = buildTimeline(state.commands, state.assets, state.settings, state.voiceover ? state.assets.find(a => a.id === state.voiceover!.assetId)?.duration : undefined);
    state.setTimeline(tl);
  }, [getDropTimeFromEvent, snap, dragOverTrackId, addCommand, commands, removeCommand, updateCommand]);

  const tracks = useMemo(() => {
    if (!effectiveTimeline) return [];

    const cmdMap = new Map(commands.map(c => [c.id, c]));

    const videoTracks: { id: string; label: string; color: string; clips: any[]; type: string; zIndex: number }[] = [];

    Object.values(effectiveTimeline.layers).forEach((layer) => {
      if (hiddenAssetIds.has(layer.assetId)) return;

      const clips: any[] = [];
      const segments = layer.assetSegments;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const nextSeg = segments[i + 1];
        const startSec = seg.startFrame / fps;
        const cmd = cmdMap.get(seg.commandId || layer.id);
        const cmdDuration = cmd && 'duration' in cmd ? (cmd as any).duration : undefined;
        const endSec = cmdDuration
          ? (cmd as any).start + cmdDuration
          : nextSeg
            ? nextSeg.startFrame / fps
            : layer.endFrame / fps;

        clips.push({
          id: seg.commandId || `${layer.id}-seg${i}`,
          start: startSec,
          end: endSec,
          label: seg.assetId,
          layerId: layer.id,
          commandId: seg.commandId || layer.id,
          zIndex: layer.zIndex,
          assetId: seg.assetId,
        });
      }

      if (clips.length === 0) {
        const startSec = layer.startFrame / fps;
        const cmd = cmdMap.get(layer.id);
        const cmdDuration = cmd && 'duration' in cmd ? (cmd as any).duration : undefined;
        const endSec = cmdDuration
          ? (cmd as any).start + cmdDuration
          : layer.endFrame / fps;
        clips.push({
          id: layer.id,
          start: startSec,
          end: endSec,
          label: layer.assetId,
          layerId: layer.id,
          commandId: layer.id,
          zIndex: layer.zIndex,
          assetId: layer.assetId,
        });
      }

      videoTracks.push({
        id: layer.id,
        label: layer.assetId,
        color: 'var(--color-track-video)',
        clips,
        type: 'video',
        zIndex: layer.zIndex,
      });
    });

    videoTracks.sort((a, b) => b.zIndex - a.zIndex);



    const audioTracks: { id: string; label: string; color: string; clips: any[]; type: string; zIndex: number }[] = [];
    for (const track of effectiveTimeline.audioTracks) {
      if (hiddenAssetIds.has(track.assetId)) continue;

      const startSec = track.startFrame / fps;
      const endSec = track.endFrame / fps;
      const colorMap: Record<string, string> = {
        music: 'var(--color-track-music)',
        sfx: 'var(--color-track-sfx)',
        ambient: 'var(--color-track-ambient)',
        voiceover: 'var(--color-track-voiceover)',
      };
      audioTracks.push({
        id: track.id,
        label: track.assetId,
        color: colorMap[track.type] || 'var(--color-track-music)',
        clips: [
          {
            id: track.id,
            start: startSec,
            end: endSec,
            label: track.assetId,
            commandId: track.id,
            layerId: track.id,
            zIndex: 0,
            assetId: track.assetId,
          },
        ],
        type: track.type,
        zIndex: 0,
      });
    }

    const textTracks: { id: string; label: string; color: string; clips: any[]; type: string; zIndex: number }[] = [];
    for (const text of effectiveTimeline.textLayers) {
      const startSec = text.startFrame / fps;
      const cmd = cmdMap.get(text.id);
      const cmdDuration = cmd && 'duration' in cmd ? (cmd as any).duration : undefined;
      const endSec = cmdDuration
        ? (cmd as any).start + cmdDuration
        : text.endFrame / fps;
      textTracks.push({
        id: text.id,
        label: text.content.substring(0, 20),
        color: 'var(--color-track-text)',
        clips: [
          {
            id: text.id,
            start: startSec,
            end: endSec,
            label: text.content.substring(0, 20),
            commandId: text.id,
            layerId: text.id,
            zIndex: text.zIndex,
            assetId: text.id,
          },
        ],
        type: 'text',
        zIndex: text.zIndex,
      });
    }

    textTracks.sort((a, b) => b.zIndex - a.zIndex);

    return [...videoTracks, ...audioTracks, ...textTracks];
  }, [effectiveTimeline, fps, hiddenAssetIds, commands]);

  const voiceoverTrack = useMemo(() => {
    if (!voiceover) return null;
    const asset = assets.find((a) => a.id === voiceover.assetId);
    if (!asset || !asset.url) return null;
    const startSec = 0;
    const endSec = asset.duration || 10;
    return {
      id: `voiceover-${asset.id}`,
      label: asset.logicalId,
      color: 'var(--color-track-voiceover)',
      clips: [{
        id: `voiceover-clip-${asset.id}`,
        start: startSec,
        end: endSec,
        label: asset.logicalId,
      }],
      type: 'voiceover',
      zIndex: 0,
    };
  }, [voiceover, assets]);

  const hasTextCommands = useMemo(
    () => commands.some((c) => c.type === 'text' || c.type === 'subtitle'),
    [commands]
  );

  const hasAudioCommands = useMemo(
    () => commands.some((c) => c.type === 'music' || c.type === 'sfx' || c.type === 'ambient' || c.type === 'volume' || c.type === 'fadeAudioIn' || c.type === 'fadeAudioOut'),
    [commands]
  );

  const trackGroups = useMemo(() => {
    const voiceoverTracks = voiceoverTrack ? [voiceoverTrack] : [];
    const allAudioTracks = [
      ...tracks.filter((t) => t.type === 'sfx' || t.type === 'music' || t.type === 'ambient'),
      ...voiceoverTracks,
    ];
    const groups: { id: string; label: string; tracks: typeof tracks; visibilityKey: keyof typeof trackVisibility; icon: any; color: string }[] = [
      { id: 'video', label: 'IMAGES & VIDEO', tracks: tracks.filter((t) => t.type === 'video'), visibilityKey: 'video', icon: Film, color: 'var(--color-track-video)' },
      { id: 'text', label: 'TEXT', tracks: tracks.filter((t) => t.type === 'text'), visibilityKey: 'text', icon: Type, color: 'var(--color-track-text)' },
      { id: 'audio', label: 'AUDIO', tracks: allAudioTracks as any, visibilityKey: 'sfx', icon: Volume2, color: 'var(--color-track-voiceover)' },
    ];
    return groups.filter((g) => {
      if (g.id === 'video') return true;
      if (g.id === 'text') return hasTextCommands;
      if (g.id === 'audio') return hasAudioCommands;
      return g.tracks.length > 0;
    });
  }, [tracks, trackVisibility, voiceoverTrack, hasTextCommands, hasAudioCommands]);

  const trackGroupsRef = useRef(trackGroups);
  useEffect(() => {
    trackGroupsRef.current = trackGroups;
  }, [trackGroups]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const time = getDropTimeFromEvent(e);
    setDropTime(time);

    // Determine target track from Y position
    const trackRowsEl = (e.currentTarget as HTMLElement).querySelector('[data-track-rows]') as HTMLElement;
    if (trackRowsEl) {
      const rect = trackRowsEl.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const trackIdx = Math.floor(y / TRACK_HEIGHT);
      let currentIdx = 0;
      let foundTrackId: string | null = null;
      for (const group of trackGroups) {
        if (trackIdx <= currentIdx) break;
        currentIdx++;
        if (trackIdx <= currentIdx + group.tracks.length - 1) {
          const localIdx = trackIdx - currentIdx;
          if (group.tracks[localIdx]) {
            foundTrackId = group.tracks[localIdx].id;
          }
          break;
        }
        currentIdx += group.tracks.length;
      }
      setDragOverTrackId(foundTrackId);
    }
  }, [getDropTimeFromEvent, trackGroups]);

  const timeMarks = useMemo(() => {
    const marks: number[] = [];
    const step = zoom >= 2 ? 0.5 : zoom >= 1 ? 1 : zoom >= 0.5 ? 2 : 5;
    for (let t = 0; t <= totalSeconds; t += step) {
      marks.push(t);
    }
    return marks;
  }, [totalSeconds, zoom]);

  return (
    <Panel title="Timeline" icon={<Film size={10} />} className="h-full min-h-0 flex flex-col relative overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-df-divider shrink-0">
        <Tooltip content="Play/Pause (Space)">
          <IconButton size="sm" variant={playing ? 'primary' : 'ghost'} aria-label={playing ? 'Pause' : 'Play'} onClick={handlePlayPause}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </IconButton>
        </Tooltip>
        <div className="flex items-center gap-2">
          <label className="text-df-xs text-df-text-muted shrink-0" style={{ width: '36px' }}>Time</label>
          <span data-timeline-time className="flex-1 text-df-xs text-df-text-primary font-mono">{formatTime(currentTime)}</span>
        </div>
        <Divider vertical className="h-4 mx-0.5" />
        <Tooltip content={snapEnabled ? 'Snap ON (S)' : 'Snap OFF (S)'}>
          <IconButton size="sm" variant={snapEnabled ? 'primary' : 'ghost'} aria-label={snapEnabled ? 'Disable Snap' : 'Enable Snap'} onClick={() => setSnapEnabled(!snapEnabled)}>
            <Magnet size={13} />
          </IconButton>
        </Tooltip>
        <Divider vertical className="h-4 mx-0.5" />
        <Tooltip content="Undo (Ctrl+Z)">
          <IconButton size="sm" variant="ghost" aria-label="Undo" onClick={undo} disabled={historyIndex <= 0}>
            <Undo2 size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)">
          <IconButton size="sm" variant="ghost" aria-label="Redo" onClick={redo} disabled={historyIndex >= history.length - 1}>
            <Redo2 size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Duplicate (Ctrl+D)">
          <IconButton size="sm" variant="ghost" aria-label="Duplicate" onClick={() => selectedCommandId && duplicateCommand(selectedCommandId)} disabled={!selectedCommandId}>
            <Copy size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Toggle Waveforms">
          <IconButton size="sm" variant={showWaveforms ? 'primary' : 'ghost'} aria-label="Toggle Waveforms" onClick={() => setShowWaveforms(!showWaveforms)}>
            <Volume2 size={13} />
          </IconButton>
        </Tooltip>
        <Divider vertical className="h-4 mx-0.5" />
        <Tooltip content="Zoom Out (Ctrl+-)">
          <IconButton size="sm" variant="ghost" aria-label="Zoom Out" onClick={() => setZoom((z) => Math.max(0.25, z * 0.8))}>
            <ZoomOut size={13} />
          </IconButton>
        </Tooltip>
        <span className="text-df-xs text-df-text-muted w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <Tooltip content="Zoom In (Ctrl++)">
          <IconButton size="sm" variant="ghost" aria-label="Zoom In" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
            <ZoomIn size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Reset Zoom (Ctrl+0)">
          <IconButton size="sm" variant="ghost" aria-label="Reset Zoom" onClick={() => setZoom(1)}>
            <Maximize2 size={13} />
          </IconButton>
        </Tooltip>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative"
        onClick={handleTimelineBodyClick}
        onWheel={handleWheel}
        onScroll={handleScroll}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseDown={(e) => {
          // Start marquee if clicking on empty space (not on a clip or playhead)
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.track-row')?.querySelector('.clip-item') === null) {
            const rect = e.currentTarget.getBoundingClientRect();
            const startX = e.clientX - rect.left + e.currentTarget.scrollLeft;
            const startY = e.clientY - rect.top + e.currentTarget.scrollTop;
            marqueeRef.current = { startX, startY, currentX: startX, currentY: startY };
            setMarqueeActive(true);
          }
        }}
        onMouseMove={(e) => {
          if (marqueeRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            marqueeRef.current.currentX = e.clientX - rect.left + e.currentTarget.scrollLeft;
            marqueeRef.current.currentY = e.clientY - rect.top + e.currentTarget.scrollTop;
            // Update overlay directly via DOM (no React re-render during drag)
            const overlay = marqueeOverlayRef.current;
            if (overlay) {
              const m = marqueeRef.current;
              const minX = Math.min(m.startX, m.currentX);
              const minY = Math.min(m.startY, m.currentY);
              const w = Math.abs(m.currentX - m.startX);
              const h = Math.abs(m.currentY - m.startY);
              overlay.style.left = `${minX}px`;
              overlay.style.top = `${minY}px`;
              overlay.style.width = `${w}px`;
              overlay.style.height = `${h}px`;
            }
          }
        }}
        onMouseUp={() => {
          if (marqueeRef.current) {
            const m = marqueeRef.current;
            const minX = Math.min(m.startX, m.currentX);
            const maxX = Math.max(m.startX, m.currentX);
            const minY = Math.min(m.startY, m.currentY);
            const maxY = Math.max(m.startY, m.currentY);

            // Only process if marquee is large enough (not just a click)
            if (maxX - minX > 5 || maxY - minY > 5) {
              const selectedIds: string[] = [];
              // Find all clips that intersect the marquee
              trackGroups.forEach((group) => {
                group.tracks.forEach((track, trackIdx) => {
                  const trackY = RULER_HEIGHT + trackIdx * TRACK_HEIGHT;
                  if (trackY + TRACK_HEIGHT >= minY && trackY <= maxY) {
                    track.clips.forEach((clip) => {
                      const clipLeft = clip.start * PIXELS_PER_SECOND * zoom;
                      const clipRight = clip.end * PIXELS_PER_SECOND * zoom;
                      if (clipRight >= minX && clipLeft <= maxX) {
                        selectedIds.push(clip.commandId);
                      }
                    });
                  }
                });
              });
              if (selectedIds.length > 0) {
                setSelectedCommandIds(selectedIds);
              }
            }
          }
          marqueeRef.current = null;
          setMarqueeActive(false);
        }}
        style={dragState ? { userSelect: 'none', WebkitUserSelect: 'none' } : undefined}
      >
        <div className="flex" style={{ width: scrollInnerWidth, minHeight: '100%' }}>
          {/* Left label column */}
          <div
            className="sticky left-0 z-20 bg-df-surface-1 border-r border-df-border shrink-0 flex flex-col"
            style={{ width: LABEL_WIDTH }}
          >
            <div className="border-b border-df-divider" style={{ height: RULER_HEIGHT }} />

            {trackGroups.map((group, groupIdx) => (
              <React.Fragment key={group.id}>
                {/* Group header label */}
                <div
                  className="flex items-center px-2 border-b border-df-divider hover:bg-df-surface-2 transition-colors"
                  style={{ height: TRACK_HEIGHT }}
                >
                  <div className="flex-1 flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-df-sm flex items-center justify-center shrink-0" style={{ backgroundColor: group.color + '20' }}>
                      <group.icon size={10} style={{ color: group.color }} />
                    </div>
                    <span className="text-df-xs text-df-text-secondary font-semibold uppercase tracking-wider">{group.label}</span>
                    <Badge variant={group.tracks.length > 0 ? 'info' : 'default'} className="text-df-xs">{group.tracks.length}</Badge>
                  </div>
                  <Tooltip content={trackVisibility[group.visibilityKey] ? 'Hide track group' : 'Show track group'}>
                    <IconButton size="sm" variant="ghost" aria-label={trackVisibility[group.visibilityKey] ? 'Hide' : 'Show'} onClick={() => setTrackVisibility(group.visibilityKey, !trackVisibility[group.visibilityKey])} className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                      {trackVisibility[group.visibilityKey] ? <Eye size={10} /> : <EyeOff size={10} />}
                    </IconButton>
                  </Tooltip>
                </div>

                {/* Track labels */}
                {group.tracks.map((track, trackIdx) => (
                  <div
                    key={track.id}
                    className="flex items-center px-2 border-b border-df-divider hover:bg-df-surface-2 transition-colors"
                    style={{
                      height: TRACK_HEIGHT,
                      backgroundColor: groupIdx % 2 === 0 ? 'rgba(17, 17, 17, 0.95)' : 'rgba(24, 24, 24, 0.95)',
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full mr-2 shrink-0" style={{ backgroundColor: track.color }} />
                    <span className="text-df-sm text-df-text-primary truncate">{track.label}</span>
                  </div>
                ))}

                {group.tracks.length === 0 && (
                  <div className="flex items-center px-2 border-b border-df-divider" style={{ height: TRACK_HEIGHT }}>
                    <span className="text-df-xs text-df-text-dim italic">Empty</span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Right content area */}
          <div className="flex-1 relative min-w-0">
            {/* Ruler */}
            <div
              className="sticky top-0 z-10 border-b border-df-divider bg-df-surface-1 cursor-pointer"
              style={{ height: RULER_HEIGHT }}
              onClick={(e) => {
                if (dragState) return;
                seekToPosition(e.clientX, e.currentTarget);
              }}
            >
              <div className="relative" style={{ width: scrollInnerWidth - LABEL_WIDTH, height: RULER_HEIGHT }}>
                {timeMarks.map((t) => (
                  <div key={t} className="absolute bottom-0 flex flex-col items-center" style={{ left: t * PIXELS_PER_SECOND * zoom }}>
                    <span className="text-df-xs text-df-text-muted font-mono leading-none mb-0.5">{formatTime(t)}</span>
                    <div className="w-px h-2.5 bg-df-border" />
                  </div>
                ))}
              </div>
            </div>

            {/* Track rows */}
            <div className="relative" data-track-rows>
              {trackGroups.map((group, groupIdx) => (
                <React.Fragment key={group.id}>
                  {/* Group header body */}
                  <div
                    className="border-b border-df-divider bg-df-surface-1/40"
                    style={{ height: TRACK_HEIGHT }}
                  />

                  {/* Track bodies with clips */}
                  {group.tracks.map((track, trackIdx) => (
                    <div
                      key={track.id}
                      className={`relative overflow-hidden border-b border-df-divider ${dragOverTrackId === track.id ? 'bg-df-accent-muted border-df-accent' : ''}`}
                      style={{
                        height: TRACK_HEIGHT,
                        backgroundColor: dragOverTrackId === track.id ? undefined : (groupIdx % 2 === 0 ? 'rgba(17, 17, 17, 0.2)' : 'rgba(24, 24, 24, 0.2)'),
                      }}
                    >
                      {track.clips.map((clip) => {
                        const clipAsset = assets.find((a) => a.logicalId === clip.label || a.id === clip.label);

                        return (
                          <TimelineClip
                            key={clip.id}
                            clip={clip}
                            trackType={track.type}
                            trackColor={track.color}
                            zoom={zoom}
                            isSelected={(clip.commandId) === selectedCommandId}
                            isMultiSelected={selectedCommandIds.includes(clip.commandId)}
                            asset={clipAsset}
                            dragVisualOffset={dragVisualOffset}
                            dragState={dragState}
                            showWaveforms={showWaveforms}
                            onMouseDown={(e, c, type, mode) => handleClipMouseDown(e, c, type, mode)}
                          />
                        );
                      })}
                    </div>
                  ))}

                  {group.tracks.length === 0 && (
                    <div className="border-b border-df-divider w-full" style={{ height: TRACK_HEIGHT }} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Drop indicator - full height of right content area */}
            {dropTime !== null && (
              <div className="absolute top-0 bottom-0 w-0.5 bg-df-accent pointer-events-none z-20" style={{ left: dropTime * PIXELS_PER_SECOND * zoom }} />
            )}

            {/* Marquee selection overlay */}
            {marqueeActive && marqueeRef.current && (
              <div
                ref={marqueeOverlayRef}
                className="absolute border border-df-accent/60 bg-df-accent/10 pointer-events-none z-40"
                style={{
                  left: Math.min(marqueeRef.current.startX, marqueeRef.current.currentX),
                  top: Math.min(marqueeRef.current.startY, marqueeRef.current.currentY),
                  width: Math.abs(marqueeRef.current.currentX - marqueeRef.current.startX),
                  height: Math.abs(marqueeRef.current.currentY - marqueeRef.current.startY),
                }}
              />
            )}

            {/* Playhead — main line is pointer-events-none so clips underneath are clickable */}
            <div
              ref={playheadRef}
              className={`absolute top-0 bottom-0 w-0.5 bg-df-error z-30 pointer-events-none ${isDraggingPlayhead ? 'shadow-[0_0_12px_rgba(239,83,80,0.8)]' : 'shadow-[0_0_8px_rgba(239,83,80,0.6)]'}`}
            >
              {/* Diamond grab handle — this is the only interactive part */}
              <div
                className={`absolute -top-0.5 -left-3 w-7 h-7 flex items-center justify-center pointer-events-auto ${isDraggingPlayhead ? '' : 'cursor-ew-resize'}`}
                onMouseDown={handlePlayheadMouseDown}
              >
                <div className={`w-3 h-3 bg-df-error rotate-45 rounded-df-xs shadow-medium ${isDraggingPlayhead ? '' : 'cursor-grab active:cursor-grabbing'}`} />
              </div>
              <div className="absolute top-full left-0 w-px h-8 bg-df-error/30 pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
            </div>

            {/* Snap guide line */}
            <div
              ref={snapGuideElementRef}
              className="absolute top-0 bottom-0 w-px bg-df-accent z-30 pointer-events-none"
              style={{ display: 'none' }}
            />

            {/* Drag overlay - renders dragged clip above all tracks */}
            {dragState && dragVisualOffset && dragState.mode === 'move' && (
              <div
                className="absolute inset-0 pointer-events-none z-50"
                style={{ overflow: 'visible' }}
              >
                {(() => {
                  const draggedClip = tracks
                    .flatMap(t => t.clips)
                    .find(c => c.commandId === dragState.clipId);
                  if (!draggedClip) return null;
                  const clipAsset = assets.find((a) => a.logicalId === draggedClip.label || a.id === draggedClip.label);
                  const track = tracks.find(t => t.clips.some(c => c.commandId === dragState.clipId));
                  if (!track) return null;

                  const left = draggedClip.start * PIXELS_PER_SECOND * zoom;
                  const width = Math.max((draggedClip.end - draggedClip.start) * PIXELS_PER_SECOND * zoom, 4);
                  const displayName = clipAsset?.filename || draggedClip.label || 'Untitled';
                  const isImage = clipAsset?.type === 'image';
                  const isAudio = clipAsset?.type === 'audio';

                  // Calculate visual position based on drag offset
                  const visualLeft = left + dragVisualOffset.dx;
                  // Compute the DOM Y of the original track using canonical track-row lookup
                  const flatIdx = trackLayerMap.indexOf(draggedClip.zIndex);
                  let trackDomY = 0;
                  {
                    let y = 0;
                    let count = 0;
                    for (const g of trackGroups) {
                      y += TRACK_HEIGHT; // group header
                      for (let i = 0; i < g.tracks.length; i++) {
                        if (count === flatIdx) { trackDomY = y; break; }
                        y += TRACK_HEIGHT;
                        count++;
                      }
                      if (count === flatIdx) break;
                    }
                  }
                  const visualTop = RULER_HEIGHT + trackDomY + dragVisualOffset.dy;

                  return (
                    <div
                      className="absolute rounded-df-sm flex items-center overflow-hidden border border-df-accent/60 shadow-lg"
                      style={{
                        left: visualLeft,
                        top: visualTop + 2,
                        width,
                        height: TRACK_HEIGHT - 4,
                        backgroundColor: track.color + 'dd',
                        color: 'white',
                        borderLeftWidth: '3px',
                        borderLeftColor: track.color,
                        opacity: 0.95,
                        transform: 'translateZ(0)',
                      }}
                    >
                      {isAudio && showWaveforms && width > 30 && (
                        <AudioWaveform assetId={clipAsset?.id} width={width} height={TRACK_HEIGHT - 4} />
                      )}
                      {(isImage || clipAsset?.type === 'video') && (clipAsset?.thumbnailUrl || clipAsset?.url) && width > 40 && (
                        <div
                          className="h-full bg-cover bg-center shrink-0 opacity-60"
                          style={{ backgroundImage: `url(${clipAsset.thumbnailUrl || clipAsset.url})`, width: Math.min(width * 0.3, 48) }}
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
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
};
