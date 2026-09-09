/**
 * Discovers Inspektor Gadget pods and creates K8s port-forward WebSocket connections.
 *
 * Uses Headlamp's ApiProxy for REST calls (pod listing) and constructs
 * port-forward WebSockets directly to avoid a race condition with the
 * `stream()` helper (whose async URL construction can cause the socket
 * to be OPEN before we can pass it to `wrapWebSocket`).
 *
 * The gadget namespace is configured per cluster via the plugin Settings
 * (see `src/utils/plugin-config.ts`). Callers pass it explicitly so this
 * module stays free of cross-module config lookups.
 */
import { request as apiRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

const GADGET_LABEL_KEY = 'k8s-app';
const GADGET_LABEL_VALUE = 'gadget';
const GADGET_PORT = 8080;

export interface PortForwardHandle {
  cancel: () => void;
  socket: WebSocket;
}

/** A discovered Inspektor Gadget pod: the DaemonSet instance running on `nodeName`. */
export interface GadgetPod {
  name: string;
  nodeName: string;
}

/**
 * List all running Inspektor Gadget pods in `namespace`.
 *
 * IG is deployed as a DaemonSet (one pod per node), and each pod's gadget
 * service only runs gadgets against its own node — there is no server-side
 * fan-out/aggregation across nodes. Callers that want cluster-wide data
 * must connect to every pod returned here and merge the resulting streams
 * themselves (see MultiIGConnection).
 */
export async function findGadgetPods(clusterName: string, namespace: string): Promise<GadgetPod[]> {
  // Use explicit cluster path instead of useCluster=true, which relies on the
  // current route having a cluster context. Project details tabs don't have
  // a cluster in the route, so useCluster would omit the /clusters/ prefix.
  const path = `/clusters/${clusterName}/api/v1/namespaces/${namespace}/pods?labelSelector=${GADGET_LABEL_KEY}%3D${GADGET_LABEL_VALUE}`;

  const response = await apiRequest(
    path,
    {},
    true, // autoLogoutOnAuthError
    false // useCluster — we handle the cluster prefix ourselves
  );

  const pods = response?.items || [];
  const runningPods: GadgetPod[] = pods
    .filter((pod: any) => pod.status?.phase === 'Running')
    .map((pod: any) => ({
      name: pod.metadata.name,
      nodeName: pod.spec?.nodeName || pod.metadata.name,
    }));

  if (runningPods.length === 0) {
    throw new Error(
      `No running Insights Agent pod found in namespace "${namespace}". ` +
        'Ensure IG is deployed on your cluster, or set the correct namespace in the plugin settings.'
    );
  }

  return runningPods;
}

/**
 * Build the WebSocket base URL, matching Headlamp's getBaseWsUrl() / getAppUrl().
 */
function getWsBaseUrl(): string {
  let host = window.location.host;
  let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (!host || window.location.protocol === 'file:') {
    const port = (window as any).headlampBackendPort || 4466;
    host = `localhost:${port}`;
    protocol = 'ws:';
  }

  return `${protocol}//${host}`;
}

/**
 * Create a port-forward WebSocket to the given gadget pod.
 *
 * Creates the WebSocket directly (instead of using Headlamp's `stream()`)
 * so that the socket is returned in CONNECTING state. This is critical:
 * `wrapWebSocket` registers an `onopen` handler and if the socket is
 * already OPEN (which happens with the async `stream()` + polling approach),
 * the handler never fires and `onReady` is never called.
 *
 * @param podName - The gadget pod name
 * @param clusterName - The K8s cluster name (for Headlamp's proxy path)
 * @param namespace - The namespace the gadget pod lives in
 */
export function createPortForward(
  podName: string,
  clusterName: string,
  namespace: string
): PortForwardHandle {
  const k8sPath = `api/v1/namespaces/${namespace}/pods/${podName}/portforward?ports=${GADGET_PORT}`;
  const url = `${getWsBaseUrl()}/clusters/${clusterName}/${k8sPath}`;

  const protocols = [
    'base64.binary.k8s.io',
    'v4.channel.k8s.io',
    'v3.channel.k8s.io',
    'v2.channel.k8s.io',
    'channel.k8s.io',
  ];

  const socket = new WebSocket(url, protocols);
  socket.binaryType = 'arraybuffer';

  const cancel = () => {
    socket.close();
  };

  return { cancel, socket };
}
