import { useEffect, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { environments } from '@inspektor-gadget/ig-desktop/frontend';
import { getSharedConnection, subscribeConnectionStatus } from '../utils/shared-connection';
import { bridgeTheme } from '../utils/theme-bridge';

/**
 * Shared hook that initializes the IG library for a given cluster:
 * - Ensures the shared connection exists and subscribes to its status
 * - Seeds the cluster as an IG environment
 * - Bridges MUI theme to IG CSS variables
 * - Derives isDark from the MUI theme
 */
export function useIGSetup(clusterName: string): { connected: boolean; isDark: boolean } {
  const muiTheme = useTheme();
  const [connected, setConnected] = useState(false);

  // Ensure the shared connection exists and subscribe to its status
  useEffect(() => {
    if (!clusterName) return;
    getSharedConnection(clusterName);
    return subscribeConnectionStatus(setConnected);
  }, [clusterName]);

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
