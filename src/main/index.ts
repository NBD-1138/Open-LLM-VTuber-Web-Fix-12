/* eslint-disable no-shadow */
import { app, ipcMain, globalShortcut, desktopCapturer } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import path from "node:path";
import {
  existsSync,
  readdirSync,
  promises as fsPromises,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { session } from "electron";
import { MenuManager } from "./menu-manager";
import { WindowManager } from "./window-manager";
import { ItemManager } from "./item-manager";
import {
  DiscoveredAsset,
  ItemTransformUpdate,
  LoadMainModelPayload,
  PersistedTransform,
} from "../shared/items";

let windowManager: WindowManager;
let menuManager: MenuManager;
let isQuitting = false;
let itemManager: ItemManager | null = null;

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

function getAsset(
  assets: DiscoveredAsset[],
  assetKey: string,
): DiscoveredAsset | undefined {
  return assets.find((asset) => asset.assetKey === assetKey);
}

function isValidLive2DDirectory(candidate: string): boolean {
  if (!candidate || !existsSync(candidate)) {
    return false;
  }
  const itemsDir = path.join(candidate, "items");
  if (!existsSync(itemsDir)) {
    return false;
  }
  try {
    const entries = readdirSync(itemsDir);
    return entries.length > 0;
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

  const appDirCandidates = [
    path.resolve(appPath, "..", "live2d-models"),
    path.resolve(appPath, "..", "Open-LLM-VTuber", "live2d-models"),
    path.resolve(process.cwd(), "..", "Open-LLM-VTuber", "live2d-models"),
    path.resolve(process.cwd(), "live2d-models"),
    path.resolve(process.cwd(), "..", "live2d-models"),
    path.resolve(appPath, "..", "..", "Open-LLM-VTuber", "live2d-models"),
  ];

  candidates.push(...appDirCandidates);

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

  console.warn("[ItemManager] Falling back to first live2d candidate:", candidates[0]);
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
    const configFiles = JSON.parse(localStorage.getItem("configFiles") || "[]");
    menuManager.updateConfigFiles(configFiles);
    return configFiles;
  });

  ipcMain.on("update-config-files", (_event, files) => {
    menuManager.updateConfigFiles(files);
  });

  ipcMain.handle('get-screen-capture', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id;
  });

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
    async (
      _event,
      args: { modelId: string; assetKey: string },
    ) => {
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
        const local = payload.localTransform ?? payload.worldTransform;
        await manager.updateItemTransform({
          modelId: payload.modelId,
          assetKey: payload.assetKey,
          pinned: true,
          transform: local,
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
        getAsset(assets, payload.assetKey) ??
        ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
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
        getAsset(assets, payload.assetKey) ??
        ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
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
        getAsset(assets, payload.assetKey) ??
        ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
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
        getAsset(assets, payload.assetKey) ??
        ({ assetKey: payload.assetKey, kind: "png" } as DiscoveredAsset);
      return manager.buildRestoredSceneItem(
        payload.modelId,
        payload.assetKey,
        asset.kind,
      );
    },
  );

  ipcMain.handle(
    "items:set-expression",
    async (
      _event,
      args: { assetKey: string; expression: string | null },
    ) => {
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

  const live2dRoot = resolveLive2DModelsRoot(app.getAppPath());
  let explicitBaseUrl =
    process.env.VITE_ITEMS_BASE_URL?.replace(/\/+$/, "") ??
    process.env.ITEMS_BASE_URL?.replace(/\/+$/, "") ??
    null;
  const layoutDir = process.cwd();

  const itemsSourceDir = path.join(live2dRoot, "items");
  process.env.LIVE2D_ITEMS_PATH = itemsSourceDir;
  if (!explicitBaseUrl) {
    const backendBase =
      process.env.BACKEND_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:12393";
    explicitBaseUrl = `${backendBase}/live2d-models/items`;
  }
  process.env.ITEMS_BASE_URL = explicitBaseUrl;

  itemManager = new ItemManager({
    live2dRoot,
    itemsBaseUrl: explicitBaseUrl,
    layoutDir,
  });
  await itemManager.initialize();

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
  windowManager = null;
  menuManager = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  menuManager.destroy();
  globalShortcut.unregisterAll();
});
