/* eslint-disable no-shadow */
import { app, ipcMain, globalShortcut, desktopCapturer, dialog } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WindowManager } from "./window-manager";
import { MenuManager } from "./menu-manager";
import { AutomationManager } from "./automation/manager";
import { AutomationProfileStore } from "./automation/profile-store";
import { NutJsKeyboardInputAdapter } from "./automation/nutjs-input-adapter";
import { ItemManager } from "./item-manager";
import type {
  DiscoveredAsset,
  ItemTransformUpdate,
  LoadMainModelPayload,
  PersistedTransform,
} from "../shared/items";

let windowManager: WindowManager;
let menuManager: MenuManager;
let automationManager: AutomationManager;
let itemManager: ItemManager;
let isQuitting = false;
let configFilesCache: any[] = [];

interface HideItemPayload extends ItemTransformUpdate {
  expression?: string | null;
  motion?: string | null;
  enableLipSync?: boolean;
}

interface SetPinnedPayload {
  modelId: string;
  assetKey: string;
  pinned: boolean;
  localTransform?: PersistedTransform;
  worldTransform: PersistedTransform;
}

const ensureString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
};

const getAsset = (
  assets: DiscoveredAsset[],
  assetKey: string,
): DiscoveredAsset | undefined => assets.find((asset) => asset.assetKey === assetKey);

function isValidLive2DDirectory(candidate: string): boolean {
  if (!candidate || !existsSync(candidate)) {
    return false;
  }

  const itemsDir = path.join(candidate, "items");
  if (!existsSync(itemsDir)) {
    return false;
  }

  try {
    return readdirSync(itemsDir).length > 0;
  } catch (error) {
    console.warn("[ItemManager] Failed to inspect items dir for candidate:", candidate, error);
    return false;
  }
}

function resolveLive2DModelsRoot(appPath: string): string {
  const envOverride = process.env.LIVE2D_MODELS_ROOT;
  const candidates: string[] = [];

  if (envOverride) {
    candidates.push(envOverride);
  }

  candidates.push(
    path.resolve(appPath, "..", "live2d-models"),
    path.resolve(appPath, "..", "Open-LLM-VTuber", "live2d-models"),
    path.resolve(process.cwd(), "..", "Open-LLM-VTuber", "live2d-models"),
    path.resolve(process.cwd(), "live2d-models"),
    path.resolve(process.cwd(), "..", "live2d-models"),
    path.resolve(appPath, "..", "..", "Open-LLM-VTuber", "live2d-models"),
  );

  for (const candidate of candidates) {
    if (isValidLive2DDirectory(candidate)) {
      console.log("[ItemManager] Using live2d root:", candidate);
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      console.warn("[ItemManager] Using fallback live2d root without validation:", candidate);
      return candidate;
    }
  }

  return candidates[0] ?? path.resolve(process.cwd(), "live2d-models");
}

