import type { SceneVisualContext } from './types';

/**
 * Derives the shared visual context of a scene from its narration and visual
 * description. Every layer of the scene receives this context so separately
 * generated images agree on time period, place, lighting and wardrobe.
 *
 * Rule-based and deterministic — no model call required.
 */

interface Pattern {
  re: RegExp;
  label?: string;
}

const PERIOD_PATTERNS: Pattern[] = [
  { re: /\b(1[5-9]\d0s|20[0-2]0s)\b/i },
  { re: /\b(1[5-9]\d{2}|20[0-2]\d)\b/i },
  { re: /\bcolonial (era|period|rule)\b/i, label: 'colonial era' },
  { re: /\bbritish raj\b/i, label: 'British Raj' },
  { re: /\bmughal (era|period|empire)\b/i, label: 'Mughal era' },
  { re: /\bpre[- ]independence\b/i, label: 'pre-independence era' },
  { re: /\bindependence (era|struggle|movement)\b/i, label: 'Indian independence era' },
  { re: /\bfreedom struggle\b/i, label: 'freedom struggle era' },
  { re: /\bancient (times|era|period)\b/i, label: 'ancient era' },
  { re: /\bmedieval\b/i, label: 'medieval era' },
  { re: /\bworld war\b/i, label: 'World War era' },
  { re: /\bpost[- ]war\b/i, label: 'post-war era' },
  { re: /\b(before|prior to) (the )?(advent|arrival|spread|invention) of\b/i, label: 'pre-industrial era' },
  { re: /\bbefore automobiles\b/i, label: 'pre-automobile era' },
  { re: /\btraditional\b/i, label: 'traditional era' },
  { re: /\bpresent[- ]day|modern day|today\b/i, label: 'present day' },
  { re: /\bfuturisti[cs]\b/i, label: 'future' },
];

const LOCATION_PATTERNS: Pattern[] = [
  { re: /\b(rajasthan|punjab|haryana|bengal|bihar|gujarat|maharashtra|kerala|tamil nadu|karnataka|odisha|assam|kashmir|sindh|balochistan|uttar pradesh|madhya pradesh|deccan|ghat)\b/i },
  { re: /\bindia|indian\b/i, label: 'India' },
  { re: /\bpakistan\b/i, label: 'Pakistan' },
  { re: /\bbangladesh\b/i, label: 'Bangladesh' },
  { re: /\bnepal\b/i, label: 'Nepal' },
  { re: /\bsri lanka\b/i, label: 'Sri Lanka' },
  { re: /\bafrica|african\b/i, label: 'Africa' },
  { re: /\beurope|european\b/i, label: 'Europe' },
  { re: /\basia|asian\b/i, label: 'Asia' },
  { re: /\bamerica|american\b/i, label: 'America' },
  { re: /\brural\b/i, label: 'rural' },
  { re: /\burban\b/i, label: 'urban' },
  { re: /\bvillage|villagers\b/i, label: 'village' },
  { re: /\bsmall town\b/i, label: 'small town' },
  { re: /\bcountryside\b/i, label: 'countryside' },
  { re: /\bdesert\b/i, label: 'desert' },
  { re: /\bcoastal|seaside|shoreline\b/i, label: 'coastal' },
  { re: /\bmountain(?:ous)?|hill country|valley\b/i, label: 'mountainous' },
  { re: /\briverside|riverbank\b/i, label: 'riverbank' },
];

