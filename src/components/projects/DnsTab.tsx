import { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';
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
  return (
    <ProjectGadgetTab
      project={project}
      gadgetImage={GADGET_IMAGE}
      gadgetLabel="DNS"
      viewConfig={EMBEDDED_VIEW_CONFIG}
      embedded
    />
  );
}
