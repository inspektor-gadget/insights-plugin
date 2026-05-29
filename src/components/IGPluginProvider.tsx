import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { useIGLanguageSync } from '../hooks/useIGLanguageSync';
import { useIGSetup } from '../hooks/useIGSetup';
import { useIGToastBridge } from '../hooks/useIGToastBridge';

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
  const { t } = useTranslation();

  // Mirror Headlamp's language into the embedded IG Desktop UI so its strings
  // localize alongside the host. IG Desktop keeps its own i18next instance and
  // bundled catalogs — only the active language is synced from the host.
  useIGLanguageSync();

  // Forward toasts emitted by the embedded IG Desktop UI into Headlamp's
  // snackbar (IG Desktop's in-app ToastContainer is not mounted in
  // library mode).
  useIGToastBridge();

  if (!connected) {
    return (
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}
        role="status"
        aria-live="polite"
      >
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          {t('Connecting to Insights Agent...')}
        </Typography>
      </Box>
    );
  }

  return (
    <div className={isDark ? 'dark' : undefined} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
