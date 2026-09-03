import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { formatTime } from '../../utils/format';
import { Play, Pause, Eye, EyeOff, Volume2, Type, Film, Magnet, Undo2, Redo2, Copy, Minimize2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Panel, IconButton, Tooltip, Divider, Badge, LabelValue } from '../ui';

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
  const {
    assets,
    commands,
    settings,
    timeline: storeTimeline,
    currentTime,
    playing,
    setCurrentTime,
    selectedCommandId,
    selectCommand,
    updateCommand,
    addCommand,
    removeCommand,
    trackVisibility,
    setTrackVisibility,
    hiddenAssetIds,
    snapEnabled,
    setSnapEnabled,
    undo,
    redo,
    duplicateCommand,
    voiceover,
    transcript,
    history,
    historyIndex,
    beginBatch,
    endBatch,
  } = useDocuFlowStore();

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

    const onMove = (e: MouseEvent) => {
      const drag = playheadDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dt = dx / (PIXELS_PER_SECOND * zoom);
      const newTime = Math.max(0, Math.min(drag.startTime + dt, maxEndTime || totalSeconds));
      const snapped = snap(newTime);
      setCurrentTime(snapped);
      const frame = Math.round(snapped * fps);
      window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame } }));
    };

    const onUp = () => {
      playheadDragRef.current = null;
      setIsDraggingPlayhead(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
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
      if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedCommandId) duplicateCommand(selectedCommandId);
        return;
      }
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
  }, [handlePlayPause, selectedCommandId, undo, redo, duplicateCommand]);

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
      selectCommand(cmdId === selectedCommandId ? null : cmdId);

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
    [selectedCommandId, selectCommand, commands, trackLayerMap, assets]
  );

  useEffect(() => {
      if (!dragState) {
        prevDragStateRef.current = null;
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

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const dt = dx / (PIXELS_PER_SECOND * zoom);

      const hasMoved = Math.abs(dx) > 3 || Math.abs(dy) > 3;

      if (dragState.mode === 'move') {
        const rawStart = dragState.originalStart + dt;
        const newStart = Math.max(0, snap(rawStart, dragState.clipId));
        const rawTrackIndex = dragState.originalLayerIndex + Math.round(dy / TRACK_HEIGHT);
        const clampedTrackIndex = Math.max(0, rawTrackIndex);
        const delta = newStart - dragState.originalStart;

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
        setDragState((prev) =>
          prev ? { ...prev, currentTrackIndex: clampedTrackIndex, hasMoved } : null
        );
      } else if (dragState.mode === 'resize-right') {
        const rawEnd = dragState.originalStart + dragState.originalDuration + dt;
        const maxEnd = dragState.maxDuration != null
          ? dragState.originalStart + dragState.maxDuration
          : Infinity;
        const newEnd = Math.max(dragState.originalStart + MIN_DURATION, Math.min(snap(rawEnd, dragState.clipId), maxEnd));
        const newDuration = Math.max(MIN_DURATION, newEnd - dragState.originalStart);
        if (!isFinite(newDuration) || newDuration <= 0) return;
        updateCommand(dragState.clipId, { duration: newDuration });
        setDragState((prev) => (prev ? { ...prev, hasMoved } : null));
      } else if (dragState.mode === 'resize-left') {
        const rawStart = dragState.originalStart + dt;
        const newStart = Math.max(0, snap(rawStart, dragState.clipId));
        const deltaStart = newStart - dragState.originalStart;
        const newDuration = Math.max(MIN_DURATION, dragState.originalDuration - deltaStart);
        if (!isFinite(newDuration) || newDuration <= 0 || !isFinite(newStart) || newStart < 0) return;
        if (Math.abs(newStart - dragState.originalStart) > 0.001) {
          updateCommand(dragState.clipId, { start: newStart, duration: newDuration });
        }
        setDragState((prev) => (prev ? { ...prev, hasMoved } : null));
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
      endBatch();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
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
                        const left = clip.start * PIXELS_PER_SECOND * zoom;
                        const width = Math.max((clip.end - clip.start) * PIXELS_PER_SECOND * zoom, 4);
                        const isSelected = (clip.layerId || clip.id) === selectedCommandId;
                        const asset = assets.find((a) => a.logicalId === clip.label || a.id === clip.label);
                        const displayName = asset?.filename || clip.label || 'Untitled';
                        const isImage = asset?.type === 'image';
                        const isAudio = asset?.type === 'audio';

                        return (
                          <div
                            key={clip.id}
                            className={`
                              absolute top-0.5 bottom-0.5 rounded-df-sm flex items-center overflow-hidden cursor-grab active:cursor-grabbing
                              border border-df-border
                              ${isSelected
                                ? 'ring-2 ring-df-accent/60 ring-offset-1 ring-offset-df-surface-1 z-10 border-df-accent/40'
                                : 'hover:border-df-border-strong hover:brightness-110'}
                            `}
                            style={{
                              left,
                              width,
                              backgroundColor: track.color + 'dd',
                              color: 'white',
                              borderLeftWidth: '3px',
                              borderLeftColor: track.color,
                            }}
                            onMouseDown={(e) => handleClipMouseDown(e, clip, track.type, 'move')}
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
                              onMouseDown={(e) => { e.stopPropagation(); handleClipMouseDown(e, clip, track.type, 'resize-left'); }}
                            >
                              <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/40 rounded-full" />
                            </div>
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30 z-20"
                              onMouseDown={(e) => { e.stopPropagation(); handleClipMouseDown(e, clip, track.type, 'resize-right'); }}
                            >
                              <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/40 rounded-full" />
                            </div>
                          </div>
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

            {/* Playhead */}
            <div
              className={`absolute top-0 bottom-0 w-0.5 bg-df-error z-30 ${isDraggingPlayhead ? 'shadow-[0_0_12px_rgba(239,83,80,0.8)]' : 'shadow-[0_0_8px_rgba(239,83,80,0.6)] pointer-events-auto cursor-ew-resize'}`}
              style={{ left: playheadX }}
              onMouseDown={handlePlayheadMouseDown}
            >
              <div className={`absolute -top-0.5 -left-1.5 w-3 h-3 bg-df-error rotate-45 rounded-df-xs shadow-medium ${isDraggingPlayhead ? '' : 'cursor-grab active:cursor-grabbing'}`} />
              <div className="absolute top-full left-0 w-px h-8 bg-df-error/30 pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
};

const AudioWaveform: React.FC<{
  assetId: string | undefined;
  width: number;
  height: number;
}> = ({ assetId, width, height }) => {
  const assets = useDocuFlowStore((s) => s.assets);
  const asset = assetId ? assets.find((a) => a.id === assetId) : null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset?.url || width <= 0) return;

    let cancelled = false;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    const decode = async () => {
      try {
        const response = await fetch(asset.url!);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (cancelled) { audioContext.close(); return; }

        const channelData = audioBuffer.getChannelData(0);
        const numBars = Math.max(1, Math.floor(width / 3));
        const samplesPerBar = Math.floor(channelData.length / numBars);
        const peaks: number[] = [];

        for (let i = 0; i < numBars; i++) {
          let max = 0;
          for (let j = 0; j < samplesPerBar; j++) {
            const val = Math.abs(channelData[i * samplesPerBar + j] || 0);
            if (val > max) max = val;
          }
          peaks.push(max);
        }

        const peakMax = Math.max(...peaks, 0.01);
        const ctx = canvas.getContext('2d');
        if (!ctx) { audioContext.close(); return; }

        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);

        const barW = Math.max(1, width / numBars - 1);
        const midY = height / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        for (let i = 0; i < numBars; i++) {
          const amp = peaks[i] / peakMax;
          const barH = Math.max(1, amp * height * 0.85);
          const x = i * (barW + 1);
          ctx.fillRect(x, midY - barH / 2, barW, barH);
        }

        audioContext.close();
        setReady(true);
      } catch {
        audioContext.close();
      }
    };

    decode();
    return () => { cancelled = true; audioContext.close(); };
  }, [asset?.url, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height, opacity: ready ? 1 : 0, transition: 'opacity 0.2s' }}
    />
  );
};
