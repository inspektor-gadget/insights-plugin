import type { GadgetInfo, GadgetInstanceData } from '@inspektor-gadget/ig-desktop/frontend';

const DEFAULT_HIDDEN_FIELDS = new Set(['k8s.namespace', 'proc.pid', 'proc.tid', 'proc.parent.tid']);

export interface ColumnDefaults {
  hiddenFields?: string[];
  descriptions?: Record<string, string>;
}

export function applyColumnDefaults(gadgetInfo: GadgetInfo, defaults: ColumnDefaults = {}): void {
  const hiddenFields = new Set([...DEFAULT_HIDDEN_FIELDS, ...(defaults.hiddenFields ?? [])]);
  const datasources = gadgetInfo.datasources ?? gadgetInfo.dataSources ?? [];

  for (const datasource of datasources) {
    for (const field of datasource.fields ?? []) {
      const fieldNames = [field.fullName, field.name];
      if (fieldNames.some(name => hiddenFields.has(name))) {
        field.flags = (field.flags ?? 0) | 0x0004;
      }

      const description = fieldNames.map(name => defaults.descriptions?.[name]).find(Boolean);
      if (description) {
        field.annotations = { ...field.annotations, description };
      }
    }
  }
}

export async function applyInstanceColumnDefaults(
  instances: Record<string, GadgetInstanceData>,
  instanceID: string,
  defaults: ColumnDefaults = {},
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!instances[instanceID]?.gadgetInfo) {
    if (Date.now() >= deadline) {
      throw new Error(`Gadget metadata for instance ${instanceID} did not arrive`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  applyColumnDefaults(instances[instanceID].gadgetInfo, defaults);
}
