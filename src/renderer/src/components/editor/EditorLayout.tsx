import React, { useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { AssetLibrary } from '../assets/AssetLibrary';
import { AssetPreview } from '../preview/AssetPreview';
import { VideoPreview } from '../preview/VideoPreview';
import { Timeline } from '../timeline/Timeline';
import { Inspector } from '../inspector/Inspector';
import { CommandEditor } from './CommandEditor';
import { AnimationPanel } from '../animation/AnimationPanel';
import { useDocuFlowStore } from '../../app/store';
import { ChevronLeft, ChevronRight, Settings, FileText, Sparkles } from 'lucide-react';
import { Tooltip } from '../ui';

const RIGHT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_MAX_WIDTH = 500;

const RIGHT_TABS = [
  { id: 'inspector' as const, label: 'Inspector', icon: Settings },
  { id: 'animation' as const, label: 'Animation', icon: Sparkles },
  { id: 'commands' as const, label: 'Commands', icon: FileText },
] as const;

export const EditorLayout: React.FC = () => {
  const panelVisibility = useDocuFlowStore((s) => s.panelVisibility);
  const setPanelVisibility = useDocuFlowStore((s) => s.setPanelVisibility);
  const workspaceLayout = useDocuFlowStore((s) => s.workspaceLayout);
  const setAssetsWidth = useDocuFlowStore((s) => s.setAssetsWidth);
  const setPreviewTimelineSplit = useDocuFlowStore((s) => s.setPreviewTimelineSplit);
  const setTimelineHeight = useDocuFlowStore((s) => s.setTimelineHeight);
  const selectedCommandId = useDocuFlowStore((s) => s.selectedCommandId);
  const rightPanel = useDocuFlowStore((s) => s.rightPanel);
  const setRightPanel = useDocuFlowStore((s) => s.setRightPanel);
  const rightPanelWidth = useDocuFlowStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useDocuFlowStore((s) => s.setRightPanelWidth);

  const rightPanelVisible = panelVisibility.inspector;

  useEffect(() => {
    if (selectedCommandId) {
      setRightPanel('inspector');
      if (!panelVisibility.inspector) {
        setPanelVisibility('inspector', true);
      }
    }
  }, [selectedCommandId, panelVisibility.inspector, setPanelVisibility]);

  // Sanitize persisted timeline height on mount: fix 0, negative, NaN, or out-of-range values
  useEffect(() => {
    const h = workspaceLayout.timelineHeight;
    if (!Number.isFinite(h) || h < 180) {
      setTimelineHeight(288);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for drag state
  const assetsDragRef = useRef(false);
  const splitDragRef = useRef(false);
  const rightPanelDragRef = useRef(false);
  const timelineDragRef = useRef(false);

  // Refs to panel DOM elements
  const assetsPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const previewSplitLeftRef = useRef<HTMLDivElement>(null);
  const previewSplitRightRef = useRef<HTMLDivElement>(null);
  const upperRowRef = useRef<HTMLDivElement>(null);

  // Initial pointer Y and timeline height captured on mousedown for delta-based resize
  const initialPointerYRef = useRef(0);
  const initialTimelineHeightForDragRef = useRef(workspaceLayout.timelineHeight);

  // Visual-only overrides during drag (no React re-renders)
  const visualOverridesRef = useRef<{
    assetsWidth?: number;
    rightPanelWidth?: number;
    timelineHeight?: number;
    previewSplit?: number;
  }>({});

  useLayoutEffect(() => {
    const v = visualOverridesRef.current;
    if (assetsPanelRef.current && v.assetsWidth !== undefined) {
      assetsPanelRef.current.style.width = `${v.assetsWidth}px`;
    }
    if (rightPanelRef.current && v.rightPanelWidth !== undefined) {
      rightPanelRef.current.style.width = `${v.rightPanelWidth}px`;
    }
    if (timelinePanelRef.current) {
      if (timelineDragRef.current && v.timelineHeight !== undefined) {
        timelinePanelRef.current.style.height = `${v.timelineHeight}px`;
        timelinePanelRef.current.style.flex = 'none';
      }
    }
    if (previewSplitLeftRef.current && v.previewSplit !== undefined) {
      previewSplitLeftRef.current.style.width = `${v.previewSplit}%`;
    }
    if (previewSplitRightRef.current && v.previewSplit !== undefined) {
      previewSplitRightRef.current.style.width = `${100 - v.previewSplit}%`;
    }
  });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (assetsDragRef.current) {
        const newWidth = Math.max(160, Math.min(400, e.clientX));
        visualOverridesRef.current.assetsWidth = newWidth;
        if (assetsPanelRef.current) {
          assetsPanelRef.current.style.width = `${newWidth}px`;
        }
      }
      if (splitDragRef.current) {
        const leftRef = previewSplitLeftRef.current;
        const rightRef = previewSplitRightRef.current;
        if (!leftRef || !rightRef) return;
        const container = leftRef.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const pct = Math.max(15, Math.min(85, (relX / rect.width) * 100));
        visualOverridesRef.current.previewSplit = pct;
        leftRef.style.width = `${pct}%`;
        rightRef.style.width = `${100 - pct}%`;
      }
      if (rightPanelDragRef.current) {
        const newWidth = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, window.innerWidth - e.clientX));
        visualOverridesRef.current.rightPanelWidth = newWidth;
        if (rightPanelRef.current) {
          rightPanelRef.current.style.width = `${newWidth}px`;
        }
      }
      if (timelineDragRef.current) {
        const timelineEl = timelinePanelRef.current;
        if (!timelineEl) return;
        const deltaY = e.clientY - initialPointerYRef.current;
        const newHeight = initialTimelineHeightForDragRef.current - deltaY;
        const parentEl = timelineEl.parentElement;
        const maxHeight = parentEl ? Math.floor(parentEl.getBoundingClientRect().height * 0.7) : window.innerHeight * 0.7;
        const clamped = Math.max(180, Math.min(maxHeight, newHeight));
        visualOverridesRef.current.timelineHeight = clamped;
        timelineEl.style.height = `${clamped}px`;
        timelineEl.style.flex = 'none';
      }
    };

    const handleMouseUp = () => {
      const overrides = visualOverridesRef.current;
      visualOverridesRef.current = {};

      if (assetsDragRef.current && overrides.assetsWidth !== undefined) {
        setAssetsWidth(overrides.assetsWidth);
      }
      if (splitDragRef.current && overrides.previewSplit !== undefined) {
        setPreviewTimelineSplit(overrides.previewSplit);
      }
      if (rightPanelDragRef.current && overrides.rightPanelWidth !== undefined) {
        setRightPanelWidth(overrides.rightPanelWidth);
      }
      if (timelineDragRef.current && overrides.timelineHeight !== undefined) {
        setTimelineHeight(overrides.timelineHeight);
      }

      assetsDragRef.current = false;
      splitDragRef.current = false;
      rightPanelDragRef.current = false;
      timelineDragRef.current = false;

      // Restore flex layout on timeline after drag
      if (timelinePanelRef.current) {
        timelinePanelRef.current.style.flex = '';
      }

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setAssetsWidth, setPreviewTimelineSplit, setRightPanelWidth, setTimelineHeight]);

  const handleAssetsMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    assetsDragRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleRightPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    rightPanelDragRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    timelineDragRef.current = true;
    initialPointerYRef.current = e.clientY;
    const el = timelinePanelRef.current;
    if (el) {
      const currentHeight = el.getBoundingClientRect().height;
      initialTimelineHeightForDragRef.current = currentHeight;
      visualOverridesRef.current.timelineHeight = currentHeight;
      el.style.height = `${currentHeight}px`;
      el.style.flex = 'none';
    }
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const hasUpperContent = panelVisibility.assets || panelVisibility.assetPreview || panelVisibility.timelinePreview || rightPanelVisible;

  return (
    <div className="w-full h-full flex flex-col bg-df-bg text-df-text-primary overflow-hidden">

      {/* ── UPPER WORKSPACE: Assets | Preview | Inspector ── */}
      {hasUpperContent && (
        <div ref={upperRowRef} className="w-full flex flex-row min-h-0 overflow-hidden" style={{ flex: '1 1 0%' }}>

          {/* Assets Panel */}
          {panelVisibility.assets && (
            <>
              <div
                ref={assetsPanelRef}
                className="bg-df-surface-1 flex flex-col overflow-hidden shrink-0 border-r border-df-border"
                style={{ width: workspaceLayout.assetsWidth }}
              >
                <AssetLibrary />
              </div>
              <div
                className="relative shrink-0 flex items-center justify-center group/resize cursor-col-resize"
                style={{ width: 12 }}
                onMouseDown={handleAssetsMouseDown}
                aria-label="Resize assets panel"
              >
                <div className="w-px h-full bg-df-border group-hover/resize:bg-df-accent transition-colors" />
              </div>
            </>
          )}

          {/* Preview Area */}
          {(panelVisibility.assetPreview || panelVisibility.timelinePreview) && (
            <div className="flex-1 min-w-0 flex flex-row overflow-hidden" style={{ minHeight: 0 }}>
              {panelVisibility.assetPreview && panelVisibility.timelinePreview ? (
                <>
                  <div
                    ref={previewSplitLeftRef}
                    style={{ width: `${workspaceLayout.previewTimelineSplit}%` }}
                    className="overflow-hidden min-w-0 flex flex-col"
                  >
                    <AssetPreview />
                  </div>
                  <div
                    className="relative shrink-0 flex items-center justify-center group/resize cursor-col-resize"
                    style={{ width: 12 }}
                    onMouseDown={handleSplitMouseDown}
                    aria-label="Resize preview panels"
                  >
                    <div className="w-px h-full bg-df-border group-hover/resize:bg-df-accent transition-colors" />
                  </div>
                  <div
                    ref={previewSplitRightRef}
                    style={{ width: `${100 - workspaceLayout.previewTimelineSplit}%` }}
                    className="overflow-hidden min-w-0 flex flex-col"
                  >
                    <VideoPreview />
                  </div>
                </>
              ) : panelVisibility.assetPreview ? (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <AssetPreview />
                </div>
              ) : (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <VideoPreview />
                </div>
              )}
            </div>
          )}

          {/* Right Panel (Inspector / Animation / Commands) */}
          {rightPanelVisible && (
            <>
              <div
                className="relative shrink-0 flex items-center justify-center group/resize cursor-col-resize"
                style={{ width: 12 }}
                onMouseDown={handleRightPanelMouseDown}
                aria-label="Resize right panel"
              >
                <div className="w-px h-full bg-df-border group-hover/resize:bg-df-accent transition-colors" />
              </div>
              <div
                ref={rightPanelRef}
                className="bg-df-surface-1 border-l border-df-border flex flex-col overflow-hidden shrink-0"
                style={{ width: rightPanelWidth }}
              >
                {/* Panel tabs */}
                <div className="flex border-b border-df-divider shrink-0">
                  <button
                    onClick={() => setPanelVisibility('inspector', false)}
                    className="px-1.5 text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 transition-colors shrink-0"
                    aria-label="Collapse right panel"
                  >
                    <ChevronRight size={10} />
                  </button>
                  {RIGHT_TABS.map((tab) => (
                    <Tooltip key={tab.id} content={`${tab.label} (Ctrl+${tab.id[0].toUpperCase()})`} position="bottom">
                      <button
                        onClick={() => setRightPanel(tab.id)}
                        className={`
                          flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-df-xs font-medium
                          border-b-2 transition-colors duration-df-fast
                          ${rightPanel === tab.id
                            ? 'text-df-accent border-df-accent'
                            : 'text-df-text-muted border-transparent hover:text-df-text-primary hover:bg-df-surface-2'}
                        `}
                      >
                        <tab.icon size={10} className="shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    </Tooltip>
                  ))}
                </div>

                {/* Panel content */}
                <div className="flex-1 overflow-hidden">
                  <div style={{ display: rightPanel === 'inspector' ? 'contents' : 'none' }} className="w-full h-full">
                    <Inspector />
                  </div>
                  <div style={{ display: rightPanel === 'animation' ? 'contents' : 'none' }} className="w-full h-full">
                    <AnimationPanel />
                  </div>
                  <div style={{ display: rightPanel === 'commands' ? 'contents' : 'none' }} className="w-full h-full">
                    <CommandEditor />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Right Panel Expand Button */}
          {!rightPanelVisible && (
            <button
              onClick={() => setPanelVisibility('inspector', true)}
              className="w-5 bg-df-surface-1 border-l border-df-border flex flex-col items-center pt-2 hover:bg-df-surface-2 shrink-0 cursor-pointer transition-colors"
              aria-label="Expand right panel"
            >
              <ChevronLeft size={10} className="text-df-text-muted" />
            </button>
          )}
        </div>
      )}

      {/* ── TIMELINE RESIZE HANDLE ── */}
      <div
        className="h-1 w-full cursor-ns-resize hover:bg-df-accent/30 transition-colors shrink-0 relative"
        onMouseDown={handleTimelineMouseDown}
        aria-label="Resize timeline panel"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-df-border" />
      </div>

      {/* ── FULL-WIDTH TIMELINE ── */}
      <div
        ref={timelinePanelRef}
        className="min-h-0 flex flex-col relative bg-df-surface-1 overflow-hidden w-full"
        style={{ height: Math.max(180, workspaceLayout.timelineHeight || 288), flex: 'none' }}
      >
        <Timeline />
      </div>

      {/* Empty state */}
      {!hasUpperContent && (
        <div className="flex-1 flex items-center justify-center bg-df-bg">
          <div className="text-center text-df-text-muted">
            <div className="text-df-sm mb-1">No panels visible</div>
            <div className="text-df-xs text-df-text-dim">Enable panels from the toolbar</div>
          </div>
        </div>
      )}
    </div>
  );
};
