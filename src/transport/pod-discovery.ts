/**
 * Discovers Inspektor Gadget pods and creates K8s port-forward WebSocket connections.
 *
 * Uses Headlamp's ApiProxy for REST calls (pod listing) and constructs
 * port-forward WebSockets directly to avoid a race condition with the
 * `stream()` helper (whose async URL construction can cause the socket
 * to be OPEN before we can pass it to `wrapWebSocket`).
 */
import { request as apiRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

const GADGET_NAMESPACE = 'gadget';
const GADGET_LABEL_KEY = 'k8s-app';
const GADGET_LABEL_VALUE = 'gadget';
const GADGET_PORT = 8080;

export interface PortForwardHandle {
  cancel: () => void;
  socket: WebSocket;
}

/**
 * Find the first running Inspektor Gadget pod in the `gadget` namespace.
 */
export async function findGadgetPod(clusterName: string): Promise<string> {
  // Use explicit cluster path instead of useCluster=true, which relies on the
  // current route having a cluster context. Project details tabs don't have
  // a cluster in the route, so useCluster would omit the /clusters/ prefix.
  const path = `/clusters/${clusterName}/api/v1/namespaces/${GADGET_NAMESPACE}/pods?labelSelector=${GADGET_LABEL_KEY}%3D${GADGET_LABEL_VALUE}`;

  const response = await apiRequest(
    path,
    {},
    true, // autoLogoutOnAuthError
    false // useCluster — we handle the cluster prefix ourselves
  );

  const pods = response?.items || [];
  const runningPod = pods.find((pod: any) => pod.status?.phase === 'Running');

  if (!runningPod) {
    throw new Error(
      `No running Inspektor Gadget pod found in namespace "${GADGET_NAMESPACE}". ` +
        'Ensure IG is deployed on your cluster.'
    );
  }

  return runningPod.metadata.name;
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
 */
export function createPortForward(podName: string, clusterName: string): PortForwardHandle {
  const k8sPath = `api/v1/namespaces/${GADGET_NAMESPACE}/pods/${podName}/portforward?ports=${GADGET_PORT}`;
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
