import { v4 as uuidv4 } from 'uuid';
import { deriveVisualContext } from './context';
import { buildLayerPrompt } from './promptBuilder';
import type {
  PlanSceneInput,
  SceneCameraMovement,
  SceneLayer,
  SceneLayerType,
  ScenePlan,
  SceneVisualContext,
  ShotType,
} from './types';

/**
 * Deterministic scene planner.
 *
 * Analyses narration + visual description and produces a layered documentary
 * composition plan: shot type, shared visual context, depth layers and camera
 * movement. Heuristic by design so it is testable and does not require a
 * model call; the AI scene breakdown's visual description feeds it.
 */

// ---------------------------------------------------------------------------
// Keyword signals
// ---------------------------------------------------------------------------

const STRONG_ESTABLISHING = [
  'wide shot', 'wide establishing', 'aerial', 'panorama', 'skyline', 'vista',
  'horizon', 'overview', 'bird\'s eye', 'across the valley', 'distant village', 'cityscape',
];
const WEAK_ESTABLISHING = ['landscape', 'distant', 'stretch of', 'expanse', 'rolling hills', 'open country'];

const DETAIL_SIGNALS = [
  'close-up', 'closeup', 'close up', 'detail of', 'details of', 'macro', 'texture of',
  'hands of', 'hands working', 'fingers', 'face of', 'portrait of', 'weaving', 'carving',
  'stitching', 'writing by hand', 'crafting', 'tool in hand',
];

const ATMOSPHERIC_SIGNALS = [
  'fog', 'mist', 'haze', 'dust', 'smoke', 'rain', 'snow', 'light rays', 'sun rays',
  'god rays', 'light beams', 'motes', 'atmosphere', 'moody', 'misty', 'smoky', 'rainy',
];

const HISTORICAL_SIGNALS = [
  'used to', 'once', 'formerly', 'in the old days', 'traditionally', 'generations ago',
  'days when', 'before the', 'before automobiles', 'heritage', 'the way it was',
  'colonial', 'ancient', 'medieval', 'bygone', 'earlier days', 'in those days',
];

const SUBJECT_SIGNALS = [
  'portrait', 'riding', 'walking', 'working', 'driving', 'pulling', 'pushing', 'carrying',
  'his ', 'her ', 'one man', 'one woman', 'a man', 'a woman', 'the farmer', 'the driver',
  'the worker', 'the vendor', 'face', 'expression', 'journey', 'travelled', 'traveled',
  'commuting', 'transport',
];

const ENVIRONMENT_SIGNALS = [
  'daily life', 'surroundings', 'setting of', 'the place', 'market', 'street', 'fields',
  'village life', 'scenery', 'environs', 'the land', 'the region', 'bustling',
];

const SUBJECT_OBJECT_WORDS = [
  'cart', 'bullock', 'ox', 'oxen', 'horse', 'camel', 'elephant', 'donkey', 'buffalo',
  'train', 'boat', 'bicycle', 'cycle', 'tractor', 'truck', 'bus', 'carriage', 'wagon',
  'loom', 'plough', 'plow', 'machine', 'tools', 'stall', 'crowd', 'children', 'people',
  'farmer', 'villagers', 'merchants', 'workers', 'fishermen', 'artisans', 'shepherd',
  'people travelling', 'travellers', 'travelers', 'pedestrians',
];

const FOREGROUND_CUE_WORDS = [
  'tree', 'branch', 'branches', 'leaves', 'foliage', 'grass', 'reeds', 'fence',
  'wall', 'doorway', 'door frame', 'window', 'pillar', 'arch', 'rock', 'boulder',
  'cornice', 'rope', 'wire', 'hanging cloth', 'net', 'wheat', 'crops', 'blades',
  'silhouette at the edge', 'overhanging', 'nearby object',
];

const DUSTY_ROAD_WORDS = ['road', 'dirt road', 'trail', 'path', 'lane', 'unpaved', 'dusty track'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countHits(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

function score(text: string, strong: string[], weak: string[] = []): number {
  return countHits(text, strong).length * 3 + countHits(text, weak).length;
}

function stableEdgeChoice(seedText: string): { edge: 'left' | 'right'; vertical: 'top' | 'bottom' } {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) | 0;
  }
  const edges: Array<'left' | 'right'> = ['left', 'right'];
  const verticals: Array<'top' | 'bottom'> = ['top', 'bottom'];
  return {
    edge: edges[Math.abs(hash) % 2],
    vertical: verticals[Math.abs(hash >> 3) % 2],
  };
}

/** Pick a plausible framing element consistent with the environment. */
function framingElementFor(context: SceneVisualContext, seedText: string): string {
  const env = `${context.environment ?? ''} ${context.location ?? ''}`.toLowerCase();
  const { edge, vertical } = stableEdgeChoice(seedText);
  const corner = `${vertical}-${edge === 'left' ? 'left' : 'right'}`;

  let element: string;
  if (/desert|dune|arid/.test(env)) {
    element = 'dry dune grass and a weathered wooden post';
  } else if (/river|coast|beach|water|fisher|canal|waterfront/.test(env)) {
    element = 'hemp ropes and fishing net strands';
  } else if (/market|street|shop|station|bazaar|workshop/.test(env)) {
    element = 'a hanging cloth awning and a wooden shoppost';
  } else if (/mountain|hill|forest|jungle|valley/.test(env)) {
    element = 'pine branches and wild grass';
  } else if (/farm|field|paddy|wheat|crop|countryside|rural|village/.test(env)) {
    element = 'wheat stalks and thorny tree branches';
  } else {
    element = 'tree branches and tall grass';
  }
  return `${element} entering from the ${corner} corner, close to the camera, slightly out of focus`;
}

