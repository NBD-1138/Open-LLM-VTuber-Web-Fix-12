/* eslint-disable @typescript-eslint/ban-ts-comment */
import electron from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { ConfigFile } from '../main/menu-manager';
import type {
  LoadMainModelPayload,
  DiscoveredAsset,
  ItemTransformUpdate,
  PersistedTransform,
} from '../shared/items';

const { contextBridge, ipcRenderer, desktopCapturer } = electron;

declare global {
  interface Window {
    electron: typeof electronAPI;
    // @ts-ignore
    api: typeof api;
  }
}

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  toggleForceIgnoreMouse: () => {
    ipcRenderer.send('toggle-force-ignore-mouse');
  },
  onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => {
    const handler = (_event: any, isForced: boolean) => callback(isForced);
    ipcRenderer.on('force-ignore-mouse-changed', handler);
    return () => ipcRenderer.removeListener('force-ignore-mouse-changed', handler);
  },
  showContextMenu: () => {
    console.log('Preload showContextMenu');
    ipcRenderer.send('show-context-menu');
  },
  onModeChanged: (callback: (mode: string) => void) => {
    ipcRenderer.on('mode-changed', (_, mode) => callback(mode));
  },
  onMicToggle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('mic-toggle', handler);
    return () => ipcRenderer.removeListener('mic-toggle', handler);
  },
  onInterrupt: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('interrupt', handler);
    return () => ipcRenderer.removeListener('interrupt', handler);
  },
  updateComponentHover: (componentId: string, isHovering: boolean) => {
    ipcRenderer.send('update-component-hover', componentId, isHovering);
  },
  onToggleInputSubtitle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('toggle-input-subtitle', handler);
    return () => ipcRenderer.removeListener('toggle-input-subtitle', handler);
  },
  onToggleScrollToResize: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('toggle-scroll-to-resize', handler);
    return () => ipcRenderer.removeListener('toggle-scroll-to-resize', handler);
  },
  onSwitchCharacter: (callback: (filename: string) => void) => {
    const handler = (_event: any, filename: string) => callback(filename);
    ipcRenderer.on('switch-character', handler);
    return () => ipcRenderer.removeListener('switch-character', handler);
  },
  setMode: (mode: 'window' | 'pet') => {
    ipcRenderer.send('pre-mode-changed', mode);
  },
  getConfigFiles: () => ipcRenderer.invoke('get-config-files'),
  updateConfigFiles: (files: ConfigFile[]) => {
    ipcRenderer.send('update-config-files', files);
  },
  listAvailableItemAssets: (): Promise<DiscoveredAsset[]> => ipcRenderer.invoke('items:list-available'),
  loadMainModelScene: (payload: LoadMainModelPayload) => ipcRenderer.invoke('items:load-main-model', payload),
  showItem: (modelId: string, assetKey: string) => ipcRenderer.invoke('items:show', { modelId, assetKey }),
  hideItem: (payload: ItemTransformUpdate & { expression?: string | null; motion?: string | null; enableLipSync?: boolean }) => ipcRenderer.invoke('items:hide', payload),
  setItemPinned: (payload: {
    modelId: string;
    assetKey: string;
    pinned: boolean;
    localTransform?: PersistedTransform;
    worldTransform: PersistedTransform;
  }) => ipcRenderer.invoke('items:set-pinned', payload),
  setItemTransform: (payload: ItemTransformUpdate) => ipcRenderer.invoke('items:set-transform', payload),
  setItemScale: (payload: ItemTransformUpdate) => ipcRenderer.invoke('items:set-scale', payload),
  setItemZIndex: (payload: ItemTransformUpdate) => ipcRenderer.invoke('items:set-zindex', payload),
  setItemExpression: (assetKey: string, expression: string | null) => ipcRenderer.invoke('items:set-expression', { assetKey, expression }),
  playItemMotion: (assetKey: string, motion: string | null) => ipcRenderer.invoke('items:set-motion', { assetKey, motion }),
  setItemLipSync: (assetKey: string, enable: boolean) => ipcRenderer.invoke('items:set-lipsync', { assetKey, enable }),
  resolveFileUrl: (filePath: string) => ipcRenderer.invoke('utils:resolve-file-url', filePath),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ...electronAPI,
      desktopCapturer: {
        getSources: (options) => desktopCapturer.getSources(options),
      },
      ipcRenderer: {
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        on: (channel, func) => ipcRenderer.on(channel, func),
        once: (channel, func) => ipcRenderer.once(channel, func),
        removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
        removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      },
      process: {
        platform: process.platform,
      },
    });
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
  (window as any).api = api;
}
