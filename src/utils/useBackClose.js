import { useEffect, useRef } from 'react';
import { pushModal } from './appHistory';

// While `open` is true, the browser Back button calls onClose instead of leaving the screen.
export function useBackClose(open, onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    return pushModal(() => ref.current && ref.current());
  }, [open]);
}
