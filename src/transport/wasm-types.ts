/**
 * TypeScript interfaces for the Go WASM binary's API.
 *
 * After the WASM binary is loaded and the Go runtime starts,
 * `window.wrapWebSocket(socket, callbacks)` returns an IGConnection
 * that exposes RPC-style methods for interacting with Inspektor Gadget.
 */

export interface GadgetInfo {
  imageName?: string;
  params?: Array<Record<string, unknown>>;
  datasources?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RunGadgetCallbacks {
  onGadgetInfo: (info: GadgetInfo) => void;
  onData: (dsID: string, data: unknown) => void;
  onReady: () => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface WrapWebSocketCallbacks {
  onReady: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export interface IGConnection {
  getGadgetInfo: (
    params: { version: number; imageName: string },
    onSuccess: (info: GadgetInfo) => void,
    onError: (error: Error) => void
  ) => void;

  runGadget: (
    params: {
      version: number;
      imageName: string;
      paramValues?: Record<string, string>;
    },
    callbacks: RunGadgetCallbacks,
    onSetupError: (error: Error) => void
  ) => { stop: () => void };

  listGadgetInstances: (
    onSuccess: (instances: Array<Record<string, unknown>>) => void,
    onError: (error: Error) => void
  ) => void;

  deleteGadgetInstance: (
    id: string,
    onSuccess: () => void,
    onError: (error: Error) => void
  ) => void;

  attachGadgetInstance: (
    params: {
      instanceName: string;
      [key: string]: unknown;
    },
    callbacks: RunGadgetCallbacks
  ) => { stop: () => void };
}

declare global {
  interface Window {
    Go: new () => {
      argv: string[];
      env: Record<string, string>;
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): Promise<void>;
    };
    wrapWebSocket: (socket: WebSocket, callbacks: WrapWebSocketCallbacks) => IGConnection;
  }
}
