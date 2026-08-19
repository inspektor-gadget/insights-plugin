import { Icon } from '@iconify/react';
import type {
  CellClickHandler,
  CellContextMenuHandler,
  GadgetInfo,
  IGDeploymentStatus,
  ViewConfig,
} from '@inspektor-gadget/ig-desktop/frontend';
import { GadgetWrapper, instances } from '@inspektor-gadget/ig-desktop/frontend';
import { SvelteWrapper } from '@inspektor-gadget/ig-desktop/frontend/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIGLanguageSync } from '../../hooks/useIGLanguageSync';
import { useIGSetup } from '../../hooks/useIGSetup';
import { useIGToastBridge } from '../../hooks/useIGToastBridge';
import { requestWithTimeout } from '../../utils/api-request';
import { applyInstanceColumnDefaults } from '../../utils/gadget-columns';
import { registerK8sAnnotations } from '../../utils/k8s-annotations';
import DeployModal from '../DeployModal';

const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Controls which snackbars a stop+remove call emits.
 *
 * - `silent`: never toast (currently unused — kept for parity with the
 *   IG Desktop policy where some flows must remain quiet).
 * - `success+error`: toast on either outcome (default for explicit user
 *   actions like the toolbar Stop button and for the unmount/navigation
 *   cleanup, so the user always gets feedback when a collector winds
 *   down).
 * - `error-only`: only toast on failure (e.g. Restart, where a success
 *   toast would step on the immediately-following "starting" UI).
 */
