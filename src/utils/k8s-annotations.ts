import type {
  GadgetDatasource,
  GadgetDatasourceField,
} from '@inspektor-gadget/ig-desktop/frontend';
import { registerAnnotationProvider } from '@inspektor-gadget/ig-desktop/frontend';

/** Field → annotation mappings for Kubernetes resource fields. */
const K8S_FIELD_ANNOTATIONS: Record<string, Record<string, string>> = {
  'k8s.podName': {
    'interaction.clickable': 'true',
    'interaction.resource-type': 'pod',
  },
  'k8s.namespace': {
    'interaction.clickable': 'true',
    'interaction.resource-type': 'namespace',
  },
  'k8s.nodeName': {
    'interaction.clickable': 'true',
    'interaction.resource-type': 'node',
  },
  'k8s.containerName': {
    'interaction.clickable': 'true',
    'interaction.resource-type': 'container',
  },
};

interface RegisterOptions {
  /** If set, only this datasource name is shown; others get view.hidden. */
  showOnlyDatasource?: string;
  /** Fields to hide from the table column list (by fullName). */
  hiddenFields?: string[];
}

/**
 * Register annotation providers that mark k8s resource fields as clickable
 * and optionally hide unwanted datasources.
 *
 * @returns Unregister function for cleanup.
 */
export function registerK8sAnnotations(options?: RegisterOptions): () => void {
  return registerAnnotationProvider({
    datasource: options?.showOnlyDatasource
      ? (ds: GadgetDatasource) => {
          if (ds.name !== options.showOnlyDatasource) {
            return { 'view.hidden': 'true' };
          }
          return {};
        }
      : undefined,

    // eslint-disable-next-line no-unused-vars
    field: (field: GadgetDatasourceField, _ds: GadgetDatasource) => {
      const annotations: Record<string, string> = {
        ...(K8S_FIELD_ANNOTATIONS[field.fullName] ?? {}),
      };
      if (options?.hiddenFields?.includes(field.fullName)) {
        annotations['columns.hidden'] = 'true';
      }
      return annotations;
    },
  });
}