const LIGHTING_PATTERNS: Pattern[] = [
  { re: /\bsunset|golden hour|evening light\b/i, label: 'warm sunset light' },
  { re: /\bsunrise|dawn|first light\b/i, label: 'soft sunrise light' },
  { re: /\bnoon|midday|high sun\b/i, label: 'harsh midday sun' },
  { re: /\bnight|midnight\b/i, label: 'night' },
  { re: /\bmoonlight|moonlit\b/i, label: 'moonlight' },
  { re: /\bdusk|twilight|blue hour\b/i, label: 'dusk light' },
  { re: /\blamplight|lamp[- ]lit|lantern\b/i, label: 'lamplight' },
  { re: /\bcandlelight|candle[- ]lit\b/i, label: 'candlelight' },
  { re: /\bfirelight|campfire|bonfire|hearth\b/i, label: 'firelight' },
  { re: /\bovercast|diffuse (light|daylight)\b/i, label: 'overcast diffuse light' },
  { re: /\bbacklit|backlight|rim light|silhouetted\b/i, label: 'backlit' },
  { re: /\bwarm (light|lighting|glow)\b/i, label: 'warm light' },
  { re: /\bcool (light|lighting|glow|tones)\b/i, label: 'cool light' },
  { re: /\bharsh (sun|light|shadows)\b/i, label: 'harsh sunlight' },
  { re: /\bsoft (light|lighting)\b/i, label: 'soft light' },
  { re: /\binterior (light|lighting)|indoor (light|lighting)\b/i, label: 'interior light' },
];

const WEATHER_PATTERNS: Pattern[] = [
  { re: /\bmonsoon|rains?\b(?!.*rainfall)/i, label: 'monsoon rain' },
  { re: /\brainy|drizzle|downpour\b/i, label: 'rain' },
  { re: /\bfog|foggy|misty|mist\b/i, label: 'fog' },
  { re: /\bhaze|hazy|haziness\b/i, label: 'haze' },
  { re: /\bdust|dusty|dust storm|dust bowl\b/i, label: 'dusty' },
  { re: /\bsmoke|smoky\b/i, label: 'smoky' },
  { re: /\bsnow|snowy|snowfall\b/i, label: 'snow' },
  { re: /\bwindy|strong wind|breeze\b/i, label: 'windy' },
  { re: /\bcloudy|clouds\b/i, label: 'cloudy' },
  { re: /\bsunny|clear sky\b/i, label: 'sunny' },
  { re: /\bstorm(?:y)?\b/i, label: 'stormy' },
  { re: /\bhumid|sweltering|heat wave\b/i, label: 'humid heat' },
  { re: /\bcold|chilly|winter\b/i, label: 'cold weather' },
];

const TONE_PATTERNS: Pattern[] = [
  { re: /\bnostalgic|nostalgia\b/i, label: 'nostalgic' },
  { re: /\bmelancholic|melancholy|somber|sombre\b/i, label: 'melancholic' },
  { re: /\bgritty|raw\b/i, label: 'gritty' },
  { re: /\bhopeful|optimistic\b/i, label: 'hopeful' },
  { re: /\bcelebrat|festive|joyful\b/i, label: 'celebratory' },
  { re: /\btense|ominous|foreboding\b/i, label: 'tense' },
  { re: /\bpeaceful|serene|tranquil|calm\b/i, label: 'peaceful' },
  { re: /\bdramatic\b/i, label: 'dramatic' },
  { re: /\bsolemn|reverent\b/i, label: 'solemn' },
  { re: /\bplayful|lighthearted\b/i, label: 'playful' },
];

const ARCHITECTURE_PATTERNS: Pattern[] = [
  { re: /\bmud (houses?|huts?|dwellings?|walls?)\b/i, label: 'mud houses' },
  { re: /\bthatch(?:ed)? (roofs?|huts?|cottages?|houses?)\b/i, label: 'thatched roofs' },
  { re: /\bhaveli\b/i, label: 'havelis' },
  { re: /\bfort\b/i, label: 'fort architecture' },
  { re: /\bpalace\b/i, label: 'palace architecture' },
  { re: /\btemple\b/i, label: 'temple architecture' },
  { re: /\bmosque\b/i, label: 'mosque architecture' },
  { re: /\bchurch\b/i, label: 'church architecture' },
  { re: /\bcolonial (building|structure|bungalow|architecture)\b/i, label: 'colonial architecture' },
  { re: /\brailway station\b/i, label: 'railway station architecture' },
  { re: /\bfactory|industrial (building|works)\b/i, label: 'industrial architecture' },
  { re: /\bshop(s)?|storefront|market stall\b/i, label: 'shopfronts' },
  { re: /\bcottages?|cabins?\b/i, label: 'cottages' },
  { re: /\bskyscraper|high[- ]rise\b/i, label: 'modern high-rises' },
  { re: /\btent(s)?|shanty|slum\b/i, label: 'tent settlements' },
  { re: /\bbrick (houses?|buildings?|walls?)\b/i, label: 'brick buildings' },
  { re: /\bstone (houses?|buildings?|walls?)\b/i, label: 'stone buildings' },
];

