import { Asset, AssetType } from '../../types/assets';

const TYPE_PREFIXES: Record<AssetType, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export function generateLogicalId(type: AssetType, existingAssets: Asset[]): string {
  const prefix = TYPE_PREFIXES[type];
  const existingIds = new Set(existingAssets.map((a) => a.logicalId));

  let counter = 1;
  let logicalId = `${prefix}${counter}`;

  while (existingIds.has(logicalId)) {
    counter++;
    logicalId = `${prefix}${counter}`;
  }

  return logicalId;
}

export function findAssetByLogicalId(assets: Asset[], logicalId: string): Asset | undefined {
  return assets.find((a) => a.logicalId === logicalId);
}

export function findAsset(assets: Asset[], name: string): Asset | undefined {
  const lowerName = name.toLowerCase();

  const byId = assets.find((a) => a.id === name);
  if (byId) return byId;

  const byLogicalId = findAssetByLogicalId(assets, name);
  if (byLogicalId) return byLogicalId;

  const exact = assets.find((a) => a.filename.toLowerCase() === lowerName);
  if (exact) return exact;

  const stem = stripExtension(lowerName);
  return assets.find((a) => stripExtension(a.filename.toLowerCase()) === stem);
}

export function getAssetUrl(assets: Asset[], name: string): string {
  const asset = findAsset(assets, name);
  return asset?.url || '';
}

export function getAssetById(assets: Asset[], id: string): Asset | undefined {
  return assets.find((a) => a.id === id || a.logicalId === id);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}
