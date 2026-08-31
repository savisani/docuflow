import { registerProvider } from './provider';
import { LocalTranscriptionProvider, checkServerHealth } from './localProvider';

const localProvider = new LocalTranscriptionProvider();

export async function initLocalProvider(): Promise<void> {
  try {
    const available = await localProvider.checkAvailability();
    if (available) {
      registerProvider(localProvider);
    }
  } catch {
    // Server not available — provider stays unregistered
  }
}

export { localProvider };
