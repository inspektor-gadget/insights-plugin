/**
 * Protocol bridge between the IG Desktop JSON message protocol and the
 * WASM binary's IGConnection RPC interface.
 *
 * The IG Desktop frontend sends JSON commands via `apiService.request()`:
 *   { cmd: "runGadget", reqID: "1", data: { image, clusterName, params, id } }
 *
 * The WASM binary exposes an `IGConnection` with callback-based RPC methods:
 *   ig.runGadget(params, { onData, onGadgetInfo, ... }, onSetupError)
 *
 * This bridge translates between the two:
 * - Incoming JSON commands → IGConnection method calls
 * - IGConnection callbacks → JSON response/streaming messages
 */
import type { DeployConfig } from '../deploy/ig-deploy';
import { checkIGDeployment, DEFAULT_CONFIG, deployIG, undeployIG } from '../deploy/ig-deploy';
import type { GadgetInfo, IGConnection } from './wasm-types';

/**
 * IG Desktop JSON protocol message types.
 * Types 1-6 mirror the WebSocket backend protocol; 200+ are deploy progress.
 */
const enum MessageType {
  /** Request/response — success or error for a reqID */
  Response = 1,
  /** Gadget info/started event (contains GadgetInfo) */
  GadgetInfo = 2,
  /** Single data event (one row) */
  DataEvent = 3,
  /** Log/error event */
  Log = 4,
  /** Gadget done/stopped */
  Done = 5,
  /** Array data event (snapshot/batch) */
  DataArray = 6,
  /** Deploy progress update */
  DeployProgress = 200,
  /** Deploy complete */
  DeployComplete = 201,
  /** Deploy error */
  DeployError = 202,
}

/** Callback to emit a message back to the frontend (as JSON string). */
type EmitFn = (message: string) => void;

interface ActiveGadget {
  stop: () => void;
}

