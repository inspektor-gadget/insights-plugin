import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
} from '@mui/material';
import { Icon } from '@iconify/react';
import ProjectGadgetTab from './ProjectGadgetTab';
import type { GadgetAction } from './gadget-actions';

interface GadgetModalProps {
  action: GadgetAction;
  row: Record<string, unknown>;
  project: { id: string; namespaces: string[]; clusters: string[] };
  onClose: () => void;
}

export default function GadgetModal({ action, row, project, onClose }: GadgetModalProps) {
  const podName = String(row['k8s.podName'] || '');
  const pid = String(row['pid'] || '');

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={action.icon} width={24} />
        {action.label} — {podName} (PID {pid})
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={onClose} size="small" edge="end">
          <Icon icon="mdi:close" width={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', height: '70vh', p: 0 }}>
        <ProjectGadgetTab
          project={project}
          gadgetImage={action.gadgetImage}
          gadgetLabel={action.gadgetLabel}
          embedded
          viewConfig={action.viewConfig}
          extraParams={action.buildParams(podName, pid)}
        />
      </DialogContent>
    </Dialog>
  );
}
