import type { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';

export interface GadgetAction {
  id: string;
  label: string;
  icon: string;
  gadgetImage: string;
  gadgetLabel: string;
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
    label: 'Profile CPU',
    icon: 'mdi:fire',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/profile_cpu:latest',
    gadgetLabel: 'CPU Profile',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_open',
    label: 'Trace File Access',
    icon: 'mdi:file-search-outline',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_open:latest',
    gadgetLabel: 'File Access',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_signal',
    label: 'Trace Signals',
    icon: 'mdi:bell-alert-outline',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_signal:latest',
    gadgetLabel: 'Signals',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_malloc',
    label: 'Trace Allocations',
    icon: 'mdi:memory',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_malloc:latest',
    gadgetLabel: 'Allocations',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false, searchBar: true },
    buildParams: buildProcessParams,
  },
  {
    id: 'trace_tcp',
    label: 'Trace TCP Connections',
    icon: 'mdi:lan-connect',
    gadgetImage: 'ghcr.io/inspektor-gadget/gadget/trace_tcp:latest',
    gadgetLabel: 'TCP Connections',
    viewConfig: { ...BASE_VIEW_CONFIG, snapshotTimeline: false },
    buildParams: buildProcessParams,
  },
];
