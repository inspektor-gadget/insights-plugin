import { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/profile_cuda:latest';

const EMBEDDED_VIEW_CONFIG: ViewConfig = {
  statusBar: true,
  inspector: false,
  logPanel: true,
  datasourceTabs: false,
  searchBar: false,
  snapshotTimeline: true,
};

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
const ALLOCS_ANNOTATE = [
  'allocs:views.defaults.mode=flamegraph',
  'allocs:views.modes.flamegraph=true',
  'allocs.kern_stack:flamegraph.level=30',
  'allocs.kern_stack:flamegraph.type=stack',
  'allocs.ustack_raw.symbols:flamegraph.level=25',
  'allocs.ustack_raw.symbols:flamegraph.type=stack',
].join(',');

/**
 * Gadget parameters that enable kernel + user stack collection and select
 * the symbolizer needed to resolve frames into readable symbols. Without
 * `collect-otel-stack` / `collect-ustack` the `kern_stack` /
 * `user_stack_raw.symbols` fields stay empty and the flamegraph is blank.
 */
const PROFILE_CUDA_PARAMS: Record<string, string> = {
  'operator.oci.ebpf.collect-otel-stack': 'true',
  'operator.oci.ebpf.collect-kstack': 'true',
  'operator.oci.ebpf.collect-ustack': 'true',
  'operator.ustack.symbolizers': 'otel-ebpf-profiler',
  'operator.oci.annotate': ALLOCS_ANNOTATE,
};

interface ProfileCudaTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

export default function ProfileCudaTab({ project }: ProfileCudaTabProps) {
  const { t } = useTranslation();

  return (
    <ProjectGadgetTab
      project={project}
      gadgetImage={GADGET_IMAGE}
      gadgetLabel={t('CUDA Profile')}
      viewConfig={EMBEDDED_VIEW_CONFIG}
      extraParams={PROFILE_CUDA_PARAMS}
      embedded
    />
  );
}
