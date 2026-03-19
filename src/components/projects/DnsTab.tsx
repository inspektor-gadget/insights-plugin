import React from 'react';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/trace_dns:latest';

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
      embedded
    />
  );
}
