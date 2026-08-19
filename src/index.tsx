// IG Desktop frontend styles (injected into JS by headlamp-plugin base Vite config)
import '@inspektor-gadget/ig-desktop/frontend/dist-lib/ig-frontend.css';
import {
  registerPluginSettings,
  registerProjectDetailsTab,
  registerRoute,
  registerSidebarEntry,
  useTranslation,
} from '@kinvolk/headlamp-plugin/lib';
import { useClustersConf } from '@kinvolk/headlamp-plugin/lib/k8s';
import { Box, Stack, TextField, Typography } from '@mui/material';
import GadgetRunnerPage from './components/GadgetRunnerPage';
import GadgetViewPage from './components/GadgetViewPage';
import InsightsTab from './components/projects/InsightsTab';
import {
  DEFAULT_GADGET_NAMESPACE,
  PLUGIN_NAME,
  pluginStore,
  setGadgetNamespace,
  useGadgetNamespace,
} from './utils/plugin-config';

// Tab label constant — exported so InsightsTab can use it to detect clicks on this tab
// (Headlamp's MUI Tab component doesn't expose the tab id as a DOM attribute,
// so we match on the visible label text instead)
export const INSIGHTS_TAB_LABEL = 'Insights (Preview)';

// --- Plugin settings ---

function Settings() {
  const { t } = useTranslation();
  const clusters = useClustersConf() || {};
  const clusterNames = Object.keys(clusters).sort();

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t('Insights Agent namespace per cluster')}
        </Typography>
        <Typography variant="caption" color="textSecondary" component="p" sx={{ mb: 1 }}>
          {t(
            'Override the Kubernetes namespace where Insights Agent is deployed for each cluster. Leave empty to use the default ("{{default}}").',
            { default: DEFAULT_GADGET_NAMESPACE }
          )}
        </Typography>
        {clusterNames.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            {t('No clusters configured yet.')}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {clusterNames.map(name => (
              <ClusterNamespaceRow key={name} clusterName={name} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function ClusterNamespaceRow({ clusterName }: { clusterName: string }) {
  const value = useGadgetNamespace(clusterName);
  // Show an empty field when the user has not set a value, even though
  // `useGadgetNamespace` returns the default — the placeholder makes the
  // fallback discoverable.
  const config = pluginStore.useConfig()();
  const storedValue = config?.gadgetNamespaces?.[clusterName] ?? '';

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Typography variant="body2" sx={{ minWidth: 160, wordBreak: 'break-all' }}>
        {clusterName}
      </Typography>
      <TextField
        value={storedValue}
        onChange={e => setGadgetNamespace(clusterName, e.target.value)}
        placeholder={value || DEFAULT_GADGET_NAMESPACE}
        size="small"
        fullWidth
      />
    </Box>
  );
}

registerPluginSettings(PLUGIN_NAME, Settings);

// --- Sidebar entry (single parent, no children = no tab bar) ---

registerSidebarEntry({
  parent: null,
  name: 'inspektor-gadget',
  label: 'Insights Agent',
  url: '/ig',
  icon: 'mdi:bug-outline',
});

// --- Routes ---

registerRoute({
  path: '/ig',
  sidebar: 'inspektor-gadget',
  name: 'ig-runner',
  exact: true,
  component: GadgetRunnerPage,
  isFullWidth: true,
});

registerRoute({
  path: '/ig/instance/:instanceID',
  sidebar: 'inspektor-gadget',
  name: 'ig-gadget-view',
  exact: true,
  component: GadgetViewPage,
  isFullWidth: true,
});

// --- Project Details Tabs ---

registerProjectDetailsTab({
  id: 'ig-insights',
  label: INSIGHTS_TAB_LABEL,
  icon: 'mdi:lightbulb-outline',
  component: ({ project }) => <InsightsTab project={project} />,
});