function setupIPC(manager: ItemManager): void {
  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.setIgnoreMouseEvents(ignore);
    }
  });

  ipcMain.on("get-current-mode", (event) => {
    event.returnValue = windowManager.getCurrentMode();
  });

  ipcMain.on("pre-mode-changed", (_event, newMode) => {
    if (newMode === 'window' || newMode === 'pet') {
      menuManager.setMode(newMode);
    }
  });

  ipcMain.on("window-minimize", () => {
    windowManager.getWindow()?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.maximizeWindow();
    }
  });

  ipcMain.on("window-close", () => {
    const window = windowManager.getWindow();
    if (window) {
      if (process.platform === "darwin") {
        window.hide();
      } else {
        window.close();
      }
    }
  });

  ipcMain.on(
    "update-component-hover",
    (_event, componentId: string, isHovering: boolean) => {
      windowManager.updateComponentHover(componentId, isHovering);
    },
  );

  ipcMain.handle("get-config-files", () => {
    menuManager.updateConfigFiles(configFilesCache);
    return configFilesCache;
  });

  ipcMain.on("update-config-files", (_event, files) => {
    configFilesCache = Array.isArray(files) ? files : [];
    menuManager.updateConfigFiles(files);
  });

  ipcMain.handle('get-screen-capture', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id;
  });

  ipcMain.handle('automation:list-profiles', () => automationManager.listProfiles());
  ipcMain.handle('automation:get-profile', (_event, profileId) => (
    automationManager.getProfile(ensureString(profileId, 'profileId'))
  ));
  ipcMain.handle('automation:save-profile', (_event, profile) => automationManager.saveProfile(profile));
  ipcMain.handle('automation:delete-profile', (_event, profileId) => (
    automationManager.deleteProfile(ensureString(profileId, 'profileId'))
  ));
  ipcMain.handle('automation:execute-command', (_event, profileId, commandId, options) => (
    automationManager.executeCommand(
      ensureString(profileId, 'profileId'),
      ensureString(commandId, 'commandId'),
      options ?? {},
    )
  ));
  ipcMain.handle('automation:cancel', (_event, requestId) => (
    automationManager.cancel(ensureString(requestId, 'requestId'))
  ));
  ipcMain.handle('automation:cancel-all', () => automationManager.cancelAll());
  ipcMain.handle('automation:emergency-stop', () => automationManager.emergencyStop());
  ipcMain.handle('automation:get-status', () => automationManager.getStatus());
  ipcMain.handle('automation:reset-emergency-stop', () => automationManager.resetEmergencyStop());
  ipcMain.handle('automation:set-active-profile', (_event, profileId) => (
    automationManager.setActiveProfile(
      profileId === null || profileId === undefined ? null : ensureString(profileId, 'profileId'),
    )
  ));
  ipcMain.handle('automation:update-settings', (_event, settingsPatch) => (
    automationManager.updateSettings(settingsPatch ?? {})
  ));
  ipcMain.handle('automation:set-voice-command-listening-active', (_event, active) => (
    automationManager.setVoiceCommandListeningActive(Boolean(active))
  ));
  ipcMain.handle('automation:import-profiles', () => automationManager.importProfiles());
  ipcMain.handle('automation:inspect-voiceattack-source', () => (
    automationManager.inspectVoiceAttackSource()
  ));
  ipcMain.handle('automation:preview-voiceattack-import', (_event, options) => (
    automationManager.previewVoiceAttackImport(options ?? {})
  ));
  ipcMain.handle('automation:export-voiceattack-diagnostic-report', (_event, options) => (
    automationManager.exportVoiceAttackDiagnosticReport(options ?? {})
  ));
  ipcMain.handle('automation:import-voiceattack-profile', (_event, options) => (
    automationManager.importVoiceAttackProfile(options)
  ));
  ipcMain.handle('automation:cancel-voiceattack-import', (_event, importId) => (
    automationManager.cancelVoiceAttackImport(ensureString(importId, 'importId'))
  ));
  ipcMain.handle('automation:validate-imported-profile', (_event, profileId) => (
    automationManager.validateImportedProfile(ensureString(profileId, 'profileId'))
  ));
  ipcMain.handle('automation:mark-imported-profile-reviewed', (_event, profileId) => (
    automationManager.markImportedProfileReviewed(ensureString(profileId, 'profileId'))
  ));
  ipcMain.handle('automation:export-profile', (_event, options) => (
    automationManager.exportProfile(options)
  ));
  ipcMain.handle('automation:select-telemetry-directory', () => (
    automationManager.selectTelemetryDirectory()
  ));
  ipcMain.handle('automation:respond-scene-action', (_event, result) => (
    automationManager.respondToSceneAction(result)
  ));
  ipcMain.handle('automation:sync-assistant-state', (_event, snapshot) => (
    automationManager.syncAssistantState(snapshot ?? null)
  ));

  ipcMain.handle("items:list-available", async () => manager.listAvailableAssets());

  ipcMain.handle(
    "items:load-main-model",
    async (_event, payload: LoadMainModelPayload) => {
      if (typeof payload.itemsBaseUrl !== "undefined") {
        const normalized =
          payload.itemsBaseUrl && payload.itemsBaseUrl.length > 0
            ? payload.itemsBaseUrl.replace(/\/+$/, "")
            : null;
        manager.setItemsBaseUrl(normalized);
        process.env.ITEMS_BASE_URL = normalized ?? undefined;
      }

      await manager.saveOutgoingScene(payload);
      return manager.loadSceneForModel(payload.newModelId);
    },
  );

  ipcMain.handle(
    "items:show",
    async (_event, args: { modelId: string; assetKey: string }) => {
      const { modelId, assetKey } = args;
      await manager.addVisibleItem(modelId, assetKey);
      const assets = await manager.listAvailableAssets();
      const asset = getAsset(assets, assetKey);
      if (!asset) {
        throw new Error(`Asset ${assetKey} not found in catalog`);
      }
      return manager.buildRestoredSceneItem(modelId, assetKey, asset.kind);
    },
  );

  ipcMain.handle(
    "items:hide",
    async (_event, payload: HideItemPayload) => {
      await manager.updateItemTransform(payload);

      if (payload.expression !== undefined) {
        await manager.setItemExpression(payload.assetKey, payload.expression);
      }
      if (payload.motion !== undefined) {
        await manager.setItemMotion(payload.assetKey, payload.motion);
      }
      if (payload.enableLipSync !== undefined) {
        await manager.setItemLipSync(payload.assetKey, payload.enableLipSync);
      }

      await manager.removeVisibleItem(payload.modelId, payload.assetKey);
      return manager.getLayout();
    },
  );

  ipcMain.handle(
    "items:set-pinned",
    async (_event, payload: SetPinnedPayload) => {
      if (payload.pinned) {
        const localTransform = payload.localTransform ?? payload.worldTransform;
        await manager.updateItemTransform({
          modelId: payload.modelId,
          assetKey: payload.assetKey,
          pinned: true,
          transform: localTransform,
        });
        await manager.updateItemWorldOnly(
          payload.assetKey,
          payload.worldTransform,
        );
      } else {
        await manager.updateItemTransform({
          modelId: payload.modelId,
          assetKey: payload.assetKey,
          pinned: false,
          transform: payload.worldTransform,
        });
      }

      const assets = await manager.listAvailableAssets();
      const asset =
        getAsset(assets, payload.assetKey)
        ?? ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
      return manager.buildRestoredSceneItem(
        payload.modelId,
        payload.assetKey,
        asset.kind,
      );
    },
  );

  ipcMain.handle(
    "items:set-transform",
    async (_event, payload: ItemTransformUpdate) => {
      await manager.updateItemTransform(payload);
      const assets = await manager.listAvailableAssets();
      const asset =
        getAsset(assets, payload.assetKey)
        ?? ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
      return manager.buildRestoredSceneItem(
        payload.modelId,
        payload.assetKey,
        asset.kind,
      );
    },
  );

  ipcMain.handle(
    "items:set-scale",
    async (_event, payload: ItemTransformUpdate) => {
      await manager.updateItemTransform(payload);
      const assets = await manager.listAvailableAssets();
      const asset =
        getAsset(assets, payload.assetKey)
        ?? ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
      return manager.buildRestoredSceneItem(
        payload.modelId,
        payload.assetKey,
        asset.kind,
      );
    },
  );

  ipcMain.handle(
    "items:set-zindex",
    async (_event, payload: ItemTransformUpdate) => {
      await manager.updateItemTransform(payload);
      const assets = await manager.listAvailableAssets();
      const asset =
        getAsset(assets, payload.assetKey)
        ?? ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
      return manager.buildRestoredSceneItem(
        payload.modelId,
        payload.assetKey,
        asset.kind,
      );
    },
  );

  ipcMain.handle(
    "items:set-expression",
    async (_event, args: { assetKey: string; expression: string | null }) => {
      await manager.setItemExpression(args.assetKey, args.expression);
      return manager.ensureItem(args.assetKey);
    },
  );

  ipcMain.handle(
    "items:set-motion",
    async (_event, args: { assetKey: string; motion: string | null }) => {
      await manager.setItemMotion(args.assetKey, args.motion);
      return manager.ensureItem(args.assetKey);
    },
  );

  ipcMain.handle(
    "items:set-lipsync",
    async (_event, args: { assetKey: string; enable: boolean }) => {
      await manager.setItemLipSync(args.assetKey, args.enable);
      return manager.ensureItem(args.assetKey);
    },
  );

  ipcMain.handle("utils:resolve-file-url", (_event, fsPath: string) => {
    const baseUrl = process.env.ITEMS_BASE_URL;
    const itemsRoot = process.env.LIVE2D_ITEMS_PATH;
    if (baseUrl && itemsRoot && fsPath.startsWith(itemsRoot)) {
      const relative = path.relative(itemsRoot, fsPath);
      const encoded = relative
        .split(path.sep)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      return `${baseUrl.replace(/\/+$/, "")}/${encoded}`;
    }
    return pathToFileURL(fsPath).toString();
  });
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.electron");

  windowManager = new WindowManager();
  menuManager = new MenuManager((mode) => windowManager.setWindowMode(mode));
  automationManager = new AutomationManager({
    store: new AutomationProfileStore(app.getPath('userData')),
    keyboardAdapter: new NutJsKeyboardInputAdapter(),
    hotkeyApi: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    dialogApi: {
      openImportFile: async () => {
        const window = windowManager.getWindow();
        const result = await dialog.showOpenDialog(window ?? undefined, {
          filters: [{ name: 'Automation Profiles', extensions: ['json', 'yaml', 'yml'] }],
          properties: ['openFile'],
        });
        return result.canceled ? null : result.filePaths[0];
      },
      openExportFile: async ({ profileId, format }) => {
        const window = windowManager.getWindow();
        const result = await dialog.showSaveDialog(window ?? undefined, {
          defaultPath: `${profileId}.${format === 'yaml' ? 'yaml' : 'json'}`,
          filters: [{
            name: format === 'yaml' ? 'YAML Profile' : 'JSON Profile',
            extensions: format === 'yaml' ? ['yaml'] : ['json'],
          }],
        });
        return result.canceled ? null : result.filePath ?? null;
      },
      openVoiceAttackDiagnosticFile: async ({ sourceBasename }) => {
        const window = windowManager.getWindow();
        const safeBase = sourceBasename
          .replace(/[<>:"/\\|?*]+/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
          || 'voiceattack-diagnostic-report';
        const result = await dialog.showSaveDialog(window ?? undefined, {
          defaultPath: `${safeBase}.voiceattack-diagnostic.json`,
          filters: [{
            name: 'VoiceAttack Diagnostic Report',
            extensions: ['json'],
          }],
        });
        return result.canceled ? null : result.filePath ?? null;
      },
      openTelemetryDirectory: async () => {
        const window = windowManager.getWindow();
        const result = await dialog.showOpenDialog(window ?? undefined, {
          properties: ['openDirectory'],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
      openVoiceAttackSource: async () => {
        const window = windowManager.getWindow();
        let selectionMode: 'file' | 'directory' = 'file';

        if (process.platform !== 'darwin') {
          const modeChoice = await dialog.showMessageBox(window ?? undefined, {
            type: 'question',
            buttons: ['Profile File', 'Folder', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
            title: 'VoiceAttack Import',
            message: 'Choose a VoiceAttack source',
            detail: 'Select an exported .vap/.vax profile file, or choose a folder to scan recursively for VoiceAttack exports.',
          });
          if (modeChoice.response === 2) {
            return null;
          }
          selectionMode = modeChoice.response === 1 ? 'directory' : 'file';
        }

        const result = await dialog.showOpenDialog(window ?? undefined, selectionMode === 'directory'
          ? {
            title: 'Select VoiceAttack Folder',
            properties: ['openDirectory'],
          }
          : {
            title: 'Select VoiceAttack Profile',
            filters: [{ name: 'VoiceAttack Profiles', extensions: ['vap', 'vax'] }],
            properties: ['openFile'],
          });
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
    },
    emitEvent: (event) => {
      windowManager.getWindow()?.webContents.send('automation:event', event);
    },
  });
  await automationManager.initialize();

  const live2dRoot = resolveLive2DModelsRoot(app.getAppPath());
  let itemsBaseUrl =
    process.env.VITE_ITEMS_BASE_URL?.replace(/\/+$/, "")
    ?? process.env.ITEMS_BASE_URL?.replace(/\/+$/, "")
    ?? null;
  const itemsSourceDir = path.join(live2dRoot, "items");
  process.env.LIVE2D_ITEMS_PATH = itemsSourceDir;

  if (!itemsBaseUrl) {
    const backendBase =
      process.env.BACKEND_BASE_URL?.replace(/\/+$/, "")
      ?? "http://127.0.0.1:12393";
    itemsBaseUrl = `${backendBase}/live2d-models/items`;
  }
  process.env.ITEMS_BASE_URL = itemsBaseUrl;

  itemManager = new ItemManager({
    live2dRoot,
    itemsBaseUrl,
    layoutDir: process.cwd(),
  });
  await itemManager.initialize();

  const window = windowManager.createWindow({
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#FFFFFF",
      height: 30,
    },
  });
  menuManager.createTray();

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
    return false;
  });
  window.on('blur', () => {
    void automationManager.setVoiceCommandListeningActive(false);
  });

  // if (process.env.NODE_ENV === "development") {
  //   globalShortcut.register("F12", () => {
  //     const window = windowManager.getWindow();
  //     if (!window) return;

  //     if (window.webContents.isDevToolsOpened()) {
  //       window.webContents.closeDevTools();
  //     } else {
  //       window.webContents.openDevTools();
  //     }
  //   });
  // }

  setupIPC(itemManager);

  app.on("activate", () => {
    const window = windowManager.getWindow();
    if (window) {
      window.show();
    }
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('web-contents-created', (_, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  menuManager.destroy();
  globalShortcut.unregisterAll();
  void automationManager?.dispose();
});
