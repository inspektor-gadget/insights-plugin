/**
 * Type declarations for @inspektor-gadget/ig-desktop vendor package.
 *
 * The vendor lib ships only JS bundles (no .d.ts files) and uses package.json
 * "exports" which TypeScript's "node" moduleResolution cannot resolve.
 * These ambient declarations let tsc find the modules.
 */

declare module '@inspektor-gadget/ig-desktop/frontend' {
  export const environments: any;
  export const apiService: any;
  export const instances: any;
  export const setTheme: (theme: Record<string, any>) => void;
  export const registerAnnotationProvider: (...args: any[]) => () => void;
  export const initializeIG: (...args: any[]) => any;
  export const WebSocketAdapter: any;
  export const WasmAdapter: any;
  export const GadgetWrapper: any;
  export const DeployModalWrapper: any;

  export type IGDeploymentStatus = any;
  export type GadgetInfo = any;
  export type GadgetParam = any;
  export type GadgetInstanceData = any;
  export type GadgetDatasourceField = any;
  export type GadgetDatasource = any;
  export type CellInteractionEvent = any;
  export type ViewConfig = any;
  export type CellClickHandler = any;
  export type CellContextMenuHandler = any;
  export type ITransportAdapter = any;
}

declare module '@inspektor-gadget/ig-desktop/frontend/react' {
  import { ComponentType } from 'react';
  export const SvelteWrapper: ComponentType<any>;
  export const IGProvider: ComponentType<any>;
  export const useIG: () => any;
}

declare module '@inspektor-gadget/ig-desktop/frontend/dist-lib/ig-frontend.css' {}
