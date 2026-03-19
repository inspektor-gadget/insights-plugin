import type { CellInteractionEvent } from '@inspektor-gadget/ig-desktop/frontend';
import type { ViewConfig } from '@inspektor-gadget/ig-desktop/frontend';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { resourceRoute } from '../../utils/headlamp-routes';
import { registerK8sAnnotations } from '../../utils/k8s-annotations';
import CellContextMenu from './CellContextMenu';
import { GADGET_ACTIONS, type GadgetAction } from './gadget-actions';
import GadgetModal from './GadgetModal';
import ProjectGadgetTab from './ProjectGadgetTab';

const GADGET_IMAGE = 'ghcr.io/inspektor-gadget/gadget/top_process:latest';

const EMBEDDED_VIEW_CONFIG: ViewConfig = {
  statusBar: false,
  inspector: false,
  logPanel: false,
  datasourceTabs: false,
  searchBar: true,
  snapshotTimeline: false,
};

interface ProcessesTabProps {
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

export default function ProcessesTab({ project }: ProcessesTabProps) {
  const clusterName = project.clusters[0] || '';
  const nsFilter = project.namespaces[0] ? `k8s.namespace==${project.namespaces[0]}` : '';
  const history = useHistory();
  const [contextMenuEvent, setContextMenuEvent] = useState<CellInteractionEvent | null>(null);
  const [activeGadget, setActiveGadget] = useState<{
    action: GadgetAction;
    row: Record<string, unknown>;
  } | null>(null);

  // Register k8s annotation providers
  useEffect(() => {
    const unregister = registerK8sAnnotations({ hiddenFields: ['k8s.namespace'] });
    return unregister;
  }, []);

  // Stable refs for callbacks (SvelteWrapper captures props at mount time)
  const handleCellClickRef = useRef<(e: CellInteractionEvent) => void>(() => {});
  handleCellClickRef.current = useCallback(
    (event: CellInteractionEvent) => {
      const resourceType = event.fieldAnnotations['interaction.resource-type'];
      if (resourceType && event.value !== null && event.value !== undefined) {
        const route = resourceRoute(
          clusterName,
          resourceType,
          String(event.value),
          event.row as Record<string, unknown>
        );
        if (route) {
          history.push(route);
        }
      }
    },
    [clusterName, history]
  );

  const handleCellContextMenuRef = useRef<(e: CellInteractionEvent) => void>(() => {});
  handleCellContextMenuRef.current = useCallback((event: CellInteractionEvent) => {
    setContextMenuEvent(event);
  }, []);

  // Stable callbacks that read from refs (survive SvelteWrapper's frozen props)
  const stableCellClick = useCallback(
    (e: CellInteractionEvent) => handleCellClickRef.current(e),
    []
  );
  const stableCellContextMenu = useCallback(
    (e: CellInteractionEvent) => handleCellContextMenuRef.current(e),
    []
  );

  return (
    <>
      <ProjectGadgetTab
        project={project}
        gadgetImage={GADGET_IMAGE}
        gadgetLabel="Processes"
        embedded
        viewConfig={EMBEDDED_VIEW_CONFIG}
        onCellClick={stableCellClick}
        onCellContextMenu={stableCellContextMenu}
        extraParams={nsFilter ? { 'operator.filter.filter': nsFilter } : undefined}
      />
      <CellContextMenu
        event={contextMenuEvent}
        clusterName={clusterName}
        onClose={() => setContextMenuEvent(null)}
        onGadgetAction={(actionId, row) => {
          const action = GADGET_ACTIONS.find(a => a.id === actionId);
          if (action) setActiveGadget({ action, row });
        }}
      />
      {activeGadget && (
        <GadgetModal
          action={activeGadget.action}
          row={activeGadget.row}
          project={project}
          onClose={() => setActiveGadget(null)}
        />
      )}
    </>
  );
}
