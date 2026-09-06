import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { formatTime } from '../../utils/format';
import { Play, Pause, Eye, EyeOff, Volume2, Type, Film, Magnet, Undo2, Redo2, Copy, Minimize2, Maximize2, ZoomIn, ZoomOut, Scissors, Trash2, Clipboard, ClipboardCopy, ClipboardX } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Panel, IconButton, Tooltip, Divider, Badge, LabelValue } from '../ui';
import { TimelineClip } from './TimelineClip';

const PIXELS_PER_SECOND = 80;
const TRACK_HEIGHT = 32;
const LABEL_WIDTH = 128;
const RULER_HEIGHT = 28;
const SNAP_THRESHOLD_PX = 5;
const MIN_DURATION = 0.2;

interface DragState {
  clipId: string;
  trackType: string;
  startX: number;
  startY: number;
  originalStart: number;
  originalDuration: number;
  originalLayerIndex: number;
  originalZIndex: number;
  mode: 'move' | 'resize-left' | 'resize-right';
  currentTrackIndex: number;
  hasMoved: boolean;
  maxDuration?: number;
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
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTime, setDropTime] = useState<number | null>(null);
  const [showWaveforms, setShowWaveforms] = useState(false);
  const prevDragStateRef = useRef<DragState | null>(null);
  const playheadDragRef = useRef<{ startX: number; startTime: number } | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  // Visual-only drag offset: pixels moved during drag, not committed to store yet
  const [dragVisualOffset, setDragVisualOffset] = useState<{ clipId: string; dx: number; dy: number } | null>(null);
  const dragVisualOffsetRef = useRef<{ clipId: string; dx: number; dy: number } | null>(null);
  // Marquee selection state
  const [marqueeState, setMarqueeState] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number } | null>(null);
  // Snap guide visual line position
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);

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
    return Math.max(fromTimeline, maxEndTime, voiceoverDuration, 10);
  }, [effectiveTimeline, maxEndTime, voiceoverDuration, settings.fps]);

  const maxFrames = useMemo(() => {
    if (commands.length === 0) return 150;
    return Math.max(150, Math.ceil(maxEndTime * fps));
  }, [maxEndTime, fps, commands.length]);

  const hardStopRef = useRef(false);

  const scrollInnerWidth = useMemo(() => {
    const durationPixels = maxEndTime * PIXELS_PER_SECOND * zoom;
    return Math.max(containerWidth, durationPixels + 400);
  }, [containerWidth, maxEndTime, zoom]);

  const videoTracks = useMemo(() => {
    if (!effectiveTimeline) return [];
    return Object.values(effectiveTimeline.layers)
      .filter((l) => l.visible && !hiddenAssetIds.has(l.assetId))
      .sort((a, b) => b.zIndex - a.zIndex);
  }, [effectiveTimeline, hiddenAssetIds]);

  const trackLayerMap = useMemo(() => {
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

  useEffect(() => {
    if (!playing) {
      hardStopRef.current = false;
      return;
    }
    if (hardStopRef.current) return;

    const currentFrame = Math.round(currentTime * fps);
    if (currentFrame >= maxFrames) {
      hardStopRef.current = true;
      setCurrentTime(maxEndTime);
      window.dispatchEvent(new CustomEvent('docuflow:toggle-play'));
    }
  }, [currentTime, playing, fps, maxFrames, maxEndTime, setCurrentTime]);

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
      const cmdId = clip.layerId || clip.id;

      // Multi-selection support: Ctrl+click toggles, plain click selects single
      if (e.ctrlKey || e.metaKey) {
        toggleCommandSelection(cmdId);
      } else {
        selectCommand(cmdId === selectedCommandId ? null : cmdId);
      }

      const cmd = commands.find((c) => c.id === cmdId);
      const duration = cmd && 'duration' in cmd ? (cmd as any).duration : (clip.end - clip.start);

      const layerIndex = trackLayerMap.indexOf(clip.zIndex);

      let maxDuration: number | undefined;
      if (trackType === 'music' || trackType === 'sfx' || trackType === 'ambient' || trackType === 'voiceover') {
        const assetName = cmd && 'asset' in cmd ? (cmd as any).asset : clip.label;
        const asset = assets.find((a) => a.logicalId === assetName || a.id === assetName);
        if (asset?.duration) {
          maxDuration = asset.duration;
        }
      }

      setDragState({
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
        hasMoved: false,
        maxDuration,
      });
    },
    [selectedCommandId, selectCommand, toggleCommandSelection, commands, trackLayerMap, assets]
  );

  useEffect(() => {
      if (!dragState) {
        prevDragStateRef.current = null;
        dragVisualOffsetRef.current = null;
        setDragVisualOffset(null);
        return;
      }

    if (prevDragStateRef.current === null) {
      beginBatch();
    }
    prevDragStateRef.current = dragState;

    {
      const state = useDocuFlowStore.getState();
      const voiceoverAsset = state.voiceover ? state.assets.find(a => a.id === state.voiceover!.assetId) : undefined;
      const tl = state.timeline || buildTimeline(state.commands, state.assets, state.settings, voiceoverAsset?.duration);
      const needsLayer = state.commands.filter(c => c.type === 'show' && (c as any).layer === undefined);
      if (needsLayer.length > 0) {
        const newCmds = state.commands.map(c => {
          if (c.type === 'show' && (c as any).layer === undefined) {
            const layer = tl.layers[c.id];
            return { ...c, layer: layer?.zIndex ?? 0 } as any;
          }
          return c;
        });
        useDocuFlowStore.setState({ commands: newCmds });
      }
    }

    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const hasMoved = Math.abs(dx) > 3 || Math.abs(dy) > 3;

      // Store visual offset in ref (no store update = no rerender during drag)
      dragVisualOffsetRef.current = { clipId: dragState.clipId, dx, dy };

      // Calculate snap guide position
      const dt = dx / (PIXELS_PER_SECOND * zoom);
      if (dragState.mode === 'move') {
        const rawStart = dragState.originalStart + dt;
        const snappedTime = snap(rawStart, dragState.clipId);
        if (Math.abs(rawStart - snappedTime) < 0.05) {
          setSnapGuideX(snappedTime * PIXELS_PER_SECOND * zoom);
        } else {
          setSnapGuideX(null);
        }
      } else if (dragState.mode === 'resize-right') {
        const rawEnd = dragState.originalStart + dragState.originalDuration + dt;
        const snappedTime = snap(rawEnd, dragState.clipId);
        if (Math.abs(rawEnd - snappedTime) < 0.05) {
          setSnapGuideX(snappedTime * PIXELS_PER_SECOND * zoom);
        } else {
          setSnapGuideX(null);
        }
      } else if (dragState.mode === 'resize-left') {
        const rawStart = dragState.originalStart + dt;
        const snappedTime = snap(rawStart, dragState.clipId);
        if (Math.abs(rawStart - snappedTime) < 0.05) {
          setSnapGuideX(snappedTime * PIXELS_PER_SECOND * zoom);
        } else {
          setSnapGuideX(null);
        }
      }

      // Update visual position via CSS transform (lightweight)
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setDragVisualOffset(dragVisualOffsetRef.current);
        // Update hasMoved flag for mouseup logic
        setDragState((prev) => prev && !prev.hasMoved && hasMoved ? { ...prev, hasMoved } : prev);
        rafId = null;
      });
    };

    const handleMouseUp = () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      const visualOffset = dragVisualOffsetRef.current;
      dragVisualOffsetRef.current = null;
      setDragVisualOffset(null);

      // Commit final position to store on mouseup only
      if (visualOffset) {
        const dx = visualOffset.dx;
        const dy = visualOffset.dy;
        const dt = dx / (PIXELS_PER_SECOND * zoom);

        if (dragState.mode === 'move') {
          const rawStart = dragState.originalStart + dt;
          const newStart = Math.max(0, snap(rawStart, dragState.clipId));
          const rawTrackIndex = dragState.originalLayerIndex + Math.round(dy / TRACK_HEIGHT);
          const clampedTrackIndex = Math.max(0, rawTrackIndex);

          let targetZIndex = dragState.originalZIndex;
          if (clampedTrackIndex !== dragState.originalLayerIndex) {
            const otherZIndices = trackLayerMap
              .filter((_, i) => i !== dragState.originalLayerIndex)
              .sort((a, b) => a - b);
            const len = otherZIndices.length;
            if (clampedTrackIndex <= 0) {
              targetZIndex = len > 0 ? otherZIndices[len - 1] + 1 : 0;
            } else if (clampedTrackIndex >= len + 1) {
              targetZIndex = len > 0 ? otherZIndices[0] - 1 : 0;
            } else {
              const above = otherZIndices[len - clampedTrackIndex];
              const below = otherZIndices[len - clampedTrackIndex - 1];
              targetZIndex = below !== undefined && above !== undefined
                ? Math.floor((below + above) / 2)
                : below !== undefined ? below + 1 : (above !== undefined ? above - 1 : 0);
            }
          }
          updateCommand(dragState.clipId, { start: newStart, layer: targetZIndex });
        } else if (dragState.mode === 'resize-right') {
          const rawEnd = dragState.originalStart + dragState.originalDuration + dt;
          const maxEnd = dragState.maxDuration != null
            ? dragState.originalStart + dragState.maxDuration
            : Infinity;
          const newEnd = Math.max(dragState.originalStart + MIN_DURATION, Math.min(snap(rawEnd, dragState.clipId), maxEnd));
          const newDuration = Math.max(MIN_DURATION, newEnd - dragState.originalStart);
          if (isFinite(newDuration) && newDuration > 0) {
            updateCommand(dragState.clipId, { duration: newDuration });
          }
        } else if (dragState.mode === 'resize-left') {
          const rawStart = dragState.originalStart + dt;
          const newStart = Math.max(0, snap(rawStart, dragState.clipId));
          const deltaStart = newStart - dragState.originalStart;
          const newDuration = Math.max(MIN_DURATION, dragState.originalDuration - deltaStart);
          if (isFinite(newDuration) && newDuration > 0 && isFinite(newStart) && newStart >= 0 && Math.abs(newStart - dragState.originalStart) > 0.001) {
            updateCommand(dragState.clipId, { start: newStart, duration: newDuration });
          }
        }
      }

      setDragState(null);
      setSnapGuideX(null);
      endBatch();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [dragState, zoom, updateCommand, snap, fps, trackLayerMap, beginBatch, endBatch]);

  const getDropTimeFromEvent = useCallback((e: React.DragEvent | MouseEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft - LABEL_WIDTH;
    return Math.max(0, x / (PIXELS_PER_SECOND * zoom));
  }, [zoom]);

  const handleDragOver = useCallback((e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const time = getDropTimeFromEvent(e);
    setDropTime(time);
    if (trackId) setDragOverTrackId(trackId);
  }, [getDropTimeFromEvent]);

  const handleDragLeave = useCallback(() => {
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

      const cmd = {
        id: uuidv4(),
        type: 'show' as const,
        asset: asset.logicalId,
        start: snapped,
        duration: asset.duration && asset.duration > 0 ? Math.min(asset.duration, 30) : 5,
        layer: nextZIndex,
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
  }, [getDropTimeFromEvent, snap, dragOverTrackId, addCommand]);

  const tracks = useMemo(() => {
    if (!effectiveTimeline) return [];

    const videoTracks: { id: string; label: string; color: string; clips: any[]; type: string; zIndex: number }[] = [];

    Object.values(effectiveTimeline.layers).forEach((layer) => {
      if (hiddenAssetIds.has(layer.assetId)) return;

      const clips: any[] = [];
      const segments = layer.assetSegments;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const nextSeg = segments[i + 1];
        const startSec = seg.startFrame / fps;
        const endSec = nextSeg
          ? nextSeg.startFrame / fps
          : layer.endFrame / fps;

        clips.push({
          id: `${layer.id}-seg${i}`,
          start: startSec,
          end: endSec,
          label: seg.assetId,
          layerId: layer.id,
        });
      }

      if (clips.length === 0) {
        const startSec = layer.startFrame / fps;
        const endSec = layer.endFrame / fps;
        clips.push({
          id: layer.id,
          start: startSec,
          end: endSec,
          label: layer.assetId,
          layerId: layer.id,
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
          },
        ],
        type: track.type,
        zIndex: 0,
      });
    }

    const textTracks: { id: string; label: string; color: string; clips: any[]; type: string; zIndex: number }[] = [];
    for (const text of effectiveTimeline.textLayers) {
      const startSec = text.startFrame / fps;
      const endSec = text.endFrame / fps;
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
          },
        ],
        type: 'text',
        zIndex: text.zIndex,
      });
    }

    textTracks.sort((a, b) => b.zIndex - a.zIndex);

    return [...videoTracks, ...audioTracks, ...textTracks];
  }, [effectiveTimeline, fps, hiddenAssetIds]);

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

  const timeMarks = useMemo(() => {
    const marks: number[] = [];
    const step = zoom >= 2 ? 0.5 : zoom >= 1 ? 1 : zoom >= 0.5 ? 2 : 5;
    for (let t = 0; t <= totalSeconds; t += step) {
      marks.push(t);
    }
    return marks;
  }, [totalSeconds, zoom]);

  const playheadX = currentTime * PIXELS_PER_SECOND * zoom;

  return (
    <Panel title="Timeline" icon={<Film size={10} />} className="h-full min-h-0 flex flex-col relative overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-df-divider shrink-0">
        <Tooltip content="Play/Pause (Space)">
          <IconButton size="sm" variant={playing ? 'primary' : 'ghost'} aria-label={playing ? 'Pause' : 'Play'} onClick={handlePlayPause}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </IconButton>
        </Tooltip>
        <LabelValue label="Time" value={formatTime(currentTime)} labelWidth="36px" />
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
        <div className="flex-1" />
        <Tooltip content="Minimize Timeline">
          <IconButton size="sm" variant="ghost" aria-label="Minimize Timeline" onClick={() => useDocuFlowStore.getState().setPanelVisibility('timeline', false)}>
            <Minimize2 size={13} />
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
        onMouseDown={(e) => {
          // Start marquee if clicking on empty space (not on a clip or playhead)
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.track-row')?.querySelector('.clip-item') === null) {
            const rect = e.currentTarget.getBoundingClientRect();
            marqueeRef.current = { startX: e.clientX - rect.left + e.currentTarget.scrollLeft, startY: e.clientY - rect.top + e.currentTarget.scrollTop };
            setMarqueeState({ startX: marqueeRef.current.startX, startY: marqueeRef.current.startY, currentX: marqueeRef.current.startX, currentY: marqueeRef.current.startY });
          }
        }}
        onMouseMove={(e) => {
          if (marqueeRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            const currentX = e.clientX - rect.left + e.currentTarget.scrollLeft;
            const currentY = e.clientY - rect.top + e.currentTarget.scrollTop;
            setMarqueeState((prev) => prev ? { ...prev, currentX, currentY } : null);
          }
        }}
        onMouseUp={() => {
          if (marqueeRef.current && marqueeState) {
            // Calculate which clips are inside the marquee
            const minX = Math.min(marqueeState.startX, marqueeState.currentX);
            const maxX = Math.max(marqueeState.startX, marqueeState.currentX);
            const minY = Math.min(marqueeState.startY, marqueeState.currentY);
            const maxY = Math.max(marqueeState.startY, marqueeState.currentY);

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
                        selectedIds.push(clip.layerId || clip.id);
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
          setMarqueeState(null);
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
            <div className="relative">
              {trackGroups.map((group, groupIdx) => (
                <React.Fragment key={group.id}>
                  {/* Group header body */}
                  <div
                    className="border-b border-df-divider bg-df-surface-1/40"
                    style={{ height: TRACK_HEIGHT }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {dropTime !== null && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-df-accent pointer-events-none z-10" style={{ left: dropTime * PIXELS_PER_SECOND * zoom }} />
                    )}
                  </div>

                  {/* Track bodies with clips */}
                  {group.tracks.map((track, trackIdx) => (
                    <div
                      key={track.id}
                      className={`relative overflow-hidden border-b border-df-divider ${dragOverTrackId === track.id ? 'bg-df-accent-muted border-df-accent' : ''}`}
                      style={{
                        height: TRACK_HEIGHT,
                        backgroundColor: dragOverTrackId === track.id ? undefined : (groupIdx % 2 === 0 ? 'rgba(17, 17, 17, 0.2)' : 'rgba(24, 24, 24, 0.2)'),
                      }}
                      onDragOver={(e) => handleDragOver(e, track.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
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
                            isSelected={(clip.layerId || clip.id) === selectedCommandId}
                            isMultiSelected={selectedCommandIds.includes(clip.layerId || clip.id)}
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

            {/* Marquee selection overlay */}
            {marqueeState && (
              <div
                className="absolute border border-df-accent/60 bg-df-accent/10 pointer-events-none z-40"
                style={{
                  left: Math.min(marqueeState.startX, marqueeState.currentX),
                  top: Math.min(marqueeState.startY, marqueeState.currentY),
                  width: Math.abs(marqueeState.currentX - marqueeState.startX),
                  height: Math.abs(marqueeState.currentY - marqueeState.startY),
                }}
              />
            )}

            {/* Playhead */}
            <div
              className={`absolute top-0 bottom-0 w-0.5 bg-df-error z-30 ${isDraggingPlayhead ? 'shadow-[0_0_12px_rgba(239,83,80,0.8)]' : 'shadow-[0_0_8px_rgba(239,83,80,0.6)] pointer-events-auto cursor-ew-resize'}`}
              style={{ left: playheadX }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className={`absolute -top-0.5 -left-1.5 w-3 h-3 bg-df-error rotate-45 rounded-df-xs shadow-medium ${isDraggingPlayhead ? '' : 'cursor-grab active:cursor-grabbing'}`} />
              <div className="absolute top-full left-0 w-px h-8 bg-df-error/30 pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
            </div>

            {/* Snap guide line */}
            {snapGuideX !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-df-accent z-30 pointer-events-none"
                style={{ left: LABEL_WIDTH + snapGuideX }}
              />
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
};