const CHARACTER_PATTERNS: Pattern[] = [
  { re: /\bfarmers?|peasants?\b/i, label: 'farmers' },
  { re: /\bvillagers?|country people\b/i, label: 'villagers' },
  { re: /\bchildren|kids\b/i, label: 'children' },
  { re: /\bwomen|woman|mothers?\b/i, label: 'women' },
  { re: /\bmen\b|man\b|men and women\b/i, label: 'men' },
  { re: /\bcrowd|marketgoers|bustling crowd\b/i, label: 'crowds' },
  { re: /\bmerchants?|traders?|shopkeepers?\b/i, label: 'merchants' },
  { re: /\bworkers?|laborers?|labourers?\b/i, label: 'workers' },
  { re: /\bsoldiers?|troops?\b/i, label: 'soldiers' },
  { re: /\bpriests?|monks?|clergy\b/i, label: 'priests' },
  { re: /\briders?|horsemen?|cavalry\b/i, label: 'riders' },
  { re: /\bherdsmen?|shepherds?|graziers?\b/i, label: 'herdsmen' },
  { re: /\bdrivers?|cart drivers?|coachmen\b/i, label: 'drivers' },
  { re: /\btravelers?|travellers?|passengers?|pedestrians?|walkers?\b/i, label: 'travellers' },
  { re: /\bfishermen?\b/i, label: 'fishermen' },
  { re: /\bpotters?|weavers?|blacksmiths?|artisans?|craftsmen?\b/i, label: 'artisans' },
];

const CLOTHING_PATTERNS: Pattern[] = [
  { re: /\bsari|saree\b/i, label: 'saris' },
  { re: /\bdhotis?\b/i, label: 'dhotis' },
  { re: /\bturbans?\b/i, label: 'turbans' },
  { re: /\bkurtas?\b/i, label: 'kurtas' },
  { re: /\bshawls?\b/i, label: 'shawls' },
  { re: /\bveil(s)?\b/i, label: 'veils' },
  { re: /\blungis?\b/i, label: 'lungis' },
  { re: /\bsalwar|kameez\b/i, label: 'salwar kameez' },
  { re: /\bheadscarf|head cloth\b/i, label: 'head scarves' },
  { re: /\btraditional (clothing|attire|dress|garb)\b/i, label: 'traditional clothing' },
  { re: /\bcolonial (attire|clothing|uniform|dress)\b/i, label: 'colonial-era attire' },
  { re: /\buniforms?\b/i, label: 'uniforms' },
  { re: /\bhandloom|homespun|khadi\b/i, label: 'handwoven cloth' },
];

const CAMERA_STYLE_PATTERNS: Pattern[] = [
  { re: /\bdocumentary (style|look|footage|aesthetic)\b/i, label: 'documentary style' },
  { re: /\barchival (footage|film|material)\b/i, label: 'archival footage look' },
  { re: /\bvintage film|old film|16mm|35mm|8mm\b/i, label: 'vintage film grain' },
  { re: /\bblack and white|monochrome\b/i, label: 'black and white' },
  { re: /\bsepia\b/i, label: 'sepia tone' },
  { re: /\bcolorized|hand[- ]colored\b/i, label: 'colorized archival' },
  { re: /\bhandheld\b/i, label: 'handheld camera' },
  { re: /\bwide[- ]angle\b/i, label: 'wide-angle lens' },
  { re: /\btelephoto|long lens\b/i, label: 'telephoto lens' },
  { re: /\baerial|drone (shot|view)\b/i, label: 'aerial view' },
  { re: /\bshallow depth of field|bokeh\b/i, label: 'shallow depth of field' },
  { re: /\bdeep focus\b/i, label: 'deep focus' },
];

