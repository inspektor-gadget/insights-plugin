import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { INSIGHTS_TAB_LABEL } from '../../index';
import { checkDeploymentStatus } from '../../utils/api-request';
import { resetConnection } from '../../utils/shared-connection';
import DeployModal from '../DeployModal';
import DnsTab from './DnsTab';
import NetworkTab from './NetworkTab';
import ProcessesTab from './ProcessesTab';
import ProfileCudaTab from './ProfileCudaTab';
import TopCudaMemoryTab from './TopCudaMemoryTab';

type View = 'landing' | 'processes' | 'network' | 'dns' | 'top-cuda-memory' | 'profile-cuda';

interface InsightsTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

const CARDS: { view: View; icon: string; titleKey: string; descriptionKey: string }[] = [
  {
    view: 'processes',
    icon: 'mdi:application-cog',
    titleKey: 'Processes',
    descriptionKey: 'Explore running processes to spot unexpected or resource-heavy activity.',
  },
  {
    view: 'network',
    icon: 'mdi:lan-connect',
    titleKey: 'Trace TCP',
    descriptionKey: 'Understand how pods in this project communicate over the network.',
  },
  {
    view: 'dns',
    icon: 'mdi:dns-outline',
    titleKey: 'Trace DNS',
    descriptionKey: 'Inspect DNS queries issued by pods in this project.',
  },
  {
    view: 'top-cuda-memory',
    icon: 'mdi:expansion-card-variant',
    titleKey: 'Top CUDA Memory',
    descriptionKey:
      'Track CUDA memory allocations and frees per process, by library and memory class.',
  },
  {
    view: 'profile-cuda',
    icon: 'mdi:fire',
    titleKey: 'Profile CUDA',
    descriptionKey: 'Profile CUDA memory allocations as a flamegraph across the project.',
  },
];

export default function InsightsTab({ project }: InsightsTabProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('landing');
  const [deployed, setDeployed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

  const clusterName = project.clusters[0];

  const checkStatus = useCallback(async () => {
    if (!clusterName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await checkDeploymentStatus(clusterName);
      setDeployed(res.deployed);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [clusterName]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleModalClose = async () => {
    setDeployOpen(false);
    // Re-check deployment. If IG is now deployed, reset the shared WS connection
    // so that ProjectGadgetTab gets a fresh adapter that can find the new gadget pod.
    setLoading(true);
    setError(null);
    try {
      const res = await checkDeploymentStatus(clusterName);
      if (res.deployed && !deployed) {
        resetConnection();
      }
      setDeployed(res.deployed);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // Reset to landing when the user clicks the "Insights (Preview)" tab while already on it.
  // We match on the tab label since Headlamp's MUI Tab component doesn't expose the tab id
  // as a DOM attribute. If the tab label changes, update INSIGHTS_TAB_LABEL in index.tsx.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const tab = (e.target as HTMLElement).closest('[role="tab"]');
      if (tab && tab.textContent?.trim() === INSIGHTS_TAB_LABEL) {
        setView('landing');
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  if (view === 'landing') {
    if (loading) {
      return (
        <Box
          sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1 }}
          role="status"
          aria-live="polite"
        >
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            {t('Checking deployment status…')}
          </Typography>
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button size="small" onClick={checkStatus}>
                {t('Retry')}
              </Button>
            }
          >
            {t('Failed to check Insights Agent deployment: {{error}}', { error })}
          </Alert>
        </Box>
      );
    }

    if (!deployed) {
      return (
        <Box sx={{ p: 3 }}>
          <Paper sx={{ p: 3, maxWidth: 520, border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Icon icon="mdi:alert-circle-outline" width={28} color="inherit" aria-hidden="true" />
              <Typography variant="h6">{t('Insights Agent Not Deployed')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t(
                'Insights Agent must be deployed on this cluster before you can use Insights. Deploy it now to start monitoring processes, network traffic, and DNS queries.'
              )}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Icon icon="mdi:rocket-launch" width={18} aria-hidden="true" />}
              onClick={() => setDeployOpen(true)}
            >
              {t('Deploy Insights Agent')}
            </Button>
          </Paper>

          <DeployModal
            open={deployOpen}
            onClose={handleModalClose}
            clusterName={clusterName}
            redeploy={false}
            undeploy={false}
          />
        </Box>
      );
    }

    return (
      <Box sx={{ p: 3, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {CARDS.map(card => {
          const title = t(card.titleKey);
          const description = t(card.descriptionKey);
          const activate = () => setView(card.view);
          return (
            <Paper
              key={card.view}
              role="button"
              tabIndex={0}
              aria-label={t('Open {{title}}: {{description}}', { title, description })}
              onClick={activate}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate();
                }
              }}
              sx={{
                p: 3,
                width: 280,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: 'divider',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  boxShadow: 3,
                },
                '&:focus-visible': {
                  outline: 'none',
                  borderColor: 'primary.main',
                  boxShadow: theme => `0 0 0 2px ${theme.palette.primary.main}`,
                },
              }}
            >
              <Icon icon={card.icon} width={36} aria-hidden="true" />
              <Typography variant="h6" sx={{ mt: 1 }}>
                {title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            </Paper>
          );
        })}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {view === 'processes' && <ProcessesTab project={project} />}
      {view === 'network' && <NetworkTab project={project} />}
      {view === 'dns' && <DnsTab project={project} />}
      {view === 'top-cuda-memory' && <TopCudaMemoryTab project={project} />}
      {view === 'profile-cuda' && <ProfileCudaTab project={project} />}
    </Box>
  );
}
