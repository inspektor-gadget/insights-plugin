import React from 'react';
import { SvelteWrapper } from '@inspektor-gadget/ig-desktop/frontend/react';
import { DeployModalWrapper } from '@inspektor-gadget/ig-desktop/frontend';
import WasmDeployDialog from './WasmDeployDialog';

const IS_WASM = import.meta.env.VITE_TRANSPORT === 'wasm';

interface DeployModalProps {
  open: boolean;
  onClose: () => void;
  clusterName: string;
  redeploy: boolean;
  undeploy: boolean;
}

/**
 * Deploy modal that renders the appropriate dialog based on transport mode:
 * - WASM: React-native WasmDeployDialog
 * - Backend: Svelte DeployModalWrapper via SvelteWrapper
 */
export default function DeployModal({ open, onClose, clusterName, redeploy, undeploy }: DeployModalProps) {
  if (!open) return null;

  if (IS_WASM) {
    return (
      <WasmDeployDialog
        open={open}
        onClose={onClose}
        clusterName={clusterName}
        redeploy={redeploy}
        undeploy={undeploy}
      />
    );
  }

  return (
    <SvelteWrapper
      component={DeployModalWrapper}
      open={open}
      onClose={onClose}
      clusterName={clusterName}
      redeploy={redeploy}
      undeploy={undeploy}
    />
  );
}
