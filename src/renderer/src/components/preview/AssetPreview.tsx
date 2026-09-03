/* @jsxImportSource react */
import React, { useRef, useCallback, useState } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { Play, Square, Eye, Volume2, RotateCcw } from 'lucide-react';

// Inline Panel component to avoid esbuild transformation issues
const Panel = ({ title, icon, children, className = '', headerActions }: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
}) => (
  <div className={`flex flex-col h-full bg-df-surface-1 border border-df-border shadow-2xl rounded-xl ${className}`}>
    {(title || headerActions) && (
      <div className="flex items-center justify-between px-3 py-2 border-b border-df-border shrink-0">
        {title && (
          <div className="flex items-center gap-1.5 text-df-xs font-semibold text-df-text-muted uppercase tracking-wider">
            {icon && <span>{icon}</span>}
            {title}
          </div>
        )}
        {headerActions && <div className="flex items-center gap-1">{headerActions}</div>}
      </div>
    )}
    <div className="flex-1 overflow-hidden">{children}</div>
  </div>
);

// Inline Tooltip component to avoid esbuild transformation issues
const Tooltip = ({ content, children, position = 'top', delay = 200 }: {
  content: string;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}) => {
  const [visible, setVisible] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <div className="relative inline-block" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {React.cloneElement(children, { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide })}
      {visible && (
        <div
          className={`
            fixed z-[50] px-2 py-1 text-df-xs font-mono text-[var(--color-text-primary)]
            bg-[var(--color-tooltip-bg)] border border-[var(--color-tooltip-border)] rounded
            shadow-lg whitespace-nowrap max-w-xs
            animate-fade-in pointer-events-none
            ${positions[position]}
          `}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export const AssetPreview: React.FC = () => {
  const { selectedPreviewAsset, settings } = useDocuFlowStore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  const handleAudioPlay = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      setAudioPlaying(true);
    }
  }, []);

  const handleAudioStop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setAudioPlaying(false);
    }
  }, []);

  const handleVideoPlay = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play();
      setVideoPlaying(true);
    }
  }, []);

  const handleVideoPause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      setVideoPlaying(false);
    }
  }, []);

  const handleVideoToggle = useCallback(() => {
    if (videoRef.current) {
      if (videoPlaying) {
        handleVideoPause();
      } else {
        handleVideoPlay();
      }
    }
  }, [videoPlaying, handleVideoPlay, handleVideoPause]);

  const handleVideoRestart = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      if (videoPlaying) {
        videoRef.current.play();
      }
    }
  }, [videoPlaying]);

  if (!selectedPreviewAsset) {
    return (
      <Panel title="Asset Preview" icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>} className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-slate-950">
          <div className="text-center text-df-text-muted">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-3 text-slate-600"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <p className="text-sm">No asset selected</p>
            <p className="text-df-xs mt-1 text-slate-600">Click an asset in the library to preview it</p>
          </div>
        </div>
      </Panel>
    );
  }

  const asset = selectedPreviewAsset;

  return (
    <Panel title="Asset Preview" icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>} className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 relative overflow-hidden">
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-df-surface-1/80 backdrop-blur-sm px-2 py-1 rounded-df-lg text-df-xs text-df-text-muted z-10 border border-df-border">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Asset Preview
        </div>

        <div className="text-center text-df-text-muted mb-2 w-full px-2">
          <div className="text-df-xs font-mono text-df-accent truncate max-w-xs mx-auto">{asset.logicalId}</div>
          <div className="text-df-xs text-df-text-muted truncate max-w-xs mx-auto">{asset.filename}</div>
        </div>

        <div
          className="w-full flex-1 flex items-center justify-center"
          style={{
            maxWidth: '100%',
            maxHeight: 'calc(100% - 80px)',
          }}
        >
          {asset.type === 'image' && asset.url ? (
            <div className="bg-df-surface-1/50 rounded-xl overflow-hidden border border-df-border flex-1 flex items-center justify-center" style={{ maxWidth: '100%', maxHeight: '100%' }}>
              <img src={asset.url} alt={asset.logicalId} className="max-w-full max-h-full object-contain" />
            </div>
          ) : asset.type === 'audio' ? (
            <div className="bg-df-surface-2/50 rounded-xl p-4 border border-df-border text-center w-full max-w-md">
              <div className="flex items-center justify-center gap-1.5 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-df-accent"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 18 15 22 15 22 9 18 9 18 5 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                <span className="text-sm text-df-text-secondary">Audio Asset</span>
              </div>
              {asset.duration && (
                <div className="text-df-xs text-df-text-muted mb-3">Duration: {asset.duration.toFixed(2)}s</div>
              )}
              <audio ref={audioRef} src={asset.url} onEnded={() => setAudioPlaying(false)} className="hidden" />
              <div className="flex items-center justify-center gap-2">
                <Tooltip content="Restart">
                  <button
                    onClick={() => { if (audioRef.current) { audioRef.current.currentTime = 0; if (audioPlaying) audioRef.current.play(); } }}
                    className="flex items-center gap-1 px-2 py-1 rounded-df-lg text-df-xs bg-df-surface-2/80 hover:bg-df-surface-2 text-df-text-secondary transition-colors border border-df-border"
                    aria-label="Restart"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-df-xs font-mono text-df-text-primary bg-df-surface-2 border border-df-border rounded-df-lg shadow-xl whitespace-nowrap pointer-events-none">Restart</div>
                </Tooltip>
                {!audioPlaying ? (
                  <Tooltip content="Play (Space)">
                    <button
                      onClick={handleAudioPlay}
                      disabled={!asset.url}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-df-lg text-df-base bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 disabled:bg-df-surface-2 disabled:text-df-text-muted transition-colors"
                      aria-label="Play"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Pause (Space)">
                    <button
                      onClick={handleAudioStop}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-df-lg text-df-base bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors"
                      aria-label="Pause"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ) : asset.type === 'video' ? (
            <div className="bg-df-surface-1/50 rounded-xl overflow-hidden border border-df-border flex-1 flex flex-col" style={{ maxWidth: '100%', maxHeight: '100%' }}>
              <video
                ref={videoRef}
                src={asset.url}
                onClick={handleVideoToggle}
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
                onEnded={() => setVideoPlaying(false)}
                className="w-full h-full object-contain flex-1"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 flex items-center justify-center gap-2 pointer-events-none">
                <Tooltip content="Restart">
                  <button
                    onClick={handleVideoRestart}
                    className="flex items-center gap-1 px-2 py-1 rounded-df-lg text-df-xs bg-df-surface-2/80 hover:bg-df-surface-2 text-df-text-secondary transition-colors border border-df-border"
                    aria-label="Restart"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg>
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-df-xs font-mono text-df-text-primary bg-df-surface-2 border border-df-border rounded-df-lg shadow-xl whitespace-nowrap pointer-events-none">Restart</div>
                </Tooltip>
                {!videoPlaying ? (
                  <Tooltip content="Play (Space)">
                    <button
                      onClick={handleVideoPlay}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-df-lg text-df-base bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-colors"
                      aria-label="Play"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Pause (Space)">
                    <button
                      onClick={handleVideoPause}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-df-lg text-df-base bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors"
                      aria-label="Pause"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-df-surface-2/50 rounded-xl p-4 border border-df-border text-center">
              <div className="text-sm text-df-text-muted">Unknown asset type</div>
            </div>
          )}
        </div>

        <div className="w-full mx-auto my-2 border-t border-df-border" />

        <div className="w-full px-2 space-y-1.5 text-df-sm">
          <div className="flex items-center gap-2">
            <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Type</span>
            <span className="text-df-accent font-mono truncate">{asset.type}</span>
          </div>
          {asset.duration && (
            <div className="flex items-center gap-2">
              <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Duration</span>
              <span className="font-mono text-df-text-secondary">{asset.duration.toFixed(2)}s</span>
            </div>
          )}
          {asset.width && asset.height && (
            <div className="flex items-center gap-2">
              <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Dimensions</span>
              <span className="font-mono text-df-text-secondary">{asset.width}×{asset.height}</span>
            </div>
          )}
          {asset.audioRole && (
            <div className="flex items-center gap-2">
              <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Audio Role</span>
              <span className="px-1.5 py-0.5 rounded-df-md text-[9px] font-medium bg-indigo-500/15 text-df-accent">{asset.audioRole}</span>
            </div>
          )}
          {asset.sampleRate && (
            <div className="flex items-center gap-2">
              <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Sample Rate</span>
              <span className="font-mono text-df-text-secondary">{asset.sampleRate} Hz</span>
            </div>
          )}
          {asset.channels && (
            <div className="flex items-center gap-2">
              <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>Channels</span>
              <span className="font-mono text-df-text-secondary">{asset.channels}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-df-xs text-df-text-muted shrink-0" style={{ width: '50px' }}>URL</span>
            <span className={`font-mono ${asset.url ? 'text-emerald-400' : 'text-red-400'}`}>
              {asset.url ? 'OK' : 'Missing'}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
};