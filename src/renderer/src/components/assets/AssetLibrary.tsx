import React, { useCallback, useState, useRef } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { Asset, AudioRole } from '../../types/assets';
import { loadAssetMetadata } from '../../engine/media/loader';
import { v4 as uuidv4 } from 'uuid';
import { Film, Image, Music, Mic, Volume2, CloudRain, HelpCircle, Eye, EyeOff, GripVertical, Search, Filter, PanelLeft, Upload } from 'lucide-react';
import { Panel, Tooltip, IconButton, Button, Badge, Divider, Section } from '../ui';

const ROLE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ size?: number }>; color: string }> = {
  voiceover: { label: 'Voiceover', icon: Mic, color: 'var(--color-track-voiceover)' },
  music: { label: 'Music', icon: Music, color: 'var(--color-track-music)' },
  sfx: { label: 'SFX', icon: Volume2, color: 'var(--color-track-sfx)' },
  ambient: { label: 'Ambient', icon: CloudRain, color: 'var(--color-track-ambient)' },
  unassigned: { label: 'Unassigned', icon: HelpCircle, color: 'var(--color-accent-secondary)' },
};

const TYPE_CONFIG = {
  image: { icon: Image, label: 'Images' },
  video: { icon: Film, label: 'Video' },
  audio: { icon: Music, label: 'Audio' },
};

