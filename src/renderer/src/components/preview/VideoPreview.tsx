/* @jsxImportSource react */
import React, { useEffect, useMemo, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { buildTimeline } from '../../engine/timeline/builder';
import { DocuFlowComposition } from '../../remotion/DocuFlowComposition';
import { Player } from '@remotion/player';
import { Play, Pause, Minimize2, Maximize2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { formatTime } from '../../utils/format';
import { AudioTrack } from '../../types/timeline';
import { IconButton, Tooltip } from '../ui';
import { TransformOverlay } from './TransformOverlay';

const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200];

export const VideoPreview: React.FC = () => {
  const { assets, commands, settings, timeline, currentTime, playing, setCurrentTime, setPlaying, voiceover } =
    useDocuFlowStore();

  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [previewZoom, setPreviewZoom] = useState<number | 'fit'>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const roRef = useRef<ResizeObserver | null>(null);

  const effectiveTimeline = useMemo(() => {
    let base: ReturnType<typeof buildTimeline> | null = null;

    if (timeline) {
      const hasLayers = Object.keys(timeline.layers).length > 0;
      if (hasLayers && assets.length > 0) {
        const firstLayer = Object.values(timeline.layers)[0];
        if (firstLayer && !firstLayer.assetUrl) {
          const voiceoverAsset = voiceover ? assets.find(a => a.id === voiceover.assetId) : undefined;
          base = buildTimeline(commands, assets, settings, voiceoverAsset?.duration);
        }
      }
      if (!base) base = timeline;
    } else if (commands.length > 0) {
      const voiceoverAsset = voiceover ? assets.find(a => a.id === voiceover.assetId) : undefined;
      base = buildTimeline(commands, assets, settings, voiceoverAsset?.duration);
    }

    if (!base) return null;

    if (voiceover) {
      const vAsset = assets.find((a) => a.id === voiceover.assetId);
      if (vAsset?.url) {
        const fps = settings.fps;
        const durationFrames = vAsset.duration
          ? Math.round(vAsset.duration * fps)
          : Math.round(10 * fps);
        const voiceoverTrack: AudioTrack = {
          id: `voiceover-${vAsset.id}`,
          assetId: vAsset.id,
          assetUrl: vAsset.url,
          type: 'voiceover',
          startFrame: 0,
          endFrame: durationFrames,
          volume: 1,
        };
        const hasVO = base.audioTracks.some((t) => t.type === 'voiceover');
        if (!hasVO) {
          base = {
            ...base,
            audioTracks: [...base.audioTracks, voiceoverTrack],
            totalFrames: Math.max(base.totalFrames, durationFrames),
          };
        }
      }
    }

    return base;
  }, [timeline, commands, assets, settings, voiceover]);

  const totalFrames = effectiveTimeline?.totalFrames || settings.fps * 10;

  // Container size tracking - use useLayoutEffect + check to handle lazy-rendered containerRef
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Disconnect any existing observer
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [effectiveTimeline != null, isFullscreen]);

  // Display scale calculation
  const displayScale = useMemo(() => {
    if (containerSize.w === 0 || containerSize.h === 0) return 1;
    if (previewZoom === 'fit') {
      const scaleX = containerSize.w / settings.width;
      const scaleY = containerSize.h / settings.height;
      return Math.min(scaleX, scaleY);
    }
    return (previewZoom as number) / 100;
  }, [containerSize, settings.width, settings.height, previewZoom]);

  // Offset to center composition in container
  const offsetX = useMemo(() => {
    if (containerSize.w === 0) return 0;
    const scaledW = settings.width * displayScale;
    return (containerSize.w - scaledW) / 2;
  }, [containerSize, settings.width, displayScale]);

  const offsetY = useMemo(() => {
    if (containerSize.h === 0) return 0;
    const scaledH = settings.height * displayScale;
    return (containerSize.h - scaledH) / 2;
  }, [containerSize, settings.height, displayScale]);

  const currentFrame = useMemo(() => Math.round(currentTime * settings.fps), [currentTime, settings.fps]);

  // Playback controls
  const handlePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.play();
    setPlaying(true);
  }, [setPlaying]);

  const handlePause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    setPlaying(false);
  }, [setPlaying]);

  const handlePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [playing, handlePlay, handlePause]);

  const handleSeekTo = useCallback(
    (frame: number) => {
      const player = playerRef.current;
      if (!player) return;
      const clamped = Math.max(0, Math.min(frame, totalFrames - 1));
      player.seekTo(clamped);
      setCurrentTime(clamped / settings.fps);
    },
    [totalFrames, settings.fps, setCurrentTime]
  );

  const handleFrameAdvance = useCallback(
    (frames: number) => {
      const player = playerRef.current;
      if (!player) return;
      const currentFrame = player.getCurrentFrame();
      handleSeekTo(currentFrame + frames);
    },
    [handleSeekTo]
  );

  const handleRestart = useCallback(() => {
    handleSeekTo(0);
  }, [handleSeekTo]);

  // Player events
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onFrame = (e: any) => {
      const frame = e.detail?.frame ?? e.detail;
      if (typeof frame === 'number') {
        setCurrentTime(frame / settings.fps);
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onEnded);

    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onEnded);
    };
  }, [effectiveTimeline, setCurrentTime, setPlaying, settings.fps]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        handlePlayPause();
      }
      if (e.code === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
      if (e.code === 'Escape' && !isFullscreen) {
        useDocuFlowStore.getState().selectCommand(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayPause, isFullscreen]);

  // Custom seek/play events
  useEffect(() => {
    const onSeek = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.frame != null) {
        handleSeekTo(detail.frame);
      }
    };
    const onTogglePlay = () => handlePlayPause();

    window.addEventListener('docuflow:seek', onSeek);
    window.addEventListener('docuflow:toggle-play', onTogglePlay);
    return () => {
      window.removeEventListener('docuflow:seek', onSeek);
      window.removeEventListener('docuflow:toggle-play', onTogglePlay);
    };
  }, [handleSeekTo, handlePlayPause]);

  // Controls auto-hide in fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      return;
    }
    const handleMouseMove = () => {
      setControlsVisible(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    };
    window.addEventListener('mousemove', handleMouseMove);
    handleMouseMove();
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isFullscreen]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleZoomChange = useCallback((level: number | 'fit') => {
    setPreviewZoom(level);
  }, []);

  if (!effectiveTimeline) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-panel)] border border-[var(--color-border)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-divider)] shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Preview
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center bg-[var(--color-bg)]">
          <div className="text-center text-[var(--color-text-muted)]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-3 text-[var(--color-border-strong)]"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <p className="text-sm">No Timeline</p>
            <p className="text-[10px] mt-1">Import assets, load commands, then click Build Timeline</p>
          </div>
        </div>
      </div>
    );
  }

  const zoomPercent = previewZoom === 'fit' ? null : previewZoom;
  const zoomLabel = previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`;

  const playerContent = (
    <Player
      key={JSON.stringify({
        ids: Object.keys(effectiveTimeline.layers),
        audioIds: effectiveTimeline.audioTracks.map((t) => t.id),
        tf: totalFrames,
      })}
      ref={playerRef}
      component={DocuFlowComposition}
      compositionWidth={settings.width}
      compositionHeight={settings.height}
      durationInFrames={totalFrames}
      fps={settings.fps}
      controls={false}
      loop={false}
      clickToPlay={false}
      acknowledgeRemotionLicense
      style={{
        width: `${settings.width}px`,
        height: `${settings.height}px`,
        objectFit: 'contain',
        transformOrigin: '0 0',
        transform: `scale(${displayScale})`,
      }}
      inputProps={{ timeline: effectiveTimeline }}
    />
  );

  // Fullscreen mode
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden flex items-center justify-center cursor-none"
          onMouseMove={() => setControlsVisible(true)}
        >
          <div
            style={{
              position: 'relative',
              width: `${settings.width * displayScale}px`,
              height: `${settings.height * displayScale}px`,
              flexShrink: 0,
            }}
          >
            {playerContent}
          </div>
          <TransformOverlay
            containerRef={containerRef}
            displayScale={displayScale}
            offsetX={offsetX}
            offsetY={offsetY}
            compositionWidth={settings.width}
            compositionHeight={settings.height}
            currentFrame={currentFrame}
            fps={settings.fps}
          />

          {controlsVisible && (
            <div
              className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg z-30 transition-opacity duration-300"
              style={{ pointerEvents: 'auto' }}
            >
              <IconButton size="sm" variant="ghost" aria-label="Restart" onClick={handleRestart} className="text-white hover:text-white hover:bg-white/10">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
              </IconButton>
              <IconButton size="sm" variant="ghost" aria-label="Previous Frame" onClick={() => handleFrameAdvance(-settings.fps)} className="text-white hover:text-white hover:bg-white/10">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              </IconButton>
              <IconButton size="md" variant="ghost" aria-label={playing ? 'Pause' : 'Play'} onClick={handlePlayPause} className="text-white hover:text-white hover:bg-white/10">
                {playing
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
              </IconButton>
              <IconButton size="sm" variant="ghost" aria-label="Next Frame" onClick={() => handleFrameAdvance(settings.fps)} className="text-white hover:text-white hover:bg-white/10">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </IconButton>
              <div className="w-px h-5 bg-white/20 mx-1" />
              <div className="text-[11px] text-white/80 font-mono w-24 text-center">
                {formatTime(currentTime)}
              </div>
              <div className="w-px h-5 bg-white/20 mx-1" />
              <Tooltip content="Zoom Out">
                <IconButton size="sm" variant="ghost" aria-label="Zoom Out" onClick={() => handleZoomChange(previewZoom === 'fit' ? 100 : Math.max(25, (previewZoom as number) - 25))} className="text-white hover:text-white hover:bg-white/10">
                  <ZoomOut size={14} />
                </IconButton>
              </Tooltip>
              <button
                className="text-[11px] text-white/80 font-mono w-14 text-center hover:text-white cursor-pointer"
                onClick={() => handleZoomChange('fit')}
              >
                {zoomLabel}
              </button>
              <Tooltip content="Zoom In">
                <IconButton size="sm" variant="ghost" aria-label="Zoom In" onClick={() => handleZoomChange(previewZoom === 'fit' ? 100 : Math.min(200, (previewZoom as number) + 25))} className="text-white hover:text-white hover:bg-white/10">
                  <ZoomIn size={14} />
                </IconButton>
              </Tooltip>
              <div className="w-px h-5 bg-white/20 mx-1" />
              <Tooltip content="Exit Fullscreen (Esc)">
                <IconButton size="sm" variant="ghost" aria-label="Exit Fullscreen" onClick={toggleFullscreen} className="text-white hover:text-white hover:bg-white/10">
                  <Minimize2 size={14} />
                </IconButton>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Normal mode
  return (
    <div className="flex flex-col h-full bg-[var(--color-panel)] border border-[var(--color-border)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-divider)] shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--color-bg)] relative overflow-hidden">
        <div
          ref={containerRef}
          className="relative bg-black rounded-lg overflow-hidden border border-[var(--color-border)] flex-1 flex items-center justify-center"
          style={{ width: '100%', maxWidth: '95%', maxHeight: 'calc(100% - 52px)' }}
        >
          <div
            style={{
              position: 'relative',
              width: `${settings.width * displayScale}px`,
              height: `${settings.height * displayScale}px`,
              flexShrink: 0,
            }}
          >
            {playerContent}
          </div>
          <TransformOverlay
            containerRef={containerRef}
            displayScale={displayScale}
            offsetX={offsetX}
            offsetY={offsetY}
            compositionWidth={settings.width}
            compositionHeight={settings.height}
            currentFrame={currentFrame}
            fps={settings.fps}
          />
        </div>

        {/* Bottom controls bar */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-[var(--color-bg-elevated)]/80 backdrop-blur-sm px-3 py-1.5 rounded-lg z-10">
          <Tooltip content="Restart (Home)">
            <IconButton size="sm" variant="ghost" aria-label="Restart" onClick={handleRestart}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
            </IconButton>
          </Tooltip>
          <Tooltip content="Previous Frame (Left)">
            <IconButton size="sm" variant="ghost" aria-label="Previous Frame" onClick={() => handleFrameAdvance(-settings.fps)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </IconButton>
          </Tooltip>
          <Tooltip content={playing ? 'Pause (Space)' : 'Play (Space)'}>
            <IconButton size="md" variant="primary" aria-label={playing ? 'Pause' : 'Play'} onClick={handlePlayPause}>
              {playing ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
            </IconButton>
          </Tooltip>
          <Tooltip content="Next Frame (Right)">
            <IconButton size="sm" variant="ghost" aria-label="Next Frame" onClick={() => handleFrameAdvance(settings.fps)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </IconButton>
          </Tooltip>
          <div className="w-px h-5 bg-[var(--color-divider)] mx-1" />
          <div className="text-[10px] text-[var(--color-text-secondary)] font-mono w-20 text-center">
            {formatTime(currentTime)}
          </div>
        </div>

        {/* Zoom controls - bottom right */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-[var(--color-bg-elevated)]/80 backdrop-blur-sm px-2 py-1 rounded-lg z-10">
          <Tooltip content="Zoom Out">
            <IconButton size="sm" variant="ghost" aria-label="Zoom Out" onClick={() => handleZoomChange(previewZoom === 'fit' ? 100 : Math.max(25, (previewZoom as number) - 25))}>
              <ZoomOut size={12} />
            </IconButton>
          </Tooltip>
          <button
            className="text-[10px] text-[var(--color-text-secondary)] font-mono w-12 text-center hover:text-[var(--color-text-primary)] cursor-pointer"
            onClick={() => handleZoomChange('fit')}
          >
            {zoomLabel}
          </button>
          <Tooltip content="Zoom In">
            <IconButton size="sm" variant="ghost" aria-label="Zoom In" onClick={() => handleZoomChange(previewZoom === 'fit' ? 100 : Math.min(200, (previewZoom as number) + 25))}>
              <ZoomIn size={12} />
            </IconButton>
          </Tooltip>
          <div className="w-px h-4 bg-[var(--color-divider)] mx-0.5" />
          <Tooltip content="Fullscreen">
            <IconButton size="sm" variant="ghost" aria-label="Fullscreen" onClick={toggleFullscreen}>
              <Maximize2 size={12} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
