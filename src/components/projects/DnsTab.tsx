import { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/trace_dns:latest';

const EMBEDDED_VIEW_CONFIG: ViewConfig = {
  inspector: false,
  logPanel: false,
  searchBar: true,
  snapshotTimeline: false,
};

interface DnsTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

export default function DnsTab({ project }: DnsTabProps) {
  const { t } = useTranslation();
  const nsFilter = project.namespaces[0] ? `k8s.namespace==${project.namespaces[0]}` : '';
  return (
    <ProjectGadgetTab
      project={project}
      gadgetImage={GADGET_IMAGE}
      gadgetLabel={t('DNS')}
      viewConfig={EMBEDDED_VIEW_CONFIG}
      extraParams={{
        'operator.oci.annotate': 'dns:views.defaults.mode=dns-network',
        ...(nsFilter && { 'operator.filter.filter': nsFilter }),
      }}
      embedded
    />
  );
}
