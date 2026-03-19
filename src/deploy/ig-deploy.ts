/**
 * Client-side IG deployment service for WASM mode.
 * Uses Headlamp's ApiProxy to apply/delete K8s manifests.
 */
import {
  apply,
  request as apiRequest,
  remove,
} from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import YAML from 'yaml';
import { APP_VERSION, CHART_VERSION } from './manifests';
import type { ManifestEntry } from './manifests';
import {
  customizeManifests,
  getDeleteOrder,
  DEFAULT_CONFIG,
} from './manifest-customizer';
import type { DeployConfig } from './manifest-customizer';

export { DEFAULT_CONFIG } from './manifest-customizer';
export type { DeployConfig, OtelExporter } from './manifest-customizer';

/** Label selectors for identifying IG DaemonSets across deployment methods */
const GADGET_LABEL_SELECTORS = [
  'app.kubernetes.io/name=gadget',
  'k8s-app=gadget',
];

export interface DeployProgress {
  deploymentId: string;
  step: string;
  progress: number;
  message: string;
  error?: string;
}

export type ProgressCallback = (progress: DeployProgress) => void;

/**
 * Build the K8s API path for a given resource.
 */
function apiPath(
  clusterName: string,
  resource: { apiVersion: string; kind: string; name: string; namespace?: string },
): string {
  const { apiVersion, kind, name, namespace } = resource;

  // Determine the API group path
  let basePath: string;
  if (apiVersion === 'v1') {
    basePath = '/api/v1';
  } else {
    basePath = `/apis/${apiVersion}`;
  }

  // Determine the resource plural name
  const plural = kindToPlural(kind);

  // Build path (no cluster prefix — callers pass { cluster } to ApiProxy)
  if (namespace) {
    return `${basePath}/namespaces/${namespace}/${plural}/${name}`;
  }
  return `${basePath}/${plural}/${name}`;
}

/**
 * Map K8s kind to plural resource name.
 */
function kindToPlural(kind: string): string {
  const map: Record<string, string> = {
    Namespace: 'namespaces',
    ServiceAccount: 'serviceaccounts',
    ConfigMap: 'configmaps',
    Secret: 'secrets',
    Service: 'services',
    ClusterRole: 'clusterroles',
    ClusterRoleBinding: 'clusterrolebindings',
    Role: 'roles',
    RoleBinding: 'rolebindings',
    DaemonSet: 'daemonsets',
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    CustomResourceDefinition: 'customresourcedefinitions',
  };
  return map[kind] || kind.toLowerCase() + 's';
}

/**
 * Parse a YAML manifest string into a JSON object for apply().
 */
function parseManifest(entry: ManifestEntry): any {
  return YAML.parse(entry.yaml);
}

/**
 * Deploy Inspektor Gadget to the cluster.
 */
export async function deployIG(
  config: DeployConfig,
  clusterName: string,
  onProgress: ProgressCallback,
): Promise<void> {
  const deploymentId = `wasm-deploy-${Date.now()}`;
  const manifests = customizeManifests(config);

  // Step 1: Create namespace
  onProgress({
    deploymentId,
    step: 'create_namespace',
    progress: 10,
    message: `Creating namespace ${config.namespace}`,
  });

  try {
    const nsManifest = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: config.namespace },
    };
    await apply(nsManifest as any, clusterName);
  } catch (err: any) {
    // Namespace may already exist (409 conflict is handled by apply)
    if (err?.status !== 409 && err?.status !== 403) {
      console.warn('Namespace creation warning:', err?.message || err);
    }
  }

  onProgress({
    deploymentId,
    step: 'create_namespace',
    progress: 20,
    message: 'Namespace ready',
  });

  // Step 2: Apply manifests in order
  const total = manifests.length;
  for (let i = 0; i < total; i++) {
    const entry = manifests[i];
    const progressPct = 20 + Math.round((i / total) * 60);

    onProgress({
      deploymentId,
      step: 'apply_resources',
      progress: progressPct,
      message: `Applying ${entry.kind}/${entry.name}`,
    });

    try {
      const resource = parseManifest(entry);
      await apply(resource, clusterName);
    } catch (err: any) {
      onProgress({
        deploymentId,
        step: 'apply_resources',
        progress: progressPct,
        message: `Failed to apply ${entry.kind}/${entry.name}`,
        error: err?.message || String(err),
      });
      throw err;
    }
  }

  // Step 3: Wait for DaemonSet readiness
  onProgress({
    deploymentId,
    step: 'verify',
    progress: 85,
    message: 'Waiting for DaemonSet to be ready...',
  });

  try {
    await waitForDaemonSet(clusterName, config.namespace, 120_000);
  } catch (err: any) {
    // Don't fail the whole operation — apply already succeeded
    onProgress({
      deploymentId,
      step: 'verify',
      progress: 95,
      message: 'DaemonSet verification timed out, but resources were applied',
    });
  }

  onProgress({
    deploymentId,
    step: 'complete',
    progress: 100,
    message: 'Deployment completed successfully',
  });
}

/**
 * Undeploy Inspektor Gadget from the cluster.
 */
