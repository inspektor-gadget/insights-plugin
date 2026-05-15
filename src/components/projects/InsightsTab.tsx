import { Icon } from '@iconify/react';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { checkDeploymentStatus } from '../../utils/api-request';
import { resetConnection } from '../../utils/shared-connection';
import DeployModal from '../DeployModal';
import DnsTab from './DnsTab';
import NetworkTab from './NetworkTab';
import ProcessesTab from './ProcessesTab';

type View = 'landing' | 'processes' | 'network' | 'dns';

interface InsightsTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

const CARDS: { view: View; icon: string; title: string; description: string }[] = [
  {
    view: 'processes',
    icon: 'mdi:application-cog',
    title: 'Processes',
    description: 'Explore running processes to spot unexpected or resource-heavy activity.',
  },
  {
    view: 'network',
    icon: 'mdi:lan-connect',
    title: 'Trace TCP',
    description: 'Understand how pods in this project communicate over the network.',
  },
  {
    view: 'dns',
    icon: 'mdi:dns-outline',
    title: 'Trace DNS',
    description: 'Understand how pods in this project communicate over the network.',
  },
];

export default function InsightsTab({ project }: InsightsTabProps) {
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

  // Reset to landing when the user clicks the "Insights" tab while already on it
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const tab = (e.target as HTMLElement).closest('[role="tab"]');
      // Hacky way to get back to the landing page
      if (tab && tab.textContent?.trim().startsWith('Insights')) {
        setView('landing');
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  if (view === 'landing') {
    if (loading) {
      return (
        <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Checking deployment status…
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
                Retry
              </Button>
            }
          >
            Failed to check Insights Agent deployment: {error}
          </Alert>
        </Box>
      );
    }

    if (!deployed) {
      return (
        <Box sx={{ p: 3 }}>
          <Paper sx={{ p: 3, maxWidth: 520, border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Icon icon="mdi:alert-circle-outline" width={28} color="inherit" />
              <Typography variant="h6">Insights Agent Not Deployed</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Insights Agent must be deployed on this cluster before you can use Insights. Deploy it
              now to start monitoring processes, network traffic, and DNS queries.
            </Typography>
            <Button
              variant="contained"
              startIcon={<Icon icon="mdi:rocket-launch" width={18} />}
              onClick={() => setDeployOpen(true)}
            >
              Deploy Insights Agent
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
        {CARDS.map(card => (
          <Paper
            key={card.view}
            onClick={() => setView(card.view)}
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
            }}
          >
            <Icon icon={card.icon} width={36} />
            <Typography variant="h6" sx={{ mt: 1 }}>
              {card.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {card.description}
            </Typography>
          </Paper>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {view === 'processes' && <ProcessesTab project={project} />}
      {view === 'network' && <NetworkTab project={project} />}
      {view === 'dns' && <DnsTab project={project} />}
    </Box>
  );
}
