/**
 * ITransportAdapter implementation backed by the Go WASM binary.
 *
 * Orchestrates:
 * 1. Loading the WASM binary (wasm-loader)
 * 2. Discovering ALL gadget pods (pod-discovery) — IG is a DaemonSet (one
 *    pod per node) and each pod's gadget-service only runs gadgets against
 *    its own node; there is no server-side aggregation across nodes.
 * 3. Creating a K8s port-forward WebSocket to EVERY pod (pod-discovery)
 * 4. Wrapping each WebSocket with the WASM binary's IGConnection (wasm-exec)
 * 5. Merging all per-pod IGConnections into one (multi-connection)
 * 6. Bridging JSON commands ↔ the merged IGConnection RPC (wasm-bridge)
 *
 * Implements the same ITransportAdapter interface as WebSocketAdapter,
 * so it can be used as a drop-in replacement in shared-connection.ts.
 */
import { getGadgetNamespace } from '../utils/plugin-config';
import { MultiIGConnection } from './multi-connection';
import { createPortForward, findGadgetPods, type PortForwardHandle } from './pod-discovery';
import { WasmBridge } from './wasm-bridge';
import { loadWasm } from './wasm-loader';
import type { IGConnection } from './wasm-types';

interface PodLink {
  podName: string;
  handle: PortForwardHandle;
}

/** Max time to wait for a single pod's port-forward + IGConnection handshake. */
const POD_CONNECT_TIMEOUT_MS = 15000;

export class WasmTransportAdapter {
  private clusterName: string;
  private messageHandler: ((message: string) => void) | null = null;
  private connectionHandler: ((connected: boolean) => void) | null = null;
  private _connected = false;
  private _gadgetNamespace: string | null = null;
  private podLinks: PodLink[] = [];
  private multiConnection: MultiIGConnection | null = null;
  private bridge: WasmBridge | null = null;
  /**
   * Pods that resolved successfully but then disconnected again while other
   * pods were still connecting (i.e. before `multiConnection` exists to be
   * notified). Tracked so they can be excluded once all connect attempts
   * settle, instead of ending up as permanently-dead entries inside
   * `multiConnection`.
   */
  private deadDuringConnect = new Set<string>();
  /** Prevents overlapping checkHealth() calls from stacking redundant probes/goroutines. */
  private healthCheckInFlight = false;

