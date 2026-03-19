/**
 * Singleton transport connection for the IG frontend library.
 *
 * All IG pages share a single connection so that gadget events (type 2 info,
 * type 3/6 data, type 4 logs, type 5 stop) persist across page navigations.
 * Without this, navigating from the GadgetRunnerPage to the GadgetViewPage
 * would close the old connection (losing the gadget's event subscriptions)
 * and open a new one that has no context about the running gadget.
 *
 * Supports two transports selected at build time via VITE_TRANSPORT:
 * - "wasm": WasmTransportAdapter (K8s direct via Go WASM binary)
 * - default: WebSocketAdapter (Headlamp backend /api/ig/ws)
 *
 * Includes auto-reconnect with exponential backoff.
 */
import { apiService, initializeIG, WebSocketAdapter } from '@inspektor-gadget/ig-desktop/frontend';

const IS_WASM = import.meta.env.VITE_TRANSPORT === 'wasm';

// Minimal adapter interface (both WebSocketAdapter and WasmTransportAdapter conform)
interface TransportAdapter {
  connect(): Promise<void>;
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onConnectionChange(handler: (connected: boolean) => void): void;
  disconnect(): void;
  readonly connected: boolean;
}

/**
 * Lazy wrapper around WasmTransportAdapter. Created synchronously so that
 * getSharedConnection() stays sync, but defers the dynamic import to connect()
 * time. This ensures the WASM adapter code is tree-shaken from the default build.
 */
class LazyWasmAdapter implements TransportAdapter {
  private inner: TransportAdapter | null = null;
  private clusterName: string;
  private _messageHandler: ((message: string) => void) | null = null;
  private _connectionHandler: ((connected: boolean) => void) | null = null;

  constructor(clusterName: string) {
    this.clusterName = clusterName;
  }

  get connected(): boolean {
    return this.inner?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (!this.inner) {
      const { WasmTransportAdapter } = await import('../transport/wasm-adapter');
      this.inner = new WasmTransportAdapter(this.clusterName);
      // Replay handlers that were set before connect()
      if (this._messageHandler) this.inner.onMessage(this._messageHandler);
      if (this._connectionHandler) this.inner.onConnectionChange(this._connectionHandler);
    }
    return this.inner.connect();
  }

  send(message: string): void {
    this.inner?.send(message);
  }

  onMessage(handler: (message: string) => void): void {
    this._messageHandler = handler;
    this.inner?.onMessage(handler);
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this._connectionHandler = handler;
    this.inner?.onConnectionChange(handler);
  }

  disconnect(): void {
    this.inner?.disconnect();
    this.inner = null;
  }
}

let adapter: TransportAdapter | null = null;
let currentCluster: string | undefined;
let connectedState = false;
const listeners = new Set<(connected: boolean) => void>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30_000; // 30s cap

// --- Keepalive ping ---
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (!adapter || !connectedState) return;
    const pingReq = (apiService as any).request({ cmd: 'helo' });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS)
    );
    Promise.race([pingReq, timeout]).catch(() => {
      console.warn('[IG] Ping timeout — forcing reconnect');
      handleConnectionChange(false);
      adapter?.disconnect();
      adapter = null;
    });
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

/**
 * Reject all pending ApiService requests so callers get an error
 * instead of hanging forever when the connection drops.
 */
function flushPendingRequests() {
  const pending = (apiService as any).requests;
  if (pending) {
    for (const [reqID, req] of Object.entries(pending)) {
      (req as any).reject?.(new Error('Connection lost'));
      delete pending[reqID];
    }
  }
}

function buildWsUrl(): string {
  let host = window.location.host;
  let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // In Electron, the app loads from file:// so window.location.host is empty.
  if (!host || window.location.protocol === 'file:') {
    const port = (window as any).headlampBackendPort || 4466;
    host = `localhost:${port}`;
    protocol = 'ws:';
  }

  return `${protocol}//${host}/api/ig/ws`;
}

function scheduleReconnect() {
  if (reconnectTimer || !adapter) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY);
  reconnectAttempt++;
  console.log(`[IG] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (adapter && !connectedState) {
      adapter.connect();
    }
  }, delay);
}

function handleConnectionChange(connected: boolean) {
  connectedState = connected;
  if (connected) {
    reconnectAttempt = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    startPing();
  } else {
    stopPing();
    flushPendingRequests();
    scheduleReconnect();
  }
  listeners.forEach(cb => cb(connected));
}

/**
 * Returns the shared transport adapter, creating it on first call.
 * Also calls initializeIG() once to wire up the IG message router.
 *
 * @param clusterName - Required in WASM mode (identifies which cluster's
 *   gadget pod to port-forward to). Ignored in WebSocket mode.
 */
export function getSharedConnection(clusterName?: string): TransportAdapter {
  if (IS_WASM && adapter && clusterName && clusterName !== currentCluster) {
    // Cluster changed in WASM mode — tear down and recreate.
    // Clear reconnect timer first to prevent it from firing on the stale adapter.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    adapter.disconnect();
    adapter = null;
    connectedState = false;
  }

  if (adapter) return adapter;

  if (IS_WASM && clusterName) {
    currentCluster = clusterName;
    adapter = new LazyWasmAdapter(clusterName);
  } else {
    adapter = new WebSocketAdapter(buildWsUrl());
  }

  // Intercept onConnectionChange so that both the IG library's internal
  // handler AND our React subscriber callbacks are notified, and we can
  // trigger reconnection on disconnect.
  const origSetter = adapter.onConnectionChange.bind(adapter);
  adapter.onConnectionChange = (handler: (connected: boolean) => void) => {
    origSetter((connected: boolean) => {
      handler(connected);
      handleConnectionChange(connected);
    });
  };

  initializeIG({
    adapter: adapter as any,
    onNavigate: (url: string) => {
      console.log('[IG] Navigation request:', url);
    },
  });

  return adapter;
}

/**
 * Subscribe to connection status changes.
 * The callback is invoked immediately with the current status,
 * then on every subsequent change.
 * Returns an unsubscribe function.
 */
export function subscribeConnectionStatus(callback: (connected: boolean) => void): () => void {
  listeners.add(callback);
  callback(connectedState);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Force a fresh connection attempt. Tears down the existing adapter so that
 * the next getSharedConnection() call creates a new one and connect() starts
 * from scratch (new pod discovery, new port-forward, etc.).
 *
 * Use this after deploying IG in WASM mode — the initial connect may have
 * failed because there was no gadget pod, and the reconnect loop doesn't
 * start when connect() never succeeds.
 */
export function resetConnection(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  stopPing();
  flushPendingRequests();
  if (adapter) {
    adapter.disconnect();
    adapter = null;
  }
  currentCluster = undefined;
  if (connectedState) {
    connectedState = false;
    listeners.forEach(cb => cb(false));
  }
}
