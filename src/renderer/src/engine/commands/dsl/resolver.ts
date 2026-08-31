import { Asset } from '../../../types/assets';

export interface ResolvedAsset {
  logicalId: string;
  asset: Asset;
}

export function resolveAssetNumber(
  assets: Asset[],
  type: 'image' | 'video' | 'audio' | 'music' | 'sfx' | 'voiceover',
  number: number
): ResolvedAsset | null {
  const typeMap: Record<string, string[]> = {
    image: ['image'],
    video: ['video'],
    audio: ['audio'],
    music: ['audio'],
    sfx: ['audio'],
    voiceover: ['audio'],
  };
  const allowedTypes = typeMap[type] || [type];

  const candidates = assets.filter((a) => {
    if (!allowedTypes.includes(a.type)) return false;
    if (type === 'music' && a.audioRole !== 'music' && a.audioRole !== 'unassigned') return false;
    if (type === 'sfx' && a.audioRole !== 'sfx' && a.audioRole !== 'unassigned') return false;
    if (type === 'voiceover' && a.audioRole !== 'voiceover' && a.audioRole !== 'unassigned') return false;
    return true;
  });

  const logicalPrefix = `${type}${number}`;
  const match = candidates.find(
    (a) => a.logicalId === logicalPrefix || a.logicalId === `${type} ${number}`
  );
  if (match) return { logicalId: match.logicalId, asset: match };

  const byIndex = candidates[number - 1];
  if (byIndex) return { logicalId: byIndex.logicalId, asset: byIndex };

  return null;
}

export function getAvailableAssets(
  assets: Asset[],
  type: 'image' | 'video' | 'audio' | 'music' | 'sfx' | 'voiceover'
): number[] {
  const typeMap: Record<string, string[]> = {
    image: ['image'],
    video: ['video'],
    audio: ['audio'],
    music: ['audio'],
    sfx: ['audio'],
    voiceover: ['audio'],
  };
  const allowedTypes = typeMap[type] || [type];

  const candidates = assets.filter((a) => {
    if (!allowedTypes.includes(a.type)) return false;
    if (type === 'music' && a.audioRole !== 'music' && a.audioRole !== 'unassigned') return false;
    if (type === 'sfx' && a.audioRole !== 'sfx' && a.audioRole !== 'unassigned') return false;
    if (type === 'voiceover' && a.audioRole !== 'voiceover' && a.audioRole !== 'unassigned') return false;
    return true;
  });

  return candidates.map((_, i) => i + 1);
}
