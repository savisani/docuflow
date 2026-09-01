import React, { useCallback, useRef, useEffect } from 'react';
import { AssetLibrary } from '../assets/AssetLibrary';
import { AssetPreview } from '../preview/AssetPreview';
import { VideoPreview } from '../preview/VideoPreview';
import { Timeline } from '../timeline/Timeline';
import { Inspector } from '../inspector/Inspector';
import { CommandEditor } from './CommandEditor';
import { CommandConsole } from '../commands/CommandConsole';
import { VoiceoverPanel } from '../voiceover/VoiceoverPanel';
import { useDocuFlowStore } from '../../app/store';
import { Settings, FileText, ChevronLeft, ChevronRight, Mic, Terminal } from 'lucide-react';
import { Tooltip } from '../ui';

const RIGHT_PANEL_MIN_WIDTH = 220;
const RIGHT_PANEL_MAX_WIDTH = 500;

export const EditorLayout: React.FC = () => {
  const {
    panelVisibility,
    setPanelVisibility,
    workspaceLayout,
    setAssetsWidth,
    setPreviewTimelineSplit,
    selectedCommandId,
    rightPanel,
    setRightPanel,
    rightPanelWidth,
    setRightPanelWidth,
  } = useDocuFlowStore();

  const rightPanelVisible = panelVisibility.inspector;

  useEffect(() => {
    if (selectedCommandId) {
      setRightPanel('inspector');
      if (!panelVisibility.inspector) {
        setPanelVisibility('inspector', true);
      }
    }
  }, [selectedCommandId, panelVisibility.inspector, setPanelVisibility]);

  const assetsDragRef = useRef(false);
  const splitDragRef = useRef(false);
  const rightPanelDragRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (assetsDragRef.current) {
        const newWidth = Math.max(160, Math.min(400, e.clientX));
        setAssetsWidth(newWidth);
      }
      if (splitDragRef.current) {
        const container = document.getElementById('center-area');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const pct = (relX / rect.width) * 100;
        setPreviewTimelineSplit(Math.max(15, Math.min(85, pct)));
      }
      if (rightPanelDragRef.current) {
        const newWidth = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, window.innerWidth - e.clientX));
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      assetsDragRef.current = false;
      splitDragRef.current = false;
      rightPanelDragRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setAssetsWidth, setPreviewTimelineSplit, setRightPanelWidth]);

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

  const anyVisible = panelVisibility.assets || panelVisibility.assetPreview || panelVisibility.timelinePreview || panelVisibility.timeline;

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-white overflow-hidden">
      <div className="flex-1 w-full h-full flex flex-row overflow-hidden">
        {/* Assets Panel - always rendered, transitions width */}
        <div
          className="bg-slate-900/60 backdrop-blur-xl flex flex-col overflow-hidden shrink-0 border-r border-white/5 transition-all duration-200"
          style={{ width: panelVisibility.assets ? workspaceLayout.assetsWidth : 0 }}
        >
          <AssetLibrary />
        </div>
        {panelVisibility.assets && (
          <div
            className="w-1 bg-white/5 hover:bg-indigo-500/50 cursor-col-resize shrink-0 transition-colors"
            onMouseDown={handleAssetsMouseDown}
            aria-label="Resize assets panel"
          />
        )}

        <div id="center-area" className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
          {!anyVisible && (
            <div className="flex-1 flex items-center justify-center bg-slate-950">
              <div className="text-center text-slate-500">
                <div className="text-sm mb-1">No panels visible</div>
                <div className="text-[11px]">Enable panels from the toolbar</div>
              </div>
            </div>
          )}

          {(panelVisibility.assetPreview || panelVisibility.timelinePreview) && (
            <div
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              <div className="flex flex-row overflow-hidden" style={{ flex: '1 1 auto', minHeight: 0 }}>
                {panelVisibility.assetPreview && panelVisibility.timelinePreview ? (
                  <>
                    <div
                      style={{ width: `${workspaceLayout.previewTimelineSplit}%` }}
                      className="overflow-hidden min-w-0 flex flex-col"
                    >
                      <AssetPreview />
                    </div>
                    <div
                      className="w-1 bg-white/5 hover:bg-indigo-500/50 cursor-col-resize shrink-0 transition-colors"
                      onMouseDown={handleSplitMouseDown}
                      aria-label="Resize preview panels"
                    />
                    <div
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
            </div>
          )}

          {panelVisibility.timeline && (
            <div className="h-72 shrink-0 flex flex-col relative border-t border-white/10 bg-slate-900/90 overflow-hidden">
              <Timeline />
            </div>
          )}
        </div>

        {/* Right Panel - always rendered, transitions width */}
        {!rightPanelVisible && (
          <button
            onClick={() => setPanelVisibility('inspector', true)}
            className="w-6 bg-slate-900/60 backdrop-blur-xl border-l border-white/5 flex flex-col items-center pt-2 hover:bg-white/5 shrink-0 cursor-pointer transition-colors"
            aria-label="Expand right panel"
          >
            <ChevronLeft size={12} className="text-slate-500" />
          </button>
        )}

        <div
          className="bg-slate-900/60 backdrop-blur-xl border-l border-white/5 flex flex-col overflow-hidden shrink-0 transition-all duration-200 relative"
          style={{ width: rightPanelVisible ? rightPanelWidth : 0 }}
        >
          {rightPanelVisible && (
            <>
              <div
                className="w-1 bg-white/5 hover:bg-indigo-500/50 cursor-col-resize shrink-0 transition-colors absolute left-0 top-0 bottom-0 z-10"
                onMouseDown={handleRightPanelMouseDown}
                aria-label="Resize right panel"
              />
              <div className="flex border-b border-white/5 shrink-0">
                <button
                  onClick={() => setPanelVisibility('inspector', false)}
                  className="px-2 text-slate-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                  aria-label="Collapse right panel"
                >
                  <ChevronRight size={12} />
                </button>
                {([
                  { id: 'inspector' as const, label: 'Inspector', icon: Settings },
                  { id: 'commands' as const, label: 'Commands', icon: FileText },
                  { id: 'console' as const, label: 'Console', icon: Terminal },
                  { id: 'voiceover' as const, label: 'Voiceover', icon: Mic },
                ]).map((tab) => (
                  <Tooltip key={tab.id} content={`${tab.label} (Ctrl+${tab.id[0].toUpperCase()})`} position="bottom">
                    <button
                      onClick={() => setRightPanel(tab.id)}
                      className={`
                        flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold
                        transition-colors duration-150
                        ${rightPanel === tab.id
                          ? 'bg-white/5 text-white border-b-2 border-indigo-500'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'}
                      `}
                    >
                      {React.createElement(tab.icon, { size: 11, className: "shrink-0" })}
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                <div style={{ display: rightPanel === 'inspector' ? 'contents' : 'none' }} className="w-full h-full">
                  <Inspector />
                </div>
                <div style={{ display: rightPanel === 'commands' ? 'contents' : 'none' }} className="w-full h-full">
                  <CommandEditor />
                </div>
                <div style={{ display: rightPanel === 'voiceover' ? 'contents' : 'none' }} className="w-full h-full">
                  <VoiceoverPanel />
                </div>
                <div style={{ display: rightPanel === 'console' ? 'contents' : 'none' }} className="w-full h-full">
                  <CommandConsole />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};






