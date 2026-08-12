import { IpcRenderer } from 'electron';
import type { AutomationBridgeApi } from '../../shared/automation/ipc';
import type {
  DiscoveredAsset,
  ItemTransformUpdate,
  LoadMainModelPayload,
  PersistedTransform,
} from '../../shared/items';

interface RendererBridgeApi {
  setIgnoreMouseEvents: (ignore: boolean) => void;
  toggleForceIgnoreMouse: () => void;
  onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => () => void;
  showContextMenu: () => void;
  onModeChanged: (callback: (mode: string) => void) => void;
  onMicToggle: (callback: () => void) => () => void;
  onInterrupt: (callback: () => void) => () => void;
  updateComponentHover: (componentId: string, isHovering: boolean) => void;
  onToggleInputSubtitle: (callback: () => void) => () => void;
  onToggleScrollToResize: (callback: () => void) => () => void;
  onSwitchCharacter: (callback: (filename: string) => void) => () => void;
  setMode: (mode: 'window' | 'pet') => void;
  getConfigFiles: () => Promise<unknown>;
  updateConfigFiles: (files: unknown[]) => void;
  listAvailableItemAssets: () => Promise<DiscoveredAsset[]>;
  loadMainModelScene: (payload: LoadMainModelPayload) => Promise<unknown>;
  showItem: (modelId: string, assetKey: string) => Promise<unknown>;
  hideItem: (
    payload: ItemTransformUpdate & {
      expression?: string | null;
      motion?: string | null;
      enableLipSync?: boolean;
    },
  ) => Promise<unknown>;
  setItemPinned: (payload: {
    modelId: string;
    assetKey: string;
    pinned: boolean;
    localTransform?: PersistedTransform;
    worldTransform: PersistedTransform;
  }) => Promise<unknown>;
  setItemTransform: (payload: ItemTransformUpdate) => Promise<unknown>;
  setItemScale: (payload: ItemTransformUpdate) => Promise<unknown>;
  setItemZIndex: (payload: ItemTransformUpdate) => Promise<unknown>;
  setItemExpression: (assetKey: string, expression: string | null) => Promise<unknown>;
  playItemMotion: (assetKey: string, motion: string | null) => Promise<unknown>;
  setItemLipSync: (assetKey: string, enable: boolean) => Promise<unknown>;
  resolveFileUrl: (filePath: string) => Promise<string>;
}

declare global {
  interface Window {
    // Define the structure of the API exposed by your preload script
    electron?: {
      ipcRenderer: IpcRenderer;
      process: {
        platform: string;
      };
      // Add other methods or properties exposed by preload script if any
    };
    // Add other custom window properties if needed
    api?: RendererBridgeApi;
    automation?: AutomationBridgeApi;
  }
}

// Export {} is needed to make this a module
export {};
