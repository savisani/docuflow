/**
 * Prompt Parser
 *
 * Splits a combined prompt string into positive prompt and negative prompt.
 * Users can embed negative prompts inline using "Negative prompt:", "negative prompt:",
 * or "Negative:" prefixes. This utility extracts them automatically.
 */

export interface ParsedPrompt {
  prompt: string;
  negativePrompt: string;
}

/**
 * Regex matches "Negative prompt:", "negative prompt:", "Negative:", "negative:"
 * at the start of a line (possibly preceded by whitespace/newlines).
 * Captures everything after the prefix as the negative prompt content.
 */
const NEGATIVE_PROMPT_PATTERN = /^\s*negative\s*(?:prompt\s*)?:\s*([\s\S]*)/im;

/**
 * Parse a combined prompt string into positive prompt and negative prompt.
 *
 * Examples:
 *   "A railway station\nNegative prompt: people, humans"
 *   → { prompt: "A railway station", negativePrompt: "people, humans" }
 *
 *   "A railway station"
 *   → { prompt: "A railway station", negativePrompt: "" }
 *
 *   "A station negative prompt: blurry"
 *   → { prompt: "A station", negativePrompt: "blurry" }
 *
 * @param input - The full prompt text from the user
 * @returns Parsed positive and negative prompts
 */
export function parsePromptAndNegativePrompt(input: string): ParsedPrompt {
  if (!input || !input.trim()) {
    return { prompt: '', negativePrompt: '' };
  }

  const match = input.match(NEGATIVE_PROMPT_PATTERN);

  if (!match) {
    return {
      prompt: input.trim(),
      negativePrompt: '',
    };
  }

  // Everything before the "Negative prompt:" line is the positive prompt
  const negativePromptStart = input.indexOf(match[0]);
  const prompt = input.slice(0, negativePromptStart).trim();

  // The captured group is the text after the "Negative prompt:" prefix
  const negativePrompt = (match[1] || '').trim();

  return {
    prompt: prompt || '',
    negativePrompt: negativePrompt || '',
  };
}
