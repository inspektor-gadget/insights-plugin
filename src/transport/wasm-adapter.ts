/**
 * ITransportAdapter implementation backed by the Go WASM binary.
 *
 * Orchestrates:
 * 1. Loading the WASM binary (wasm-loader)
 * 2. Discovering the gadget pod (pod-discovery)
 * 3. Creating a K8s port-forward WebSocket (pod-discovery)
 * 4. Wrapping the WebSocket with the WASM binary's IGConnection (wasm-exec)
 * 5. Bridging JSON commands ↔ IGConnection RPC (wasm-bridge)
 *
 * Implements the same ITransportAdapter interface as WebSocketAdapter,
 * so it can be used as a drop-in replacement in shared-connection.ts.
 */
import { loadWasm } from './wasm-loader';
import { findGadgetPod, createPortForward, type PortForwardHandle } from './pod-discovery';
import { WasmBridge } from './wasm-bridge';
import type { IGConnection } from './wasm-types';

export class WasmTransportAdapter {
  private clusterName: string;
  private messageHandler: ((message: string) => void) | null = null;
  private connectionHandler: ((connected: boolean) => void) | null = null;
  private _connected = false;
  private portForwardHandle: PortForwardHandle | null = null;
  private bridge: WasmBridge | null = null;

  constructor(clusterName: string) {
    this.clusterName = clusterName;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    try {
      // Step 1: Load WASM binary (singleton — fast on subsequent calls)
      await loadWasm();

      // Step 2: Find gadget pod
      console.log(`[IG WASM] Finding gadget pod for cluster "${this.clusterName}"...`);
      const podName = await findGadgetPod(this.clusterName);
      console.log(`[IG WASM] Found gadget pod: ${podName}`);

      // Step 3: Create port-forward WebSocket (synchronous — returns socket
      // in CONNECTING state so wrapWebSocket can register its onopen handler
      // before the socket opens)
      console.log('[IG WASM] Creating port-forward...');
      this.portForwardHandle = createPortForward(podName, this.clusterName);
      console.log('[IG WASM] Port-forward WebSocket created');

      // Register onerror on the port-forward socket to detect connection death
      this.portForwardHandle.socket.onerror = (event: Event) => {
        console.error('[IG WASM] Port-forward socket error:', event);
        this.handleDisconnect();
      };

      // Step 4: Wrap WebSocket with WASM IGConnection
      await new Promise<void>((resolve, reject) => {
        const ig: IGConnection = window.wrapWebSocket(
          this.portForwardHandle!.socket,
          {
            onReady: () => {
              console.log('[IG WASM] IGConnection ready');

              // Step 5: Create the protocol bridge
              this.bridge = new WasmBridge(
                ig,
                (message: string) => {
                  // Route bridge output to the message handler
                  this.messageHandler?.(message);
                },
                this.clusterName,
              );

              this._connected = true;
              this.connectionHandler?.(true);
              resolve();
            },
            onError: (error: Error) => {
              console.error('[IG WASM] Connection error:', error);
              this.handleDisconnect();
              reject(error);
            },
            onClose: () => {
              console.log('[IG WASM] Connection closed');
              this.handleDisconnect();
            },
          },
        );
      });
    } catch (err) {
      this.handleDisconnect();
      throw err;
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
    if (this.portForwardHandle) {
      this.portForwardHandle.cancel();
      this.portForwardHandle = null;
    }
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    this.bridge?.destroy();
    this.bridge = null;
    this.portForwardHandle = null;

    if (this._connected) {
      this._connected = false;
      this.connectionHandler?.(false);
    }
  }
}
