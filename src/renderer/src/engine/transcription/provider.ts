import { TranscriptionProvider } from './types';

let registeredProvider: TranscriptionProvider | null = null;

export function registerProvider(provider: TranscriptionProvider): void {
  registeredProvider = provider;
}

export function getProvider(): TranscriptionProvider | null {
  return registeredProvider;
}

export function isProviderAvailable(): boolean {
  return registeredProvider !== null && registeredProvider.isAvailable();
}

export function getProviderName(): string {
  return registeredProvider?.name ?? 'None';
}
