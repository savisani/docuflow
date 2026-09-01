import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { validateCommands, normalizeCommands } from '../../engine/commands/validator';
import { buildTimeline } from '../../engine/timeline/builder';
import { Command } from '../../engine/commands/types';
import { Play, CheckCircle, AlertTriangle, Trash2, Copy, FileText, Minimize2, Terminal, RefreshCw } from 'lucide-react';
import { Panel, Button, IconButton, Tooltip, Section } from '../ui';

interface ParsedData {
  commands?: Command[];
  version?: number;
  settings?: any;
  assets?: any[];
}

interface LineError {
  line: number;
  message: string;
}

function commandsToJSON(commands: Command[]): string {
  return JSON.stringify({ commands }, null, 2);
}

function findJsonLineError(content: string, err: SyntaxError): LineError {
  const posMatch = err.message.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const upToPos = content.slice(0, pos);
    const line = upToPos.split('\n').length;
    return { line, message: err.message };
  }
  const lineMatch = err.message.match(/line\s+(\d+)/i);
  if (lineMatch) {
    return { line: parseInt(lineMatch[1], 10), message: err.message };
  }
  return { line: 1, message: err.message };
}

function mapCommandIdToLine(content: string, commandId: string): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(commandId)) return i + 1;
  }
  return 0;
}

function mapValidationToLineErrors(content: string, errors: { commandId: string; field: string; message: string }[]): LineError[] {
  return errors.map((e) => {
    const line = mapCommandIdToLine(content, e.commandId);
    return {
      line,
      message: `[${e.field}] ${e.message}`,
    };
  });
}