// ---------------------------------------------------------------------------
// Shot type selection
// ---------------------------------------------------------------------------

export function chooseShotType(text: string, context: SceneVisualContext): ShotType {
  const scores: Record<ShotType, number> = {
    establishing: score(text, STRONG_ESTABLISHING, WEAK_ESTABLISHING),
    detail: score(text, DETAIL_SIGNALS),
    atmospheric: score(text, ATMOSPHERIC_SIGNALS),
    historical_reconstruction: context.period ? 4 : 0,
    subject: score(text, SUBJECT_SIGNALS),
    environment: score(text, ENVIRONMENT_SIGNALS),
  };

  scores.historical_reconstruction += countHits(text, HISTORICAL_SIGNALS).length * 3;

  // Priority breaks ties toward the most specific documentary composition.
  const priority: ShotType[] = [
    'historical_reconstruction',
    'atmospheric',
    'detail',
    'establishing',
    'subject',
    'environment',
  ];

  let best: ShotType | undefined;
  let bestScore = 0;
  for (const shot of priority) {
    if (scores[shot] > bestScore) {
      best = shot;
      bestScore = scores[shot];
    }
  }
  return best ?? 'subject';
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const SHOT_DEFAULT_MOVEMENT: Record<ShotType, SceneCameraMovement> = {
  establishing: 'zoom_in',
  subject: 'zoom_in',
  environment: 'pan_right',
  historical_reconstruction: 'zoom_in',
  detail: 'zoom_in',
  atmospheric: 'static',
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function makeLayer(
  id: string,
  type: SceneLayerType,
  name: string,
  order: number,
  subject: string,
  prompt: string,
  extra?: Partial<SceneLayer>,
): SceneLayer {
  return {
    id,
    type,
    name,
    order,
    subject,
    prompt,
    status: 'pending',
    alphaMode: type === 'background' ? 'none' : type === 'atmosphere' ? 'luminance' : 'chroma',
    visible: true,
    optional: type === 'atmosphere',
    ...extra,
  };
}

/**
 * Plan a layered documentary composition for one storyboard scene.
 *
 * Layer budget favours quality over count: background always, one subject
 * layer when the scene has subjects, one foreground for depth (a second only
 * for rich historical/environmental scenes with multiple framing cues), and
 * atmosphere only when the scene actually calls for it.
 */
/**
 * Strip explicit absence phrasing ("no people", "without vehicles") so
 * negated subjects are not planned as layers.
 */
function stripNegatedSubjects(text: string): string {
  return text.replace(
    /\b(no|without|devoid of|empty of|free of)\s+(any\s+)?(prominent\s+)?(close[-\s]?(up\s+)?)?(people|persons|figures|subjects|characters|human|humans|vehicles|animals|crowds?|crowd)\b/gi,
    ' ',
  );
}

export function planScene(input: PlanSceneInput): ScenePlan {
  const idFactory = input.idFactory ?? uuidv4;
  const text = [input.visual, input.imagePrompt, input.text].filter(Boolean).join('\n');
  const lower = text.toLowerCase();
  const subjectText = stripNegatedSubjects(text);

  const context = deriveVisualContext(input.visual, input.imagePrompt, input.text);
  const shot = chooseShotType(text, context);

  const subjectHits = countHits(subjectText, SUBJECT_OBJECT_WORDS);
  const fgCues = countHits(text, FOREGROUND_CUE_WORDS);
  const hasSubjects = subjectHits.length > 0 || shot !== 'establishing';

  const layers: SceneLayer[] = [];
  let order = 0;

  // --- Background (always) -------------------------------------------------
  const bgParts: string[] = [];
  bgParts.push(
    context.environment
      ? `${context.environment} landscape`
      : 'the scene environment',
  );
  if (context.architecture) bgParts.push(context.architecture);
  if (context.lighting) bgParts.push(context.lighting);
  if (context.weather) bgParts.push(context.weather);
  const bgContent = `${bgParts.join(', ')}, with sky and distant horizon, wide depth, natural perspective`;
  layers.push(
    makeLayer(
      idFactory(),
      'background',
      'Background',
      order++,
      bgContent,
      buildLayerPrompt({
        type: 'background',
        alphaMode: 'none',
        content: bgContent,
        shot,
        context,
      }),
      input.existingAssetId
        ? { status: 'done', assetId: input.existingAssetId, alphaApplied: false }
        : undefined,
    ),
  );

  // --- Midground (subjects) ----------------------------------------------
  if (hasSubjects) {
    const midParts: string[] = [];
    if (context.characters) midParts.push(context.characters);
    else if (subjectHits.length > 0) midParts.push(subjectHits.slice(0, 4).join(', '));
    else midParts.push('the main subjects');
    if (context.clothing) midParts.push(context.clothing);
    const midPlacement =
      shot === 'detail'
        ? 'filling the center of the frame at close range'
        : shot === 'establishing'
          ? 'small in the frame, placed in the middle distance'
          : 'positioned in the middle band of the frame, scaled for natural distance from the camera';
    const midContent = `${midParts.join(', ')}, ${midPlacement}`;

    layers.push(
      makeLayer(
        idFactory(),
        'midground',
        shot === 'detail' ? 'Main Subject' : 'Main Subject',
        order++,
        midContent,
        buildLayerPrompt({
          type: 'midground',
          alphaMode: 'chroma',
          content: midContent,
          shot,
          context,
        }),
      ),
    );

    // Secondary subject layer only for rich scenes with several subject groups.
    if (
      subjectHits.length >= 4 &&
      (shot === 'historical_reconstruction' || shot === 'environment')
    ) {
      const secondContent = `${subjectHits.slice(4, 8).join(', ') || 'secondary subjects'}, placed to one side of the main subject at a slightly different distance`;
      layers.push(
        makeLayer(
          idFactory(),
          'midground',
          'Secondary Subject',
          order++,
          secondContent,
          buildLayerPrompt({
            type: 'midground',
            alphaMode: 'chroma',
            content: secondContent,
            shot,
            context,
          }),
        ),
      );
    }
  }

  // --- Foreground (depth) --------------------------------------------------
  const wantsForeground =
    fgCues.length > 0 ||
    shot === 'subject' ||
    shot === 'historical_reconstruction' ||
    shot === 'environment' ||
    shot === 'detail';
  if (wantsForeground) {
    const fgContent =
      fgCues.length > 0
        ? `${[...new Set(fgCues)].slice(0, 3).join(', ')} framing the scene from the ${stableEdgeChoice(text).edge} edge, close to the camera`
        : framingElementFor(context, text);
    layers.push(
      makeLayer(
        idFactory(),
        'foreground',
        'Foreground',
        order++,
        fgContent,
        buildLayerPrompt({
          type: 'foreground',
          alphaMode: 'chroma',
          content: fgContent,
          shot,
          context,
        }),
      ),
    );

    if (fgCues.length >= 2 && (shot === 'historical_reconstruction' || shot === 'environment')) {
      const fg2Content = `${[...new Set(fgCues)].slice(3, 6).join(', ') || 'additional foliage'}, entering from the opposite frame edge, closest to the camera`;
      layers.push(
        makeLayer(
          idFactory(),
          'foreground',
          'Foreground 2',
          order++,
          fg2Content,
          buildLayerPrompt({
            type: 'foreground',
            alphaMode: 'chroma',
            content: fg2Content,
            shot,
            context,
          }),
        ),
      );
    }
  }

  // --- Atmosphere (optional — only when the scene calls for it) -----------
  const weatherAtmo = context.weather && !/sunny|clear sky/i.test(context.weather);
  const explicitAtmo = countHits(text, ATMOSPHERIC_SIGNALS).length > 0;
  const dustyRoad =
    shot === 'historical_reconstruction' && countHits(lower, DUSTY_ROAD_WORDS).length > 0;
  if (explicitAtmo || weatherAtmo || dustyRoad || shot === 'atmospheric') {
    const atmoKind = /rain/.test(context.weather ?? '') || countHits(text, ['rain', 'rainy']).length > 0
      ? 'fine rain streaks'
      : /snow/.test(context.weather ?? '') || countHits(text, ['snow']).length > 0
        ? 'drifting snowflakes'
        : /fog|mist/.test(`${context.weather ?? ''} ${lower}`) || countHits(text, ['fog', 'mist', 'misty']).length > 0
          ? 'low-lying fog and mist'
          : /smoke/.test(`${context.weather ?? ''} ${lower}`) || countHits(text, ['smoke', 'smoky']).length > 0
            ? 'drifting smoke'
            : dustyRoad || countHits(text, ['dust', 'dusty']).length > 0
              ? 'suspended dust motes catching the light'
              : 'subtle volumetric light rays and floating particles';
    const atmoContent = `${atmoKind}, spread evenly across the whole frame, gentle and unobtrusive`;
    layers.push(
      makeLayer(
        idFactory(),
        'atmosphere',
        'Atmosphere',
        order++,
        atmoContent,
        buildLayerPrompt({
          type: 'atmosphere',
          alphaMode: 'luminance',
          content: atmoContent,
          shot,
          context,
        }),
        { transform: { opacity: 0.55 } },
      ),
    );
  }

  const movement = input.cameraMotion ?? SHOT_DEFAULT_MOVEMENT[shot];

  return {
    shot,
    context,
    camera: { movement, intensity: 'subtle' },
    layers,
    reasoning:
      `Shot: ${shot}. ` +
      `Layers: ${layers.map((l) => `${l.type} (${l.name})`).join(' → ')}. ` +
      `Camera: ${movement}, subtle.`,
  };
}
