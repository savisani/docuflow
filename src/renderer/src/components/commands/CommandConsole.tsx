import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { parseDsl } from '../../engine/commands/dsl';
import { parseNaturalLanguage } from '../../engine/commands/nlParser';
import { validateCommands, normalizeCommands } from '../../engine/commands/validator';
import { buildTimeline } from '../../engine/timeline/builder';
import { Command } from '../../engine/commands/types';
import { Play, CheckCircle, Trash2, RotateCcw, Minimize2, Terminal, Sparkles, Code } from 'lucide-react';
import { Panel, Button, IconButton, Tooltip, Section } from '../ui';
import { CommandResults } from './CommandResults';

type ParseMode = 'dsl' | 'natural';

const DSL_EXAMPLE = `SHOW IMAGE 1 FROM 0 TO 5
SCALE IMAGE 1 FROM 1 TO 1.15 DURING 0-5
REPLACE IMAGE 1 WITH IMAGE 2 AT 5
SLIDE IMAGE 2 FROM RIGHT DURING 5-6
SHOW IMAGE 3 FROM 6 TO 12
MOVE3D IMAGE 3 FROM 0,0,0 TO 0,0,400 DURING 6-12
ROTATE3D IMAGE 3 FROM 0,0,0 TO 10,20,0 DURING 6-12
SFX 1 AT 5 VOLUME 0.7
MUSIC 1 FROM 0 TO 12 VOLUME 0.3
TEXT "THE BIRTH OF THE COMPUTER" FROM 2 TO 5`;

const NL_EXAMPLES = [
  'Show image 1 from 0 to 5 seconds, then fade in image 2 from 5 to 6',
  'Display video 1 for 10 seconds, move it from left to right during 0-10',
  'Play music 1 from 0 to 15 seconds at volume 0.5',
  'Add a title "Hello World" at 2 seconds for 4 seconds',
  'Show image 1, then after 3 seconds scale it up to 1.5x over 2 seconds',
];

