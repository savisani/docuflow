import type {
  MotionDirectorProvider,
  MotionProviderConfig,
  MotionProviderResponse,
} from '../provider';
import { buildMotionDirectorPrompt } from '../provider';
import type { MotionDirectorRequest } from '../protocol';

/**
 * Ollama Provider — first local AI implementation.
 *
 * Uses the Ollama HTTP API to generate motion director responses.
 * The model should be selectable, with gemma3:1b suitable as the
 * first lightweight test model.
 *
 * Security: This provider only communicates with localhost Ollama.
 * It does NOT expose filesystem, shell, or system access.
 */

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'gemma3:1b';

export class OllamaMotionProvider implements MotionDirectorProvider {
  readonly providerType = 'ollama' as const;

  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config?: Partial<MotionProviderConfig>) {
    this.baseUrl = config?.baseUrl || DEFAULT_OLLAMA_BASE;
    this.model = config?.model || DEFAULT_MODEL;
    this.temperature = config?.temperature ?? 0.3;
    this.maxTokens = config?.maxTokens ?? 2048;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(request: MotionDirectorRequest): Promise<MotionProviderResponse> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = buildMotionDirectorPrompt(request);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: this.maxTokens,
          },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          text: '',
          model: this.model,
          provider: 'ollama',
          finishReason: 'error',
          error: `Ollama HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      const text = data.message?.content || '';

      return {
        text,
        model: this.model,
        provider: 'ollama',
        finishReason: 'stop',
      };
    } catch (err) {
      return {
        text: '',
        model: this.model,
        provider: 'ollama',
        finishReason: 'error',
        error: err instanceof Error ? err.message : 'Ollama request failed',
      };
    }
  }

  getSystemPrompt(): string {
    return `You are a motion graphics director. You produce simple key-value blocks describing motion graphics components. You do NOT produce JSON. You do NOT write code. You do NOT execute commands. You only describe visual components using the specified text format.`;
  }
}
