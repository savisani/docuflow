import React, { useState, useEffect, useCallback } from 'react';
import { Minus, Square, X, Maximize2, Undo2, Redo2, PanelLeft, Image, SlidersHorizontal, Sparkles, Film, Clapperboard, FileText, FolderOpen, Save, FilePlus, Workflow, Power, Loader2, Copy } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { Tooltip, Dropdown } from '../ui';

const TABS = [
  { id: 'studio' as const, label: 'Studio', icon: Film },
  { id: 'generator' as const, label: 'Image Gen', icon: Sparkles },
  { id: 'scenes' as const, label: 'Scene Gen', icon: Clapperboard },
  { id: 'motion' as const, label: 'Motion GFX', icon: Workflow },
] as const;

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [unloadingModels, setUnloadingModels] = useState(false);
  const [unloadMessage, setUnloadMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const {
    historyIndex, history,
    panelVisibility, setPanelVisibility,
    undo, redo,
    activeTab, setActiveTab,
    saveStatus, projectPath,
    newProject, openProjectFromDialog, saveProject, saveAsProject,
  } = useDocuFlowStore();

  useEffect(() => {
    window.docuflow?.isMaximized()?.then(setIsMaximized);
    const unsubscribe = window.docuflow?.onMaximizedChange(setIsMaximized);
    return () => { unsubscribe?.(); };
  }, []);

  const handleMinimize = useCallback(() => { window.docuflow?.minimize(); }, []);
  const handleMaximize = useCallback(() => { window.docuflow?.maximize(); }, []);
  const handleClose = useCallback(() => { window.docuflow?.close(); }, []);

  const handleNewProject = useCallback(() => {
    newProject();
  }, [newProject]);

  const handleOpenProject = useCallback(async () => {
    await openProjectFromDialog();
  }, [openProjectFromDialog]);

  const handleSave = useCallback(async () => {
    await saveProject();
  }, [saveProject]);

  const handleSaveAs = useCallback(async () => {
    await saveAsProject();
  }, [saveAsProject]);

  // ── Unload All Models ──────────────────────────────────────────
  const handleUnloadAllModels = useCallback(async () => {
    if (unloadingModels) return;
    
    setUnloadingModels(true);
    setUnloadMessage(null);
    
    try {
      // Check if any model is currently loaded
      const modelStatus = await window.docuflow?.getModelStatus();
      const activeModel = await window.docuflow?.getActiveLocalModel();
      
      // If no model is loaded and no Ollama model is active
      if (!modelStatus?.loaded && (!activeModel || activeModel.type === 'none')) {
        setUnloadMessage({ text: 'No models currently loaded', type: 'info' });
        setUnloadingModels(false);
        return;
      }
      
      let unloadCount = 0;
      let errors: string[] = [];
      
      // Unload diffusion model if loaded
      if (modelStatus?.loaded) {
        try {
          const result = await window.docuflow?.unloadModel();
          if (result?.success) {
            unloadCount++;
          } else {
            errors.push(result?.error || 'Failed to unload diffusion model');
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'Failed to unload diffusion model');
        }
      }
      
      // Unload Ollama model (keep_alive: 0) without stopping the server
      if (activeModel?.type === 'ollama' && activeModel?.model) {
        try {
          // Use the offloadModel function which sends keep_alive: 0
          const { offloadModel } = await import('../../services/aiService');
          const result = await offloadModel(activeModel.model);
          if (result.success) {
            unloadCount++;
          } else {
            errors.push(result.error || 'Failed to unload Ollama model');
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'Failed to unload Ollama model');
        }
      }
      
      if (errors.length > 0) {
        setUnloadMessage({ text: `Partial unload: ${errors.join('; ')}`, type: 'error' });
      } else if (unloadCount > 0) {
        setUnloadMessage({ text: 'All models unloaded', type: 'success' });
      } else {
        setUnloadMessage({ text: 'No models currently loaded', type: 'info' });
      }
    } catch (err) {
      setUnloadMessage({ text: err instanceof Error ? err.message : 'Failed to unload models', type: 'error' });
    } finally {
      setUnloadingModels(false);
      // Auto-dismiss message after 3 seconds
      setTimeout(() => setUnloadMessage(null), 3000);
    }
  }, [unloadingModels]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div
      className="h-[36px] flex items-center bg-df-surface-1 border-b border-df-border select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Logo + Title */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <div className="w-5 h-5 rounded-df-sm bg-df-accent flex items-center justify-center">
          <span className="text-df-xs font-bold text-white">D</span>
        </div>
        <span className="text-df-sm font-semibold text-df-text-primary tracking-wide">DocuFlow</span>
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* Workspace Tabs — Segmented Control */}
      <div
        className="flex items-center bg-df-surface-2 rounded-df-md border border-df-border p-px"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 rounded-df-sm text-df-xs font-medium
              transition-all duration-df-fast
              ${activeTab === tab.id
                ? 'bg-df-accent text-white shadow-sm'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'}
            `}
          >
            <tab.icon size={11} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* Unload All Models Button */}
      <div
        className="relative"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip content="Unload all AI models from VRAM" position="bottom">
          <button
            onClick={handleUnloadAllModels}
            disabled={unloadingModels}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-df-sm text-df-xs font-medium bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-muted hover:text-df-text-primary transition-all duration-df-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {unloadingModels ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Power size={11} />
            )}
            <span>Unload All Models</span>
          </button>
        </Tooltip>
        
        {/* Unload Status Toast */}
        {unloadMessage && (
          <div className={`absolute top-full left-0 mt-1 px-2 py-1 rounded-df-sm text-df-xs font-medium whitespace-nowrap z-50 flex items-center gap-1 ${
            unloadMessage.type === 'success' ? 'bg-df-success text-white' :
            unloadMessage.type === 'error' ? 'bg-df-error text-white' :
            'bg-df-surface-3 text-df-text-primary border border-df-border'
          }`}>
            <span>{unloadMessage.text}</span>
            {unloadMessage.type === 'error' && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`Error: ${unloadMessage.text}`);
                  } catch {
                    const textarea = document.createElement('textarea');
                    textarea.value = `Error: ${unloadMessage.text}`;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '-9999px';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                  }
                }}
                className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                title="Copy error to clipboard"
              >
                <Copy size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* File Menu */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Dropdown
          trigger={
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-df-sm text-df-xs font-semibold bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-primary transition-all duration-df-fast active:scale-[0.97]">
              <span>File</span>
            </button>
          }
          content={
            <div className="py-1">
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-df-xs text-df-text-primary hover:bg-df-surface-3 transition-colors"
              >
                <FilePlus size={11} />
                <span>New</span>
                <span className="ml-auto text-df-text-dim text-[10px]">Ctrl+N</span>
              </button>
              <button
                onClick={handleOpenProject}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-df-xs text-df-text-primary hover:bg-df-surface-3 transition-colors"
              >
                <FolderOpen size={11} />
                <span>Open</span>
                <span className="ml-auto text-df-text-dim text-[10px]">Ctrl+O</span>
              </button>
              <div className="h-px bg-df-border mx-2 my-1" />
              <button
                onClick={handleSave}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-df-xs text-df-text-primary hover:bg-df-surface-3 transition-colors"
              >
                <Save size={11} />
                <span>Save</span>
                <span className="ml-auto text-df-text-dim text-[10px]">Ctrl+S</span>
              </button>
              <button
                onClick={handleSaveAs}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-df-xs text-df-text-primary hover:bg-df-surface-3 transition-colors"
              >
                <FileText size={11} />
                <span>Save As</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Save Status Indicator */}
      <div
        className="flex items-center gap-2 px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {projectPath && (
          <span className="text-df-xs text-df-text-dim max-w-[200px] truncate" title={projectPath}>
            {projectPath.split(/[/\\]/).pop()}
          </span>
        )}
        <span className={`text-df-xs font-medium ${
          saveStatus === 'saved' ? 'text-df-success' :
          saveStatus === 'unsaved' ? 'text-df-warning' :
          saveStatus === 'saving' ? 'text-df-accent animate-pulse' :
          'text-df-error'
        }`}>
          {saveStatus === 'saved' ? '● Saved' :
           saveStatus === 'unsaved' ? '○ Unsaved' :
           saveStatus === 'saving' ? '◐ Saving...' :
           '✕ Save failed'}
        </span>
      </div>

      <div className="w-px h-4 bg-df-divider mx-1" />

      {/* Actions */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Tooltip content="Undo (Ctrl+Z)" position="bottom">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-df-sm text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-all duration-df-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Undo2 size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)" position="bottom">
          <button
            onClick={redo}
            disabled={!canRedo}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-df-sm text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-all duration-df-fast disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Redo2 size={12} />
          </button>
        </Tooltip>

        {/* Studio-only panel toggles */}
        {activeTab === 'studio' && (
          <>
            <div className="w-px h-4 bg-df-divider mx-1" />

            <Tooltip content="Assets Panel" position="bottom">
              <button
                onClick={() => setPanelVisibility('assets', !panelVisibility.assets)}
                className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
                  panelVisibility.assets
                    ? 'bg-df-accent-muted text-df-accent'
                    : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
                }`}
              >
                <PanelLeft size={12} />
              </button>
            </Tooltip>
            <Tooltip content="Asset Preview" position="bottom">
              <button
                onClick={() => setPanelVisibility('assetPreview', !panelVisibility.assetPreview)}
                className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
                  panelVisibility.assetPreview
                    ? 'bg-df-accent-muted text-df-accent'
                    : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
                }`}
              >
                <Image size={12} />
              </button>
            </Tooltip>
            <Tooltip content="Inspector" position="bottom">
              <button
                onClick={() => setPanelVisibility('inspector', !panelVisibility.inspector)}
                className={`w-[26px] h-[26px] flex items-center justify-center rounded-df-sm transition-all duration-df-fast ${
                  panelVisibility.inspector
                    ? 'bg-df-accent-muted text-df-accent'
                    : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3'
                }`}
              >
                <SlidersHorizontal size={12} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Window Controls Only */}
      <div
        className="flex items-center h-full shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 transition-colors"
          aria-label="Minimize"
        >
          <Minus size={13} strokeWidth={1.5} />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 transition-colors"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Square size={10} strokeWidth={1.5} /> : <Maximize2 size={11} strokeWidth={1.5} />}
        </button>
        <button
          onClick={handleClose}
          className="h-full w-[36px] flex items-center justify-center text-df-text-muted hover:text-white hover:bg-df-error transition-colors"
          aria-label="Close"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};
