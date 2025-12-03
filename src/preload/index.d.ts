import { ElectronAPI } from '@electron-toolkit/preload';
import type {
  LoadMainModelPayload,
  DiscoveredAsset,
  ItemTransformUpdate,
  PersistedTransform,
  LoadMainModelResult,
} from '../shared/items';

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void
      toggleForceIgnoreMouse: () => void
      onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => void
      onModeChanged: (callback: (mode: 'pet' | 'window') => void) => void
      showContextMenu: (x: number, y: number) => void
      onMicToggle: (callback: () => void) => void
      onInterrupt: (callback: () => void) => void
      updateComponentHover: (componentId: string, isHovering: boolean) => void
      onToggleInputSubtitle: (callback: () => void) => void
      onToggleScrollToResize: (callback: () => void) => void
      onSwitchCharacter: (callback: (filename: string) => void) => void
      setMode: (mode: 'window' | 'pet') => void
      getConfigFiles: () => Promise<any>
      updateConfigFiles: (files: any[]) => void
      listAvailableItemAssets: () => Promise<DiscoveredAsset[]>
      loadMainModelScene: (payload: LoadMainModelPayload) => Promise<LoadMainModelResult>
      showItem: (modelId: string, assetKey: string) => Promise<any>
      hideItem: (payload: ItemTransformUpdate & { expression?: string | null; motion?: string | null; enableLipSync?: boolean }) => Promise<any>
      setItemPinned: (payload: {
        modelId: string
        assetKey: string
        pinned: boolean
        localTransform?: PersistedTransform
        worldTransform: PersistedTransform
      }) => Promise<any>
      setItemTransform: (payload: ItemTransformUpdate) => Promise<any>
      setItemScale: (payload: ItemTransformUpdate) => Promise<any>
      setItemZIndex: (payload: ItemTransformUpdate) => Promise<any>
      setItemExpression: (assetKey: string, expression: string | null) => Promise<any>
      playItemMotion: (assetKey: string, motion: string | null) => Promise<any>
      setItemLipSync: (assetKey: string, enable: boolean) => Promise<any>
      resolveFileUrl: (path: string) => Promise<string>
    }
  }
}

interface IpcRenderer {
  on(channel: 'mode-changed', func: (_event: any, mode: 'pet' | 'window') => void): void;
  send(channel: string, ...args: any[]): void;
}
