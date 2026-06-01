import type { CellInteractionEvent, ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useCallback, useRef, useState } from 'react';
import CellContextMenu from './CellContextMenu';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/top_cuda_memory:latest';

/**
 * Per-datasource and per-field annotations passed to the OCI operator at
 * gadget-run time via `operator.oci.annotate`. Preferred over a frontend
 * `registerAnnotationProvider` because the annotations then ride along
 * with the gadget metadata (CLI/replay see the same view) and don't depend
 * on the React tree being mounted before the gadget starts.
 *
 * Syntax: `datasource:key=value` (datasource-level) or
 * `datasource.field:key=value` (field-level), comma-separated.
 */
// Group chart series by Kubernetes container name. The gadget.yaml for
// top_cuda_memory declares `pid`, `host_raw`, `host`, and `comm` with
// `metrics.type=key`; we override those to a non-key value (`none`) so the
// only grouping key is `k8s.containerName`. Within each container, the chart
// then sums per snapshot (via per-(key, timestamp) aggregation in
// ig-desktop's chart visualizer).
const ANNOTATE = [
  // libcudart_mem_stats datasource
  'libcudart_mem_stats:title=libcudart Memory Usage',
  'libcudart_mem_stats:cli.clear-screen-before=true',
  'libcudart_mem_stats.mem_alloc_bytes:metrics.type=gauge',
  'libcudart_mem_stats.mem_free_bytes:metrics.type=gauge',
  'libcudart_mem_stats.k8s.podName:metrics.type=key',
  'libcudart_mem_stats.pid:metrics.type=none',
  'libcudart_mem_stats.host:metrics.type=none',
  'libcudart_mem_stats.host_raw:metrics.type=none',
  'libcudart_mem_stats.comm:metrics.type=none',
  'libcudart_mem_stats.proc.comm:metrics.type=none',
  // libcuda_mem_stats datasource
  'libcuda_mem_stats:title=libcuda Memory Usage',
  'libcuda_mem_stats:cli.clear-screen-before=true',
  'libcuda_mem_stats.mem_alloc_bytes:metrics.type=gauge',
  'libcuda_mem_stats.mem_free_bytes:metrics.type=gauge',
  'libcuda_mem_stats.k8s.podName:metrics.type=key',
  'libcuda_mem_stats.pid:metrics.type=none',
  'libcuda_mem_stats.host:metrics.type=none',
  'libcuda_mem_stats.host_raw:metrics.type=none',
  'libcuda_mem_stats.comm:metrics.type=none',
  'libcuda_mem_stats.proc.comm:metrics.type=none',
].join(',');

const PARAMS: Record<string, string> = {
  'operator.oci.annotate': ANNOTATE,
};

const EMBEDDED_VIEW_CONFIG: ViewConfig = {
  statusBar: false,
  inspector: false,
  logPanel: false,
  datasourceTabs: true,
  searchBar: true,
  snapshotTimeline: false,
};

interface TopCudaMemoryTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

export default function TopCudaMemoryTab({ project }: TopCudaMemoryTabProps) {
  const { t } = useTranslation();
  const clusterName = project.clusters[0] || '';

  const [contextMenuEvent, setContextMenuEvent] = useState<CellInteractionEvent | null>(null);

  // Stable ref pattern (SvelteWrapper captures props at mount time, see ProcessesTab)
  const handleCellContextMenuRef = useRef<(e: CellInteractionEvent) => void>(() => {});
  handleCellContextMenuRef.current = useCallback((event: CellInteractionEvent) => {
    setContextMenuEvent(event);
  }, []);

  const stableCellContextMenu = useCallback(
    (e: CellInteractionEvent) => handleCellContextMenuRef.current(e),
    []
  );

  return (
    <>
      <ProjectGadgetTab
        project={project}
        gadgetImage={GADGET_IMAGE}
        gadgetLabel={t('CUDA Memory')}
        embedded
        viewConfig={EMBEDDED_VIEW_CONFIG}
        onCellContextMenu={stableCellContextMenu}
        extraParams={PARAMS}
      />
      <CellContextMenu
        event={contextMenuEvent}
        clusterName={clusterName}
        onClose={() => setContextMenuEvent(null)}
      />
    </>
  );
}
