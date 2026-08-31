export type AssetType = 'image' | 'video' | 'audio';

export type AudioRole = 'voiceover' | 'music' | 'sfx' | 'ambient' | 'unassigned';

export interface Asset {
  id: string;
  logicalId: string;
  filename: string;
  type: AssetType;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
  thumbnailUrl?: string;
  filePath?: string;
  serverUrl?: string;
  thumbnail?: string;
  audioRole?: AudioRole;
  sampleRate?: number;
  channels?: number;
}
