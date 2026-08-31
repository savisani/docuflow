import React from 'react';
import { Upload, Image, Music, Film } from 'lucide-react';

interface DropZoneProps {
  visible: boolean;
  fileCount?: number;
}

export const DropZone: React.FC<DropZoneProps> = ({ visible, fileCount = 0 }) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none animate-fade-in">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" />
      <div className="relative flex flex-col items-center gap-4 p-8">
        <div className="w-20 h-20 rounded-2xl bg-indigo-500/15 border-2 border-dashed border-indigo-500/50 flex items-center justify-center animate-pulse">
          <Upload size={32} className="text-indigo-400" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-white">
            Drop assets here to import
          </h3>
          <p className="text-sm text-slate-400">
            {fileCount > 0
              ? `${fileCount} file${fileCount > 1 ? 's' : ''} detected`
              : 'Images, video, and audio files supported'}
          </p>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/5 text-[11px] text-slate-400">
            <Image size={12} className="text-indigo-400" />
            <span>Images</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/5 text-[11px] text-slate-400">
            <Film size={12} className="text-indigo-400" />
            <span>Video</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/5 text-[11px] text-slate-400">
            <Music size={12} className="text-indigo-400" />
            <span>Audio</span>
          </div>
        </div>
      </div>
    </div>
  );
};