type StopNotify = 'silent' | 'success+error' | 'error-only';

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
  /** Additional fields hidden by default but available from the column menu */
  defaultHiddenFields?: string[];
  /** Tooltip text keyed by field name */
  fieldDescriptions?: Record<string, string>;
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
  defaultHiddenFields,
  fieldDescriptions,
}: ProjectGadgetTabProps) {
  const { t } = useTranslation();
  const clusterName = project.clusters[0] || '';
  const { connected, isDark } = useIGSetup(clusterName);
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  // Mirror Headlamp's language into the embedded IG Desktop UI.
  useIGLanguageSync();

  // Forward IG Desktop toasts into Headlamp's snackbar.
  useIGToastBridge();

  useEffect(() => registerK8sAnnotations(), []);

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

  // Capture enqueueSnackbar in a ref so the async unmount cleanup
  // (which fires after the component has torn down) can still surface
  // toasts. The notistack hook returns a stable function from the
  // app-level <SnackbarProvider>, so storing it via ref is safe.
  const enqueueSnackbarRef = useRef(enqueueSnackbar);
  enqueueSnackbarRef.current = enqueueSnackbar;
  const closeSnackbarRef = useRef(closeSnackbar);
  closeSnackbarRef.current = closeSnackbar;
  // gadgetLabel may be passed as a translated string; capture it too so
  // the unmount cleanup interpolates the user-visible label even if the
  // parent has already unmounted (and i18n strings have changed).
  const gadgetLabelRef = useRef(gadgetLabel);
  gadgetLabelRef.current = gadgetLabel;
  const tRef = useRef(t);
  tRef.current = t;

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

      // Derive a stable, locale-independent slug from the gadget image name.
      // This ensures the instance ID remains consistent regardless of UI language.
      // Example: 'ghcr.io/inspektor-gadget/gadget/top_cuda_memory:latest' → 'top_cuda_memory'
      const slug = (gadgetImage.split('/').pop()?.split(':')[0] ?? 'gadget')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');
      const id = `project-${project.id}-${slug}-${Date.now()}`;
      // The gRPC backend (non-WASM) requires a canonical 32-hex-char
      // instance ID for stop/remove. When we pass a friendly string as
      // `id`, the backend treats it as a *name* and returns its own
      // generated ID in the response. Capture that ID — using the
      // friendly string for `removeInstance` would fail with
      // "invalid gadget instance id". The WASM bridge echoes the local
      // id back as `{ id }`, so the same code path works there too.
      const res = await requestWithTimeout({
        cmd: 'runGadget',
        data: { image: gadgetImage, clusterName, params, id },
      });
      const instanceID = res?.id || id;
      await applyInstanceColumnDefaults(instances as any, instanceID, {
        hiddenFields: defaultHiddenFields,
        descriptions: fieldDescriptions,
      });

      instanceRef.current = instanceID;
      setInstanceId(instanceID);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  }, [
    clusterName,
    gadgetImage,
    project.namespaces,
    project.id,
    extraParams,
    defaultHiddenFields,
    fieldDescriptions,
  ]);

  /**
   * Stop a gadget instance and clean it up from the client-side store,
   * optionally surfacing snackbars for success and/or failure.
   *
   * This mirrors IG Desktop's own `closeInstance` semantics: for
   * non-detached runs the instance lives only in IG Desktop's local
   * `instanceManager`, not on the gadget pod, so we only need to call
   * `stopInstance` and then drop the client-side entry. (Calling
   * `removeInstance` against the gRPC backend with a non-canonical id
   * fails with "invalid gadget instance id" — and would be wrong even
   * with a canonical id, since the instance was never persisted there.)
   *
   * Implementation note: the function reads `enqueueSnackbar`,
   * `gadgetLabel`, and `t` from refs so the unmount cleanup (which
   * resolves after the component is gone) still gets the latest
   * values without retaining a stale closure.
   */
  const stopAndRemoveGadget = useCallback(
    async (
      id: string,
      options: { notify?: StopNotify; retry?: () => void } = {}
    ): Promise<void> => {
      const notify = options.notify ?? 'success+error';
      const enqueue = enqueueSnackbarRef.current;
      const tt = tRef.current;
      const label = gadgetLabelRef.current;
      let failed = false;
      let failureMessage = '';

      try {
        await requestWithTimeout({
          cmd: 'stopInstance',
          data: { id },
        });
      } catch (err: any) {
        failed = true;
        failureMessage = err?.message || String(err);
      }

      // Drop the client-side entry only on a successful stop. If the
      // stop call failed (e.g. transient network error), keep the local
      // entry around so the user can retry from the snackbar action.
      if (!failed) {
        delete (instances as any)[id];
      }

      if (notify === 'silent') return;

      if (failed) {
        enqueue(
          tt('Failed to stop Insights collector "{{label}}": {{error}}', {
            label,
            error: failureMessage,
          }),
          {
            variant: 'error',
            action: options.retry
              ? key => (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      closeSnackbarRef.current(key);
                      options.retry?.();
                    }}
                  >
                    {tt('Retry')}
                  </Button>
                )
              : undefined,
          }
        );
        return;
      }

      if (notify === 'success+error') {
        enqueue(tt('Insights collector "{{label}}" stopped successfully', { label }), {
          variant: 'success',
        });
      }
    },
    []
  );

  const stopGadget = useCallback(
    async (notify: StopNotify = 'success+error') => {
      const id = instanceRef.current;
      if (!id) return;
      // Capture id in the retry closure so it works even after we clear
      // instanceRef below. Retry self-references for repeated failures
      // and inherits the same notification policy.
      const retry: () => void = () => {
        stopAndRemoveGadget(id, { notify, retry });
      };
      await stopAndRemoveGadget(id, { notify, retry });
      instanceRef.current = null;
      setInstanceId(null);
    },
    [stopAndRemoveGadget]
  );

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

  // Stop + remove gadget on unmount.
  // Same toast policy as the toolbar Stop button: success and error
  // both surface, so the user always gets feedback when an Insights
  // collector winds down (including card switches inside the Insights
  // project tab).
  useEffect(() => {
    return () => {
      const id = instanceRef.current;
      if (!id) return;
      stopAndRemoveGadget(id, { notify: 'success+error' }).catch(() => {
        // stopAndRemoveGadget already surfaces failures via snackbar.
      });
    };
  }, [clusterName, stopAndRemoveGadget]);

  // --- Render ---

  if (!clusterName) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{t('This project has no clusters configured.')}</Alert>
      </Box>
    );
  }

  // Not connected yet
  if (!connected) {
    if (timedOut) {
      return (
        <Box sx={{ p: 3 }}>
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Box sx={{ color: 'text.disabled' }}>
              <Icon icon="mdi:connection" width={48} aria-hidden="true" />
            </Box>
            <Typography variant="h6" sx={{ mt: 1 }}>
              {t('Cannot Connect to Insights Agent')}
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 1, mb: 2 }}>
              {t(
                'The Insights Agent backend is not responding. Make sure the backend is running and Insights Agent is deployed on cluster {{cluster}}.',
                { cluster: clusterName }
              )}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<Icon icon="mdi:rocket-launch" aria-hidden="true" />}
              onClick={() => {
                setDeployModalMode('deploy');
                setDeployOpen(true);
              }}
            >
              {t('Deploy Insights Agent')}
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

  // Checking deployment
  if (checking) {
    return (
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}
        role="status"
        aria-live="polite"
      >
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          {t('Checking Insights Agent deployment...')}
        </Typography>
      </Box>
    );
  }

  // Not deployed
  if (deployStatus && !deployStatus.deployed) {
    return (
      <Box sx={{ p: 3 }}>
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Box sx={{ color: 'warning.main' }}>
            <Icon icon="mdi:alert-circle-outline" width={48} aria-hidden="true" />
          </Box>
          <Typography variant="h6" sx={{ mt: 1 }}>
            {t('Insights Agent Not Deployed')}
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1, mb: 2 }}>
            {t('{{label}} requires Insights Agent to be deployed on cluster {{cluster}}.', {
              label: gadgetLabel,
              cluster: clusterName,
            })}
          </Typography>
          <Button
            variant="contained"
            startIcon={<Icon icon="mdi:rocket-launch" aria-hidden="true" />}
            onClick={() => {
              setDeployModalMode('deploy');
              setDeployOpen(true);
            }}
          >
            {t('Deploy Insights Agent')}
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
              {t('Retry')}
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
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 3 }}
        role="status"
        aria-live="polite"
      >
        <CircularProgress size={20} />
        <Typography variant="body2" color="textSecondary">
          {t('Starting {{label}} gadget...', { label: gadgetLabel.toLowerCase() })}
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
            {gadgetLabel} &middot; {project.namespaces.join(', ') || t('all namespaces')}
          </Typography>
          <Button
            size="small"
            startIcon={<Icon icon="mdi:stop" aria-hidden="true" />}
            onClick={() => stopGadget('success+error')}
          >
            {t('Stop')}
          </Button>
          <Button
            size="small"
            startIcon={<Icon icon="mdi:refresh" aria-hidden="true" />}
            onClick={async () => {
              // Restart: suppress the stop success toast (a new run
              // starts immediately) but still surface stop failures.
              await stopGadget('error-only');
              runGadget();
            }}
          >
            {t('Restart')}
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
