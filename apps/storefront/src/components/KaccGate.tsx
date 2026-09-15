import type { ReactNode } from 'react';
import { Gate } from './Gate';

interface KaccGateProps {
  children: ReactNode;
  storageKey?: string;
  passwordKey?: string;
  emailKey?: string;
}

/** KACC accounting portal sign-in — same staff auth as the other portals, role `kacc`. */
export function KaccGate({ children, storageKey = 'kacc_authenticated' }: KaccGateProps) {
  return (
    <Gate
      storageKey={storageKey}
      domain="kacc"
      title="KACC Portal"
      subtitle="Sign in with your accounting account to continue."
      submitLabel="Continue"
      loadingLabel="Checking…"
    >
      {children}
    </Gate>
  );
}
