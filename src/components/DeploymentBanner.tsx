import { Icon } from '@iconify/react';
import type { IGDeploymentStatus } from '@inspektor-gadget/ig-desktop/frontend';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, IconButton, Typography } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { checkDeploymentStatus } from '../utils/api-request';
import DeployModal from './DeployModal';

export default function DeploymentBanner({ clusterName }: { clusterName: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<IGDeploymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'deploy' | 'redeploy' | 'undeploy'>('deploy');

  const checkStatus = useCallback(async () => {
    if (!clusterName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await checkDeploymentStatus(clusterName);
      setStatus(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [clusterName]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleModalClose = () => {
    setDeployOpen(false);
    checkStatus();
  };

  const openModal = (mode: 'deploy' | 'redeploy' | 'undeploy') => {
    setModalMode(mode);
    setDeployOpen(true);
  };

  if (dismissed) return null;

  if (loading) {
    return (
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}
        role="status"
        aria-live="polite"
      >
        <CircularProgress size={16} />
        <Typography variant="body2" color="textSecondary">
          {t('Checking deployment status...')}
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert
        severity="error"
        sx={{ mb: 2 }}
        action={
          <Button size="small" onClick={checkStatus}>
            {t('Retry')}
          </Button>
        }
      >
        {t('Failed to check IG deployment: {{error}}', { error })}
      </Alert>
    );
  }

  if (!status) return null;

  return (
    <>
      <Alert
        severity={status.deployed ? 'success' : 'warning'}
        sx={{ mb: 2 }}
        icon={
          <Icon
            icon={status.deployed ? 'mdi:check-circle' : 'mdi:alert'}
            width={22}
            aria-hidden="true"
          />
        }
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {!status.deployed && (
              <Button
                size="small"
                color="inherit"
                startIcon={<Icon icon="mdi:rocket-launch" width={16} aria-hidden="true" />}
                onClick={() => openModal('deploy')}
              >
                {t('Deploy')}
              </Button>
            )}
            {status.deployed && (
              <>
                <Button size="small" color="inherit" onClick={() => openModal('redeploy')}>
                  {t('Redeploy')}
                </Button>
                <Button size="small" color="inherit" onClick={() => openModal('undeploy')}>
                  {t('Undeploy')}
                </Button>
              </>
            )}
            <IconButton size="small" onClick={() => setDismissed(true)} aria-label={t('Dismiss')}>
              <Icon icon="mdi:close" width={16} aria-hidden="true" />
            </IconButton>
          </Box>
        }
      >
        {status.deployed
          ? status.namespace && status.version
            ? t('Insights Agent deployed in namespace {{namespace}} ({{version}})', {
                namespace: status.namespace,
                version: status.version,
              })
            : status.namespace
            ? t('Insights Agent deployed in namespace {{namespace}}', {
                namespace: status.namespace,
              })
            : status.version
            ? t('Insights Agent deployed ({{version}})', { version: status.version })
            : t('Insights Agent deployed')
          : t('Insights Agent is not deployed on this cluster')}
      </Alert>

      <DeployModal
        open={deployOpen}
        onClose={handleModalClose}
        clusterName={clusterName}
        redeploy={modalMode === 'redeploy'}
        undeploy={modalMode === 'undeploy'}
      />
    </>
  );
}
