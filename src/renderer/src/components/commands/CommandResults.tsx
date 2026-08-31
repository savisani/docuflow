import React from 'react';
import { CheckCircle, AlertTriangle, MousePointer } from 'lucide-react';
import { Command } from '../../engine/commands/types';
import { DslError } from '../../engine/commands/dsl';
import { useDocuFlowStore } from '../../app/store';

interface CommandResultsProps {
  parsedCommands: Command[];
  errors: DslError[];
  onSelectCommand: (id: string) => void;
}

function getAssetLabel(assets: any[], id: string): string {
  const asset = assets.find((a) => a.id === id);
  if (!asset) return id.slice(0, 8);
  return asset.logicalId || asset.filename?.slice(0, 12) || id.slice(0, 8);
}

export const CommandResults: React.FC<CommandResultsProps> = ({
  parsedCommands,
  errors,
  onSelectCommand,
}) => {
  const assets = useDocuFlowStore((s) => s.assets);

  if (parsedCommands.length === 0 && errors.length === 0) return null;

  return (
    <div className="border-t border-neutral-700 shrink-0 max-h-36 overflow-y-auto">
      {errors.length > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-900/20 border-b border-red-900/30">
          <div className="flex items-center gap-1 font-semibold mb-0.5">
            <AlertTriangle size={10} />
            {errors.length} error{errors.length !== 1 ? 's' : ''} found
          </div>
          {errors.map((e, i) => (
            <div key={i} className="ml-4 text-[10px] text-red-300/80">
              Line {e.line}: {e.message}
            </div>
          ))}
        </div>
      )}
      {parsedCommands.length > 0 && errors.length === 0 && (
        <div className="px-3 py-1.5 text-[11px] text-green-400 bg-green-900/20 border-b border-green-900/30">
          <div className="flex items-center gap-1 font-semibold">
            <CheckCircle size={10} />
            {parsedCommands.length} command{parsedCommands.length !== 1 ? 's' : ''} ready
          </div>
        </div>
      )}
      {parsedCommands.map((cmd) => {
        let label = '';
        switch (cmd.type) {
          case 'show':
            label = getAssetLabel(assets, cmd.asset);
            break;
          case 'scale':
          case 'move':
          case 'rotate':
          case 'move3D':
          case 'rotate3D':
          case 'depth':
          case 'fadeIn':
          case 'fadeOut':
          case 'slide':
            label = getAssetLabel(assets, cmd.target);
            break;
          case 'replace':
            label = `${getAssetLabel(assets, cmd.target)} → ${getAssetLabel(assets, cmd.asset)}`;
            break;
          case 'crossfade':
            label = `${getAssetLabel(assets, cmd.target)} → ${getAssetLabel(assets, (cmd as any).toAsset)}`;
            break;
          case 'sfx':
          case 'music':
            label = getAssetLabel(assets, cmd.asset);
            break;
          case 'text':
          case 'subtitle':
            label = `"${(cmd as any).content?.slice(0, 20)}"`;
            break;
        }

        return (
          <div
            key={cmd.id}
            className="px-3 py-1 text-[10px] text-neutral-300 bg-neutral-900/50 flex items-center gap-1.5 hover:bg-neutral-800/50 cursor-pointer"
            onClick={() => onSelectCommand(cmd.id)}
          >
            <MousePointer size={8} className="text-neutral-500" />
            <span className="font-mono text-green-400/80">{cmd.type.toUpperCase()}</span>
            <span className="text-neutral-500 truncate">{label}</span>
            <span className="text-neutral-600 ml-auto font-mono">
              t={cmd.start}s{cmd.duration != null ? ` dur=${cmd.duration}s` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};



