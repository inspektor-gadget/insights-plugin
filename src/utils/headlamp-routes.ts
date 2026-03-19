/** Map resource type → Headlamp route pattern */
export function resourceRoute(
  clusterName: string,
  resourceType: string,
  value: string,
  row: Record<string, unknown>
): string | null {
  switch (resourceType) {
    case 'pod': {
      const ns = (row['k8s.namespace'] as string) || 'default';
      return `/c/${clusterName}/pods/${ns}/${value}`;
    }
    case 'namespace':
      return `/c/${clusterName}/namespaces/${value}`;
    case 'node':
      return `/c/${clusterName}/nodes/${value}`;
    case 'container': {
      const ns = (row['k8s.namespace'] as string) || 'default';
      const pod = row['k8s.podName'] as string;
      if (pod) return `/c/${clusterName}/pods/${ns}/${pod}`;
      return null;
    }
    default:
      return null;
  }
}
