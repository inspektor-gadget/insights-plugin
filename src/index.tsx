// IG Desktop frontend styles (injected into JS by headlamp-plugin base Vite config)
import '@inspektor-gadget/ig-desktop/frontend/dist-lib/ig-frontend.css';
import {
  ConfigStore,
  registerPluginSettings,
  registerProjectDetailsTab,
  registerRoute,
  registerRouteFilter,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { FormControlLabel, Switch } from '@mui/material';
import GadgetRunnerPage from './components/GadgetRunnerPage';
import GadgetViewPage from './components/GadgetViewPage';
import InsightsTab from './components/projects/InsightsTab';

// --- Plugin settings (experimental gate) ---

const PLUGIN_NAME = 'insights-plugin';
const pluginStore = new ConfigStore<{ enabled?: boolean }>(PLUGIN_NAME);
const isEnabled = () => pluginStore.get()?.enabled ?? false;

function Settings() {
  const config = pluginStore.useConfig()();
  const enabled = config?.enabled ?? false;

  return (
    <FormControlLabel
      control={
        <Switch
          checked={enabled}
          onChange={() => pluginStore.update({ enabled: !enabled })}
          color="primary"
        />
      }
      label="Enable Insights plugin (Experimental)"
    />
  );
}

registerPluginSettings(PLUGIN_NAME, Settings);

// --- Sidebar entry (single parent, no children = no tab bar) ---

registerSidebarEntry({
  parent: null,
  name: 'inspektor-gadget',
  label: 'Inspektor Gadget',
  url: '/ig',
  icon: 'mdi:bug-outline',
});

registerSidebarEntryFilter(entry =>
  entry.name === 'inspektor-gadget' && !isEnabled() ? null : entry
);

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

registerRouteFilter(route =>
  (route.name === 'ig-runner' || route.name === 'ig-gadget-view') && !isEnabled() ? null : route
);

// --- Project Details Tabs ---

registerProjectDetailsTab({
  id: 'ig-insights',
  label: 'Insights',
  icon: 'mdi:lightbulb-outline',
  component: ({ project }) => <InsightsTab project={project} />,
  isEnabled: async () => isEnabled(),
});
