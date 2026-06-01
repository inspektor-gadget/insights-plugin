import type { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';

export interface GadgetAction {
  id: string;
  /** i18n key for the menu entry label (English text used as key). */
  labelKey: string;
  icon: string;
  gadgetImage: string;
  /** i18n key for the gadget label shown in toolbar / status messages. */
  gadgetLabelKey: string;
  viewConfig: ViewConfig;
  buildParams: (podName: string, pid: string) => Record<string, string>;
}

const BASE_VIEW_CONFIG: ViewConfig = {
  statusBar: false,
  inspector: false,
  logPanel: true,
  datasourceTabs: false,
  searchBar: false,
};

// eslint-disable-next-line no-unused-vars
function buildProcessParams(podName: string, _pid: string): Record<string, string> {
  return {
    'operator.KubeManager.podname': podName,
    // TODO: re-enable once gadgets support pid filtering
    // 'operator.oci.ebpf.pid': pid,
  };
}

export const GADGET_ACTIONS: GadgetAction[] = [
  {
    id: 'profile_cpu',
    labelKey: 'Profile CPU',
    icon: 'mdi:fire',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/profile_cpu:latest',
    gadgetLabelKey: 'CPU Profile',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_open',
    labelKey: 'Trace File Access',
    icon: 'mdi:file-search-outline',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_open:latest',
    gadgetLabelKey: 'File Access',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_signal',
    labelKey: 'Trace Signals',
    icon: 'mdi:bell-alert-outline',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_signal:latest',
    gadgetLabelKey: 'Signals',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_malloc',
    labelKey: 'Trace Allocations',
    icon: 'mdi:memory',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_malloc:latest',
    gadgetLabelKey: 'Allocations',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_tcp',
    labelKey: 'Trace TCP Connections',
    icon: 'mdi:lan-connect',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_tcp:latest',
    gadgetLabelKey: 'TCP Connections',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false },
    buildParams: buildProcessParams,
  },
];