  constructor(clusterName: string) {
    this.clusterName = clusterName;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** The namespace used for the most recent (or current) connection attempt. */
  get gadgetNamespace(): string | null {
    return this._gadgetNamespace;
  }

  async connect(): Promise<void> {
    try {
      this.deadDuringConnect.clear();

      // Step 1: Load WASM binary (singleton — fast on subsequent calls)
      await loadWasm();

      // Step 2: Find all gadget pods (one per node) in the configured
      // namespace (defaults to "gadget")
      const namespace = getGadgetNamespace(this.clusterName);
      this._gadgetNamespace = namespace;
      console.log(
        `[IG WASM] Finding gadget pods for cluster "${this.clusterName}" in namespace "${namespace}"...`
      );
      const pods = await findGadgetPods(this.clusterName, namespace);
      console.log(
        `[IG WASM] Found ${pods.length} gadget pod(s): ${pods
          .map(p => `${p.name}@${p.nodeName}`)
          .join(', ')}`
      );

      // Step 3-4: Create a port-forward + IGConnection for every pod in
      // parallel. A single pod failing to connect must not fail the whole
      // connection — we only need at least one working connection.
      const results = await Promise.allSettled(
        pods.map(pod => this.connectToPod(pod.name, pod.nodeName, namespace))
      );

      const connections: Array<{ podName: string; nodeName: string; ig: IGConnection }> = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          // Exclude pods that resolved but then disconnected again while
          // other pods were still connecting (multiConnection didn't exist
          // yet to prune them) — see handlePodDisconnect.
          if (!this.deadDuringConnect.has(result.value.podName)) {
            connections.push(result.value);
          }
        } else {
          console.error(
            `[IG WASM] Failed to connect to gadget pod ${pods[i].name} (node ${pods[i].nodeName}):`,
            result.reason
          );
        }
      }
      this.deadDuringConnect.clear();

      if (connections.length === 0) {
        throw new Error(
          `Failed to connect to any of the ${pods.length} gadget pod(s) in namespace "${namespace}".`
        );
      }

      // Step 5: Merge all per-pod connections into one
      this.multiConnection = new MultiIGConnection(connections);

      // Step 6: Create the protocol bridge over the merged connection
      this.bridge = new WasmBridge(
        this.multiConnection,
        (message: string) => {
          this.messageHandler?.(message);
        },
        this.clusterName
      );

      this._connected = true;
      this.connectionHandler?.(true);
    } catch (err) {
      this.handleDisconnect();
      throw err;
    }
  }

  /** Create a port-forward + WASM IGConnection for a single pod. */
  private connectToPod(
    podName: string,
    nodeName: string,
    namespace: string
  ): Promise<{ podName: string; nodeName: string; ig: IGConnection }> {
    return new Promise((resolve, reject) => {
      // Create port-forward WebSocket (synchronous — returns socket in
      // CONNECTING state so wrapWebSocket can register its onopen handler
      // before the socket opens)
      const handle = createPortForward(podName, this.clusterName, namespace);
      this.podLinks.push({ podName, handle });

      let settled = false;

      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.error(
            `[IG WASM] Timed out waiting for pod ${podName} (node ${nodeName}) to become ready`
          );
          handle.cancel();
          reject(new Error(`Timed out connecting to gadget pod ${podName} (node ${nodeName})`));
        }
      }, POD_CONNECT_TIMEOUT_MS);

      // Register onerror on the port-forward socket to detect connection death
      handle.socket.onerror = (event: Event) => {
        console.error(`[IG WASM] Port-forward socket error for pod ${podName}:`, event);
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          reject(event);
          return;
        }
        this.handlePodDisconnect(podName);
      };

      const ig: IGConnection = window.wrapWebSocket(handle.socket, {
        onReady: () => {
          console.log(`[IG WASM] IGConnection ready for pod ${podName} (node ${nodeName})`);
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            resolve({ podName, nodeName, ig });
          }
        },
        onError: (error: Error) => {
          console.error(`[IG WASM] Connection error for pod ${podName}:`, error);
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            reject(error);
            return;
          }
          this.handlePodDisconnect(podName);
        },
        onClose: () => {
          console.log(`[IG WASM] Connection closed for pod ${podName}`);
          if (!settled) {
            settled = true;
            clearTimeout(timeoutTimer);
            reject(new Error(`Connection closed before ready for pod ${podName}`));
            return;
          }
          this.handlePodDisconnect(podName);
        },
      });
    });
  }

  /**
   * Handle the loss of a single pod's connection after it was successfully
   * established. Only tears down the whole adapter once every pod is gone.
   *
   * If this fires before `multiConnection` exists yet (i.e. this pod
   * resolved while other pods were still connecting), the pod is instead
   * recorded so `connect()` can exclude it once all attempts settle.
   */
  private handlePodDisconnect(podName: string): void {
    this.podLinks = this.podLinks.filter(link => link.podName !== podName);

    if (!this.multiConnection) {
      this.deadDuringConnect.add(podName);
      return;
    }

    this.multiConnection.removePod(podName);
    if (this.multiConnection.size === 0) {
      this.handleDisconnect();
    }
  }

  /**
   * Actively probe all connected pods for a "zombie" port-forward socket —
   * one that's silently dead (idle proxy timeout, dropped NAT mapping,
   * etc.) without ever firing `onerror`/`onclose`. Unlike the WASM bridge's
   * synthetic 'helo' reply, this performs a real round trip per pod (see
   * `MultiIGConnection.findDeadPods`), so it's the only way this transport
   * can detect that kind of failure.
   *
   * Dead pods are pruned exactly like a natural disconnect: their
   * port-forward socket is cancelled and they're removed from
   * `multiConnection` (which also unblocks any in-flight `runGadget`/
   * `attachGadgetInstance` calls waiting on them). If every pod turns out
   * to be dead, this tears down the whole adapter and reconnection is left
   * to the caller (shared-connection.ts's ping/reconnect loop).
   *
   * Returns whether the adapter is still connected to at least one pod
   * afterwards.
   */
  async checkHealth(): Promise<boolean> {
    if (this.healthCheckInFlight || !this.multiConnection) {
      return this._connected;
    }
    this.healthCheckInFlight = true;
    try {
      const deadPods = await this.multiConnection.findDeadPods();
      if (deadPods.length === 0) {
        return this._connected;
      }
      for (const podName of deadPods) {
        console.warn(`[IG WASM] Pod ${podName} failed health check — treating as disconnected`);
        const link = this.podLinks.find(l => l.podName === podName);
        link?.handle.cancel();
      }
      // Any pod dying is treated as a full disconnect rather than silently
      // continuing against the surviving pods: gadget results are supposed
      // to be aggregated across every node, so running against a partial
      // set would silently under-report data with no indication to the
      // user. Tearing down here (instead of just pruning) triggers the
      // shared-connection ping loop's reconnect path, which re-discovers
      // and reconnects to the full current pod set.
      this.handleDisconnect();
      return this._connected;
    } finally {
      this.healthCheckInFlight = false;
    }
  }

  send(message: string): void {
    if (this.bridge) {
      this.bridge.handleOutgoing(message);
    } else {
      console.warn('[IG WASM] Cannot send — bridge not initialized');
    }
  }

  onMessage(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandler = handler;
  }

  disconnect(): void {
    for (const link of this.podLinks) {
      link.handle.cancel();
    }
    this.podLinks = [];
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    this.bridge?.destroy();
    this.bridge = null;
    this.multiConnection = null;
    for (const link of this.podLinks) {
      link.handle.cancel();
    }
    this.podLinks = [];

    if (this._connected) {
      this._connected = false;
      this.connectionHandler?.(false);
    }
  }
}
