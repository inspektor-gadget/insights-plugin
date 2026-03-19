import { Icon } from '@iconify/react';
import type {
  CellClickHandler,
  CellContextMenuHandler,
  GadgetInfo,
  IGDeploymentStatus,
  ViewConfig,
} from '@inspektor-gadget/ig-desktop/frontend';
import { apiService, GadgetWrapper, instances } from '@inspektor-gadget/ig-desktop/frontend';
import { SvelteWrapper } from '@inspektor-gadget/ig-desktop/frontend/react';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIGSetup } from '../../hooks/useIGSetup';
import { requestWithTimeout } from '../../utils/api-request';
import DeployModal from '../DeployModal';

const CONNECTION_TIMEOUT_MS = 10_000;

interface ProjectGadgetTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
  gadgetImage: string;
  gadgetLabel: string;
  /** When true, hides the toolbar (stop/restart buttons) */
  embedded?: boolean;
  /** Controls which IG Desktop UI panels are visible */
  viewConfig?: ViewConfig;
  /** Callback when a clickable cell is clicked */
  onCellClick?: CellClickHandler;
  /** Callback when a cell is right-clicked */
  onCellContextMenu?: CellContextMenuHandler;
  /** Additional params to pass when running the gadget */
  extraParams?: Record<string, string>;
}

/**
 * Shared tab component for project-scoped IG gadgets.
 * Handles connection setup inline (instead of using IGPluginProvider)
 * so we can show a helpful timeout message rather than spinning forever.
 */
