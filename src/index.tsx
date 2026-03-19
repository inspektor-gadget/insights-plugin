import {
  registerProjectDetailsTab,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';

// IG Desktop frontend styles (injected into JS by headlamp-plugin base Vite config)
import '@inspektor-gadget/ig-desktop/frontend/dist-lib/ig-frontend.css';

import GadgetRunnerPage from './components/GadgetRunnerPage';
import GadgetViewPage from './components/GadgetViewPage';
import InsightsTab from './components/projects/InsightsTab';

// --- Sidebar entry (single parent, no children = no tab bar) ---

registerSidebarEntry({
  parent: null,
  name: 'inspektor-gadget',
  label: 'Inspektor Gadget',
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
  label: 'Insights',
  icon: 'mdi:lightbulb-outline',
  component: ({ project }) => <InsightsTab project={project} />,
});
