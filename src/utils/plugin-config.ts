/**
 * Persistent plugin-level configuration backed by Headlamp's `ConfigStore`.
 *
 * Holds:
 * - `gadgetNamespaces`: per-cluster map of the namespace where Inspektor
 *   Gadget is deployed. When unset for a cluster, callers should fall back
 *   to `DEFAULT_GADGET_NAMESPACE` ("gadget"). The value is updated:
 *   - automatically after a successful deploy/redeploy via the WASM bridge;
 *   - manually by the user via the Settings UI;
 *   - left untouched on undeploy (so an immediate redeploy reuses the same
 *     namespace).
 *
 * All other modules should import from here rather than instantiating their
 * own ConfigStore — multiple ConfigStore instances with the same key would
 * each subscribe to the Redux store independently, which is wasteful and
 * makes reactive updates harder to reason about.
 */
import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';

export const PLUGIN_NAME = 'insights-plugin';

/** Default namespace used when no per-cluster override is configured. */
export const DEFAULT_GADGET_NAMESPACE = 'gadget';

export interface PluginConfig {
  /** Per-cluster gadget namespace overrides (clusterName → namespace). */
  gadgetNamespaces?: Record<string, string>;
}

export const pluginStore = new ConfigStore<PluginConfig>(PLUGIN_NAME);

/** Returns the current plugin configuration (never null). */
function readConfig(): PluginConfig {
  return pluginStore.get() ?? {};
}

/** Returns the configured gadget namespace for `clusterName`, falling back to "gadget". */
export function getGadgetNamespace(clusterName: string): string {
  if (!clusterName) return DEFAULT_GADGET_NAMESPACE;
  const ns = readConfig().gadgetNamespaces?.[clusterName];
  return ns && ns.trim() ? ns.trim() : DEFAULT_GADGET_NAMESPACE;
}

/**
 * Persist the gadget namespace for `clusterName`.
 *
 * An empty/whitespace `namespace` removes the entry (falling back to the
 * default on subsequent reads). Performs a merge against the existing map
 * so unrelated clusters are preserved.
 */
export function setGadgetNamespace(clusterName: string, namespace: string): void {
  if (!clusterName) return;
  const current = readConfig().gadgetNamespaces ?? {};
  const trimmed = namespace.trim();
  const next: Record<string, string> = { ...current };
  if (trimmed) {
    next[clusterName] = trimmed;
  } else {
    delete next[clusterName];
  }
  pluginStore.update({ gadgetNamespaces: next });
}

/**
 * React hook returning the configured gadget namespace for `clusterName`.
 * Re-renders when the plugin config changes.
 */
export function useGadgetNamespace(clusterName: string): string {
  const config = pluginStore.useConfig()();
  return useMemo(() => {
    if (!clusterName) return DEFAULT_GADGET_NAMESPACE;
    const ns = config?.gadgetNamespaces?.[clusterName];
    return ns && ns.trim() ? ns.trim() : DEFAULT_GADGET_NAMESPACE;
  }, [clusterName, config?.gadgetNamespaces]);
}
