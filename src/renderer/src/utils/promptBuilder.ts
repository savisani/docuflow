/**
 * Prompt Builder for Scene Generation
 *
 * Constructs independent SD 1.5 / FLUX prompts for background and person.
 * Adds appropriate quality tags and negative constraints automatically.
 */

const QUALITY_TAGS = 'cinematic lighting, hyper-detailed, sharp focus, 8k, ultra-realistic textures, depth of field, intricate details';

const BACKGROUND_POSITIVE_SUFFIX = `empty environment,æ— äºº, no people, wide establishing shot, ${QUALITY_TAGS}`;

const BACKGROUND_NEGATIVE = 'person, people, human, character, figure, silhouette, man, woman, child, crowd, foreground subject, portrait, face, body, hands, fingers, blurry, low quality, watermark, text';

const PERSON_POSITIVE_SUFFIX = `centered composition, sharp focus, detailed features, ${QUALITY_TAGS}`;

const PERSON_NEGATIVE = 'complex background, landscape, scenery, crowd, multiple people, blurry, low quality, watermark, deformed, extra limbs, disfigured, bad anatomy, ugly';

export interface ScenePromptPair {
  backgroundPrompt: string;
  backgroundNegative: string;
  personPrompt: string;
  personNegative: string;
}

/**
 * Build a prompt pair for scene generation.
 *
 * @param backgroundDescription - User's description of the environment/background
 * @param personDescription - User's description of the person
 * @param userBackgroundNegative - Optional user-provided negative prompt for background (already extracted from text)
 * @param userPersonNegative - Optional user-provided negative prompt for person (already extracted from text)
 * @returns Two independent prompt/negative-prompt pairs
 */
export function buildScenePrompts(
  backgroundDescription: string,
  personDescription: string,
  userBackgroundNegative?: string,
  userPersonNegative?: string,
): ScenePromptPair {
  return {
    backgroundPrompt: buildBackgroundPrompt(backgroundDescription),
    backgroundNegative: mergeNegativePrompts(BACKGROUND_NEGATIVE, userBackgroundNegative),
    personPrompt: buildPersonPrompt(personDescription),
    personNegative: mergeNegativePrompts(PERSON_NEGATIVE, userPersonNegative),
  };
}

/**
 * Build a prompt for background-only generation.
 * Strongly excludes any person, character, or foreground subject.
 */
export function buildBackgroundPrompt(description: string): string {
  const cleaned = description.trim().replace(/[,]+$/, '');
  return `${cleaned}, ${BACKGROUND_POSITIVE_SUFFIX}`;
}

/**
 * Build a prompt for person-only generation.
 * Focuses on the person with a simple neutral background.
 */
export function buildPersonPrompt(description: string): string {
  const cleaned = description.trim().replace(/[,]+$/, '');
  return `${cleaned}, simple neutral background, ${PERSON_POSITIVE_SUFFIX}`;
}

/**
 * Merge system default negative prompts with user-provided negative prompts.
 * Deduplicates by normalizing tokens (lowercase, trimmed).
 *
 * @param systemNegative - System default negative prompt (e.g. BACKGROUND_NEGATIVE)
 * @param userNegative - User-provided negative prompt (may be empty/undefined)
 * @returns Combined negative prompt with no duplicates
 */
export function mergeNegativePrompts(
  systemNegative: string,
  userNegative?: string,
): string {
  if (!userNegative || !userNegative.trim()) {
    return systemNegative;
  }

  // Normalize: split on commas, lowercase, trim, filter empties
  const normalize = (s: string) =>
    s
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const systemTokens = new Set(normalize(systemNegative));
  const userTokens = normalize(userNegative);

  // Add user tokens; skip if already in system set (dedup)
  const merged: string[] = [...systemNegative.split(',').map((t) => t.trim()).filter(Boolean)];
  for (const token of userTokens) {
    if (!systemTokens.has(token)) {
      merged.push(token);
    }
  }

  return merged.join(', ');
}

