/**
 * Fans a single IGConnection-shaped API out to multiple gadget pods and
 * merges their results back into one logical connection.
 *
 * Inspektor Gadget is deployed as a DaemonSet (one pod per node). Each pod's
 * gadget-service runs gadgets against its own node ONLY — there is no
 * server-side aggregation across nodes (that only happens client-side, e.g.
 * in `kubectl gadget`'s grpc-runtime). To get cluster-wide data, this plugin
 * must connect to every gadget pod and combine their streams itself.
 *
 * MultiIGConnection implements the same IGConnection interface as a single
 * WASM connection, so WasmBridge (and everything above it) is unaware that
 * multiple pods are involved.
 *
 * Completion tracking (onReady/onDone) is based on Sets of pending pod
 * names rather than fixed counters, so that a pod dropping out mid-call
 * (see removePod, invoked by the adapter when a port-forward socket dies)
 * prunes it from any in-flight call and can still let that call complete,
 * instead of hanging forever waiting for a pod that will never respond.
 */
import type { GadgetInfo, IGConnection, RunGadgetCallbacks } from './wasm-types';

interface PodConnection {
  podName: string;
  nodeName: string;
  ig: IGConnection;
}

type DisconnectListener = (podName: string) => void;

/** Merges periodic full-snapshot arrays (e.g. top/histogram gadgets) from all pods. */
class SnapshotMerger {
  // dsID -> podName -> latest array from that pod
  private latest = new Map<string, Map<string, unknown[]>>();

  /** Record the latest array from `podName` for `dsID` and return the merged view. */
  update(dsID: string, podName: string, data: unknown[]): unknown[] {
    let byPod = this.latest.get(dsID);
    if (!byPod) {
      byPod = new Map();
      this.latest.set(dsID, byPod);
    }
    byPod.set(podName, data);

    const merged: unknown[] = [];
    for (const arr of byPod.values()) {
      merged.push(...arr);
    }
    return merged;
  }

  /** Drop a pod's contribution so a dead pod's stale snapshot doesn't linger forever. */
  removePod(podName: string): void {
    for (const byPod of this.latest.values()) {
      byPod.delete(podName);
    }
  }
}

export class MultiIGConnection implements IGConnection {
  private pods: PodConnection[];
  private disconnectListeners = new Set<DisconnectListener>();

  constructor(pods: PodConnection[]) {
    if (pods.length === 0) {
      throw new Error('MultiIGConnection requires at least one pod connection');
    }
    this.pods = pods;
  }

  /**
   * Remove a pod whose underlying transport (port-forward socket) died.
   * Notifies any in-flight runGadget/attachGadgetInstance calls so they can
   * complete instead of waiting forever on a pod that's gone.
   */
  removePod(podName: string): void {
    this.pods = this.pods.filter(p => p.podName !== podName);
    for (const listener of this.disconnectListeners) {
      listener(podName);
    }
  }

  get size(): number {
    return this.pods.length;
  }

