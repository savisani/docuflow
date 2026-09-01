import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { v4 as uuidv4 } from 'uuid';
import { generateId } from '../../utils/format';
import { loadAssetMetadata } from '../../engine/media/loader';
import { formatTimestamp } from '../../engine/transcription/service';
import { getAvailableModels, type WhisperModelInfo } from '../../engine/transcription/localProvider';
import { Mic, Play, Pause, Trash2, Languages, FileText, MapPin, AlertCircle, CheckCircle, Loader2, Cpu, RefreshCw, Power, Minimize2, Trash } from 'lucide-react';
import { Command } from '../../engine/commands/types';
import { useServerStatus } from '../../hooks/useServerStatus';
import { Panel, Section, Divider, LabelValue, Badge, IconButton, Tooltip, Toggle, Select, Slider, Input } from '../ui';

const LANGUAGES = [
  { code: 'auto', label: 'Auto Detect' },
  { code: 'hi', label: 'Hindi' },
  { code: 'en', label: 'English' },
  { code: 'pa', label: 'Punjabi' },
];

const TRANSCRIPTION_STEPS = [
  'Preparing audio...',
  'Loading model...',
  'Transcribing...',
  'Generating timestamps...',
  'Complete',
];

export const VoiceoverPanel: React.FC = () => {
  const {
    assets,
    voiceover,
    transcript,
    sceneMarkers,
    transcriptionStatus,
    transcriptionError,
    transcriptionStep,
    transcriptionStepLabel,
    transcriptionStartedAt,
    currentTime,
    setVoiceover,
    setTranscript,
    setSceneMarkers,
    addSceneMarker,
    removeSceneMarker,
    setTranscriptionStatus,
    setTranscriptionError,
    setTranscriptionStep,
    resetTranscriptionProgress,
    setAudioRole,
    addCommand,
    setCurrentTime,
  } = useDocuFlowStore();

  const { health, status: serverStatus, serverStarting, startServer, restartServer } = useServerStatus();
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [selectedModel, setSelectedModel] = useState('base');
  const [availableModels, setAvailableModels] = useState<WhisperModelInfo[]>([]);
  const [importing, setImporting] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingSegment, setPlayingSegment] = useState<string | null>(null);

  const voiceoverAsset = voiceover
    ? assets.find((a) => a.id === voiceover.assetId)
    : undefined;

  const serverOnline = serverStatus === 'running';

  useEffect(() => {
    if (serverOnline) {
      getAvailableModels().then((modelsData) => {
        if (modelsData?.models) {
          setAvailableModels(modelsData.models);
          if (modelsData.default) setSelectedModel(modelsData.default);
        }
      });
    }
  }, [serverOnline]);

  const handleImportVoiceover = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        const currentAssets = useDocuFlowStore.getState().assets;
        const metadata = await loadAssetMetadata(file, currentAssets);
        const newAsset: any = {
          id: generateId(),
          ...metadata,
          audioRole: 'voiceover' as const,
        };
        useDocuFlowStore.getState().addAsset(newAsset);
        setVoiceover({ assetId: newAsset.id, language: selectedLanguage });
        setAudioRole(newAsset.id, 'voiceover');
      } catch (err) {
        console.error('Failed to import voiceover:', err);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }, [selectedLanguage, setVoiceover, setAudioRole]);

  const handleTranscribe = useCallback(async () => {
    if (!voiceoverAsset?.url) return;

    if (!serverOnline) {
      setTranscriptionStatus('error');
      setTranscriptionError(
        'Local transcription server is not running. Click "Start Local Transcription Server" above.'
      );
      return;
    }

    setTranscriptionStatus('processing');
    setTranscriptionError(null);
    setTranscriptionStep(0, 'Preparing audio...');

    try {
      const response = await fetch(voiceoverAsset.url);
      const blob = await response.blob();
      const file = new File([blob], voiceoverAsset.filename, { type: voiceoverAsset.mimeType });

      setTranscriptionStep(1, 'Sending to transcription server...');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('language', voiceover?.language || 'auto');
      formData.append('word_timestamps', 'true');
      formData.append('vad_filter', 'true');
      formData.append('model', selectedModel);

      const baseUrl = (import.meta as any).env?.VITE_TRANSCRIPTION_URL || 'http://127.0.0.1:8765';

      setTranscriptionStep(2, `Transcribing with ${selectedModel} model...`);

      const result = await fetch(`${baseUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(300000),
      });

      setTranscriptionStep(3, 'Finalizing transcript...');

      if (!result.ok) {
        const errData = await result.json().catch(() => null);
        throw new Error(errData?.detail || `Server error ${result.status}`);
      }

      const data = await result.json();

      setTranscript({
        language: data.language || voiceover?.language || 'auto',
        text: data.text || '',
        segments: (data.segments || []).map((s: any) => ({
          id: s.id,
          text: s.text,
          start: s.start,
          end: s.end,
          words: s.words?.map((w: any) => ({
            text: w.text,
            start: w.start,
            end: w.end,
          })),
        })),
      });

      setTranscriptionStep(4, 'Completed');
      setTranscriptionStatus('complete');
    } catch (err) {
      setTranscriptionStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('CUDA') || message.includes('GPU')) {
        setTranscriptionError(`CUDA initialization failed. Try the base model or verify your NVIDIA driver.\n\n${message}`);
      } else if (message.includes('timeout') || message.includes('Timeout')) {
        setTranscriptionError('Transcription timed out. Try a shorter audio file or check GPU memory.');
      } else {
        setTranscriptionError(message);
      }
    }
  }, [voiceoverAsset, voiceover?.language, selectedModel, serverOnline, setTranscript, setTranscriptionStatus, setTranscriptionError, setTranscriptionStep]);

  const handleRemoveVoiceover = useCallback(() => {
    setVoiceover(null);
    setTranscript(null);
    setSceneMarkers([]);
    setTranscriptionStatus('idle');
    setTranscriptionError(null);
    resetTranscriptionProgress();
  }, [setVoiceover, setTranscript, setSceneMarkers, setTranscriptionStatus, setTranscriptionError, resetTranscriptionProgress]);

  const handleSegmentClick = useCallback((start: number) => {
    setCurrentTime(start);
    window.dispatchEvent(new CustomEvent('docuflow:seek', { detail: { frame: Math.round(start * 30) } }));
  }, [setCurrentTime]);

  const handleCreateSubtitles = useCallback(() => {
    if (!transcript) return;

    const state = useDocuFlowStore.getState();
    const existingSubtitleIds = new Set(
      state.commands
        .filter((c) => c.type === 'subtitle')
        .map((c) => c.id)
    );

    for (const segment of transcript.segments) {
      if (existingSubtitleIds.has(segment.id)) continue;

      const cmd: Command = {
        id: segment.id,
        type: 'subtitle',
        content: segment.text,
        start: segment.start,
        duration: segment.end - segment.start,
      };
      useDocuFlowStore.getState().addCommand(cmd);
    }
  }, [transcript]);

  const handleCreateSceneMarkers = useCallback(() => {
    if (!transcript) return;

    const markers: typeof sceneMarkers = [];
    const SEGMENT_GROUP_SIZE = 3;

    for (let i = 0; i < transcript.segments.length; i += SEGMENT_GROUP_SIZE) {
      const group = transcript.segments.slice(i, i + SEGMENT_GROUP_SIZE);
      markers.push({
        id: uuidv4(),
        start: group[0].start,
        end: group[group.length - 1].end,
        transcriptSegmentIds: group.map((s) => s.id),
      });
    }

    setSceneMarkers(markers);
  }, [transcript, setSceneMarkers]);

  const progressPercent = transcriptionStep >= 0
    ? Math.round(((transcriptionStep + 1) / TRANSCRIPTION_STEPS.length) * 100)
    : 0;

  // Elapsed time for transcription
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (transcriptionStatus !== 'processing' || !transcriptionStartedAt) {
      setElapsedSec(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - transcriptionStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [transcriptionStatus, transcriptionStartedAt]);

  return (
    <Panel title="Voiceover" icon={<Mic size={10} />} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <Section title="Audio Source" className="space-y-2">
          {voiceoverAsset ? (
            <div className="bg-[var(--color-bg-elevated)] rounded p-2 space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <Mic size={12} className="text-[var(--color-track-voiceover)]" />
                <span className="text-[var(--color-track-voiceover)] font-mono truncate">{voiceoverAsset.logicalId}</span>
                <span className="text-[var(--color-text-muted)] truncate">{voiceoverAsset.filename}</span>
              </div>
              {voiceoverAsset.duration && (
                <LabelValue label="Duration" value={`${voiceoverAsset.duration.toFixed(2)}s`} labelWidth="60px" />
              )}
              <div className="flex gap-1">
                <Tooltip content="Remove voiceover">
                  <IconButton size="sm" variant="danger" aria-label="Remove" onClick={handleRemoveVoiceover}>
                    <Trash size={10} /> Remove
                  </IconButton>
                </Tooltip>
              </div>
            </div>
          ) : (
            <Tooltip content="Import voiceover audio file">
              <IconButton
                size="lg"
                variant="secondary"
                aria-label="Import Voiceover Audio"
                onClick={handleImportVoiceover}
                disabled={importing}
                className="w-full justify-center gap-2 px-3 py-4 rounded border-2 border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)] transition-colors text-[11px]"
              >
                {importing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Mic size={18} />
                )}
                {importing ? 'Importing...' : 'Import Voiceover Audio'}
              </IconButton>
            </Tooltip>
          )}
        </Section>

        <Section title="Language" icon={<Languages size={10} />} className="space-y-2">
          <Select
            value={voiceover?.language || selectedLanguage}
            onChange={(e) => {
              setSelectedLanguage(e.target.value);
              if (voiceover) {
                setVoiceover({ ...voiceover, language: e.target.value });
              }
            }}
            options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
            className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] text-white"
          />
        </Section>

        <Section title="Model" icon={<Cpu size={10} />} className="space-y-2">
          <Select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={!serverOnline}
            options={availableModels.length > 0
              ? availableModels.map((m) => ({ value: m.name, label: `${m.name} - ${m.description}` }))
              : [
                  { value: 'tiny', label: 'tiny - Fastest, ~1GB VRAM' },
                  { value: 'base', label: 'base - Balanced speed/quality, ~1GB VRAM' },
                  { value: 'small', label: 'small - Better accuracy, ~2GB VRAM' },
                ]}
            className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] text-white disabled:opacity-50"
          />
          {availableModels.length > 0 && (
            <div className="text-[9px] text-[var(--color-text-muted)] space-y-0.5">
              {(() => {
                const m = availableModels.find((x) => x.name === selectedModel);
                return m ? (
                  <>
                    <div>Speed: {m.speed} | Accuracy: {m.accuracy}</div>
                    <div>Optimized for repeated short voiceovers</div>
                  </>
                ) : null;
              })()}
            </div>
          )}
        </Section>

        <Section title="Local Transcription" icon={<Cpu size={10} />} className="space-y-2">
          <div className="bg-[var(--color-bg-elevated)] rounded p-2 space-y-2">
            {serverStatus === 'checking' && (
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-[var(--color-accent-primary)]" />
                <span className="text-[11px] text-[var(--color-text-muted)]">Checking server status...</span>
              </div>
            )}

            {serverStatus === 'running' && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0" />
                    <span className="text-[11px] text-[var(--color-success)]">Server Running</span>
                  </div>
                  <Tooltip content="Restart server">
                    <IconButton size="sm" variant="ghost" aria-label="Restart" onClick={restartServer}>
                      <RefreshCw size={10} />
                    </IconButton>
                  </Tooltip>
                </div>
                {health && (
                  <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
                    {health.gpu_name && <div>GPU: {health.gpu_name}</div>}
                    <div>CUDA: {health.cuda_available ? 'Available' : 'Unavailable'}</div>
                    <div>Model: {health.model}</div>
                  </div>
                )}
              </>
            )}

            {serverStatus === 'offline' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-error)] shrink-0" />
                  <span className="text-[11px] text-[var(--color-text-muted)]">Server Offline</span>
                </div>
                <Tooltip content="Start local transcription server">
                  <IconButton size="md" variant="primary" aria-label="Start Server" onClick={startServer} className="w-full justify-center gap-2">
                    <Power size={12} />
                    Start Local Transcription Server
                  </IconButton>
                </Tooltip>
              </div>
            )}

            {serverStatus === 'starting' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin text-[var(--color-warning)]" />
                  <span className="text-[11px] text-[var(--color-warning)]">Starting server...</span>
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] space-y-1">
                  <div className="font-semibold text-[var(--color-text-secondary)]">To start the server, run in a terminal:</div>
                  <code className="block bg-[var(--color-bg)] rounded px-2 py-1.5 text-[10px] text-[var(--color-success)] font-mono select-all">
                    cd server && start.bat
                  </code>
                  <div className="text-[var(--color-border)]">Auto-detecting when server comes online...</div>
                </div>
              </div>
            )}

            {serverStatus === 'failed' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle size={12} className="text-[var(--color-error)]" />
                  <span className="text-[11px] text-[var(--color-error)]">Failed to Start</span>
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] space-y-1">
                  <div>Server did not respond within 30 seconds.</div>
                  <div className="font-semibold text-[var(--color-text-secondary)]">Start manually in a terminal:</div>
                  <code className="block bg-[var(--color-bg)] rounded px-2 py-1.5 text-[10px] text-[var(--color-success)] font-mono select-all">
                    cd server && start.bat
                  </code>
                </div>
                <Tooltip content="Retry starting server">
                  <IconButton size="sm" variant="secondary" aria-label="Try Again" onClick={startServer} className="w-full justify-center gap-2">
                    <RefreshCw size={12} />
                    Try Again
                  </IconButton>
                </Tooltip>
              </div>
            )}
          </div>
        </Section>

        <Section title="Transcription" icon={<FileText size={10} />} className="space-y-2">
          <Tooltip content="Transcribe voiceover audio">
            <IconButton
              size="lg"
              variant="primary"
              aria-label="Transcribe"
              onClick={handleTranscribe}
              disabled={!voiceoverAsset || transcriptionStatus === 'processing' || !serverOnline}
              className="w-full justify-center gap-2 px-3 py-3 rounded"
            >
              {transcriptionStatus === 'processing' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Transcribing...
                </>
              ) : (
                <>
                  <FileText size={14} />
                  Transcribe
                </>
              )}
            </IconButton>
          </Tooltip>

          {!serverOnline && voiceoverAsset && (
            <div className="text-[10px] text-[var(--color-text-muted)]">Server must be running to transcribe</div>
          )}

          {transcriptionStatus === 'processing' && (
            <div className="space-y-1">
              <div className="text-[10px] text-[var(--color-accent-primary)]">
                {transcriptionStepLabel || 'Starting...'}
              </div>
              <div className="w-full bg-[var(--color-border)] rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent-primary)] rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)]">
                {transcriptionStepLabel || 'Processing...'} {elapsedSec > 0 && `(${elapsedSec}s elapsed)`}
              </div>
            </div>
          )}

          {transcriptionStatus === 'error' && transcriptionError && (
            <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)]/50 rounded p-2 text-[11px] text-[var(--color-error)] whitespace-pre-wrap font-mono text-[10px]">
              {transcriptionError}
            </div>
          )}

          {transcriptionStatus === 'complete' && transcript && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--color-success)]">
              <CheckCircle size={12} />
              Transcription complete ({transcript.segments.length} segments)
            </div>
          )}
        </Section>

        {transcript && transcript.segments.length > 0 && (
          <Section title={`Transcript (${transcript.language})`} className="space-y-2">
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {transcript.segments.map((segment) => (
                <button
                  key={segment.id}
                  onClick={() => handleSegmentClick(segment.start)}
                  className={`
                    w-full p-2 rounded text-[11px] text-left cursor-pointer transition-colors
                    ${currentTime >= segment.start && currentTime < segment.end
                      ? 'bg-[var(--color-accent-primary-muted)] border border-[var(--color-accent-primary)]/50 text-[var(--color-accent-primary)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)]/50 border border-transparent'}
                  `}
                >
                  <div className="font-mono text-[10px] text-[var(--color-text-muted)] mb-0.5">
                    {formatTimestamp(segment.start)}
                  </div>
                  <div>{segment.text}</div>
                  {segment.words && segment.words.length > 0 && (
                    <div className="mt-1 text-[9px] text-[var(--color-border)]">
                      {segment.words.map((w, i) => (
                        <span key={i}>
                          <span className="text-[var(--color-text-muted)]">{w.text}</span>
                          <span className="text-[var(--color-divider)] mx-0.5">|</span>
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </Section>
        )}

        {transcript && transcript.segments.length > 0 && (
          <Section title="Actions" className="space-y-1">
            <Tooltip content="Generate subtitle commands from transcript">
              <IconButton size="md" variant="secondary" aria-label="Generate Subtitles" onClick={handleCreateSubtitles} className="w-full justify-center gap-2">
                <FileText size={12} /> Generate Subtitles
              </IconButton>
            </Tooltip>
            <Tooltip content="Create scene markers from transcript">
              <IconButton size="md" variant="secondary" aria-label="Create Scene Markers" onClick={handleCreateSceneMarkers} className="w-full justify-center gap-2">
                <MapPin size={12} /> Create Scene Markers
              </IconButton>
            </Tooltip>
          </Section>
        )}

        {sceneMarkers.length > 0 && (
          <Section title={`Scene Markers (${sceneMarkers.length})`} icon={<MapPin size={10} />} className="space-y-2">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {sceneMarkers.map((marker, idx) => (
                <button
                  key={marker.id}
                  onClick={() => handleSegmentClick(marker.start)}
                  className="flex items-center justify-between p-1.5 rounded bg-[var(--color-bg-elevated)] text-[11px] cursor-pointer hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
                >
                  <div>
                    <span className="text-[var(--color-text-muted)] font-mono mr-2">Scene {idx + 1}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {formatTimestamp(marker.start)} — {formatTimestamp(marker.end)}
                    </span>
                  </div>
                  <Tooltip content="Remove scene marker">
                    <IconButton size="sm" variant="ghost" aria-label="Remove" onClick={(e) => { e.stopPropagation(); removeSceneMarker(marker.id); }}>
                      <Trash size={10} />
                    </IconButton>
                  </Tooltip>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </Panel>
  );
};


