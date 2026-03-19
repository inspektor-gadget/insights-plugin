import React from 'react';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/trace_tcp:latest';

interface NetworkTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

export default function NetworkTab({ project }: NetworkTabProps) {
  return (
    <ProjectGadgetTab project={project} gadgetImage={GADGET_IMAGE} gadgetLabel="Network" embedded />
  );
}