  /**
   * Probe every currently-connected pod with a real round trip (not the
   * synthetic 'helo' the WASM bridge answers locally) and return the names
   * of pods that don't respond within `timeoutMs`.
   *
   * This is the only reliable way to detect a "zombie" port-forward
   * WebSocket: a socket can silently stop delivering data (idle proxy
   * timeout, dropped NAT mapping, etc.) without ever firing `onerror`/
   * `onclose`, so `readyState` alone can't tell a dead connection from a
   * healthy idle one. `listGadgetInstances` is used as the probe because
   * it's a real gRPC round trip over the same channel gadget data flows
   * through, so success (or even a gRPC-level error reply) proves the
   * socket is genuinely alive; only a real timeout proves it's dead.
   *
   * Does not mutate `this.pods` — callers (see WasmTransportAdapter)
   * decide how to react (cancel the socket, prune via removePod(), etc.).
   */
  async findDeadPods(timeoutMs = 5000): Promise<string[]> {
    const podsSnapshot = [...this.pods];
    const deadPods: string[] = [];
    await Promise.all(
      podsSnapshot.map(
        ({ podName, ig }) =>
          new Promise<void>(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
              if (!settled) {
                settled = true;
                deadPods.push(podName);
                resolve();
              }
            }, timeoutMs);
            const done = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve();
              }
            };
            // Both success and error responses prove the round trip
            // completed, i.e. the pod is alive — only a timeout means dead.
            ig.listGadgetInstances(done, done);
          })
      )
    );
    return deadPods;
  }

  /**
   * Gadget info (params/datasource schema) is identical across all pods for
   * a given image, so it's enough to fetch it from the first pod that
   * answers.
   *
   * Matches upstream's grpc-runtime `getConnToRandomTarget`, which dials
   * only the first target with no retry across pods (schema is identical
   * for a given image regardless of node).
   */
  getGadgetInfo(
    params: { version: number; imageName: string },
    onSuccess: (info: GadgetInfo) => void,
    onError: (error: Error) => void
  ): void {
    if (this.pods.length === 0) {
      onError(new Error('getGadgetInfo failed: no gadget pods connected'));
      return;
    }
    this.pods[0].ig.getGadgetInfo(params, onSuccess, onError);
  }

  /**
   * Run the gadget on every currently-connected pod in parallel and merge
   * the results:
   * - onGadgetInfo fires once (schema is identical across pods/nodes)
   * - onData: single-row events are forwarded as-is (they're already a
   *   stream, not a snapshot); array events (snapshot/top/histogram) are
   *   merged across all pods' latest known snapshot before forwarding
   * - onReady fires once every pod has acknowledged the request (matches
   *   the underlying WASM binary, which signals onReady right after the
   *   request is sent, before it knows whether the gadget actually started)
   * - onDone fires once every pod's stream has ended
   * - onError is forwarded per pod (tagged with node name), and doesn't
   *   stop the other pods from continuing
   * - a pod that disconnects mid-run (removePod) is pruned from the
   *   pending sets so onReady/onDone can still complete
   */
  runGadget(
    params: { version: number; imageName: string; paramValues?: Record<string, string> },
    callbacks: RunGadgetCallbacks,
    onSetupError: (error: Error) => void
  ): { stop: () => void } {
    const podsSnapshot = [...this.pods];
    const readyPending = new Set(podsSnapshot.map(p => p.podName));
    const donePending = new Set(podsSnapshot.map(p => p.podName));
    const setupPending = new Set(podsSnapshot.map(p => p.podName));
    let readyFired = false;
    let doneFired = false;
    let anySucceeded = false;
    let gadgetInfoSent = false;
    const snapshots = new SnapshotMerger();
    const handles: Array<{ stop: () => void }> = [];

    const maybeReady = () => {
      if (!readyFired && readyPending.size === 0) {
        readyFired = true;
        callbacks.onReady();
      }
    };
    const maybeDone = () => {
      if (!doneFired && donePending.size === 0) {
        doneFired = true;
        callbacks.onDone();
        this.disconnectListeners.delete(onDisconnect);
      }
    };
    const onDisconnect = (podName: string) => {
      snapshots.removePod(podName);
      readyPending.delete(podName);
      donePending.delete(podName);
      setupPending.delete(podName);
      maybeReady();
      maybeDone();
    };
    this.disconnectListeners.add(onDisconnect);

    for (const { podName, nodeName, ig } of podsSnapshot) {
      const handle = ig.runGadget(
        params,
        {
          onGadgetInfo: info => {
            if (!gadgetInfoSent) {
              gadgetInfoSent = true;
              callbacks.onGadgetInfo(info);
            }
          },
          onData: (dsID, data) => {
            if (Array.isArray(data)) {
              callbacks.onData(dsID, snapshots.update(dsID, podName, data));
            } else {
              callbacks.onData(dsID, data);
            }
          },
          onReady: () => {
            anySucceeded = true;
            setupPending.delete(podName);
            readyPending.delete(podName);
            maybeReady();
          },
          onDone: () => {
            donePending.delete(podName);
            maybeDone();
          },
          onError: error => {
            callbacks.onError(new Error(`[node ${nodeName}] ${error.message || error}`));
          },
        },
        setupError => {
          console.error(
            `[IG Multi] runGadget setup failed on pod ${podName} (node ${nodeName}):`,
            setupError
          );
          setupPending.delete(podName);
          readyPending.delete(podName);
          donePending.delete(podName);
          maybeReady();
          maybeDone();
          // Only surface a hard setup error if every pod failed to even
          // accept the request; otherwise the pods that succeeded still
          // produce useful (partial) data.
          if (!anySucceeded && setupPending.size === 0) {
            onSetupError(setupError);
          }
        }
      );
      handles.push(handle);
    }

    return {
      stop: () => {
        this.disconnectListeners.delete(onDisconnect);
        for (const h of handles) {
          try {
            h.stop();
          } catch {
            // Ignore errors during cleanup
          }
        }
      },
    };
  }

  /**
   * List persistent gadget instances from every pod and merge them.
   *
   * Matches upstream's grpc-runtime `GetGadgetInstances`, which always
   * fans out to all targets (`allTargets=true`) even on Kubernetes: the
   * instance's config is synced via a k8s CR, but each pod's *local run
   * state* (running/error/stopped) is not, so every node must be asked.
   * Results are merged and deduped by id, preferring a non-running state on
   * conflict, mirroring upstream's sort+compact behavior.
   */
  listGadgetInstances(
    onSuccess: (instances: Array<Record<string, unknown>>) => void,
    onError: (error: Error) => void
  ): void {
    const podsSnapshot = [...this.pods];
    let remaining = podsSnapshot.length;
    let succeeded = 0;
    let lastError: Error | undefined;
    const byId = new Map<string, Record<string, unknown>>();

    const finish = () => {
      remaining--;
      if (remaining === 0) {
        if (succeeded > 0) {
          // Sorted by id, matching upstream's deterministic ordering
          // (`slices.SortFunc` before `slices.CompactFunc`).
          const merged = [...byId.values()].sort((a, b) =>
            String(a.id).localeCompare(String(b.id))
          );
          onSuccess(merged);
        } else {
          onError(lastError || new Error('listGadgetInstances failed on all pods'));
        }
      }
    };

    const isRunning = (inst: Record<string, unknown>): boolean => {
      const status = (inst.state as Record<string, unknown> | undefined)?.status;
      return status === 'StatusRunning' || status === 1;
    };

    for (const { ig } of podsSnapshot) {
      ig.listGadgetInstances(
        instances => {
          succeeded++;
          for (const inst of instances) {
            const id = (inst.id as string) || JSON.stringify(inst);
            // Prefer a non-running state over a running one on conflict,
            // same tie-break upstream uses (surfaces problems first).
            if (!byId.has(id) || (isRunning(byId.get(id)!) && !isRunning(inst))) {
              byId.set(id, inst);
            }
          }
          finish();
        },
        err => {
          lastError = err;
          finish();
        }
      );
    }
  }

  /**
   * Remove a persistent gadget instance.
   *
   * Matches upstream's grpc-runtime `RemoveGadgetInstance`, which — on
   * Kubernetes — talks to a single target only (k8s/etcd syncs the
   * instance CR deletion across nodes), with no fallback across pods.
   */
  deleteGadgetInstance(id: string, onSuccess: () => void, onError: (error: Error) => void): void {
    if (this.pods.length === 0) {
      onError(new Error(`deleteGadgetInstance(${id}) failed: no gadget pods connected`));
      return;
    }
    this.pods[0].ig.deleteGadgetInstance(id, onSuccess, onError);
  }

  /**
   * Attach to an existing persistent gadget instance and stream its data.
   *
   * Matches upstream's grpc-runtime: attach reuses the same per-target
   * fan-out as runGadget (`runGadgetOnTargets`, one goroutine per node), so
   * it's fanned out to every pod here too. The underlying WASM binary
   * signals onReady right after the attach request is sent (regardless of
   * whether that particular pod's instance manager actually has the
   * instance), and onDone when that pod's stream ends — so both must be
   * tracked per-pod-pending, exactly like runGadget.
   */
  attachGadgetInstance(
    params: { instanceName: string; [key: string]: unknown },
    callbacks: RunGadgetCallbacks
  ): { stop: () => void } {
    const podsSnapshot = [...this.pods];
    const readyPending = new Set(podsSnapshot.map(p => p.podName));
    const donePending = new Set(podsSnapshot.map(p => p.podName));
    let readyFired = false;
    let doneFired = false;
    let gadgetInfoSent = false;
    const snapshots = new SnapshotMerger();
    const handles: Array<{ stop: () => void }> = [];

    const maybeReady = () => {
      if (!readyFired && readyPending.size === 0) {
        readyFired = true;
        callbacks.onReady();
      }
    };
    const maybeDone = () => {
      if (!doneFired && donePending.size === 0) {
        doneFired = true;
        callbacks.onDone();
        this.disconnectListeners.delete(onDisconnect);
      }
    };
    const onDisconnect = (podName: string) => {
      snapshots.removePod(podName);
      readyPending.delete(podName);
      donePending.delete(podName);
      maybeReady();
      maybeDone();
    };
    this.disconnectListeners.add(onDisconnect);

    for (const { podName, ig } of podsSnapshot) {
      const handle = ig.attachGadgetInstance(params, {
        onGadgetInfo: info => {
          if (!gadgetInfoSent) {
            gadgetInfoSent = true;
            callbacks.onGadgetInfo(info);
          }
        },
        onData: (dsID, data) => {
          if (Array.isArray(data)) {
            callbacks.onData(dsID, snapshots.update(dsID, podName, data));
          } else {
            callbacks.onData(dsID, data);
          }
        },
        onReady: () => {
          readyPending.delete(podName);
          maybeReady();
        },
        onDone: () => {
          donePending.delete(podName);
          maybeDone();
        },
        onError: error => {
          callbacks.onError(error);
        },
      });
      handles.push(handle);
    }

    return {
      stop: () => {
        this.disconnectListeners.delete(onDisconnect);
        for (const h of handles) {
          try {
            h.stop();
          } catch {
            // Ignore errors during cleanup
          }
        }
      },
    };
  }
}