export const CommandConsole: React.FC = () => {
  const { assets, commands, settings, selectCommand, setCommands, setTimeline } = useDocuFlowStore();
  const getState = useDocuFlowStore.getState;
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ParseMode>('natural');
  const [parsedCommands, setParsedCommands] = useState<Command[]>([]);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [nlErrors, setNlErrors] = useState<string[]>([]);
  const [executionResult, setExecutionResult] = useState<'success' | null>(null);
  const [commandSummary, setCommandSummary] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  const handleValidate = useCallback(() => {
    setExecutionResult(null);
    setCommandSummary(null);
    setNlErrors([]);

    if (mode === 'dsl') {
      const result = parseDsl(input, assets);
      setParsedCommands(result.commands);
      setParseErrors(result.errors);

      if (result.errors.length === 0 && result.commands.length > 0) {
        const normalized = normalizeCommands(result.commands, assets);
        const validation = validateCommands(normalized, assets);
        if (!validation.valid) {
          setParseErrors(validation.errors.map((e) => ({ line: 0, message: `${e.field}: ${e.message}` })));
        }
      }
    } else {
      const result = parseNaturalLanguage(input, assets);
      setParsedCommands(result.commands);
      setParseErrors([]);
      setNlErrors(result.errors);
    }
  }, [input, assets, mode]);

  const handleExecute = useCallback(() => {
    setExecutionResult(null);
    setCommandSummary(null);
    setNlErrors([]);

    let result: { commands: Command[]; errors: any[] };

    if (mode === 'dsl') {
      result = parseDsl(input, assets);
      setParsedCommands(result.commands);
      setParseErrors(result.errors);

      if (result.errors.length > 0) return;
    } else {
      const nlResult = parseNaturalLanguage(input, assets);
      result = { commands: nlResult.commands, errors: [] };
      setParsedCommands(nlResult.commands);
      setParseErrors([]);
      setNlErrors(nlResult.errors);

      if (nlResult.errors.length > 0) return;
    }

    if (result.commands.length === 0) {
      const errMsg = mode === 'dsl'
        ? [{ line: 0, message: 'No commands found' }]
        : [];
      setParseErrors(errMsg);
      if (mode === 'natural') {
        setNlErrors(['No commands recognized. Try: "Show image 1 for 5 seconds"']);
      }
      return;
    }

    if (mode === 'dsl') {
      const normalized = normalizeCommands(result.commands, assets);
      const validation = validateCommands(normalized, assets);
      if (!validation.valid) {
        setParseErrors(validation.errors.map((e) => ({ line: 0, message: `${e.field}: ${e.message}` })));
        return;
      }
      result.commands = normalized;
    }

    const existingCommands = getState().commands;
    const merged = [...existingCommands, ...result.commands];
    const voiceoverAsset = getState().voiceover ? assets.find(a => a.id === getState().voiceover!.assetId) : undefined;
    const timeline = buildTimeline(merged, assets, settings, voiceoverAsset?.duration);

    getState().setCommands(merged);
    setTimeline(timeline);

    const types = [...new Set(result.commands.map((c) => c.type))];
    setCommandSummary(
      `Generated ${result.commands.length} command${result.commands.length !== 1 ? 's' : ''}: [${types.join(', ')}]`
    );

    setExecutionResult('success');
    setParseErrors([]);
    setNlErrors([]);
  }, [input, assets, settings, setCommands, setTimeline, mode]);

  const handleClear = useCallback(() => {
    setInput('');
    setParsedCommands([]);
    setParseErrors([]);
    setNlErrors([]);
    setExecutionResult(null);
    setCommandSummary(null);
  }, []);

  const handleLoadExample = useCallback(() => {
    if (mode === 'dsl') {
      setInput(DSL_EXAMPLE);
    } else {
      const ex = NL_EXAMPLES[Math.floor(Math.random() * NL_EXAMPLES.length)];
      setInput(ex);
    }
    setParsedCommands([]);
    setParseErrors([]);
    setNlErrors([]);
    setExecutionResult(null);
    setCommandSummary(null);
  }, [mode]);

  const handleSelectCommand = useCallback(
    (id: string) => {
      selectCommand(id);
    },
    [selectCommand]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute]
  );

  const modeLabel = mode === 'dsl' ? 'DSL' : 'Natural Language';
  const placeholder = mode === 'dsl'
    ? `Type DSL commands here...\n\nExample:\nSHOW IMAGE 1 FROM 0 TO 5\nSCALE IMAGE 1 FROM 1 TO 1.15 DURING 0-5\n\nCtrl+Enter to execute`
    : `Describe what you want in plain English...\n\nExamples:\nShow image 1 for 5 seconds\nPlay music 1 from 0 to 10 at volume 0.5\nAdd text "Hello" at 2s for 4s\n\nCtrl+Enter to execute`;

  return (
    <Panel title="Command Console" icon={<Terminal size={10} />} className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-df-border mb-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-df-surface-2/60 rounded-df-md p-0.5 border border-slate-700/40">
            <button
              onClick={() => setMode('natural')}
              className={`flex items-center gap-1 px-2 py-1 text-df-xs font-medium rounded transition-all duration-150 ${
                mode === 'natural'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-df-text-muted hover:text-df-text-primary'
              }`}
            >
              <Sparkles size={9} />
              NL
            </button>
            <button
              onClick={() => setMode('dsl')}
              className={`flex items-center gap-1 px-2 py-1 text-df-xs font-medium rounded transition-all duration-150 ${
                mode === 'dsl'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-df-text-muted hover:text-df-text-primary'
              }`}
            >
              <Code size={9} />
              DSL
            </button>
          </div>

          <Tooltip content={`Execute ${modeLabel} (Ctrl+Enter)`}>
            <Button size="sm" variant="primary" onClick={handleExecute}>
              <Play size={10} />
              <span>Execute</span>
            </Button>
          </Tooltip>
          <Tooltip content="Validate">
            <Button size="sm" variant="secondary" onClick={handleValidate}>
              <CheckCircle size={10} />
              <span>Validate</span>
            </Button>
          </Tooltip>
          <Tooltip content="Clear">
            <Button size="sm" variant="ghost" onClick={handleClear}>
              <Trash2 size={10} />
              <span>Clear</span>
            </Button>
          </Tooltip>
          <Tooltip content="Load Example">
            <Button size="sm" variant="ghost" onClick={handleLoadExample}>
              <RotateCcw size={10} />
              <span>Example</span>
            </Button>
          </Tooltip>
        </div>
        <Tooltip content="Minimize">
          <IconButton size="sm" variant="ghost" aria-label="Minimize" onClick={() => useDocuFlowStore.getState().setPanelVisibility('assets', false)}>
            <Minimize2 size={10} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-[var(--color-bg)] text-[var(--color-text-primary)] font-mono text-df-sm p-3 resize-none outline-none placeholder:text-[var(--color-text-muted)] border-0"
          spellCheck={false}
          rows={6}
        />
      </div>

      {executionResult === 'success' && commandSummary && (
        <div className="px-3 py-1.5 text-df-sm text-[var(--color-success)] bg-[var(--color-success-muted)] border-t border-[var(--color-success-muted)] shrink-0 flex items-center gap-1">
          <CheckCircle size={10} />
          {commandSummary}
        </div>
      )}

      {nlErrors.length > 0 && (
        <div className="px-3 py-1.5 text-df-sm text-df-error bg-red-900/20 border-t border-red-900/30 shrink-0">
          <div className="flex items-center gap-1 font-semibold mb-0.5">
            <span>{nlErrors.length} error{nlErrors.length !== 1 ? 's' : ''}</span>
          </div>
          {nlErrors.map((err, i) => (
            <div key={i} className="ml-4 text-df-xs text-red-300/80">{err}</div>
          ))}
        </div>
      )}

      <Section title="Results" className="shrink-0">
        <CommandResults
          parsedCommands={parsedCommands}
          errors={parseErrors}
          onSelectCommand={handleSelectCommand}
        />
      </Section>
    </Panel>
  );
};
