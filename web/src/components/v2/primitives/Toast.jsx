import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * App-wide toast singleton (design spec: bottom-right pill, ~2.2s auto-dismiss,
 * accent border, checkmark icon; one visible at a time, latest wins).
 *
 * Usage: call `toast('Rule created')` from anywhere; mount one <ToastHost/> in the shell.
 */

let emit = null;

/** @param {string} message */
export function toast(message) {
  if (emit) emit(message);
}

export function ToastHost() {
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let timer = null;
    const localEmit = (message) => {
      clearTimeout(timer);
      setMsg(message);
      timer = setTimeout(() => setMsg(null), 2200);
    };
    emit = localEmit;
    return () => {
      clearTimeout(timer);
      // only clear the singleton if it's still ours (StrictMode double-mount safe)
      if (emit === localEmit) emit = null;
    };
  }, []);

  if (!msg) return null;
  return (
    <div className="v2-toast" role="status" data-testid="v2-toast">
      <Icon name="check" size={16} strokeWidth={2} style={{ color: 'var(--accent)' }} />
      {msg}
    </div>
  );
}
