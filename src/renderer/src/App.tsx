import React, { useEffect, useCallback, useState, useRef } from 'react';
import { TitleBar } from './components/titlebar/TitleBar';
import { EditorLayout } from './components/editor/EditorLayout';
import { ImageGenerator } from './components/generator/ImageGenerator';
import { SceneGenerator } from './components/generator/SceneGenerator';
import { DropZone } from './components/ui/DropZone';
import { useDocuFlowStore } from './app/store';
import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetType } from './types/assets';
import { generateLogicalId } from './engine/media/findAsset';

const ACCEPTED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'mp3', 'wav', 'ogg', 'flac', 'aac',
]);

function assetTypeFromPath(filePath: string): AssetType | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (!ACCEPTED_EXTENSIONS.has(ext)) return null;
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  return 'audio';
}

function mimeTypeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function loadVideoDimensions(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    };
    video.onerror = () => resolve({ width: 0, height: 0, duration: 0 });
    video.src = url;
  });
}

function loadAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

function getSupportedFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  } else {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      files.push(dataTransfer.files[i]);
    }
  }
  return files.filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTENSIONS.has(ext);
  });
}

function App() {
  const [dropVisible, setDropVisible] = useState(false);
  const [dropFileCount, setDropFileCount] = useState(0);
  const dragCounterRef = useRef(0);
  const activeTab = useDocuFlowStore((s) => s.activeTab);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;

      if (e.code === 'Delete' || e.code === 'Backspace') {
        const { selectedCommandId, removeCommand } = useDocuFlowStore.getState();
        if (selectedCommandId) {
          e.preventDefault();
          removeCommand(selectedCommandId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDropVisible(false);
    setDropFileCount(0);

    const files = getSupportedFiles(e.dataTransfer);
    if (files.length === 0) return;

    const existingAssets = useDocuFlowStore.getState().assets;
    const projectName = 'Untitled';

    const filePaths: string[] = [];
    for (const file of files) {
      const path = (file as any).path as string | undefined;
      if (path) filePaths.push(path);
    }

    let assetUrls: { path: string; url: string }[] = [];

    if (filePaths.length > 0 && window.docuflow) {
      try {
        const copiedPaths = await window.docuflow.copyDroppedFiles(projectName, filePaths);
        assetUrls = copiedPaths.map((p, i) => ({
          path: p,
          url: window.docuflow.filePathToAssetUrl(p),
        }));
      } catch (err) {
        console.error('Failed to copy dropped files:', err);
        assetUrls = filePaths.map((p) => ({
          path: p,
          url: window.docuflow.filePathToAssetUrl(p),
        }));
      }
    } else {
      for (const file of files) {
        const url = URL.createObjectURL(file);
        assetUrls.push({ path: file.name, url });
      }
    }

    let currentAssets = [...existingAssets];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const info = assetUrls[i] || { path: file.name, url: URL.createObjectURL(file) };
      const ext = info.path.split('.').pop()?.toLowerCase() || '';
      const assetType = assetTypeFromPath(info.path);
      if (!assetType) continue;

      const mimeType = mimeTypeFromPath(info.path);
      const filename = info.path.split(/[/\\]/).pop() || file.name;
      const logicalId = generateLogicalId(assetType, currentAssets);

      const asset: Asset = {
        id: uuidv4(),
        logicalId,
        filename,
        type: assetType,
        mimeType,
        filePath: info.path,
        url: info.url,
      };

      try {
        if (assetType === 'image') {
          const dims = await loadImageDimensions(info.url);
          asset.width = dims.width;
          asset.height = dims.height;
        } else if (assetType === 'video') {
          const dims = await loadVideoDimensions(info.url);
          asset.width = dims.width;
          asset.height = dims.height;
          asset.duration = dims.duration;
        } else if (assetType === 'audio') {
          asset.duration = await loadAudioDuration(info.url);
        }
      } catch (err) {
        console.warn(`Failed to load metadata for ${filename}:`, err);
      }

      currentAssets.push(asset);
      useDocuFlowStore.getState().addAsset(asset);
    }
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      const files = getSupportedFiles(e.dataTransfer);
      if (files.length > 0) {
        setDropFileCount(files.length);
        setDropVisible(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropVisible(false);
      setDropFileCount(0);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden bg-slate-950 text-white">
      <TitleBar />
      <div className="flex-1 w-full h-full overflow-hidden flex flex-row">
        {activeTab === 'studio' ? <EditorLayout /> : activeTab === 'scenes' ? <SceneGenerator /> : <ImageGenerator />}
      </div>
      <DropZone visible={dropVisible} fileCount={dropFileCount} />
    </div>
  );
}

export default App;
