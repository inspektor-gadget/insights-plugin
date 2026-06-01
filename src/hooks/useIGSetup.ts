import { environments } from '@inspektor-gadget/ig-desktop/frontend';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { useGadgetNamespace } from '../utils/plugin-config';
import { getSharedConnection, subscribeConnectionStatus } from '../utils/shared-connection';
import { bridgeTheme } from '../utils/theme-bridge';

/**
 * Shared hook that initializes the IG library for a given cluster:
 * - Ensures the shared connection exists and subscribes to its status
 * - Seeds the cluster as an IG environment
 * - Bridges MUI theme to IG CSS variables
 * - Derives isDark from the MUI theme
 *
 * The effect also re-runs when the cluster's configured gadget namespace
 * changes, so editing the namespace in the plugin Settings tears down the
 * stale connection and reconnects to the new namespace immediately.
 */
export function useIGSetup(clusterName: string): { connected: boolean; isDark: boolean } {
  const muiTheme = useTheme();
  const [connected, setConnected] = useState(false);
  const gadgetNamespace = useGadgetNamespace(clusterName);

  // Ensure the shared connection exists and subscribe to its status
  useEffect(() => {
    if (!clusterName) return;
    getSharedConnection(clusterName);
    return subscribeConnectionStatus(setConnected);
  }, [clusterName, gadgetNamespace]);

  // Seed the cluster as an IG environment
  useEffect(() => {
    if (!clusterName) return;
    (environments as any)[clusterName] = {
      id: clusterName,
      name: clusterName,
      runtime: 'k8s',
      params: {},
    };
  }, [clusterName]);

  // Bridge MUI theme to IG CSS variables
  useEffect(() => {
    bridgeTheme(muiTheme);
  }, [muiTheme]);

  const isDark = muiTheme.palette?.mode === 'dark';

  return { connected, isDark };
}
