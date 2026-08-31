import { Command } from '../engine/commands/types';

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

export interface SerializedAsset {
  id: string;
  logicalId: string;
  filename: string;
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
  serverUrl?: string;
  audioRole?: 'voiceover' | 'music' | 'sfx' | 'ambient' | 'unassigned';
  sampleRate?: number;
  channels?: number;
}

export interface ProjectVoiceover {
  assetId: string;
  language: string;
}

export interface ProjectTranscriptSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: { text: string; start: number; end: number }[];
  originalText?: string;
  originalLanguage?: string;
}

export interface ProjectTranscript {
  language: string;
  text: string;
  segments: ProjectTranscriptSegment[];
  translated?: boolean;
}

export interface ProjectSceneMarker {
  id: string;
  start: number;
  end: number;
  transcriptSegmentIds: string[];
}

export interface Project {
  version: number;
  settings: ProjectSettings;
  assets: SerializedAsset[];
  commands: Command[];
  voiceover?: ProjectVoiceover;
  transcript?: ProjectTranscript;
  sceneMarkers?: ProjectSceneMarker[];
}
