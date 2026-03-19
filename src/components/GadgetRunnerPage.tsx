import { Icon } from '@iconify/react';
import type {
  GadgetInfo,
  GadgetInstanceData,
  GadgetParam,
} from '@inspektor-gadget/ig-desktop/frontend';
import { instances } from '@inspektor-gadget/ig-desktop/frontend';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { requestWithTimeout } from '../utils/api-request';
import DeploymentBanner from './DeploymentBanner';
import IGPluginProvider from './IGPluginProvider';

/** Parameter form for a gadget's configurable params */
function ParamForm({
  params,
  values,
  onChange,
}: {
  params: GadgetParam[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  // Filter to user-facing params (skip internal/hidden ones)
  const userParams = params.filter(p => {
    const tags = p.tags || [];
    return !tags.includes('hidden');
  });

  if (userParams.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        This gadget has no configurable parameters.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {userParams.map(param => (
        <TextField
          key={param.key}
          label={param.title || param.key}
          helperText={param.description}
          value={values[param.key] || param.defaultValue || ''}
          onChange={e => onChange(param.key, e.target.value)}
          size="small"
          fullWidth
          placeholder={param.defaultValue || ''}
        />
      ))}
    </Box>
  );
}

/** List of currently running gadget instances */
function RunningInstances({ clusterName }: { clusterName: string }) {
  const history = useHistory();
  const instanceList = Object.entries(instances as Record<string, GadgetInstanceData>).filter(
    ([, inst]) => inst.environment === clusterName
  );

  if (instanceList.length === 0) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" gutterBottom>
        Running Instances
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {instanceList.map(([id, inst]) => (
          <Paper
            key={id}
            variant="outlined"
            sx={{
              p: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
            }}
            onClick={() => history.push(`/c/${clusterName}/ig/instance/${id}`)}
          >
            <Box>
              <Typography variant="body2" fontWeight={500}>
                {inst.name || inst.gadgetInfo?.imageName || id}
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {inst.running ? 'Running' : 'Stopped'} &middot; {inst.eventCount ?? 0} events
              </Typography>
            </Box>
            <Chip
              size="small"
              color={inst.running ? 'success' : 'default'}
              label={inst.running ? 'Running' : 'Stopped'}
            />
          </Paper>
        ))}
      </Box>
    </Box>
  );
}

export default function GadgetRunnerPage() {
  const cluster = K8s.useCluster();
  const history = useHistory();

  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gadgetInfo, setGadgetInfo] = useState<GadgetInfo | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const clusterName = cluster || '';

  const fetchGadgetInfo = useCallback(async () => {
    if (!image.trim()) return;
    setLoading(true);
    setError(null);
    setGadgetInfo(null);
    setParamValues({});

    try {
      const res = await requestWithTimeout({
        cmd: 'getGadgetInfo',
        data: { url: image.trim(), clusterName },
      });
      setGadgetInfo(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [image, clusterName]);

  const runGadget = useCallback(async () => {
    if (!gadgetInfo) return;
    setRunning(true);
    setError(null);

    try {
      const instanceId = `ig-${Date.now()}`;
      // Build params: only include non-empty values that differ from defaults
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(paramValues)) {
        if (value.trim()) {
          params[key] = value.trim();
        }
      }

      const res = await requestWithTimeout({
        cmd: 'runGadget',
        data: { image: image.trim(), clusterName, params, id: instanceId },
      });

      const resultId = res?.id || instanceId;
      history.push(`/c/${clusterName}/ig/instance/${resultId}`);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  }, [gadgetInfo, image, clusterName, paramValues, history]);

  const handleParamChange = useCallback((key: string, value: string) => {
    setParamValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const gadgetParams = gadgetInfo?.params || [];

  return (
    <>
      <Box sx={{ maxWidth: 800, mx: 'auto', px: 2, pt: 2 }}>
        <DeploymentBanner clusterName={clusterName} />
      </Box>
      <IGPluginProvider clusterName={clusterName}>
        <Box sx={{ maxWidth: 800, mx: 'auto', p: 2 }}>
          <Typography variant="h5" gutterBottom>
            Run Gadget
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
            Enter a gadget image URL to inspect your cluster with Inspektor Gadget.
          </Typography>

          {/* Image input */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              label="Gadget Image"
              placeholder="ghcr.io/inspektor-gadget/gadget/trace_exec:latest"
              value={image}
              onChange={e => setImage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') fetchGadgetInfo();
              }}
              fullWidth
              size="small"
            />
            <Button
              variant="contained"
              onClick={fetchGadgetInfo}
              disabled={!image.trim() || loading}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {loading ? <CircularProgress size={20} /> : 'Load Info'}
            </Button>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Gadget info + params */}
          {gadgetInfo && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Icon icon="mdi:bug-outline" width={20} />
                <Typography variant="subtitle1" fontWeight={600}>
                  {gadgetInfo.imageName || image}
                </Typography>
              </Box>

              {/* Datasources info */}
              {(gadgetInfo.datasources || gadgetInfo.dataSources) && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="textSecondary">
                    Datasources:{' '}
                    {(gadgetInfo.datasources || gadgetInfo.dataSources || [])
                      .map(ds => ds.name)
                      .join(', ')}
                  </Typography>
                </Box>
              )}

              <Divider sx={{ my: 1.5 }} />

              {/* Parameters */}
              <Typography variant="subtitle2" gutterBottom>
                Parameters
              </Typography>
              <ParamForm params={gadgetParams} values={paramValues} onChange={handleParamChange} />

              <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={runGadget}
                  disabled={running}
                  startIcon={running ? <CircularProgress size={16} /> : <Icon icon="mdi:play" />}
                >
                  {running ? 'Starting...' : 'Run Gadget'}
                </Button>
              </Box>
            </Paper>
          )}

          {/* Running instances */}
          <RunningInstances clusterName={clusterName} />
        </Box>
      </IGPluginProvider>
    </>
  );
}
