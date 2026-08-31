/**
 * Secondary-development hook for server runtime kind detection.
 * The community useAuthStore doesn't track runtime kind;
 * this hook provides local state + detection logic for the external LogsPage.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores';
import { detectRuntimeKind } from '@/external/services/api/versionExtension';
import type { ServerRuntimeKind } from '@/external/types/runtime';

export function useServerRuntimeKind(): {
  runtimeKind: ServerRuntimeKind;
  updateRuntimeKind: (kind: ServerRuntimeKind) => void;
} {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [runtimeKind, setRuntimeKind] = useState<ServerRuntimeKind>('unknown');

  useEffect(() => {
    if (connectionStatus !== 'connected' || runtimeKind !== 'unknown') return;
    let cancelled = false;
    detectRuntimeKind().then((kind) => {
      if (!cancelled && kind !== 'unknown') {
        setRuntimeKind(kind);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connectionStatus, runtimeKind]);

  return {
    runtimeKind,
    updateRuntimeKind: setRuntimeKind,
  };
}
