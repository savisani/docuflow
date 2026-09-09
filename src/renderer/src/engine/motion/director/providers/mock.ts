import type {
  MotionDirectorProvider,
  MotionProviderResponse,
} from '../provider';
import type { MotionDirectorRequest } from '../protocol';

/**
 * Mock Provider — deterministic responses for testing.
 *
 * Returns pre-defined text responses without calling any external service.
 * Used for unit tests and development.
 */

export class MockMotionProvider implements MotionDirectorProvider {
  readonly providerType = 'mock' as const;

  private response: string;

  constructor(response?: string) {
    this.response = response || '';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(_request: MotionDirectorRequest): Promise<MotionProviderResponse> {
    return {
      text: this.response,
      model: 'mock-model',
      provider: 'mock',
      finishReason: 'stop',
    };
  }

  getSystemPrompt(): string {
    return 'Mock motion director provider for testing.';
  }
}
