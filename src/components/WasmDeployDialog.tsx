/**
 * React-native deploy dialog for WASM mode.
 * Replaces the Svelte DeployModalWrapper when there's no Go backend.
 */
import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Typography,
  Box,
  LinearProgress,
  Alert,
  IconButton,
  Divider,
  Paper,
} from '@mui/material';
import { Icon } from '@iconify/react';
import {
  deployIG,
  undeployIG,
  DEFAULT_CONFIG,
  CHART_VERSION,
  APP_VERSION,
} from '../deploy/ig-deploy';
import type { DeployConfig, OtelExporter, DeployProgress } from '../deploy/ig-deploy';

interface WasmDeployDialogProps {
  open: boolean;
  onClose: () => void;
  clusterName: string;
  redeploy?: boolean;
  undeploy?: boolean;
}

type Phase = 'form' | 'progress' | 'done' | 'error';

export default function WasmDeployDialog({
  open,
  onClose,
  clusterName,
  redeploy = false,
  undeploy = false,
}: WasmDeployDialogProps) {
  const [config, setConfig] = useState<DeployConfig>({ ...DEFAULT_CONFIG });
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<DeployProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = undeploy ? 'undeploy' : redeploy ? 'redeploy' : 'deploy';

  const handleDeploy = useCallback(async () => {
    setPhase('progress');
    setError(null);

    const onProgress = (p: DeployProgress) => {
      setProgress({ ...p });
      if (p.error) {
        setError(p.error);
        setPhase('error');
      } else if (p.progress === 100) {
        setPhase('done');
      }
    };

    try {
      if (mode === 'undeploy') {
        await undeployIG(clusterName, config.namespace, onProgress);
      } else if (mode === 'redeploy') {
        // Undeploy first, then deploy
        await undeployIG(clusterName, config.namespace, (p) => {
          onProgress({
            ...p,
            // Scale undeploy progress to 0-50%
            progress: Math.round(p.progress / 2),
            message: `[Undeploy] ${p.message}`,
          });
        });
        await deployIG(config, clusterName, (p) => {
          onProgress({
            ...p,
            // Scale deploy progress to 50-100%
            progress: 50 + Math.round(p.progress / 2),
            message: `[Deploy] ${p.message}`,
          });
        });
      } else {
        await deployIG(config, clusterName, onProgress);
      }
    } catch (err: any) {
      if (phase !== 'error') {
        setError(err?.message || String(err));
        setPhase('error');
      }
    }
  }, [mode, config, clusterName]);

  const title = mode === 'undeploy'
    ? 'Undeploy Inspektor Gadget'
    : mode === 'redeploy'
      ? 'Redeploy Inspektor Gadget'
      : 'Deploy Inspektor Gadget';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {phase === 'form' && (
          <DeployForm
            config={config}
            setConfig={setConfig}
            mode={mode}
          />
        )}
        {(phase === 'progress' || phase === 'done' || phase === 'error') && (
          <ProgressView progress={progress} error={error} phase={phase} />
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'form' && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              color={mode === 'undeploy' ? 'error' : 'primary'}
              onClick={handleDeploy}
            >
              {mode === 'undeploy' ? 'Undeploy' : mode === 'redeploy' ? 'Redeploy' : 'Deploy'}
            </Button>
          </>
        )}
        {(phase === 'done' || phase === 'error') && (
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deploy form
// ---------------------------------------------------------------------------

function DeployForm({
  config,
  setConfig,
  mode,
}: {
  config: DeployConfig;
  setConfig: (c: DeployConfig) => void;
  mode: string;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="textSecondary">
        Chart version: {CHART_VERSION} (app: {APP_VERSION})
      </Typography>

      <TextField
        label="Namespace"
        value={config.namespace}
        onChange={(e) => setConfig({ ...config, namespace: e.target.value })}
        size="small"
        fullWidth
        disabled={mode === 'undeploy'}
      />

      {mode !== 'undeploy' && (
        <>
          <FormControlLabel
            control={
              <Switch
                checked={config.verifyImage}
                onChange={(e) => setConfig({ ...config, verifyImage: e.target.checked })}
              />
            }
            label="Verify Image Signatures"
          />

          <Divider />

          <ExporterSection
            title="OTel Log Exporters"
            exporters={config.otelLogExporters}
            onChange={(exporters) => setConfig({ ...config, otelLogExporters: exporters })}
            showMetricsFields={false}
          />

          <Divider />

          <ExporterSection
            title="OTel Metric Exporters"
            exporters={config.otelMetricExporters}
            onChange={(exporters) => setConfig({ ...config, otelMetricExporters: exporters })}
            showMetricsFields={true}
          />

          <Divider />

          <FormControlLabel
            control={
              <Switch
                checked={config.prometheusListen}
                onChange={(e) => setConfig({ ...config, prometheusListen: e.target.checked })}
              />
            }
            label="Prometheus Metrics Listener"
          />

          {config.prometheusListen && (
            <TextField
              label="Listen Address"
              value={config.prometheusListenAddress}
              onChange={(e) => setConfig({ ...config, prometheusListenAddress: e.target.value })}
              size="small"
              fullWidth
              placeholder="0.0.0.0:2224"
            />
          )}
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Exporter editor
// ---------------------------------------------------------------------------

function ExporterSection({
  title,
  exporters,
  onChange,
  showMetricsFields,
}: {
  title: string;
  exporters: OtelExporter[];
  onChange: (exporters: OtelExporter[]) => void;
  showMetricsFields: boolean;
}) {
  const addExporter = () => {
    onChange([
      ...exporters,
      {
        name: `exporter-${exporters.length + 1}`,
        endpoint: '',
        insecure: false,
        ...(showMetricsFields
          ? { temporality: 'cumulative', interval: 60, collectGoMetrics: false, collectIGMetrics: false }
          : { compression: '' }),
      },
    ]);
  };

  const removeExporter = (idx: number) => {
    onChange(exporters.filter((_, i) => i !== idx));
  };

  const updateExporter = (idx: number, updates: Partial<OtelExporter>) => {
    onChange(exporters.map((exp, i) => (i === idx ? { ...exp, ...updates } : exp)));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        <IconButton size="small" onClick={addExporter}>
          <Icon icon="mdi:plus-circle-outline" width={20} />
        </IconButton>
      </Box>

      {exporters.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          No exporters configured
        </Typography>
      )}

      {exporters.map((exp, idx) => (
        <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <TextField
              label="Name"
              value={exp.name}
              onChange={(e) => updateExporter(idx, { name: e.target.value })}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Endpoint"
              value={exp.endpoint}
              onChange={(e) => updateExporter(idx, { endpoint: e.target.value })}
              size="small"
              sx={{ flex: 2 }}
              placeholder="localhost:4317"
            />
            <IconButton size="small" onClick={() => removeExporter(idx)} color="error">
              <Icon icon="mdi:delete-outline" width={20} />
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={exp.insecure ?? false}
                  onChange={(e) => updateExporter(idx, { insecure: e.target.checked })}
                />
              }
              label="Insecure"
            />

            {!showMetricsFields && (
              <TextField
                label="Compression"
                value={exp.compression ?? ''}
                onChange={(e) => updateExporter(idx, { compression: e.target.value })}
                size="small"
                sx={{ width: 140 }}
                placeholder="gzip"
              />
            )}

            {showMetricsFields && (
              <>
                <TextField
                  label="Temporality"
                  value={exp.temporality ?? 'cumulative'}
                  onChange={(e) => updateExporter(idx, { temporality: e.target.value })}
                  size="small"
                  sx={{ width: 140 }}
                />
                <TextField
                  label="Interval (s)"
                  type="number"
                  value={exp.interval ?? 60}
                  onChange={(e) => updateExporter(idx, { interval: Number(e.target.value) })}
                  size="small"
                  sx={{ width: 100 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={exp.collectGoMetrics ?? false}
                      onChange={(e) => updateExporter(idx, { collectGoMetrics: e.target.checked })}
                    />
                  }
                  label="Go Metrics"
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={exp.collectIGMetrics ?? false}
                      onChange={(e) => updateExporter(idx, { collectIGMetrics: e.target.checked })}
                    />
                  }
                  label="IG Metrics"
                />
              </>
            )}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Progress view
// ---------------------------------------------------------------------------

function ProgressView({
  progress,
  error,
  phase,
}: {
  progress: DeployProgress | null;
  error: string | null;
  phase: Phase;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 120 }}>
      {progress && (
        <>
          <LinearProgress
            variant="determinate"
            value={progress.progress}
            color={phase === 'error' ? 'error' : phase === 'done' ? 'success' : 'primary'}
          />
          <Typography variant="body2">
            {progress.message}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            Step: {progress.step} ({progress.progress}%)
          </Typography>
        </>
      )}

      {error && (
        <Alert severity="error">{error}</Alert>
      )}

      {phase === 'done' && (
        <Alert severity="success">Operation completed successfully.</Alert>
      )}
    </Box>
  );
}