const ENVIRONMENT_PATTERNS: Pattern[] = [
  { re: /\bfields?|farmland|cropland|paddy|wheat fields?\b/i, label: 'farm fields' },
  { re: /\bforest|jungle|woods\b/i, label: 'forest' },
  { re: /\bdesert|dunes\b/i, label: 'desert' },
  { re: /\briver|stream|canal\b/i, label: 'river' },
  { re: /\broads?|highway|path|trail|lane\b/i, label: 'roads' },
  { re: /\bmarket|bazaar|souq\b/i, label: 'market' },
  { re: /\bstreets?|alley|lane\b/i, label: 'streets' },
  { re: /\bstation|platform\b/i, label: 'railway station' },
  { re: /\bworkshop|forge|workshed\b/i, label: 'workshop' },
  { re: /\bhome|household|courtyard|verandah|porch\b/i, label: 'home courtyard' },
  { re: /\bkitchen\b/i, label: 'kitchen' },
  { re: /\bhills?|mountains?|valleys?\b/i, label: 'mountains' },
  { re: /\bbeach|coast|shore\b/i, label: 'coast' },
  { re: /\bbridge\b/i, label: 'bridge' },
  { re: /\bcanal|harbor|harbour|port\b/i, label: 'waterfront' },
  { re: /\btemple|shrine|mosque|church|gurudwara\b/i, label: 'place of worship' },
];

function collectMatches(text: string, patterns: Pattern[]): string[] {
  const found: string[] = [];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const label = p.label ?? m[0];
      const normalized = label.toLowerCase();
      if (!found.some((f) => f.toLowerCase() === normalized)) {
        found.push(label);
      }
    }
  }
  return found;
}

function firstMatch(text: string, patterns: Pattern[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) return p.label ?? m[0];
  }
  return undefined;
}

function join(list: string[]): string | undefined {
  return list.length > 0 ? list.join(', ') : undefined;
}

/**
 * Extract a shared visual context from any combination of scene text sources.
 * Only defined keys are returned; the prompt builder skips missing ones.
 */
export function deriveVisualContext(...sources: (string | undefined)[]): SceneVisualContext {
  const text = sources.filter(Boolean).join('\n');

  const context: SceneVisualContext = {
    period: firstMatch(text, PERIOD_PATTERNS),
    location: join(collectMatches(text, LOCATION_PATTERNS)),
    lighting: join(collectMatches(text, LIGHTING_PATTERNS)),
    weather: join(collectMatches(text, WEATHER_PATTERNS)),
    tone: join(collectMatches(text, TONE_PATTERNS)),
    architecture: join(collectMatches(text, ARCHITECTURE_PATTERNS)),
    characters: join(collectMatches(text, CHARACTER_PATTERNS)),
    clothing: join(collectMatches(text, CLOTHING_PATTERNS)),
    cameraStyle: join(collectMatches(text, CAMERA_STYLE_PATTERNS)),
    environment: join(collectMatches(text, ENVIRONMENT_PATTERNS)),
    style: join(collectMatches(text, [
      { re: /\bdocumentary\b/i, label: 'documentary' },
      { re: /\bcinematic\b/i, label: 'cinematic' },
      { re: /\bhistorical\b/i, label: 'historical' },
      { re: /\brealistic|photorealistic\b/i, label: 'photorealistic' },
    ])),
  };

  // Drop empty entries so prompt building stays clean.
  for (const key of Object.keys(context) as (keyof SceneVisualContext)[]) {
    if (!context[key]) delete context[key];
  }
  return context;
}
