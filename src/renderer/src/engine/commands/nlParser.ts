import { v4 as uuidv4 } from 'uuid';
import { Command } from './types';
import { Asset } from '../../types/assets';

interface NlParseResult {
  commands: Command[];
  errors: string[];
}

interface ParseContext {
  commands: Command[];
  errors: string[];
  currentTime: number;
  currentTarget: string | null;
  currentLayerCmdId: string | null;
  layerMap: Map<string, string>;
  assetRefIndex: Map<string, number>;
}

function cleanStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function resolveAssetRef(
  ref: string,
  assets: Asset[],
  ctx: ParseContext
): { id: string; type: string; number: number } | null {
  const lower = ref.toLowerCase().trim();
  const cleaned = cleanStr(ref);

  const typeMap: Record<string, string> = {
    'image': 'image', 'images': 'image', 'pic': 'image', 'photo': 'image', 'photos': 'image', 'picture': 'image', 'pictures': 'image',
    'video': 'video', 'videos': 'video', 'clip': 'video', 'clips': 'video', 'footage': 'video',
    'audio': 'audio', 'music': 'music', 'musics': 'music', 'sound': 'audio',
    'sfx': 'sfx', 'effect': 'sfx', 'effects': 'sfx',
    'voiceover': 'voiceover', 'voice': 'voiceover', 'vo': 'voiceover', 'narration': 'voiceover',
    'ambient': 'ambient', 'bg': 'ambient', 'background': 'ambient',
  };

  let assetType: string | null = null;
  let numberPart = '';
  for (const [keyword, type] of Object.entries(typeMap)) {
    const regex = new RegExp(`^${keyword}\\s*(\\d+)?`, 'i');
    const m = lower.match(regex);
    if (m) {
      assetType = type;
      numberPart = m[1] || '';
      break;
    }
  }

  if (assetType && numberPart) {
    const num = parseInt(numberPart, 10);
    const key = `${assetType}_${num}`;
    const currentIdx = ctx.assetRefIndex.get(key) ?? 0;
    ctx.assetRefIndex.set(key, currentIdx + 1);
    const matches = assets.filter(a => {
      if (assetType === 'image') return a.type === 'image';
      if (assetType === 'video') return a.type === 'video';
      if (['music', 'sfx', 'voiceover', 'ambient'].includes(assetType)) return a.type === 'audio' && a.audioRole === assetType;
      return false;
    });
    if (matches.length > 0 && num <= matches.length) {
      return { id: matches[num - 1].id, type: assetType, number: num };
    }
  }

  if (assetType && !numberPart) {
    const byType = assets.filter(a => {
      if (assetType === 'image') return a.type === 'image';
      if (assetType === 'video') return a.type === 'video';
      if (['music', 'sfx', 'voiceover', 'ambient'].includes(assetType)) return a.type === 'audio' && a.audioRole === assetType;
      return false;
    });
    if (byType.length === 1) {
      return { id: byType[0].id, type: assetType, number: 1 };
    }
  }

  for (const a of assets) {
    if (a.id === ref || a.id.toLowerCase() === lower) {
      return { id: a.id, type: a.type, number: 0 };
    }
  }

  for (const a of assets) {
    if (a.logicalId.toLowerCase() === lower || cleanStr(a.logicalId) === cleaned) {
      return { id: a.id, type: a.type, number: 0 };
    }
  }

  for (const a of assets) {
    const fnLower = a.filename.toLowerCase();
    const fnClean = cleanStr(a.filename);
    const fnNoExt = cleanStr(stripExt(a.filename));
    if (fnLower === lower || fnClean === cleaned || fnNoExt === cleaned) {
      return { id: a.id, type: a.type, number: 0 };
    }
  }

  for (const a of assets) {
    const fnNoExt = stripExt(a.filename).toLowerCase();
    if (fnNoExt.includes(lower) || lower.includes(fnNoExt)) {
      return { id: a.id, type: a.type, number: 0 };
    }
    if (cleanStr(a.logicalId).includes(cleaned) || cleaned.includes(cleanStr(a.logicalId))) {
      return { id: a.id, type: a.type, number: 0 };
    }
  }

  if (assetType) {
    const byType = assets.filter(a => {
      if (assetType === 'image') return a.type === 'image';
      if (assetType === 'video') return a.type === 'video';
      if (['music', 'sfx', 'voiceover', 'ambient'].includes(assetType)) return a.type === 'audio' && a.audioRole === assetType;
      return false;
    });
    const idxMatch = lower.match(/(\d+)/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10);
      if (idx >= 1 && idx <= byType.length) {
        return { id: byType[idx - 1].id, type: assetType, number: idx };
      }
    }
    if (byType.length > 0) {
      return { id: byType[0].id, type: assetType, number: 1 };
    }
  }

  const numMatch = lower.match(/(\d+)/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10);
    const allByType = assets.filter(a => a.type === 'image' || a.type === 'video');
    if (idx >= 1 && idx <= allByType.length) {
      return { id: allByType[idx - 1].id, type: allByType[idx - 1].type, number: idx };
    }
    if (assets.length > 0 && idx >= 1 && idx <= assets.length) {
      return { id: assets[idx - 1].id, type: assets[idx - 1].type, number: idx };
    }
  }

  return null;
}

