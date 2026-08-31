import { useCallback, useEffect, useRef, useState } from 'react';
import { checkServerHealth, type ServerHealth } from '../engine/transcription/localProvider';

export type ServerStatus = 'checking' | 'running' | 'offline' | 'starting' | 'failed';

const BASE_URL = (import.meta as any).env?.VITE_TRANSCRIPTION_URL || 'http://127.0.0.1:8765';
const POLL_INTERVAL_MS = 2000;
const STARTUP_POLL_INTERVAL_MS = 1000;
const STARTUP_TIMEOUT_MS = 30000;

export function useServerStatus() {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [status, setStatus] = useState<ServerStatus>('checking');
  const [serverStarting, setServerStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearStartupPolling = useCallback(() => {
    if (startupPollRef.current) {
      clearInterval(startupPollRef.current);
      startupPollRef.current = null;
    }
  }, []);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const h = await checkServerHealth();
      if (signal?.aborted) return;
      setHealth(h);
      if (h && h.status === 'ok') {
        setStatus('running');
        return true;
      }
      setStatus(serverStarting ? 'starting' : 'offline');
      return false;
    } catch {
      if (signal?.aborted) return;
      setHealth(null);
      setStatus(serverStarting ? 'starting' : 'offline');
      return false;
    }
  }, [serverStarting]);

  const startServer = useCallback(async () => {
    if (status === 'running') return;

    setServerStarting(true);
    setStatus('starting');

    try {
      await fetch(`${BASE_URL}/start-server`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Expected - server not yet available
    }

    // Let the polling effect handle detection
  }, [status]);

  const restartServer = useCallback(async () => {
    clearPolling();
    clearStartupPolling();
    setHealth(null);
    setStatus('starting');
    setServerStarting(true);

    try {
      await fetch(`${BASE_URL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      // Ignore
    }

    try {
      await fetch(`${BASE_URL}/start-server`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    } catch {
      // Expected
    }
  }, [clearPolling, clearStartupPolling]);

  // Normal polling (every 2s)
  useEffect(() => {
    const controller = new AbortController();

    const poll = async () => {
      await checkHealth(controller.signal);
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearPolling();
    };
  }, [checkHealth, clearPolling]);

  // Fast startup polling (every 1s, up to 30s)
  useEffect(() => {
    if (!serverStarting) {
      clearStartupPolling();
      return;
    }

    const controller = new AbortController();
    let elapsed = 0;

    const fastPoll = async () => {
      elapsed += STARTUP_POLL_INTERVAL_MS;
      const found = await checkHealth(controller.signal);
      if (found || elapsed >= STARTUP_TIMEOUT_MS) {
        clearStartupPolling();
        setServerStarting(false);
        if (!found && elapsed >= STARTUP_TIMEOUT_MS) {
          setStatus('failed');
        }
      }
    };

    fastPoll();
    startupPollRef.current = setInterval(fastPoll, STARTUP_POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearStartupPolling();
    };
  }, [serverStarting, checkHealth, clearStartupPolling]);

  return {
    health,
    status,
    serverStarting,
    startServer,
    restartServer,
  };
}