export default function ProjectGadgetTab({
  project,
  gadgetImage,
  gadgetLabel,
  embedded = false,
  viewConfig,
  onCellClick,
  onCellContextMenu,
  extraParams,
}: ProjectGadgetTabProps) {
  const clusterName = project.clusters[0] || '';
  const { connected, isDark } = useIGSetup(clusterName);

  const [timedOut, setTimedOut] = useState(false);
  const [deployStatus, setDeployStatus] = useState<IGDeploymentStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployModalMode, setDeployModalMode] = useState<'deploy' | 'redeploy' | 'undeploy'>(
    'deploy'
  );

  const instanceRef = useRef<string | null>(null);
  const prevConnected = useRef(false);

  // Reset gadget lifecycle when connection drops so we re-run after reconnect
  useEffect(() => {
    if (prevConnected.current && !connected) {
      setDeployStatus(null);
      setChecking(false);
      setStarting(false);
      setError(null);
      setInstanceId(null);
      instanceRef.current = null;
    }
    prevConnected.current = connected;
  }, [connected]);

  // Connection timeout
  useEffect(() => {
    if (connected) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!connected) setTimedOut(true);
    }, CONNECTION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  // --- Deployment check + gadget lifecycle ---

  const checkDeployment = useCallback(async () => {
    if (!clusterName) return;
    setChecking(true);
    setError(null);
    try {
      const res = await requestWithTimeout({
        cmd: 'checkIGDeployment',
        data: { clusterName },
      });
      setDeployStatus(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setChecking(false);
    }
  }, [clusterName]);

  const runGadget = useCallback(async () => {
    if (!clusterName) return;
    setStarting(true);
    setError(null);
    try {
      const info: GadgetInfo = await requestWithTimeout({
        cmd: 'getGadgetInfo',
        data: { url: gadgetImage, clusterName },
      });

      // Find a namespace-related param and set it to project namespaces
      const params: Record<string, string> = {};
      const nsParam = (info.params || []).find(
        (p: any) => p.key && p.key.toLowerCase().includes('namespace')
      );
      if (nsParam && project.namespaces.length > 0) {
        params[nsParam.key] = project.namespaces.join(',');
      }
      if (extraParams) {
        Object.assign(params, extraParams);
      }

      const id = `project-${project.id}-${gadgetLabel
        .toLowerCase()
        .replace(/\s+/g, '-')}-${Date.now()}`;
      await requestWithTimeout({
        cmd: 'runGadget',
        data: { image: gadgetImage, clusterName, params, id },
      });

      instanceRef.current = id;
      setInstanceId(id);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  }, [clusterName, gadgetImage, project.namespaces, project.id, gadgetLabel, extraParams]);

  const stopAndRemoveGadget = useCallback(
    async (id: string) => {
      try {
        await requestWithTimeout({
          cmd: 'stopInstance',
          data: { id },
        });
      } catch {
        // Instance may already be stopped
      }
      try {
        await requestWithTimeout({
          cmd: 'removeInstance',
          data: { id, clusterName },
        });
      } catch {
        // Instance may already be removed
      }
      // Clean up client-side instances store
      delete (instances as any)[id];
    },
    [clusterName]
  );

  const stopGadget = useCallback(async () => {
    const id = instanceRef.current;
    if (!id) return;
    await stopAndRemoveGadget(id);
    instanceRef.current = null;
    setInstanceId(null);
  }, [stopAndRemoveGadget]);

  // Check deployment once connected
  useEffect(() => {
    if (connected && !deployStatus && !checking) {
      checkDeployment();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally trigger only on connected change, not on deployStatus/checking

  // Auto-run gadget once deployment is confirmed
  useEffect(() => {
    if (deployStatus?.deployed && !instanceId && !starting) {
      runGadget();
    }
  }, [deployStatus]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally trigger only on deployStatus change, not on instanceId/starting

  // Stop + remove gadget on unmount
  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        const id = instanceRef.current;
        (apiService as any)
          .request({ cmd: 'stopInstance', data: { id } })
          .catch(() => {})
          .then(() =>
            (apiService as any)
              .request({ cmd: 'removeInstance', data: { id, clusterName } })
              .catch(() => {})
          )
          .then(() => {
            delete (instances as any)[id];
          });
      }
    };
  }, [clusterName]);

  // --- Render ---

  if (!clusterName) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">This project has no clusters configured.</Alert>
      </Box>
    );
  }

  // Not connected yet
  if (!connected) {
    if (timedOut) {
      return (
        <Box sx={{ p: 3 }}>
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Icon icon="mdi:connection" width={48} color="#9e9e9e" />
            <Typography variant="h6" sx={{ mt: 1 }}>
              Cannot Connect to Inspektor Gadget
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1, mb: 2 }}>
              The Inspektor Gadget backend is not responding. Make sure the backend is running and
              Inspektor Gadget is deployed on cluster <strong>{clusterName}</strong>.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<Icon icon="mdi:rocket-launch" />}
              onClick={() => {
                setDeployModalMode('deploy');
                setDeployOpen(true);
              }}
            >
              Deploy Inspektor Gadget
            </Button>

            <DeployModal
              open={deployOpen}
              onClose={() => {
                setDeployOpen(false);
                setDeployStatus(null);
                setTimedOut(false);
              }}
              clusterName={clusterName}
              redeploy={deployModalMode === 'redeploy'}
              undeploy={deployModalMode === 'undeploy'}
            />
          </Paper>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          Connecting to Inspektor Gadget...
        </Typography>
      </Box>
    );
  }

  // Checking deployment
  if (checking) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          Checking Inspektor Gadget deployment...
        </Typography>
      </Box>
    );
  }

  // Not deployed
  if (deployStatus && !deployStatus.deployed) {
    return (
      <Box sx={{ p: 3 }}>
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Icon icon="mdi:alert-circle-outline" width={48} color="#f57c00" />
          <Typography variant="h6" sx={{ mt: 1 }}>
            Inspektor Gadget Not Deployed
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1, mb: 2 }}>
            {gadgetLabel} requires Inspektor Gadget to be deployed on cluster{' '}
            <strong>{clusterName}</strong>.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:rocket-launch" />}
            onClick={() => {
              setDeployModalMode('deploy');
              setDeployOpen(true);
            }}
          >
            Deploy Inspektor Gadget
          </Button>

          <DeployModal
            open={deployOpen}
            onClose={() => {
              setDeployOpen(false);
              setDeployStatus(null);
            }}
            clusterName={clusterName}
            redeploy={deployModalMode === 'redeploy'}
            undeploy={deployModalMode === 'undeploy'}
          />
        </Paper>
      </Box>
    );
  }

  // Error
  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={runGadget}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  // Starting gadget
  if (starting || !instanceId) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          Starting {gadgetLabel.toLowerCase()} gadget...
        </Typography>
      </Box>
    );
  }

  // Gadget running — show output
  return (
    <Box
      className={isDark ? 'dark' : undefined}
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {/* Toolbar — hidden in embedded mode */}
      {!embedded && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="textSecondary" sx={{ flex: 1 }}>
            {gadgetLabel} &middot; {project.namespaces.join(', ') || 'all namespaces'}
          </Typography>
          <Button size="small" startIcon={<Icon icon="mdi:stop" />} onClick={stopGadget}>
            Stop
          </Button>
          <Button
            size="small"
            startIcon={<Icon icon="mdi:refresh" />}
            onClick={async () => {
              await stopGadget();
              runGadget();
            }}
          >
            Restart
          </Button>
        </Box>
      )}

      {/* Gadget output */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <SvelteWrapper
            component={GadgetWrapper}
            instanceID={instanceId}
            viewConfig={viewConfig}
            onCellClick={onCellClick}
            onCellContextMenu={onCellContextMenu}
          />
        </Box>
      </Box>
    </Box>
  );
}
