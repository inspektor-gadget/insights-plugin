import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useIGSetup } from '../hooks/useIGSetup';

interface IGPluginProviderProps {
  clusterName: string;
  children: React.ReactNode;
}

/**
 * Initializes the IG library (shared WebSocket, theme bridge, cluster environment)
 * and wraps children. Defers rendering children until the WebSocket is connected
 * so that apiService.request() calls don't race the connection handshake.
 *
 * The WebSocket is a singleton shared across all IG pages — navigating between
 * GadgetRunnerPage and GadgetViewPage reuses the same connection, keeping
 * gadget subscriptions and the instances store intact.
 */
export default function IGPluginProvider({ clusterName, children }: IGPluginProviderProps) {
  const { connected, isDark } = useIGSetup(clusterName);

  if (!connected) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          Connecting to Inspektor Gadget...
        </Typography>
      </Box>
    );
  }

  return <div className={isDark ? 'dark' : undefined} style={{ display: 'contents' }}>{children}</div>;
}
