let lastWebhookDiagnostic: Record<string, unknown> | null = null;

export function recordWhatsAppDiagnostic(
  stage: string,
  details: Record<string, unknown> = {},
): void {
  lastWebhookDiagnostic = {
    at: new Date().toISOString(),
    stage,
    ...details,
  };
}

export function getLastWhatsAppDiagnostic(): Record<string, unknown> | null {
  return lastWebhookDiagnostic;
}
