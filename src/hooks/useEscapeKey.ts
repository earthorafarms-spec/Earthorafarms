import { useEffect } from 'react';

/**
 * Calls `onClose` when the user presses the Escape key.
 * Only active when `isActive` is true (default).
 */
export function useEscapeKey(onClose: () => void, isActive = true) {
  useEffect(() => {
    if (!isActive) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isActive]);
}