export async function undeployIG(
  clusterName: string,
  namespace: string,
  onProgress: ProgressCallback,
): Promise<void> {
  const deploymentId = `wasm-undeploy-${Date.now()}`;
  const manifests = getDeleteOrder(customizeManifests({ ...DEFAULT_CONFIG, namespace }));

  onProgress({
    deploymentId,
    step: 'delete_resources',
    progress: 10,
    message: 'Removing Inspektor Gadget resources...',
  });

  const total = manifests.length;
  for (let i = 0; i < total; i++) {
    const entry = manifests[i];
    const progressPct = 10 + Math.round((i / total) * 50);

    onProgress({
      deploymentId,
      step: 'delete_resources',
      progress: progressPct,
      message: `Deleting ${entry.kind}/${entry.name}`,
    });

    try {
      const path = apiPath(clusterName, {
        apiVersion: entry.apiVersion,
        kind: entry.kind,
        name: entry.name,
        namespace: entry.namespace,
      });
      await remove(path, {
        cluster: clusterName,
        autoLogoutOnAuthError: true,
      });
    } catch (err: any) {
      // 404 means already deleted — ignore
      if (err?.status !== 404) {
        console.warn(`Failed to delete ${entry.kind}/${entry.name}:`, err?.message);
      }
    }
  }

  // Delete namespace last
  onProgress({
    deploymentId,
    step: 'delete_namespace',
    progress: 65,
    message: `Deleting namespace ${namespace}`,
  });

  try {
    const nsPath = `/api/v1/namespaces/${namespace}`;
    await remove(nsPath, {
      cluster: clusterName,
      autoLogoutOnAuthError: true,
    });
  } catch (err: any) {
    if (err?.status !== 404) {
      console.warn(`Failed to delete namespace ${namespace}:`, err?.message);
    }
  }

  // Wait for DaemonSet removal
  onProgress({
    deploymentId,
    step: 'verify_removal',
    progress: 70,
    message: 'Verifying DaemonSet removal...',
  });

  try {
    await waitForDaemonSetRemoval(clusterName, namespace, 120_000);
  } catch (err: any) {
    onProgress({
      deploymentId,
      step: 'verify_removal',
      progress: 90,
      message: 'Verification timed out, but resources were deleted',
    });
  }

  onProgress({
    deploymentId,
    step: 'complete',
    progress: 100,
    message: 'Undeployment completed successfully',
  });
}

/**
 * Check if Inspektor Gadget is deployed in the cluster.
 * Queries for DaemonSets/Deployments with IG labels.
 */
export async function checkIGDeployment(
  clusterName: string,
): Promise<{ deployed: boolean; namespace?: string; version?: string; error?: string }> {
  // Check common namespaces first
  const namespacesToCheck = ['gadget', 'kube-system', 'ig-system', 'inspektor-gadget'];

  for (const ns of namespacesToCheck) {
    for (const selector of GADGET_LABEL_SELECTORS) {
      try {
        const path = `/clusters/${clusterName}/apis/apps/v1/namespaces/${ns}/daemonsets?labelSelector=${encodeURIComponent(selector)}`;
        const response = await apiRequest(path, {}, true, false);

        if (response?.items?.length > 0) {
          const ds = response.items[0];
          const version =
            ds.metadata?.labels?.['app.kubernetes.io/version'] ||
            extractVersionFromImage(ds.spec?.template?.spec?.containers?.[0]?.image) ||
            'unknown';
          return { deployed: true, namespace: ns, version };
        }
      } catch {
        // Namespace may not exist — ignore
      }
    }
  }

  // Try all namespaces
  try {
    for (const selector of GADGET_LABEL_SELECTORS) {
      const path = `/clusters/${clusterName}/apis/apps/v1/daemonsets?labelSelector=${encodeURIComponent(selector)}`;
      const response = await apiRequest(path, {}, true, false);

      if (response?.items?.length > 0) {
        const ds = response.items[0];
        const ns = ds.metadata?.namespace || 'unknown';
        const version =
          ds.metadata?.labels?.['app.kubernetes.io/version'] ||
          extractVersionFromImage(ds.spec?.template?.spec?.containers?.[0]?.image) ||
          'unknown';
        return { deployed: true, namespace: ns, version };
      }
    }
  } catch (err: any) {
    return { deployed: false, error: err?.message || String(err) };
  }

  return { deployed: false };
}

function extractVersionFromImage(image?: string): string | undefined {
  if (!image) return undefined;
  const idx = image.lastIndexOf(':');
  return idx !== -1 ? image.substring(idx + 1) : undefined;
}

/**
 * Poll for DaemonSet readiness.
 */
async function waitForDaemonSet(
  clusterName: string,
  namespace: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  const labelSelectors = GADGET_LABEL_SELECTORS;

  while (Date.now() - start < timeoutMs) {
    for (const selector of labelSelectors) {
      try {
        const path = `/clusters/${clusterName}/apis/apps/v1/namespaces/${namespace}/daemonsets?labelSelector=${encodeURIComponent(selector)}`;
        const response = await apiRequest(path, {}, true, false);

        if (response?.items?.length > 0) {
          const ds = response.items[0];
          const desired = ds.status?.desiredNumberScheduled ?? 0;
          const ready = ds.status?.numberReady ?? 0;
          if (desired > 0 && ready >= desired) {
            return;
          }
        }
      } catch {
        // Ignore — may not be created yet
      }
    }
    await sleep(3000);
  }

  throw new Error('Timeout waiting for DaemonSet to be ready');
}

/**
 * Poll for DaemonSet removal.
 */
async function waitForDaemonSetRemoval(
  clusterName: string,
  namespace: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  const labelSelectors = GADGET_LABEL_SELECTORS;

  while (Date.now() - start < timeoutMs) {
    let found = false;
    for (const selector of labelSelectors) {
      try {
        const path = `/clusters/${clusterName}/apis/apps/v1/namespaces/${namespace}/daemonsets?labelSelector=${encodeURIComponent(selector)}`;
        const response = await apiRequest(path, {}, true, false);

        if (response?.items?.length > 0) {
          found = true;
          break;
        }
      } catch {
        // Namespace may be gone — that means it's deleted
      }
    }

    if (!found) return;
    await sleep(3000);
  }

  throw new Error('Timeout waiting for DaemonSet removal');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Re-export for display purposes */
export { CHART_VERSION, APP_VERSION };
