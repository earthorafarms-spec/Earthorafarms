import { AsyncLocalStorage } from 'node:async_hooks';

/** A voice request must not change the provider of a concurrent web chat. */
const voiceScope = new AsyncLocalStorage<{ tenantId: string }>();
export function inVoiceScope(): boolean { return Boolean(voiceScope.getStore()); }
export function voiceTenantId(): string | undefined { return voiceScope.getStore()?.tenantId; }
export function withVoiceScope<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  return voiceScope.run({ tenantId }, work);
}
