import React from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import { Icon } from '@iconify/react';
import { useHistory } from 'react-router-dom';
import type { CellInteractionEvent } from '@inspektor-gadget/ig-desktop/frontend';
import { GADGET_ACTIONS } from './gadget-actions';
import { resourceRoute } from '../../utils/headlamp-routes';

interface CellContextMenuProps {
  event: CellInteractionEvent | null;
  clusterName: string;
  onClose: () => void;
  onGadgetAction?: (actionId: string, row: Record<string, unknown>) => void;
}

/** Resource type → icon mapping */
const RESOURCE_ICONS: Record<string, string> = {
  pod: 'mdi:cube-outline',
  namespace: 'mdi:folder-outline',
  node: 'mdi:server',
  container: 'mdi:package-variant',
};

export default function CellContextMenu({ event, clusterName, onClose, onGadgetAction }: CellContextMenuProps) {
  const history = useHistory();

  if (!event) return null;

  const { value, fieldName, fieldAnnotations, row, position } = event;
  const displayValue = value != null ? String(value) : '';
  const resourceType = fieldAnnotations['interaction.resource-type'];

  const handleNavigate = () => {
    if (resourceType && displayValue) {
      const route = resourceRoute(clusterName, resourceType, displayValue, row as Record<string, unknown>);
      if (route) {
        history.push(route);
      }
    }
    onClose();
  };

  const rowData = row as Record<string, unknown>;
  const canProfile = !!(rowData['k8s.podName'] && rowData['pid']);

  const handleCopy = () => {
    if (displayValue) {
      navigator.clipboard.writeText(displayValue).catch(() => {});
    }
    onClose();
  };

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: position.y, left: position.x }}
      slotProps={{
        paper: { sx: { minWidth: 200 } },
      }}
    >
      {/* Navigate to resource */}
      {resourceType && displayValue && (
        <MenuItem onClick={handleNavigate}>
          <ListItemIcon>
            <Icon icon={RESOURCE_ICONS[resourceType] || 'mdi:open-in-new'} width={20} />
          </ListItemIcon>
          <ListItemText
            primary={`Go to ${resourceType}`}
            secondary={displayValue}
          />
        </MenuItem>
      )}

      {/* Gadget actions */}
      {canProfile && onGadgetAction && GADGET_ACTIONS.map(action => (
        <MenuItem
          key={action.id}
          onClick={() => {
            onGadgetAction(action.id, rowData);
            onClose();
          }}
        >
          <ListItemIcon>
            <Icon icon={action.icon} width={20} />
          </ListItemIcon>
          <ListItemText primary={action.label} />
        </MenuItem>
      ))}

      {/* Copy value */}
      {displayValue && (
        <MenuItem onClick={handleCopy}>
          <ListItemIcon>
            <Icon icon="mdi:content-copy" width={20} />
          </ListItemIcon>
          <ListItemText
            primary="Copy value"
            secondary={displayValue.length > 40 ? displayValue.slice(0, 40) + '...' : displayValue}
          />
        </MenuItem>
      )}

      {(resourceType || displayValue) && <Divider />}

      {/* Field info (non-interactive) */}
      <MenuItem disabled>
        <ListItemText
          primary={fieldName}
          primaryTypographyProps={{ variant: 'caption', color: 'textSecondary' }}
        />
      </MenuItem>
    </Menu>
  );
}