export const AssetLibrary: React.FC = () => {
  const assets = useDocuFlowStore((s) => s.assets);
  const addAsset = useDocuFlowStore((s) => s.addAsset);
  const selectedAssetId = useDocuFlowStore((s) => s.selectedAssetId);
  const selectAsset = useDocuFlowStore((s) => s.selectAsset);
  const setSelectedPreviewAsset = useDocuFlowStore((s) => s.setSelectedPreviewAsset);
  const hiddenAssetIds = useDocuFlowStore((s) => s.hiddenAssetIds);
  const toggleAssetHidden = useDocuFlowStore((s) => s.toggleAssetHidden);
  const trackVisibility = useDocuFlowStore((s) => s.trackVisibility);
  const setTrackVisibility = useDocuFlowStore((s) => s.setTrackVisibility);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [filterRole, setFilterRole] = useState<string>('all');

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const acceptedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'aac'];
    const validFiles = fileArray.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      return acceptedExts.includes(ext);
    });

    if (validFiles.length === 0) return;

    const currentAssets = useDocuFlowStore.getState().assets;
    let existingAssets = [...currentAssets];

    for (const file of validFiles) {
      try {
        const metadata = await loadAssetMetadata(file, existingAssets);
        const asset: Asset = {
          id: uuidv4(),
          logicalId: metadata.logicalId || '',
          filename: metadata.filename || file.name,
          type: metadata.type || 'image',
          mimeType: metadata.mimeType || file.type || 'application/octet-stream',
          url: metadata.url,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
        };
        existingAssets.push(asset);
        addAsset(asset);
      } catch (err) {
        console.warn(`Failed to process ${file.name}:`, err);
      }
    }
  }, [addAsset]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
    e.target.value = '';
  }, [processFiles]);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }, [processFiles]);

  const handleSelectAsset = useCallback((asset: Asset) => {
    const isAlreadySelected = asset.id === selectedAssetId;
    if (isAlreadySelected) {
      selectAsset(null);
      setSelectedPreviewAsset(null);
    } else {
      selectAsset(asset.id);
      setSelectedPreviewAsset(asset);
    }
  }, [selectedAssetId, selectAsset, setSelectedPreviewAsset]);

  const handleDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData('application/docuflow-asset', JSON.stringify({
      id: asset.id,
      logicalId: asset.logicalId,
      type: asset.type,
      duration: asset.duration,
      audioRole: asset.audioRole,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const filteredAssets = assets.filter((asset) => {
    if (filterType !== 'all' && asset.type !== filterType) return false;
    if (filterRole !== 'all') {
      if (filterRole === 'unassigned') {
        if (asset.audioRole && asset.audioRole !== 'unassigned') return false;
      } else if (asset.audioRole !== filterRole) return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!asset.logicalId.toLowerCase().includes(query) &&
          !asset.filename.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  const images = filteredAssets.filter((a) => a.type === 'image' || a.type === 'video');
  const audioFiles = filteredAssets.filter((a) => a.type === 'audio');

  const roleGroups: { role: string; assets: Asset[] }[] = [];
  const roleOrder: AudioRole[] = ['voiceover', 'music', 'sfx', 'ambient', 'unassigned'];
  for (const role of roleOrder) {
    const roleAssets = audioFiles.filter((a) => a.audioRole === role || (!a.audioRole && role === 'unassigned'));
    if (roleAssets.length > 0) roleGroups.push({ role, assets: roleAssets });
  }

  return (
    <Panel title="Assets" icon={<PanelLeft size={10} />} className="h-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        onChange={handleFileInputChange}
        className="hidden"
      />
      <div
        className="p-2 space-y-3 h-full flex flex-col"
        onDragOver={handlePanelDragOver}
        onDragLeave={handlePanelDragLeave}
        onDrop={handlePanelDrop}
      >
        {/* Import Button */}
        <Button size="sm" variant="primary" onClick={handleImportClick} className="w-full">
          <Upload size={12} />
          <span>Import Assets</span>
        </Button>

        {/* Search + Filter */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-df-surface-2/60 border border-df-border rounded-df-lg px-2 py-1.5">
            <Search size={12} className="text-df-text-muted" />
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-df-sm text-df-text-primary placeholder:text-slate-600 outline-none"
            />
          </div>
          <Tooltip content="Filter by type">
            <IconButton size="sm" variant="ghost" aria-label="Filter by type">
              <Filter size={12} />
            </IconButton>
          </Tooltip>
        </div>

        {/* Type Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterType('all')}
            className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors ${
              filterType === 'all'
                ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType('image')}
            className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors ${
              filterType === 'image'
                ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
            }`}
          >
            <Image size={10} className="inline mr-1" /> Images
          </button>
          <button
            onClick={() => setFilterType('video')}
            className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors ${
              filterType === 'video'
                ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
            }`}
          >
            <Film size={10} className="inline mr-1" /> Video
          </button>
          <button
            onClick={() => setFilterType('audio')}
            className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors ${
              filterType === 'audio'
                ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
            }`}
          >
            <Music size={10} className="inline mr-1" /> Audio
          </button>
        </div>

        <Divider className="my-1" />

        {/* Asset List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3">
          {images.length > 0 && (
            <AssetGroup
              title="Images & Video"
              count={images.length}
              assets={images}
              selectedId={selectedAssetId}
              hiddenIds={hiddenAssetIds}
              onSelect={handleSelectAsset}
              onToggleHidden={toggleAssetHidden}
              onDragStart={handleDragStart}
            />
          )}

          {roleGroups.length > 0 && (
            <Section title="Audio" className="space-y-2">
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                <button
                  onClick={() => setFilterRole('all')}
                  className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors ${
                    filterRole === 'all'
                      ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                      : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
                  }`}
                >
                  All
                </button>
                {roleOrder.map((role) => {
                  const config = ROLE_CONFIG[role];
                  const count = audioFiles.filter(a => a.audioRole === role || (!a.audioRole && role === 'unassigned')).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={role}
                      onClick={() => setFilterRole(role)}
                      className={`px-2 py-1 rounded-df-lg text-df-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                        filterRole === role
                          ? 'bg-df-accent-muted text-df-accent border border-df-accent/30'
                          : 'text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-2 border border-transparent'
                      }`}
                    >
                      <config.icon size={10} />
                      {config.label}
                      <Badge variant="default" className="ml-1">{count}</Badge>
                    </button>
                  );
                })}
              </div>

              {roleGroups.map(({ role, assets: roleAssets }) => (
                <AssetGroup
                  key={role}
                  title={ROLE_CONFIG[role].label}
                  count={roleAssets.length}
                  assets={roleAssets}
                  selectedId={selectedAssetId}
                  hiddenIds={hiddenAssetIds}
                  onSelect={handleSelectAsset}
                  onToggleHidden={toggleAssetHidden}
                  onDragStart={handleDragStart}
                  roleConfig={ROLE_CONFIG[role]}
                />
              ))}
            </Section>
          )}

          {filteredAssets.length === 0 && assets.length > 0 && (
            <div className="text-center py-8 text-df-text-muted">
              <Search size={24} className="mx-auto mb-2 text-slate-600" />
              <p className="text-sm">No assets match your filters</p>
              <p className="text-df-xs mt-1">Try adjusting your search or filters</p>
            </div>
          )}

          {assets.length === 0 && !isDragOver && (
            <div className="text-center py-8 px-2">
              <Film size={32} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-df-text-muted mb-1">No assets imported yet</p>
              <p className="text-df-xs text-df-text-muted">Click Import or drag files here</p>
            </div>
          )}
        </div>

        {/* Dropzone */}
        <div
          className={`
            shrink-0 rounded-df-lg border-2 border-dashed transition-all duration-200 p-3
            ${isDragOver
              ? 'border-indigo-500/60 bg-indigo-500/10'
              : 'border-df-border bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'}
          `}
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Upload size={16} className={isDragOver ? 'text-df-accent' : 'text-df-text-muted'} />
            <p className={`text-df-sm font-medium ${isDragOver ? 'text-df-accent' : 'text-df-text-muted'}`}>
              {isDragOver ? 'Drop to import' : 'Drag files here to import'}
            </p>
            <p className="text-[9px] text-slate-600">Images, video, and audio</p>
          </div>
        </div>
      </div>
    </Panel>
  );
};

interface AssetGroupProps {
  title: string;
  count: number;
  assets: Asset[];
  selectedId: string | null;
  hiddenIds: Set<string>;
  onSelect: (asset: Asset) => void;
  onToggleHidden: (id: string) => void;
  onDragStart: (e: React.DragEvent, asset: Asset) => void;
  roleConfig?: { label: string; icon: React.ComponentType<{ size?: number }>; color: string };
}

const AssetGroup: React.FC<AssetGroupProps> = ({
  title,
  count,
  assets,
  selectedId,
  hiddenIds,
  onSelect,
  onToggleHidden,
  onDragStart,
  roleConfig,
}) => (
  <Section title={title} className="space-y-1">
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-1">
        {roleConfig?.icon && <span style={{ color: roleConfig.color }}><roleConfig.icon size={10} /></span>}
      </div>
      <Badge variant="default" className="text-[9px]">{count}</Badge>
    </div>
    <div className="space-y-1">
      {assets.map((asset) => (
        <AssetItem
          key={asset.id}
          asset={asset}
          selected={asset.id === selectedId}
          hidden={hiddenIds.has(asset.id)}
          onSelect={() => onSelect(asset)}
          onToggleHidden={() => onToggleHidden(asset.id)}
          onDragStart={(e) => onDragStart(e, asset)}
          roleConfig={roleConfig}
        />
      ))}
    </div>
  </Section>
);

interface AssetItemProps {
  asset: Asset;
  selected: boolean;
  hidden: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onDragStart: (e: React.DragEvent) => void;
  roleConfig?: { label: string; icon: React.ComponentType<{ size?: number }>; color: string };
}

const AssetItem: React.FC<AssetItemProps> = ({
  asset,
  selected,
  hidden,
  onSelect,
  onToggleHidden,
  onDragStart,
  roleConfig,
}) => {
  const Icon = asset.type === 'image' ? Image : asset.type === 'video' ? Film : roleConfig?.icon || Music;
  const duration = asset.duration ? `${asset.duration.toFixed(1)}s` : '';
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : '';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      className={`
        group flex items-center gap-2 px-2 py-1.5 rounded-df-lg cursor-pointer transition-all duration-150
        ${selected
          ? 'bg-indigo-500/15 border border-df-accent/30'
          : 'hover:bg-df-surface-2 border border-transparent'}
        ${hidden ? 'opacity-40' : ''}
      `}
    >
      <Tooltip content="Drag to timeline">
        <div className="w-4 h-4 flex items-center justify-center text-slate-600 cursor-grab active:cursor-grabbing">
          <GripVertical size={12} />
        </div>
      </Tooltip>

      <div className="w-8 h-8 rounded-df-lg bg-df-surface-2/80 flex items-center justify-center overflow-hidden shrink-0 border border-df-border">
        {asset.type === 'image' && asset.url ? (
          <img src={asset.url} alt="" className="w-full h-full object-cover" />
        ) : asset.type === 'video' && asset.url ? (
          <video src={asset.url} className="w-full h-full object-cover" muted />
        ) : (
          <Icon size={14} className={roleConfig ? `text-[${roleConfig.color}]` : 'text-df-text-muted'} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-df-xs font-mono text-df-accent truncate">{asset.logicalId}</div>
          {roleConfig && <Badge variant="default" className="text-[9px]">{roleConfig.label}</Badge>}
        </div>
        <div className="text-df-xs text-df-text-muted truncate flex items-center gap-1.5">
          <span>{asset.filename}</span>
          {duration && <span className="text-df-text-dim">•</span>}
          {duration && <span>{duration}</span>}
          {dimensions && <span className="text-df-text-dim">•</span>}
          {dimensions && <span>{dimensions}</span>}
        </div>
      </div>

      <Tooltip content={hidden ? 'Show asset' : 'Hide asset'}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className="opacity-0 group-hover:opacity-100 text-df-text-muted hover:text-df-text-primary transition-opacity p-0.5"
        >
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </Tooltip>
    </div>
  );
};