/**
 * Flatten a nested object into dot-notation keys.
 * e.g. { k8s: { node: "minikube" } } → { "k8s.node": "minikube" }
 *
 * The WASM binary returns nested JSON objects, but the IG Desktop frontend
 * indexes event fields by flat dot-notation names (matching datasource field
 * `fullName` values like "k8s.node", "proc.comm", etc.).
 *
 * Arrays are preserved as-is (important for histogram slot data).
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

export class WasmBridge {
  private ig: IGConnection;
  private emit: EmitFn;
  private clusterName: string;
  private activeGadgets = new Map<string, ActiveGadget>();
  constructor(ig: IGConnection, emit: EmitFn, clusterName: string) {
    this.ig = ig;
    this.emit = emit;
    this.clusterName = clusterName;
  }

  /**
   * Handle an outgoing message from the frontend.
   * Parses the JSON command and dispatches to the appropriate handler.
   */
  handleOutgoing(message: string): void {
    let msg: any;
    try {
      msg = JSON.parse(message);
    } catch {
      console.error('[IG Bridge] Invalid JSON:', message);
      return;
    }

    const { cmd, reqID, data } = msg;

    switch (cmd) {
      case 'helo':
        this.handleHelo(reqID);
        break;
      case 'getGadgetInfo':
        this.handleGetGadgetInfo(reqID, data);
        break;
      case 'runGadget':
        this.handleRunGadget(reqID, data);
        break;
      case 'attachInstance':
        this.handleAttachInstance(reqID, data);
        break;
      case 'listInstances':
        this.handleListInstances(reqID, data);
        break;
      case 'stopInstance':
        this.handleStopInstance(reqID, data);
        break;
      case 'removeInstance':
        this.handleRemoveInstance(reqID, data);
        break;
      case 'getRuntimes':
        this.handleGetRuntimes(reqID);
        break;
      case 'getRuntimeParams':
        this.handleGetRuntimeParams(reqID);
        break;
      case 'checkIGDeployment':
        this.handleCheckIGDeployment(reqID, data);
        break;
      case 'deployIG':
        this.handleDeployIG(reqID, data);
        break;
      // Commands that aren't supported in WASM mode
      case 'getChartValues':
      case 'listSessions':
      case 'deleteSession':
      case 'getSession':
      case 'getRun':
      case 'getRunEvents':
      case 'listPlugins':
      case 'getPlugin':
      case 'checkForUpdates':
        this.sendError(reqID, `"${cmd}" is not supported in WASM mode`);
        break;
      default:
        console.warn(`[IG Bridge] Unknown command: ${cmd}`);
        if (reqID) {
          this.sendError(reqID, `Unknown command: ${cmd}`);
        }
    }
  }

  /**
   * Stop all active gadgets and clean up.
   */
  destroy(): void {
    for (const [, gadget] of this.activeGadgets) {
      try {
        gadget.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.activeGadgets.clear();
  }

  // ---------------------------------------------------------------------------
  // Command handlers
  // ---------------------------------------------------------------------------

  private handleHelo(reqID?: string): void {
    // The helo command is sent automatically when the connection is established.
    // In WebSocket mode, the backend responds with { status: "ok" }.
    // We synthesize the same response.
    if (reqID) {
      this.sendResponse(reqID, { status: 'ok' });
    }
  }

  private handleGetGadgetInfo(reqID: string, data: any): void {
    if (!data?.url) {
      this.sendError(reqID, 'Missing required field: url');
      return;
    }

    this.ig.getGadgetInfo(
      { version: 1, imageName: data.url },
      (info: GadgetInfo) => {
        this.sendResponse(reqID, info);
      },
      (error: Error) => {
        this.sendError(reqID, error.message || String(error));
      }
    );
  }

  private handleRunGadget(reqID: string, data: any): void {
    if (!data?.image) {
      this.sendError(reqID, 'Missing required field: image');
      return;
    }

    const instanceID = data.id || `wasm-${Date.now()}`;

    const handle = this.ig.runGadget(
      {
        version: 1,
        imageName: data.image,
        paramValues: data.params || {},
      },
      {
        onGadgetInfo: (info: GadgetInfo) => {
          this.emitMessage({
            type: MessageType.GadgetInfo,
            instanceID,
            environmentID: this.clusterName,
            instanceName: info.imageName || data.image,
            data: info,
          });
        },
        onData: (dsID: string, rawData: unknown) => {
          this.emitData(instanceID, dsID, rawData);
        },
        onReady: () => {
          this.sendResponse(reqID, { id: instanceID });
        },
        onDone: () => {
          this.activeGadgets.delete(instanceID);
          this.emitMessage({ type: MessageType.Done, instanceID });
        },
        onError: (error: Error) => {
          this.emitMessage({
            type: MessageType.Log,
            instanceID,
            data: {
              msg: error.message || String(error),
              severity: 'error',
            },
          });
        },
      },
      (setupError: Error) => {
        this.sendError(reqID, setupError.message || String(setupError));
      }
    );

    if (handle) {
      this.activeGadgets.set(instanceID, handle);
    }
  }

  private handleAttachInstance(reqID: string, data: any): void {
    if (!data?.instanceName) {
      this.sendError(reqID, 'Missing required field: instanceName');
      return;
    }

    const instanceID = `wasm-attach-${Date.now()}`;

    const handle = this.ig.attachGadgetInstance(
      {
        instanceName: data.instanceName,
        ...data,
      },
      {
        onGadgetInfo: (info: GadgetInfo) => {
          this.emitMessage({
            type: MessageType.GadgetInfo,
            instanceID,
            environmentID: this.clusterName,
            instanceName: data.instanceName,
            data: info,
            attached: true,
          });
        },
        onData: (dsID: string, rawData: unknown) => {
          this.emitData(instanceID, dsID, rawData);
        },
        onReady: () => {
          this.sendResponse(reqID, { id: instanceID });
        },
        onDone: () => {
          this.activeGadgets.delete(instanceID);
          this.emitMessage({ type: MessageType.Done, instanceID });
        },
        onError: (error: Error) => {
          this.emitMessage({
            type: MessageType.Log,
            instanceID,
            data: {
              msg: error.message || String(error),
              severity: 'error',
            },
          });
        },
      }
    );

    if (handle) {
      this.activeGadgets.set(instanceID, handle);
    }
  }

  // eslint-disable-next-line no-unused-vars
  private handleListInstances(reqID: string, _data: any): void {
    this.ig.listGadgetInstances(
      (instances: Array<Record<string, unknown>>) => {
        this.sendResponse(reqID, { gadgetInstances: instances });
      },
      (error: Error) => {
        this.sendError(reqID, error.message || String(error));
      }
    );
  }

  private handleStopInstance(reqID: string, data: any): void {
    const id = data?.id;
    if (!id) {
      this.sendError(reqID, 'Missing required field: id');
      return;
    }

    const active = this.activeGadgets.get(id);
    if (active) {
      try {
        active.stop();
      } catch (err: any) {
        this.sendError(reqID, err.message || String(err));
        return;
      }
      this.activeGadgets.delete(id);
    }

    this.sendResponse(reqID, {});
  }

  private handleRemoveInstance(reqID: string, data: any): void {
    const id = data?.id;
    if (!id) {
      this.sendError(reqID, 'Missing required field: id');
      return;
    }

    this.ig.deleteGadgetInstance(
      id,
      () => {
        this.activeGadgets.delete(id);
        this.sendResponse(reqID, {});
      },
      (error: Error) => {
        this.sendError(reqID, error.message || String(error));
      }
    );
  }

  /** Synthetic: return the current cluster as the only runtime. */
  private handleGetRuntimes(reqID: string): void {
    this.sendResponse(reqID, [{ name: 'k8s', label: 'Kubernetes' }]);
  }

  /** Synthetic: no additional runtime params needed in WASM mode. */
  private handleGetRuntimeParams(reqID: string): void {
    this.sendResponse(reqID, []);
  }

  /** Check IG deployment status via K8s API. */
  private handleCheckIGDeployment(reqID: string, data: any): void {
    const cluster = data?.clusterName || this.clusterName;
    checkIGDeployment(cluster)
      .then(status => this.sendResponse(reqID, status))
      .catch(err => this.sendError(reqID, err.message || String(err)));
  }

  /** Deploy/undeploy IG via pre-rendered manifests + Headlamp ApiProxy. */
  private handleDeployIG(reqID: string, data: any): void {
    const cluster = data?.clusterName || this.clusterName;
    const isUndeploy = !!data?.undeploy;
    const isRedeploy = !!data?.redeploy;
    const namespace = data?.namespace || 'gadget';

    const deploymentId = `wasm-${Date.now()}`;

    // Return deploymentId immediately
    this.sendResponse(reqID, { deploymentId });

    const onProgress = (p: {
      deploymentId: string;
      step: string;
      progress: number;
      message: string;
      error?: string;
    }) => {
      if (p.error) {
        this.emitMessage({
          type: MessageType.DeployError,
          deploymentId,
          error: p.error,
          progress: 0,
        });
      } else if (p.progress === 100) {
        this.emitMessage({
          type: MessageType.DeployComplete,
          deploymentId,
          step: p.step,
          progress: p.progress,
          message: p.message,
        });
      } else {
        this.emitMessage({
          type: MessageType.DeployProgress,
          deploymentId,
          step: p.step,
          progress: p.progress,
          message: p.message,
        });
      }
    };

    const config: DeployConfig = {
      ...DEFAULT_CONFIG,
      namespace,
      verifyImage: data?.verifyImage ?? DEFAULT_CONFIG.verifyImage,
      otelLogExporters: data?.otelLogExporters ?? [],
      otelMetricExporters: data?.otelMetricExporters ?? [],
      prometheusListen: data?.prometheusListen ?? false,
      prometheusListenAddress:
        data?.prometheusListenAddress ?? DEFAULT_CONFIG.prometheusListenAddress,
    };

    const doWork = async () => {
      try {
        if (isUndeploy) {
          await undeployIG(cluster, namespace, onProgress);
        } else if (isRedeploy) {
          await undeployIG(cluster, namespace, p => {
            onProgress({
              ...p,
              progress: Math.round(p.progress / 2),
              message: `[Undeploy] ${p.message}`,
            });
          });
          await deployIG(config, cluster, p => {
            onProgress({
              ...p,
              progress: 50 + Math.round(p.progress / 2),
              message: `[Deploy] ${p.message}`,
            });
          });
        } else {
          await deployIG(config, cluster, onProgress);
        }
      } catch (err: any) {
        this.emitMessage({
          type: MessageType.DeployError,
          deploymentId,
          error: err?.message || String(err),
          progress: 0,
        });
      }
    };

    doWork();
  }

  // ---------------------------------------------------------------------------
  // Message emission helpers
  // ---------------------------------------------------------------------------

  /** Emit a data event (single row or snapshot array), flattening nested objects. */
  private emitData(instanceID: string, dsID: string, rawData: unknown): void {
    if (Array.isArray(rawData)) {
      this.emitMessage({
        type: MessageType.DataArray,
        instanceID,
        datasourceID: dsID,
        environmentID: this.clusterName,
        data: rawData.map(item =>
          typeof item === 'object' && item !== null
            ? flattenObject(item as Record<string, unknown>)
            : item
        ),
      });
    } else {
      const event =
        typeof rawData === 'object' && rawData !== null
          ? flattenObject(rawData as Record<string, unknown>)
          : { value: rawData };
      this.emitMessage({
        type: MessageType.DataEvent,
        instanceID,
        datasourceID: dsID,
        environmentID: this.clusterName,
        data: event,
      });
    }
  }

  /** Send a success response. */
  private sendResponse(reqID: string, data: unknown): void {
    this.emit(
      JSON.stringify({
        type: MessageType.Response,
        reqID,
        success: true,
        data,
      })
    );
  }

  /** Send an error response. */
  private sendError(reqID: string, error: string): void {
    this.emit(
      JSON.stringify({
        type: MessageType.Response,
        reqID,
        success: false,
        error,
      })
    );
  }

  /** Emit a streaming message. */
  private emitMessage(msg: Record<string, unknown>): void {
    this.emit(JSON.stringify(msg));
  }
}
