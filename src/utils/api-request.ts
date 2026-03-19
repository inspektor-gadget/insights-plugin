/**
 * Timeout wrapper for apiService.request() calls.
 *
 * The IG library's ApiService has no built-in request timeout — if the
 * WebSocket dies silently, requests hang forever. This wrapper races
 * the request against a timeout so callers get a clear error instead.
 */
import type { IGDeploymentStatus } from '@inspektor-gadget/ig-desktop/frontend';
import { apiService } from '@inspektor-gadget/ig-desktop/frontend';

const IS_WASM = import.meta.env.VITE_TRANSPORT === 'wasm';

const REQUEST_TIMEOUT_MS = 15_000;

export async function requestWithTimeout(cmd: object): Promise<any> {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Request timed out — connection may be lost')),
      REQUEST_TIMEOUT_MS
    )
  );
  return Promise.race([(apiService as any).request(cmd), timeout]);
}

/**
 * Check IG deployment status, routing to the appropriate backend:
 * - WASM mode: queries K8s API directly via ig-deploy
 * - Backend mode: goes through the IG transport WebSocket
 */
export async function checkDeploymentStatus(clusterName: string): Promise<IGDeploymentStatus> {
  if (IS_WASM) {
    const { checkIGDeployment } = await import('../deploy/ig-deploy');
    return checkIGDeployment(clusterName);
  }
  return requestWithTimeout({
    cmd: 'checkIGDeployment',
    data: { clusterName },
  });
}