function parseTimePhrase(text: string): number | null {
  const t = text.toLowerCase().trim();

  const secMatch = t.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/);
  if (secMatch) return parseFloat(secMatch[1]);

  const minMatch = t.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/);
  if (minMatch) return parseFloat(minMatch[1]) * 60;

  const msMatch = t.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (msMatch) return parseFloat(msMatch[1]) / 1000;

  const num = parseFloat(t);
  return isNaN(num) ? null : num;
}

function parseDirection(text: string): 'left' | 'right' | 'top' | 'bottom' | null {
  const t = text.toLowerCase().trim();
  if (t === 'left') return 'left';
  if (t === 'right') return 'right';
  if (t === 'top' || t === 'up') return 'top';
  if (t === 'bottom' || t === 'down') return 'bottom';
  return null;
}

function parseOpacity(text: string): number | null {
  const t = text.toLowerCase().trim();
  if (t === 'fully' || t === 'fully visible') return 1;
  if (t === 'invisible' || t === 'gone') return 0;
  const num = parseFloat(t.replace('%', ''));
  if (isNaN(num)) return null;
  return num > 1 ? num / 100 : num;
}

function makeId(): string {
  return `nl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeLayerTarget(resolved: { id: string }, ctx: ParseContext): string {
  if (!ctx.layerMap.has(resolved.id)) {
    const showCmdId = makeId();
    ctx.commands.push({
      id: showCmdId,
      type: 'show',
      asset: resolved.id,
      start: ctx.currentTime,
      duration: 5,
    });
    ctx.layerMap.set(resolved.id, showCmdId);
  }
  return ctx.layerMap.get(resolved.id) || resolved.id;
}

function addCommand(ctx: ParseContext, cmd: Command) {
  ctx.commands.push(cmd);
}

function extractQuotedContent(text: string): string | null {
  const match = text.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}

function splitClauses(text: string): string[] {
  const cleaned = text.replace(/;\s*/g, '. ').replace(/\.\s+/g, '. ');
  const parts = cleaned.split(/\.\s*|,\s*(?:then|after that|next|also)\s*/i);
  return parts
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => p.replace(/^[Tt]hen\s+/, '').replace(/^[Aa]fter that\s+/, '').replace(/^[Nn]ext\s+/, '').replace(/^[Aa]lso\s+/, ''));
}

export function parseNaturalLanguage(
  input: string,
  assets: Asset[]
): NlParseResult {
  const ctx: ParseContext = {
    commands: [],
    errors: [],
    currentTime: 0,
    currentTarget: null,
    currentLayerCmdId: null,
    layerMap: new Map(),
    assetRefIndex: new Map(),
  };

  const clauses = splitClauses(input);

  for (const clause of clauses) {
    try {
      processClause(clause, assets, ctx);
    } catch (e: any) {
      ctx.errors.push(e.message || `Failed to parse: "${clause}"`);
    }
  }

  return { commands: ctx.commands, errors: ctx.errors };
}

function processClause(clause: string, assets: Asset[], ctx: ParseContext) {
  const c = clause.toLowerCase().trim();

  // SHOW / display / add / put / place / insert
  if (/\b(show|display|add|put|place|render|insert)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const time = extractTimeValue(clause);
    const duration = extractDurationValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'show',
      asset: resolved.id,
      start: ctx.currentTime,
      duration: duration ?? 5,
    });
    ctx.layerMap.set(resolved.id, ctx.commands[ctx.commands.length - 1].id);
    ctx.currentTarget = resolved.id;
    if (duration !== null) ctx.currentTime += duration;
    return;
  }

  // HIDE / remove
  if (/\b(hide|remove|clear)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'hide',
      target: makeLayerTarget(resolved, ctx),
      start: ctx.currentTime,
    });
    return;
  }

  // FADE IN
  if (/\bfade\s*in\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'fadeIn',
      target: makeLayerTarget(resolved, ctx),
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // FADE OUT
  if (/\bfade\s*out\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'fadeOut',
      target: makeLayerTarget(resolved, ctx),
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // MOVE
  if (/\b(move|shift|slide)\b/.test(c) && !/\b(move3d|rotate3d)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const from = extractCoord(clause, /from\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    const to = extractCoord(clause, /to\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    const dir = parseDirection(c.match(/(?:to|toward|towards)\s+(left|right|up|down|top|bottom)/i)?.[1] ?? '');
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    const fromPos = from ?? { x: 0, y: 0 };
    const toPos = to ?? (dir ? dirToCoord(dir) : { x: 100, y: 0 });

    addCommand(ctx, {
      id: makeId(),
      type: 'move',
      target: makeLayerTarget(resolved, ctx),
      from: fromPos,
      to: toPos,
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // SCALE
  if (/\b(scale|zoom|resize|enlarge|shrink)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const scaleMatch = c.match(/(?:scale|zoom|resize|enlarge|shrink).*?(?:from\s+)?(\d+(?:\.\d+)?)\s*(?:x|times|×)?\s*(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:x|times|×)?/);
    const from = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    const to = scaleMatch ? parseFloat(scaleMatch[2]) : 2;
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'scale',
      target: makeLayerTarget(resolved, ctx),
      from,
      to,
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // ROTATE
  if (/\b(rotate|spin|turn|rotate3d)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const angleMatch = c.match(/(?:from\s+)?(-?\d+(?:\.\d+)?)\s*°?\s*(?:to\s+)?(-?\d+(?:\.\d+)?)\s*°?/);
    const from = angleMatch ? parseFloat(angleMatch[1]) : 0;
    const to = angleMatch ? parseFloat(angleMatch[2]) : 360;
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    const is3D = /\brotate3d\b/.test(c);
    if (is3D) {
      addCommand(ctx, {
        id: makeId(),
        type: 'rotate3D',
        target: makeLayerTarget(resolved, ctx),
        from: { x: from, y: 0, z: 0 },
        to: { x: to, y: 0, z: 0 },
        start: ctx.currentTime,
        duration: dur,
      });
    } else {
      addCommand(ctx, {
        id: makeId(),
        type: 'rotate',
        target: makeLayerTarget(resolved, ctx),
        from,
        to,
        start: ctx.currentTime,
        duration: dur,
      });
    }
    ctx.currentTime += dur;
    return;
  }

  // OPACITY
  if (/\b(opacity|transparent|visible|invisible)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const opacityMatch = c.match(/opacity\s+(?:to\s+)?(\d+(?:\.\d+)?%?|fully|invisible|gone)/);
    const from = 1;
    const to = opacityMatch ? (parseOpacity(opacityMatch[1]) ?? 0.5) : 0.5;
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'opacity',
      target: makeLayerTarget(resolved, ctx),
      from,
      to,
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // FLIP
  if (/\bflip\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const isH = /\bhorizontally?\b/.test(c) || /\bflip\s+h\b/.test(c);
    const isV = /\bvertically?\b/.test(c) || /\bflip\s+v\b/.test(c);
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    if (isV) {
      addCommand(ctx, {
        id: makeId(),
        type: 'flipVertical',
        target: makeLayerTarget(resolved, ctx),
        start: ctx.currentTime,
      });
    } else {
      addCommand(ctx, {
        id: makeId(),
        type: 'flipHorizontal',
        target: makeLayerTarget(resolved, ctx),
        start: ctx.currentTime,
      });
    }
    return;
  }

  // BLUR
  if (/\b(blur|defocus|soften)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const blurMatch = c.match(/(?:from\s+)?(\d+(?:\.\d+)?)\s*(?:to\s+)?(\d+(?:\.\d+)?)/);
    const from = blurMatch ? parseFloat(blurMatch[1]) : 0;
    const to = blurMatch ? parseFloat(blurMatch[2]) : 5;
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'blur',
      target: makeLayerTarget(resolved, ctx),
      from,
      to,
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // WIPE
  if (/\bwipe\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dir = extractDirection(clause);
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'wipe',
      target: makeLayerTarget(resolved, ctx),
      direction: dir ?? 'left',
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // SLIDE
  if (/\bslide\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dir = extractDirection(clause);
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'slide',
      target: makeLayerTarget(resolved, ctx),
      direction: dir ?? 'left',
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // PLAY (audio)
  if (/\b(play|start\s+playing|begin\s+playing)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 10;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;
    const vol = extractVolume(clause);

    addCommand(ctx, {
      id: makeId(),
      type: 'music',
      asset: resolved.id,
      start: ctx.currentTime,
      duration: dur,
      volume: vol,
    });
    ctx.currentTime += dur;
    return;
  }

  // MUSIC
  if (/\b(music|song|track|bgm)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 10;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;
    const vol = extractVolume(clause);

    addCommand(ctx, {
      id: makeId(),
      type: 'music',
      asset: resolved.id,
      start: ctx.currentTime,
      duration: dur,
      volume: vol,
    });
    ctx.currentTime += dur;
    return;
  }

  // SFX
  if (/\b(sfx|sound effect|effect)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;
    const vol = extractVolume(clause);

    addCommand(ctx, {
      id: makeId(),
      type: 'sfx',
      asset: resolved.id,
      start: ctx.currentTime,
      volume: vol,
    });
    return;
  }

  // VOICEOVER
  if (/\b(voiceover|voice|narration|speak|narrate)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 5;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'sfx',
      asset: resolved.id,
      start: ctx.currentTime,
    });
    ctx.currentTime += dur;
    return;
  }

  // AMBIENT
  if (/\b(ambient|background sound|bg sound|room tone)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 10;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;
    const vol = extractVolume(clause);

    addCommand(ctx, {
      id: makeId(),
      type: 'ambient',
      asset: resolved.id,
      start: ctx.currentTime,
      duration: dur,
      volume: vol,
    });
    ctx.currentTime += dur;
    return;
  }

  // TEXT / SUBTITLE
  if (/\b(text|title|caption|subtitle|label)\b/.test(c)) {
    const content = extractQuotedContent(clause);
    if (!content) {
      ctx.errors.push(`Missing quoted text in: "${clause}"`);
      return;
    }
    const dur = extractDurationValue(clause) ?? 3;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;
    const pos = extractCoord(clause, /at\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    const fontSize = extractFontSize(clause);
    const color = extractColor(clause);

    const isSubtitle = /\b(subtitle|caption)\b/.test(c);
    if (isSubtitle) {
      addCommand(ctx, {
        id: makeId(),
        type: 'subtitle',
        content,
        start: ctx.currentTime,
        duration: dur,
        x: pos?.x,
        y: pos?.y,
      });
    } else {
      addCommand(ctx, {
        id: makeId(),
        type: 'text',
        content,
        start: ctx.currentTime,
        duration: dur,
        x: pos?.x,
        y: pos?.y,
        fontSize,
        color,
      });
    }
    ctx.currentTime += dur;
    return;
  }

  // VOLUME
  if (/\b(volume|loudness|gain)\b/.test(c)) {
    const resolved = extractAssetRef(clause, assets, ctx);
    if (!resolved) {
      ctx.errors.push(`Could not resolve asset reference in: "${clause}"`);
      return;
    }
    const volMatch = c.match(/(?:to|at)\s+(\d+(?:\.\d+)?%?|low|medium|high|muted|silent)/);
    const to = volMatch ? parseVolumeWord(volMatch[1]) : 0.5;
    const dur = extractDurationValue(clause) ?? 1;
    const time = extractTimeValue(clause);
    if (time !== null) ctx.currentTime = time;

    addCommand(ctx, {
      id: makeId(),
      type: 'volume',
      target: makeLayerTarget(resolved, ctx),
      from: 1,
      to,
      start: ctx.currentTime,
      duration: dur,
    });
    ctx.currentTime += dur;
    return;
  }

  // Time shift: "at 2s", "start at 5s", "begin at 10s"
  const timeShift = c.match(/\b(?:at|start\s+at|begin\s+at|from)\s+(\d+(?:\.\d+)?(?:s|sec|m|min)?)/);
  if (timeShift) {
    const t = parseTimePhrase(timeShift[1]);
    if (t !== null) ctx.currentTime = t;
    return;
  }

  // Duration extension: "for 3s", "lasting 5 seconds"
  const durExt = c.match(/\b(?:for|lasting)\s+(\d+(?:\.\d+)?(?:s|sec|m|min)?)\b/);
  if (durExt) {
    const d = parseTimePhrase(durExt[1]);
    if (d !== null) ctx.currentTime += d;
    return;
  }

  ctx.errors.push(`Unrecognized clause: "${clause}"`);
}

function extractAssetRef(
  clause: string,
  assets: Asset[],
  ctx: ParseContext
): { id: string } | null {
  const lower = clause.toLowerCase();

  const typePatterns = [
    /\b(image|images?|pics?|photos?|pictures?)\s*(\d+)\b/i,
    /\b(videos?|clips?|footage)\s*(\d+)\b/i,
    /\b(music|musics?|songs?|tracks?|bgm)\s*(\d+)\b/i,
    /\b(sfx|sound\s*effects?|effects?)\s*(\d+)\b/i,
    /\b(voiceover|voice|vo|narration)\s*(\d+)\b/i,
    /\b(ambient|bg|background)\s*(\d+)\b/i,
    /\b(audio)\s*(\d+)\b/i,
  ];

  for (const pat of typePatterns) {
    const m = clause.match(pat);
    if (m) {
      const resolved = resolveAssetRef(`${m[1]} ${m[2]}`, assets, ctx);
      if (resolved) return { id: resolved.id };
    }
  }

  const quoted = extractQuotedContent(clause);
  if (quoted) {
    const resolved = resolveAssetRef(quoted, assets, ctx);
    if (resolved) return { id: resolved.id };
  }

  const afterPreposition = clause.match(/\b(?:of|for|the|on|to|from)\s+([A-Za-z][A-Za-z0-9_.-]+)/i);
  if (afterPreposition) {
    const resolved = resolveAssetRef(afterPreposition[1], assets, ctx);
    if (resolved) return { id: resolved.id };
  }

  const assetKeywords = lower.match(/\b(image|video|audio|music|sfx|effect|voiceover|voice|ambient|photo|clip|song|track)\s+(\d+)\b/i);
  if (assetKeywords) {
    const resolved = resolveAssetRef(`${assetKeywords[1]} ${assetKeywords[2]}`, assets, ctx);
    if (resolved) return { id: resolved.id };
  }

  const standaloneAssetRef = lower.match(/\b(image|video|audio|music|sfx|effect|voiceover|voice|ambient|photo|clip|song|track)(?:\s+(\d+))?\b/i);
  if (standaloneAssetRef) {
    const ref = standaloneAssetRef[2]
      ? `${standaloneAssetRef[1]} ${standaloneAssetRef[2]}`
      : standaloneAssetRef[1];
    const resolved = resolveAssetRef(ref, assets, ctx);
    if (resolved) return { id: resolved.id };
  }

  const words = clause.replace(/["',]/g, '').split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    const skipWords = new Set([
      'show', 'display', 'add', 'put', 'place', 'insert', 'render', 'hide', 'remove', 'clear',
      'fade', 'in', 'out', 'move', 'shift', 'slide', 'scale', 'zoom', 'resize', 'enlarge', 'shrink',
      'rotate', 'spin', 'turn', 'flip', 'blur', 'defocus', 'soften', 'wipe', 'cut',
      'music', 'song', 'track', 'bgm', 'sfx', 'effect', 'voiceover', 'voice', 'narration', 'ambient',
      'text', 'title', 'caption', 'subtitle', 'label', 'volume', 'loudness', 'gain',
      'the', 'a', 'an', 'at', 'from', 'to', 'for', 'on', 'with', 'by', 'of', 'and', 'or',
      'seconds', 'second', 'minutes', 'minute', 'ms', 'duration', 'time',
      'left', 'right', 'top', 'bottom', 'up', 'down', 'horizontally', 'vertically',
      'fully', 'invisible', 'gone', 'low', 'medium', 'high', 'muted', 'silent',
    ]);
    if (skipWords.has(word.toLowerCase())) continue;
    const resolved = resolveAssetRef(word, assets, ctx);
    if (resolved) return { id: resolved.id };
  }

  return null;
}

function extractTimeValue(clause: string): number | null {
  const c = clause.toLowerCase();
  if (/\b(from\s+the\s+beginning|at\s+start|at\s+the\s+start|from\s+start)\b/.test(c)) return 0;
  if (/\b(beginning|start)\b/.test(c) && !/\b(from|to|start\s+at)\b/.test(c)) return 0;

  const patterns = [
    /\bat\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\bstart(?:ing)?\s+at\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\bbegin(?:ning)?\s+at\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\bfrom\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\btime\s*[=:]\s*(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\bat\s+(\d+(?:\.\d+)?)\b/,
  ];
  for (const pat of patterns) {
    const m = clause.match(pat);
    if (m) return parseTimePhrase(m[1]);
  }
  return null;
}

function extractDurationValue(clause: string): number | null {
  const patterns = [
    /\bfor\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\blast(?:ing)?\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\bduration\s*[=:]\s*(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
    /\blong\s+(\d+(?:\.\d+)?(?:s|sec|ms|m|min)?)\b/i,
  ];
  for (const pat of patterns) {
    const m = clause.match(pat);
    if (m) return parseTimePhrase(m[1]);
  }
  return null;
}

function extractCoord(
  clause: string,
  regex: RegExp
): { x: number; y: number } | null {
  const m = clause.match(regex);
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  return isNaN(x) || isNaN(y) ? null : { x, y };
}

function extractDirection(clause: string): 'left' | 'right' | 'top' | 'bottom' | null {
  const m = clause.match(/\b(left|right|up|down|top|bottom)\b/i);
  if (!m) return null;
  return parseDirection(m[1]);
}

function extractVolume(clause: string): number | null {
  const patterns = [
    /volume\s*(?:at|=|:)?\s*(\d+(?:\.\d+)?%?|low|medium|high|muted|silent)/i,
    /at\s+(\d+(?:\.\d+)?)%\s*(?:volume)?/i,
    /(\d+(?:\.\d+)?)%\s*volume/i,
    /\b(low|medium|high|muted|silent)\b/i,
  ];
  for (const pat of patterns) {
    const m = clause.match(pat);
    if (m) return parseVolumeWord(m[1]);
  }
  return null;
}

function parseVolumeWord(val: string): number | null {
  const v = val.toLowerCase();
  if (v === 'low') return 0.25;
  if (v === 'medium') return 0.5;
  if (v === 'high') return 0.75;
  if (v === 'muted' || v === 'silent') return 0;
  const num = parseFloat(v.replace('%', ''));
  if (isNaN(num)) return null;
  return num > 1 ? num / 100 : num;
}

function extractFontSize(clause: string): number | undefined {
  const m = clause.match(/\b(?:size|font\s*size)\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : undefined;
}

function extractColor(clause: string): string | undefined {
  const m = clause.match(/\bcolor\s*[=:]\s*(#[0-9a-fA-F]{3,8}|[a-z]+)/i);
  return m ? m[1] : undefined;
}

function dirToCoord(dir: string): { x: number; y: number } {
  switch (dir) {
    case 'left': return { x: -100, y: 0 };
    case 'right': return { x: 100, y: 0 };
    case 'top': return { x: 0, y: -100 };
    case 'bottom': return { x: 0, y: 100 };
    default: return { x: 100, y: 0 };
  }
}

export async function parseNaturalLanguageWithLLM(
  input: string,
  assets: Asset[]
): Promise<NlParseResult> {
  const localResult = parseNaturalLanguage(input, assets);

  if (localResult.commands.length > 0) {
    return localResult;
  }

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt: `Convert this natural language video editing instruction into JSON commands array. Available assets: ${JSON.stringify(assets.map(a => ({ id: a.id, type: a.type, name: a.filename })))}. Instruction: "${input}"`,
        stream: false,
      }),
    });
    const data = await response.json();
    const text = data.response || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const cmds = JSON.parse(jsonMatch[0]) as Command[];
      return { commands: cmds, errors: [] };
    }
  } catch {
    // LLM unavailable
  }

  return localResult;
}