export const CommandEditor: React.FC = () => {
  const { commands, assets, settings, setCommands, setTimeline, setSettings } = useDocuFlowStore();
  const [editorContent, setEditorContent] = useState('');
  const [errors, setErrors] = useState<LineError[]>([]);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [isUserEditing, setIsUserEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSyncedCommandsRef = useRef<string>('');

  useEffect(() => {
    const serialized = commandsToJSON(commands);
    if (serialized === lastSyncedCommandsRef.current) return;
    lastSyncedCommandsRef.current = serialized;

    if (!isUserEditing) {
      setEditorContent(serialized);
      setErrors([]);
      setParseSuccess(false);
    }
  }, [commands, isUserEditing]);

  const handleFocus = useCallback(() => {
    setIsUserEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsUserEditing(false);
  }, []);

  const handleSyncFromStore = useCallback(() => {
    const serialized = commandsToJSON(commands);
    lastSyncedCommandsRef.current = serialized;
    setEditorContent(serialized);
    setErrors([]);
    setParseSuccess(false);
    setIsUserEditing(false);
  }, [commands]);

  const handleParseAndApply = useCallback(() => {
    setErrors([]);
    setParseSuccess(false);

    let parsed: ParsedData;
    try {
      parsed = JSON.parse(editorContent) as ParsedData;
    } catch (e) {
      const lineErr = findJsonLineError(editorContent, e as SyntaxError);
      setErrors([lineErr]);
      return;
    }

    const cmds = parsed.commands || parsed as Command[];

    if (!Array.isArray(cmds)) {
      setErrors([{ line: 1, message: 'Invalid format: expected { "commands": [...] } or [...]' }]);
      return;
    }

    const normalized = normalizeCommands(cmds, assets);

    const validation = validateCommands(normalized, assets);
    if (!validation.valid) {
      const lineErrors = mapValidationToLineErrors(editorContent, validation.errors);
      setErrors(lineErrors);
      return;
    }

    if (parsed.settings) {
      setSettings(parsed.settings);
    }

    const voiceoverAsset = useDocuFlowStore.getState().voiceover ? assets.find(a => a.id === useDocuFlowStore.getState().voiceover!.assetId) : undefined;
    const timeline = buildTimeline(normalized, assets, parsed.settings || settings, voiceoverAsset?.duration);
    setTimeline(timeline);
    setCommands(normalized);

    const serialized = commandsToJSON(normalized);
    lastSyncedCommandsRef.current = serialized;
    setEditorContent(serialized);

    setParseSuccess(true);
    setTimeout(() => setParseSuccess(false), 3000);
  }, [editorContent, assets, settings, setCommands, setTimeline, setSettings]);

  const handleValidate = useCallback(() => {
    setErrors([]);
    setParseSuccess(false);

    let parsed: ParsedData;
    try {
      parsed = JSON.parse(editorContent) as ParsedData;
    } catch (e) {
      const lineErr = findJsonLineError(editorContent, e as SyntaxError);
      setErrors([lineErr]);
      return;
    }

    const cmds = parsed.commands || parsed as Command[];

    if (!Array.isArray(cmds)) {
      setErrors([{ line: 1, message: 'Invalid format: expected { "commands": [...] } or [...]' }]);
      return;
    }

    const normalized = normalizeCommands(cmds, assets);

    const validation = validateCommands(normalized, assets);
    if (!validation.valid) {
      const lineErrors = mapValidationToLineErrors(editorContent, validation.errors);
      setErrors(lineErrors);
    } else {
      setParseSuccess(true);
      setErrors([]);
    }
  }, [editorContent, assets]);

  const handleClear = useCallback(() => {
    setEditorContent('');
    setErrors([]);
    setParseSuccess(false);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(editorContent);
  }, [editorContent]);

  const handleLoadFromProject = useCallback(() => {
    const serialized = commandsToJSON(commands);
    lastSyncedCommandsRef.current = serialized;
    setEditorContent(serialized);
    setErrors([]);
    setParseSuccess(false);
    setIsUserEditing(false);
  }, [commands]);

  return (
    <Panel title="Command Editor" icon={<Terminal size={10} />} className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-white/5 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Tooltip content="Parse & Apply (Ctrl+Enter)">
            <Button size="sm" variant="primary" onClick={handleParseAndApply}>
              <Play size={10} />
              <span>Parse & Apply</span>
            </Button>
          </Tooltip>
          <Tooltip content="Validate">
            <Button size="sm" variant="secondary" onClick={handleValidate}>
              <CheckCircle size={10} />
              <span>Validate</span>
            </Button>
          </Tooltip>
          <Tooltip content="Sync from Store">
            <Button size="sm" variant="ghost" onClick={handleSyncFromStore}>
              <RefreshCw size={10} />
              <span>Sync</span>
            </Button>
          </Tooltip>
          <Tooltip content="Clear">
            <Button size="sm" variant="ghost" onClick={handleClear}>
              <Trash2 size={10} />
              <span>Clear</span>
            </Button>
          </Tooltip>
          <Tooltip content="Copy to Clipboard">
            <Button size="sm" variant="ghost" onClick={handleCopy}>
              <Copy size={10} />
              <span>Copy</span>
            </Button>
          </Tooltip>
          <Tooltip content="Load from Project">
            <Button size="sm" variant="ghost" onClick={handleLoadFromProject}>
              <FileText size={10} />
              <span>Load</span>
            </Button>
          </Tooltip>
        </div>
        <Tooltip content="Minimize">
          <IconButton size="sm" variant="ghost" aria-label="Minimize" onClick={() => useDocuFlowStore.getState().setPanelVisibility('assets', false)}>
            <Minimize2 size={10} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <textarea
          ref={textareaRef}
          value={editorContent}
          onChange={(e) => {
            setEditorContent(e.target.value);
            setIsUserEditing(true);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleParseAndApply();
            }
          }}
          placeholder={`Paste commands here...\n\nExample:\n{\n  "commands": [\n    {\n      "type": "show",\n      "asset": "image1.jpg",\n      "start": 0,\n      "duration": 5\n    }\n  ]\n}`}
          className="w-full h-full bg-[var(--color-bg)] text-[var(--color-text-primary)] font-mono text-[11px] p-3 resize-none outline-none placeholder:text-[var(--color-text-muted)]"
          spellCheck={false}
        />
      </div>

      {(errors.length > 0 || parseSuccess) && (
        <div className="border-t border-[var(--color-divider)] shrink-0 max-h-24 overflow-y-auto">
          {parseSuccess && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--color-success)] bg-[var(--color-success-muted)] flex items-center gap-1">
              <CheckCircle size={10} />
              Commands applied successfully
            </div>
          )}
          {errors.map((error, i) => (
            <div key={i} className="px-3 py-1 text-[11px] text-[var(--color-error)] bg-[var(--color-error-muted)] flex items-start gap-1">
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              <span>
                {error.line > 0 && <span className="font-mono opacity-70">L{error.line}: </span>}
                {error.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
