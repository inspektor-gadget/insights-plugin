import { Icon } from '@iconify/react';
import { GadgetWrapper } from '@inspektor-gadget/ig-desktop/frontend';
import { SvelteWrapper } from '@inspektor-gadget/ig-desktop/frontend/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useHistory, useParams } from 'react-router-dom';
import DeploymentBanner from './DeploymentBanner';
import IGPluginProvider from './IGPluginProvider';

export default function GadgetViewPage() {
  const { instanceID } = useParams<{ instanceID: string }>();
  const cluster = K8s.useCluster();
  const history = useHistory();
  const clusterName = cluster || '';

  return (
    <>
      <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
        <DeploymentBanner clusterName={clusterName} />
      </Box>
      <IGPluginProvider clusterName={clusterName}>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header bar */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1,
              borderBottom: 1,
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <Tooltip title="Back to Gadget Runner">
              <IconButton size="small" onClick={() => history.push(`/c/${clusterName}/ig`)}>
                <Icon icon="mdi:arrow-left" />
              </IconButton>
            </Tooltip>
            <Icon icon="mdi:bug-outline" width={20} />
            <Typography variant="subtitle1" fontWeight={600}>
              Gadget Instance: {instanceID}
            </Typography>
          </Box>

          {/* Gadget component fills remaining space.
            position:relative + absolute child ensures a real pixel height
            propagates through the SvelteWrapper div to the Gadget component's
            flex layout (which needs a sized parent). */}
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <SvelteWrapper component={GadgetWrapper} instanceID={instanceID} />
            </Box>
          </Box>
        </Box>
      </IGPluginProvider>
    </>
  );
}
