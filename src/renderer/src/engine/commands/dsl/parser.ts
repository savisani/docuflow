import { v4 as uuidv4 } from 'uuid';
import { Command, EasingType } from '../types';
import { Asset } from '../../../types/assets';
import { DslError } from './errors';
import { tokenize, TokenLine } from './tokenizer';
import { resolveAssetNumber, getAvailableAssets } from './resolver';
import { DSL_COMMAND_NAMES } from './registry';

interface ParseResult {
  commands: Command[];
  errors: DslError[];
}

function expectToken(line: TokenLine, index: number, expected: string): boolean {
  const t = line.tokens[index];
  return t != null && t.value.toUpperCase() === expected.toUpperCase();
}

function getNumber(line: TokenLine, index: number): number | null {
  const t = line.tokens[index];
  if (!t) return null;
  const n = Number(t.value);
  return isNaN(n) ? null : n;
}

function parseCoordinatePair(line: TokenLine, index: number): { x: number; y: number; nextIndex: number } | null {
  const t = line.tokens[index];
  if (!t) return null;
  const parts = t.value.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y, nextIndex: index + 1 };
}

function parseCoordinateTriple(line: TokenLine, index: number): { x: number; y: number; z: number; nextIndex: number } | null {
  const t = line.tokens[index];
  if (!t) return null;
  const parts = t.value.split(',');
  if (parts.length !== 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
  return { x, y, z, nextIndex: index + 1 };
}

function parseTimeRange(line: TokenLine, index: number): { start: number; end: number; nextIndex: number } | null {
  const t = line.tokens[index];
  if (!t) return null;
  const parts = t.value.split('-');
  if (parts.length !== 2) return null;
  const start = Number(parts[0]);
  const end = Number(parts[1]);
  if (isNaN(start) || isNaN(end)) return null;
  return { start, end, nextIndex: index + 1 };
}

function parseDirection(line: TokenLine, index: number): 'left' | 'right' | 'top' | 'bottom' | null {
  const t = line.tokens[index];
  if (!t) return null;
  const v = t.value.toUpperCase();
  if (v === 'LEFT') return 'left';
  if (v === 'RIGHT') return 'right';
  if (v === 'TOP') return 'top';
  if (v === 'BOTTOM') return 'bottom';
  return null;
}

function parseAssetTypeAndNumber(
  line: TokenLine,
  index: number
): { type: 'image' | 'video' | 'music' | 'sfx' | 'voiceover'; number: number; nextIndex: number } | null {
  const t = line.tokens[index];
  if (!t) return null;
  const v = t.value.toUpperCase();
  const n = getNumber(line, index + 1);
  if (n === null) return null;
  if (v === 'IMAGE') return { type: 'image', number: n, nextIndex: index + 2 };
  if (v === 'VIDEO') return { type: 'video', number: n, nextIndex: index + 2 };
  if (v === 'MUSIC') return { type: 'music', number: n, nextIndex: index + 2 };
  if (v === 'SFX') return { type: 'sfx', number: n, nextIndex: index + 2 };
  if (v === 'VOICEOVER') return { type: 'voiceover', number: n, nextIndex: index + 2 };
  return null;
}

function resolveTarget(
  line: TokenLine,
  index: number,
  assets: Asset[],
  assetLookup: Map<string, { type: string; number: number }>
): { targetId: string; logicalRef: string; nextIndex: number } | null {
  const ref = parseAssetTypeAndNumber(line, index);
  if (!ref) return null;
  const resolved = resolveAssetNumber(assets, ref.type, ref.number);
  if (!resolved) return null;
  const key = `${ref.type.toUpperCase()} ${ref.number}`;
  assetLookup.set(key, { type: ref.type, number: ref.number });
  return { targetId: resolved.asset.id, logicalRef: key, nextIndex: ref.nextIndex };
}

function resolveAssetRef(
  line: TokenLine,
  index: number,
  assets: Asset[]
): { assetId: string; resolved: boolean; nextIndex: number } | null {
  const ref = parseAssetTypeAndNumber(line, index);
  if (!ref) return null;
  const resolved = resolveAssetNumber(assets, ref.type, ref.number);
  if (!resolved) return null;
  return { assetId: resolved.asset.id, resolved: true, nextIndex: ref.nextIndex };
}

export function parseDsl(input: string, assets: Asset[]): ParseResult {
  const tokenLines = tokenize(input);
  const commands: Command[] = [];
  const errors: DslError[] = [];
  const assetLookup = new Map<string, { type: string; number: number }>();
  const layerMap = new Map<string, string>(); // assetId -> layer command id

  for (const line of tokenLines) {
    if (line.tokens.length === 0) continue;

    const first = line.tokens[0].value.toUpperCase();

    try {
      switch (first) {
        case 'SHOW': {
          if (line.tokens.length < 6) {
            errors.push({ line: line.line, message: 'Expected: SHOW IMAGE <n> FROM <start> TO <end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after SHOW' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM after asset reference' }); break; }
          const start = getNumber(line, 4);
          if (start === null) { errors.push({ line: line.line, message: 'Invalid start time' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO after start time' }); break; }
          const end = getNumber(line, 6);
          if (end === null) { errors.push({ line: line.line, message: 'Invalid end time' }); break; }
          if (end <= start) { errors.push({ line: line.line, message: 'End time must be greater than start time' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const showCmdId = uuidv4();
          commands.push({
            id: showCmdId,
            type: 'show',
            asset: resolved.asset.id,
            start,
            duration: end - start,
          });
          layerMap.set(resolved.asset.id, showCmdId);
          assetLookup.set(`${ref.type.toUpperCase()} ${ref.number}`, { type: ref.type, number: ref.number });
          break;
        }

        case 'HIDE': {
          if (line.tokens.length < 4) {
            errors.push({ line: line.line, message: 'Expected: HIDE IMAGE <n> AT <time>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after HIDE' }); break; }
          if (!expectToken(line, 3, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const time = getNumber(line, 4);
          if (time === null) { errors.push({ line: line.line, message: 'Invalid time value' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerId = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'hide',
            target: targetLayerId,
            start: time,
          });
          break;
        }

        case 'MOVE3D': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: MOVE3D IMAGE <n> FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after MOVE3D' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const fromCoord3d = parseCoordinateTriple(line, 4);
          if (!fromCoord3d) { errors.push({ line: line.line, message: 'Invalid FROM coordinate. Expected x,y,z' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const toCoord3d = parseCoordinateTriple(line, 6);
          if (!toCoord3d) { errors.push({ line: line.line, message: 'Invalid TO coordinate. Expected x,y,z' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const move3dRange = parseTimeRange(line, 8);
          if (!move3dRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerId = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'move3D',
            target: targetLayerId,
            from: { x: fromCoord3d.x, y: fromCoord3d.y, z: fromCoord3d.z },
            to: { x: toCoord3d.x, y: toCoord3d.y, z: toCoord3d.z },
            start: move3dRange.start,
            duration: move3dRange.end - move3dRange.start,
          });
          break;
        }

        case 'MOVE': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: MOVE IMAGE <n> FROM <x>,<y> TO <x>,<y> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after MOVE' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const fromCoord = parseCoordinatePair(line, 4);
          if (!fromCoord) { errors.push({ line: line.line, message: 'Invalid FROM coordinate. Expected x,y' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const toCoord = parseCoordinatePair(line, 6);
          if (!toCoord) { errors.push({ line: line.line, message: 'Invalid TO coordinate. Expected x,y' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const moveRange = parseTimeRange(line, 8);
          if (!moveRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerId = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'move',
            target: targetLayerId,
            from: { x: fromCoord.x, y: fromCoord.y },
            to: { x: toCoord.x, y: toCoord.y },
            start: moveRange.start,
            duration: moveRange.end - moveRange.start,
          });
          break;
        }

        case 'SCALE': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: SCALE IMAGE <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after SCALE' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const scaleFrom = getNumber(line, 4);
          if (scaleFrom === null) { errors.push({ line: line.line, message: 'Invalid scale value' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const scaleTo = getNumber(line, 6);
          if (scaleTo === null) { errors.push({ line: line.line, message: 'Invalid scale value' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const scaleRange = parseTimeRange(line, 8);
          if (!scaleRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          commands.push({
            id: uuidv4(),
            type: 'scale',
            target: resolved.asset.id,
            from: scaleFrom,
            to: scaleTo,
            start: scaleRange.start,
            duration: scaleRange.end - scaleRange.start,
          });
          break;
        }

        case 'ROTATE3D': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: ROTATE3D IMAGE <n> FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after ROTATE3D' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const fromCoord3d = parseCoordinateTriple(line, 4);
          if (!fromCoord3d) { errors.push({ line: line.line, message: 'Invalid FROM coordinate. Expected x,y,z' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const toCoord3d = parseCoordinateTriple(line, 6);
          if (!toCoord3d) { errors.push({ line: line.line, message: 'Invalid TO coordinate. Expected x,y,z' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const rot3dRange = parseTimeRange(line, 8);
          if (!rot3dRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerId3d = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'rotate3D',
            target: targetLayerId3d,
            from: { x: fromCoord3d.x, y: fromCoord3d.y, z: fromCoord3d.z },
            to: { x: toCoord3d.x, y: toCoord3d.y, z: toCoord3d.z },
            start: rot3dRange.start,
            duration: rot3dRange.end - rot3dRange.start,
          });
          break;
        }

        case 'ROTATE': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: ROTATE IMAGE <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after ROTATE' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const rotFrom = getNumber(line, 4);
          if (rotFrom === null) { errors.push({ line: line.line, message: 'Invalid rotation value' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const rotTo = getNumber(line, 6);
          if (rotTo === null) { errors.push({ line: line.line, message: 'Invalid rotation value' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const rotRange = parseTimeRange(line, 8);
          if (!rotRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdRot = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'rotate',
            target: targetLayerIdRot,
            from: rotFrom,
            to: rotTo,
            start: rotRange.start,
            duration: rotRange.end - rotRange.start,
          });
          break;
        }

        case 'DEPTH': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: DEPTH IMAGE <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after DEPTH' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const depthFrom = getNumber(line, 4);
          if (depthFrom === null) { errors.push({ line: line.line, message: 'Invalid depth value' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const depthTo = getNumber(line, 6);
          if (depthTo === null) { errors.push({ line: line.line, message: 'Invalid depth value' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const depthRange = parseTimeRange(line, 8);
          if (!depthRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdDepth = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'depth',
            target: targetLayerIdDepth,
            from: depthFrom,
            to: depthTo,
            start: depthRange.start,
            duration: depthRange.end - depthRange.start,
          });
          break;
        }

        case 'OPACITY': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: OPACITY IMAGE <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          const ref = parseAssetTypeAndNumber(line, 1);
          if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after OPACITY' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const opFrom = getNumber(line, 4);
          if (opFrom === null) { errors.push({ line: line.line, message: 'Invalid opacity value' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const opTo = getNumber(line, 6);
          if (opTo === null) { errors.push({ line: line.line, message: 'Invalid opacity value' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const opRange = parseTimeRange(line, 8);
          if (!opRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, ref.type, ref.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, ref.type);
            errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdOpacity = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'opacity',
            target: targetLayerIdOpacity,
            from: opFrom,
            to: opTo,
            start: opRange.start,
            duration: opRange.end - opRange.start,
          });
          break;
        }

        case 'FADE': {
          const second = line.tokens[1]?.value.toUpperCase();
          if (second === 'AUDIO') {
            if (line.tokens.length < 7) {
              errors.push({ line: line.line, message: 'Expected: FADE AUDIO IN/OUT IMAGE <n> DURING <start>-<end>' });
              break;
            }
            const fadeDir = line.tokens[2]?.value.toUpperCase();
            if (fadeDir !== 'IN' && fadeDir !== 'OUT') {
              errors.push({ line: line.line, message: 'Expected IN or OUT after FADE AUDIO' });
              break;
            }
            const ref = parseAssetTypeAndNumber(line, 3);
            if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after FADE AUDIO' }); break; }
            if (!expectToken(line, 6, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
            const fadeRange = parseTimeRange(line, 7);
            if (!fadeRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }
            const resolved = resolveAssetNumber(assets, ref.type, ref.number);
            if (!resolved) {
              const avail = getAvailableAssets(assets, ref.type);
              errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
              break;
            }
            const targetLayerIdFadeAudio = layerMap.get(resolved.asset.id) || resolved.asset.id;
            commands.push({
              id: uuidv4(),
              type: fadeDir === 'IN' ? 'fadeAudioIn' : 'fadeAudioOut',
              target: targetLayerIdFadeAudio,
              duration: fadeRange.end - fadeRange.start,
              start: fadeRange.start,
            });
          } else {
            if (line.tokens.length < 6) {
              errors.push({ line: line.line, message: 'Expected: FADE IN/OUT IMAGE <n> DURING <start>-<end>' });
              break;
            }
            if (second !== 'IN' && second !== 'OUT') {
              errors.push({ line: line.line, message: 'Expected IN or OUT after FADE' });
              break;
            }
            const ref = parseAssetTypeAndNumber(line, 2);
            if (!ref) { errors.push({ line: line.line, message: 'Expected asset type and number after FADE IN/OUT' }); break; }
            if (!expectToken(line, 4, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
            const fadeRange = parseTimeRange(line, 5);
            if (!fadeRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }
            const resolved = resolveAssetNumber(assets, ref.type, ref.number);
            if (!resolved) {
              const avail = getAvailableAssets(assets, ref.type);
              errors.push({ line: line.line, message: `${ref.type.toUpperCase()} ${ref.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
              break;
            }
            const targetLayerIdFade = layerMap.get(resolved.asset.id) || resolved.asset.id;
            if (second === 'IN') {
              commands.push({
                id: uuidv4(),
                type: 'fadeIn',
                target: targetLayerIdFade,
                duration: fadeRange.end - fadeRange.start,
                start: fadeRange.start,
              });
            } else {
              commands.push({
                id: uuidv4(),
                type: 'fadeOut',
                target: targetLayerIdFade,
                duration: fadeRange.end - fadeRange.start,
                start: fadeRange.start,
              });
            }
          }
          break;
        }

        case 'FLIP': {
          const flipDir = line.tokens[1]?.value.toUpperCase();
          if (flipDir !== 'HORIZONTAL' && flipDir !== 'VERTICAL') {
            errors.push({ line: line.line, message: 'Expected HORIZONTAL or VERTICAL after FLIP' });
            break;
          }
          if (!expectToken(line, 2, 'IMAGE')) { errors.push({ line: line.line, message: 'Expected IMAGE after FLIP' }); break; }
          const flipRef = parseAssetTypeAndNumber(line, 2);
          if (!flipRef) { errors.push({ line: line.line, message: 'Expected asset type and number after FLIP' }); break; }
          if (!expectToken(line, flipRef.nextIndex, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const flipTime = getNumber(line, flipRef.nextIndex + 1);
          if (flipTime === null) { errors.push({ line: line.line, message: 'Invalid time value' }); break; }
          const resolved = resolveAssetNumber(assets, flipRef.type, flipRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, flipRef.type);
            errors.push({ line: line.line, message: `${flipRef.type.toUpperCase()} ${flipRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdFlip = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: flipDir === 'HORIZONTAL' ? 'flipHorizontal' : 'flipVertical',
            target: targetLayerIdFlip,
            start: flipTime,
          });
          break;
        }

        case 'CROP': {
          if (!expectToken(line, 2, 'IMAGE')) { errors.push({ line: line.line, message: 'Expected IMAGE after CROP' }); break; }
          const cropRef = parseAssetTypeAndNumber(line, 2);
          if (!cropRef) { errors.push({ line: line.line, message: 'Expected asset type and number after CROP' }); break; }
          if (!expectToken(line, cropRef.nextIndex, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const cropT = line.tokens[cropRef.nextIndex + 1];
          if (!cropT) { errors.push({ line: line.line, message: 'Expected x,y,w,h coordinates' }); break; }
          const cparts = cropT.value.split(',');
          if (cparts.length !== 4) { errors.push({ line: line.line, message: 'Expected x,y,w,h coordinates' }); break; }
          const cx = Number(cparts[0]);
          const cy = Number(cparts[1]);
          const cw = Number(cparts[2]);
          const ch = Number(cparts[3]);
          if ([cx, cy, cw, ch].some(isNaN)) { errors.push({ line: line.line, message: 'Invalid crop coordinates' }); break; }
          const resolved = resolveAssetNumber(assets, cropRef.type, cropRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, cropRef.type);
            errors.push({ line: line.line, message: `${cropRef.type.toUpperCase()} ${cropRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdCrop = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'crop',
            target: targetLayerIdCrop,
            x: cx,
            y: cy,
            width: cw,
            height: ch,
            start: 0,
          });
          break;
        }

        case 'WIPE': {
          if (line.tokens.length < 7) {
            errors.push({ line: line.line, message: 'Expected: WIPE IMAGE <n> FROM <direction> DURING <start>-<end>' });
            break;
          }
          const wipeRef = parseAssetTypeAndNumber(line, 1);
          if (!wipeRef) { errors.push({ line: line.line, message: 'Expected asset type and number after WIPE' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const wipeDir = parseDirection(line, 4);
          if (!wipeDir) { errors.push({ line: line.line, message: 'Invalid direction' }); break; }
          if (!expectToken(line, 5, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const wipeRange = parseTimeRange(line, 6);
          if (!wipeRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }
          const resolved = resolveAssetNumber(assets, wipeRef.type, wipeRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, wipeRef.type);
            errors.push({ line: line.line, message: `${wipeRef.type.toUpperCase()} ${wipeRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdWipe = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'wipe',
            target: targetLayerIdWipe,
            direction: wipeDir,
            start: wipeRange.start,
            duration: wipeRange.end - wipeRange.start,
          });
          break;
        }

        case 'CUT': {
          if (line.tokens.length < 4) {
            errors.push({ line: line.line, message: 'Expected: CUT IMAGE <n> AT <time>' });
            break;
          }
          const cutRef = parseAssetTypeAndNumber(line, 1);
          if (!cutRef) { errors.push({ line: line.line, message: 'Expected asset type and number after CUT' }); break; }
          if (!expectToken(line, 3, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const cutTime = getNumber(line, 4);
          if (cutTime === null) { errors.push({ line: line.line, message: 'Invalid time value' }); break; }
          const resolved = resolveAssetNumber(assets, cutRef.type, cutRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, cutRef.type);
            errors.push({ line: line.line, message: `${cutRef.type.toUpperCase()} ${cutRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdCut = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'cut',
            target: targetLayerIdCut,
            start: cutTime,
          });
          break;
        }

        case 'VOLUME': {
          if (line.tokens.length < 10) {
            errors.push({ line: line.line, message: 'Expected: VOLUME AUDIO <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          if (!expectToken(line, 1, 'AUDIO')) { errors.push({ line: line.line, message: 'Expected AUDIO after VOLUME' }); break; }
          const volRef = parseAssetTypeAndNumber(line, 2);
          if (!volRef) { errors.push({ line: line.line, message: 'Expected asset type and number after VOLUME AUDIO' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const volFrom = getNumber(line, 4);
          const volTo = getNumber(line, 6);
          if (volFrom === null || volTo === null) { errors.push({ line: line.line, message: 'Invalid volume values' }); break; }
          if (!expectToken(line, 8, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const volRange = parseTimeRange(line, 9);
          if (!volRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }
          const easingStr = line.tokens[10]?.value;
          const easing = (easingStr ? easingStr.toLowerCase() : 'linear') as EasingType;
          const resolved = resolveAssetNumber(assets, volRef.type, volRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, volRef.type);
            errors.push({ line: line.line, message: `${volRef.type.toUpperCase()} ${volRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          commands.push({
            id: uuidv4(),
            type: 'volume',
            target: resolved.asset.id,
            from: volFrom,
            to: volTo,
            start: volRange.start,
            duration: volRange.end - volRange.start,
            easing,
          });
          break;
        }

        case 'AMBIENT': {
          if (!expectToken(line, 1, 'MUSIC')) { errors.push({ line: line.line, message: 'Expected MUSIC after AMBIENT' }); break; }
          const ambNum = getNumber(line, 2);
          if (ambNum === null) { errors.push({ line: line.line, message: 'Expected music number' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const ambStart = getNumber(line, 4);
          if (ambStart === null) { errors.push({ line: line.line, message: 'Invalid start time' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const ambEnd = getNumber(line, 6);
          if (ambEnd === null) { errors.push({ line: line.line, message: 'Invalid end time' }); break; }
          if (ambEnd <= ambStart) { errors.push({ line: line.line, message: 'End time must be greater than start time' }); break; }
          let ambVolume;
          if (line.tokens.length > 7 && expectToken(line, 7, 'VOLUME')) {
            const v = getNumber(line, 8);
            if (v === null) { errors.push({ line: line.line, message: 'Invalid volume value' }); break; }
            ambVolume = Math.max(0, Math.min(1, v));
          }
          const resolved = resolveAssetNumber(assets, 'music', ambNum);
          if (!resolved) {
            const avail = getAvailableAssets(assets, 'music');
            errors.push({ line: line.line, message: `MUSIC ${ambNum} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          commands.push({
            id: uuidv4(),
            type: 'ambient',
            asset: resolved.asset.id,
            start: ambStart,
            duration: ambEnd - ambStart,
            volume: ambVolume,
          });
          break;
        }

        case 'REPLACE': {
          if (line.tokens.length < 7) {
            errors.push({ line: line.line, message: 'Expected: REPLACE IMAGE <n> WITH IMAGE <m> AT <time>' });
            break;
          }
          const replaceRef = parseAssetTypeAndNumber(line, 1);
          if (!replaceRef) { errors.push({ line: line.line, message: 'Expected asset type and number after REPLACE' }); break; }
          if (!expectToken(line, replaceRef.nextIndex, 'WITH')) { errors.push({ line: line.line, message: 'Expected WITH' }); break; }
          const withRef = parseAssetTypeAndNumber(line, replaceRef.nextIndex + 1);
          if (!withRef) { errors.push({ line: line.line, message: 'Expected asset type and number after WITH' }); break; }
          if (!expectToken(line, withRef.nextIndex, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const replaceTime = getNumber(line, withRef.nextIndex + 1);
          if (replaceTime === null) { errors.push({ line: line.line, message: 'Invalid time value' }); break; }

          const targetResolved = resolveAssetNumber(assets, replaceRef.type, replaceRef.number);
          if (!targetResolved) {
            const avail = getAvailableAssets(assets, replaceRef.type);
            errors.push({ line: line.line, message: `${replaceRef.type.toUpperCase()} ${replaceRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const withResolved = resolveAssetNumber(assets, withRef.type, withRef.number);
          if (!withResolved) {
            const avail = getAvailableAssets(assets, withRef.type);
            errors.push({ line: line.line, message: `${withRef.type.toUpperCase()} ${withRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdReplace = layerMap.get(targetResolved.asset.id) || targetResolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'replace',
            target: targetLayerIdReplace,
            asset: withResolved.asset.id,
            start: replaceTime,
          });
          break;
        }

        case 'SLIDE': {
          if (line.tokens.length < 7) {
            errors.push({ line: line.line, message: 'Expected: SLIDE IMAGE <n> FROM <direction> DURING <start>-<end>' });
            break;
          }
          const slideRef = parseAssetTypeAndNumber(line, 1);
          if (!slideRef) { errors.push({ line: line.line, message: 'Expected asset type and number after SLIDE' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const slideDir = parseDirection(line, 4);
          if (!slideDir) { errors.push({ line: line.line, message: 'Invalid direction' }); break; }
          if (!expectToken(line, 5, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const slideRange = parseTimeRange(line, 6);
          if (!slideRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }
          let fromAssetId: string | undefined;
          if (line.tokens.length > 7 && expectToken(line, 7, 'FROM')) {
            const fromRef = parseAssetTypeAndNumber(line, 8);
            if (!fromRef) { errors.push({ line: line.line, message: 'Expected asset type and number after FROM' }); break; }
            const fromResolved = resolveAssetNumber(assets, fromRef.type, fromRef.number);
            if (!fromResolved) {
              const avail = getAvailableAssets(assets, fromRef.type);
              errors.push({ line: line.line, message: `${fromRef.type.toUpperCase()} ${fromRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
              break;
            }
            fromAssetId = fromResolved.asset.id;
          }
          const resolved = resolveAssetNumber(assets, slideRef.type, slideRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, slideRef.type);
            errors.push({ line: line.line, message: `${slideRef.type.toUpperCase()} ${slideRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdSlide = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'slide',
            target: targetLayerIdSlide,
            fromAsset: fromAssetId,
            direction: slideDir,
            start: slideRange.start,
            duration: slideRange.end - slideRange.start,
          });
          break;
        }

        case 'BLUR': {
          if (line.tokens.length < 9) {
            errors.push({ line: line.line, message: 'Expected: BLUR IMAGE <n> FROM <from> TO <to> DURING <start>-<end>' });
            break;
          }
          const blurRef = parseAssetTypeAndNumber(line, 1);
          if (!blurRef) { errors.push({ line: line.line, message: 'Expected asset type and number after BLUR' }); break; }
          if (!expectToken(line, 3, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const blurFrom = getNumber(line, 4);
          if (blurFrom === null) { errors.push({ line: line.line, message: 'Invalid blur value' }); break; }
          if (!expectToken(line, 5, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const blurTo = getNumber(line, 6);
          if (blurTo === null) { errors.push({ line: line.line, message: 'Invalid blur value' }); break; }
          if (!expectToken(line, 7, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const blurRange = parseTimeRange(line, 8);
          if (!blurRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const resolved = resolveAssetNumber(assets, blurRef.type, blurRef.number);
          if (!resolved) {
            const avail = getAvailableAssets(assets, blurRef.type);
            errors.push({ line: line.line, message: `${blurRef.type.toUpperCase()} ${blurRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdBlur = layerMap.get(resolved.asset.id) || resolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'blur',
            target: targetLayerIdBlur,
            from: blurFrom,
            to: blurTo,
            start: blurRange.start,
            duration: blurRange.end - blurRange.start,
          });
          break;
        }

        case 'MUSIC': {
          if (line.tokens.length < 5) {
            errors.push({ line: line.line, message: 'Expected: MUSIC <n> FROM <start> TO <end>' });
            break;
          }
          const musicNum = getNumber(line, 1);
          if (musicNum === null) { errors.push({ line: line.line, message: 'Expected music number' }); break; }
          if (!expectToken(line, 2, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
          const musicStart = getNumber(line, 3);
          if (musicStart === null) { errors.push({ line: line.line, message: 'Invalid start time' }); break; }
          if (!expectToken(line, 4, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const musicEnd = getNumber(line, 5);
          if (musicEnd === null) { errors.push({ line: line.line, message: 'Invalid end time' }); break; }
          if (musicEnd <= musicStart) { errors.push({ line: line.line, message: 'End time must be greater than start time' }); break; }
          let musicVolume: number | undefined;
          if (line.tokens.length > 6 && expectToken(line, 6, 'VOLUME')) {
            const v = getNumber(line, 7);
            if (v === null) { errors.push({ line: line.line, message: 'Invalid volume value' }); break; }
            musicVolume = Math.max(0, Math.min(1, v));
          }
          let musicFadeIn: number | undefined;
          if (line.tokens.length > 6 && expectToken(line, 6, 'FADEIN')) {
            const v = getNumber(line, 7);
            if (v === null) { errors.push({ line: line.line, message: 'Invalid fade in value' }); break; }
            musicFadeIn = v;
          }
          let musicFadeOut: number | undefined;
          if (line.tokens.length > 6 && expectToken(line, 6, 'FADEOUT')) {
            const v = getNumber(line, 7);
            if (v === null) { errors.push({ line: line.line, message: 'Invalid fade out value' }); break; }
            musicFadeOut = v;
          }
          const musicResolved = resolveAssetNumber(assets, 'music', musicNum);
          if (!musicResolved) {
            const avail = getAvailableAssets(assets, 'music');
            errors.push({ line: line.line, message: `MUSIC ${musicNum} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          commands.push({
            id: uuidv4(),
            type: 'music',
            asset: musicResolved.asset.id,
            start: musicStart,
            duration: musicEnd - musicStart,
            volume: musicVolume,
            fadeIn: musicFadeIn,
            fadeOut: musicFadeOut,
          });
          break;
        }

        case 'SFX': {
          if (line.tokens.length < 4) {
            errors.push({ line: line.line, message: 'Expected: SFX <n> AT <time>' });
            break;
          }
          const sfxNum = getNumber(line, 1);
          if (sfxNum === null) { errors.push({ line: line.line, message: 'Expected sfx number' }); break; }
          if (!expectToken(line, 2, 'AT')) { errors.push({ line: line.line, message: 'Expected AT' }); break; }
          const sfxTime = getNumber(line, 3);
          if (sfxTime === null) { errors.push({ line: line.line, message: 'Invalid time value' }); break; }
          let sfxVolume: number | undefined;
          if (line.tokens.length > 4 && expectToken(line, 4, 'VOLUME')) {
            const v = getNumber(line, 5);
            if (v === null) { errors.push({ line: line.line, message: 'Invalid volume value' }); break; }
            sfxVolume = Math.max(0, Math.min(1, v));
          }
          const sfxResolved = resolveAssetNumber(assets, 'sfx', sfxNum);
          if (!sfxResolved) {
            const avail = getAvailableAssets(assets, 'sfx');
            errors.push({ line: line.line, message: `SFX ${sfxNum} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          commands.push({
            id: uuidv4(),
            type: 'sfx',
            asset: sfxResolved.asset.id,
            start: sfxTime,
            volume: sfxVolume,
          });
          break;
        }

        case 'TEXT': {
          if (line.tokens.length < 4) {
            errors.push({ line: line.line, message: 'Expected: TEXT "<content>" FROM <start> TO <end>' });
            break;
          }
          let content = '';
          let nextIndex = 1;
          for (let i = 1; i < line.tokens.length; i++) {
            content += line.tokens[i].value;
            if (i + 1 < line.tokens.length && line.tokens[i + 1].value === 'FROM') {
              nextIndex = i + 1;
              break;
            }
            content += ' ';
          }
          if (!expectToken(line, nextIndex, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM after text content' }); break; }
          const textStart = getNumber(line, nextIndex + 1);
          if (textStart === null) { errors.push({ line: line.line, message: 'Invalid start time' }); break; }
          if (!expectToken(line, nextIndex + 2, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const textEnd = getNumber(line, nextIndex + 3);
          if (textEnd === null) { errors.push({ line: line.line, message: 'Invalid end time' }); break; }
          if (textEnd <= textStart) { errors.push({ line: line.line, message: 'End time must be greater than start time' }); break; }

          let x: number | undefined;
          let y: number | undefined;
          let fontSize: number | undefined;
          let fontFamily: string | undefined;
          let color: string | undefined;

          let idx = nextIndex + 4;
          while (idx < line.tokens.length) {
            const token = line.tokens[idx]?.value.toUpperCase();
            if (token === 'AT') {
              const coord = parseCoordinatePair(line, idx + 1);
              if (coord) { x = coord.x; y = coord.y; idx = coord.nextIndex; }
            } else if (token === 'SIZE') {
              const sz = getNumber(line, idx + 1);
              if (sz !== null) { fontSize = sz; idx += 2; }
            } else if (token === 'FONT') {
              const fam = line.tokens[idx + 1]?.value;
              if (fam) { fontFamily = fam; idx += 2; }
            } else if (token === 'COLOR') {
              const col = line.tokens[idx + 1]?.value;
              if (col) { color = col; idx += 2; }
            } else {
              idx++;
            }
          }

          commands.push({
            id: uuidv4(),
            type: 'text',
            content,
            x,
            y,
            fontSize,
            fontFamily,
            color,
            start: textStart,
            duration: textEnd - textStart,
          });
          break;
        }

        case 'SUBTITLE': {
          if (line.tokens.length < 4) {
            errors.push({ line: line.line, message: 'Expected: SUBTITLE "<content>" FROM <start> TO <end>' });
            break;
          }
          let content = '';
          let nextIndex = 1;
          for (let i = 1; i < line.tokens.length; i++) {
            content += line.tokens[i].value;
            if (i + 1 < line.tokens.length && line.tokens[i + 1].value === 'FROM') {
              nextIndex = i + 1;
              break;
            }
            content += ' ';
          }
          if (!expectToken(line, nextIndex, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM after text content' }); break; }
          const subStart = getNumber(line, nextIndex + 1);
          if (subStart === null) { errors.push({ line: line.line, message: 'Invalid start time' }); break; }
          if (!expectToken(line, nextIndex + 2, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const subEnd = getNumber(line, nextIndex + 3);
          if (subEnd === null) { errors.push({ line: line.line, message: 'Invalid end time' }); break; }
          if (subEnd <= subStart) { errors.push({ line: line.line, message: 'End time must be greater than start time' }); break; }

          let x: number | undefined;
          let y: number | undefined;
          let style: 'default' | 'large' | 'small' | undefined;

          let idx = nextIndex + 4;
          while (idx < line.tokens.length) {
            const token = line.tokens[idx]?.value.toUpperCase();
            if (token === 'AT') {
              const coord = parseCoordinatePair(line, idx + 1);
              if (coord) { x = coord.x; y = coord.y; idx = coord.nextIndex; }
            } else if (token === 'STYLE') {
              const s = line.tokens[idx + 1]?.value.toLowerCase();
              if (s === 'default' || s === 'large' || s === 'small') { style = s; idx += 2; }
            } else {
              idx++;
            }
          }

          commands.push({
            id: uuidv4(),
            type: 'subtitle',
            content,
            x,
            y,
            style,
            start: subStart,
            duration: subEnd - subStart,
          });
          break;
        }

        case 'CROSSFADE': {
          if (line.tokens.length < 8) {
            errors.push({ line: line.line, message: 'Expected: CROSSFADE IMAGE <n> TO IMAGE <m> DURING <start>-<end>' });
            break;
          }
          const cfRef = parseAssetTypeAndNumber(line, 1);
          if (!cfRef) { errors.push({ line: line.line, message: 'Expected asset type and number after CROSSFADE' }); break; }
          if (!expectToken(line, cfRef.nextIndex, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
          const toRef = parseAssetTypeAndNumber(line, cfRef.nextIndex + 1);
          if (!toRef) { errors.push({ line: line.line, message: 'Expected asset type and number after TO' }); break; }
          if (!expectToken(line, toRef.nextIndex, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
          const cfRange = parseTimeRange(line, toRef.nextIndex + 1);
          if (!cfRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

          const targetResolved = resolveAssetNumber(assets, cfRef.type, cfRef.number);
          if (!targetResolved) {
            const avail = getAvailableAssets(assets, cfRef.type);
            errors.push({ line: line.line, message: `${cfRef.type.toUpperCase()} ${cfRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const toResolved = resolveAssetNumber(assets, toRef.type, toRef.number);
          if (!toResolved) {
            const avail = getAvailableAssets(assets, toRef.type);
            errors.push({ line: line.line, message: `${toRef.type.toUpperCase()} ${toRef.number} does not exist. Available: ${avail.length > 0 ? avail.join(', ') : 'none'}` });
            break;
          }
          const targetLayerIdCrossfade = layerMap.get(targetResolved.asset.id) || targetResolved.asset.id;
          commands.push({
            id: uuidv4(),
            type: 'crossfade',
            target: targetLayerIdCrossfade,
            toAsset: toResolved.asset.id,
            start: cfRange.start,
            duration: cfRange.end - cfRange.start,
          });
          break;
        }

        case 'CAMERA': {
          const camSecond = line.tokens[1]?.value.toUpperCase();
          if (camSecond === 'MOVE') {
            if (line.tokens.length < 8) {
              errors.push({ line: line.line, message: 'Expected: CAMERA MOVE FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>' });
              break;
            }
            if (!expectToken(line, 2, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
            const camFrom = parseCoordinateTriple(line, 3);
            if (!camFrom) { errors.push({ line: line.line, message: 'Invalid FROM coordinate. Expected x,y,z' }); break; }
            if (!expectToken(line, 4, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
            const camTo = parseCoordinateTriple(line, 5);
            if (!camTo) { errors.push({ line: line.line, message: 'Invalid TO coordinate. Expected x,y,z' }); break; }
            if (!expectToken(line, 6, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
            const camRange = parseTimeRange(line, 7);
            if (!camRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

            commands.push({
              id: uuidv4(),
              type: 'cameraMove',
              from: { x: camFrom.x, y: camFrom.y, z: camFrom.z },
              to: { x: camTo.x, y: camTo.y, z: camTo.z },
              start: camRange.start,
              duration: camRange.end - camRange.start,
            });
          } else if (camSecond === 'ROTATE') {
            if (line.tokens.length < 8) {
              errors.push({ line: line.line, message: 'Expected: CAMERA ROTATE FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>' });
              break;
            }
            if (!expectToken(line, 2, 'FROM')) { errors.push({ line: line.line, message: 'Expected FROM' }); break; }
            const camFrom = parseCoordinateTriple(line, 3);
            if (!camFrom) { errors.push({ line: line.line, message: 'Invalid FROM coordinate. Expected x,y,z' }); break; }
            if (!expectToken(line, 4, 'TO')) { errors.push({ line: line.line, message: 'Expected TO' }); break; }
            const camTo = parseCoordinateTriple(line, 5);
            if (!camTo) { errors.push({ line: line.line, message: 'Invalid TO coordinate. Expected x,y,z' }); break; }
            if (!expectToken(line, 6, 'DURING')) { errors.push({ line: line.line, message: 'Expected DURING' }); break; }
            const camRange = parseTimeRange(line, 7);
            if (!camRange) { errors.push({ line: line.line, message: 'Invalid time range' }); break; }

            commands.push({
              id: uuidv4(),
              type: 'cameraRotate',
              from: { x: camFrom.x, y: camFrom.y, z: camFrom.z },
              to: { x: camTo.x, y: camTo.y, z: camTo.z },
              start: camRange.start,
              duration: camRange.end - camRange.start,
            });
          } else {
            errors.push({ line: line.line, message: 'Expected CAMERA MOVE or CAMERA ROTATE' });
          }
          break;
        }

        default:
          if (!DSL_COMMAND_NAMES.has(first)) {
            errors.push({ line: line.line, message: `Unknown command "${line.tokens[0].value}"` });
          }
      }
    } catch (e) {
      errors.push({ line: line.line, message: `Parse error: ${(e as Error).message}` });
    }
  }

  return { commands, errors };
}
