/* eslint-disable class-methods-use-this, no-param-reassign, no-restricted-syntax, no-continue, no-nested-ternary, no-useless-return */
import * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";
import {
  DiscoveredAsset,
  ItemKind,
  PersistedTransform,
  RestoredSceneItem,
  RuntimeSceneItem,
  SceneItemSummary,
} from "../../../../shared/items";
import { useSceneItemsStore } from "../../store/scene-items-store";

const cubismCoreUrl = new URL(
  "../../../WebSDK/Core/live2dcubismcore.js",
  import.meta.url,
).href;

let cubismRuntimePromise: Promise<void> | null = null;
let Live2DModelCtor: typeof import("pixi-live2d-display/cubism4").Live2DModel | null = null;

let tickerRegistered = false;
const DEFAULT_ITEM_SCALE = 0.2;

const ensureCubismRuntime = (): Promise<void> => {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  const globalAny = window as any;
  if (globalAny.Live2DCubismCore) {
    return Promise.resolve();
  }

  if (cubismRuntimePromise) {
    return cubismRuntimePromise;
  }

  if (globalAny.Live2DCubismCore?.Memory) {
    return Promise.resolve();
  }

  cubismRuntimePromise = new Promise<void>((resolve, reject) => {
    let targetScript: HTMLScriptElement | null = null;
    const coreConfig = globalAny.Live2DCubismCore ?? {};
    coreConfig.RESERVED_FUNCTION_POINTERS = Math.max(
      Number(coreConfig.RESERVED_FUNCTION_POINTERS) || 0,
      4096,
    );
    coreConfig.ALLOW_TABLE_GROWTH = 1;
    globalAny.Live2DCubismCore = coreConfig;

    const handleReady = () => {
      const runtime = (window as any).Live2DCubismCore ?? (window as any).myGlobalObject;
      if (runtime) {
        (window as any).Live2DCubismCore = runtime;
        if (targetScript) {
          targetScript.dataset.live2dReady = "true";
        }
        resolve();
      } else {
        reject(new Error("Live2DCubismCore unavailable after script load"));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-live2d-cubism-core="true"]',
    );

    if (globalAny.Live2DCubismCore?.Memory) {
      resolve();
      return;
    }

    if (existingScript) {
      targetScript = existingScript;
      if (existingScript.dataset.live2dReady === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", handleReady, { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load live2dcubismcore.js")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = cubismCoreUrl;
    script.async = false;
    script.dataset.live2dCubismCore = "true";
    script.dataset.live2dReady = "false";
    script.addEventListener("load", handleReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load live2dcubismcore.js")),
      { once: true },
    );
    targetScript = script;
    document.head.appendChild(script);
  });

  return cubismRuntimePromise;
};

const ensureLive2DModelCtor = async () => {
  if (!Live2DModelCtor) {
    const module = await import("pixi-live2d-display/cubism4");
    Live2DModelCtor = module.Live2DModel;
  }
  if (!tickerRegistered && Live2DModelCtor && typeof Live2DModelCtor.registerTicker === "function") {
    const tickerClass = (PIXI as any).Ticker;
    if (tickerClass?.shared) {
      Live2DModelCtor.registerTicker(tickerClass);
      tickerRegistered = true;
    }
  }
  return Live2DModelCtor!;
};

const windowApi = (window as any).api;

const ensureInteractiveMethod = (display: PIXI.DisplayObject) => {
  const prototypeFn = (PIXI.DisplayObject.prototype as any)?.isInteractive;
  if (typeof (display as any).isInteractive !== "function" && typeof prototypeFn === "function") {
    (display as any).isInteractive = prototypeFn.bind(display);
  }
};

export interface ItemSceneCallbacks {
  onDragComplete: (item: RuntimeSceneItem) => void;
  onScaleChange: (item: RuntimeSceneItem) => void;
}

type SceneDisplayObject = any;
const clampScale = (value: number, min = 0.05, max = 5): number => Math.max(min, Math.min(max, value));

const asLive2DModel = (display: SceneDisplayObject | null | undefined): Live2DModel | null => {
  if (!display) {
    return null;
  }
  const candidate = display as unknown as Live2DModel;
  if ((candidate as any)?.internalModel) {
    return candidate;
  }
  return null;
};

interface SceneItemInternal extends RuntimeSceneItem {
  asset: DiscoveredAsset;
  dragData?: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
  };
  pixiRef: SceneDisplayObject;
  live2dRef?: Live2DModel | null;
}

export class ItemSceneManager {
  private app: PIXI.Application | null = null;

  private worldContainer: PIXI.Container | null = null;

  private avatarContainer: PIXI.Container | null = null;

  private assets = new Map<string, DiscoveredAsset>();

  private items = new Map<string, SceneItemInternal>();

  private callbacks: ItemSceneCallbacks;

  private currentModelId: string | null = null;

  private itemCounter = 0;

  private avatarScale = 1;

  private avatarModel: Live2DModel | null = null;

  private avatarAttachTargets: SceneDisplayObject[] = [];

  constructor(callbacks: ItemSceneCallbacks) {
    this.callbacks = callbacks;
  }

  public isReady(): boolean {
    return !!this.app && !!this.worldContainer && !!this.avatarContainer;
  }

  public async initialize(canvas: HTMLCanvasElement): Promise<void> {
    this.app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: canvas.parentElement ?? window,
    });

    this.app.renderer.events.domElement = canvas;
    this.app.stage.sortableChildren = true;
    this.worldContainer = new PIXI.Container();
    this.worldContainer.sortableChildren = true;
    this.worldContainer.zIndex = 0;
    this.avatarContainer = new PIXI.Container();
    this.avatarContainer.sortableChildren = true;
    this.avatarContainer.zIndex = 100;
    this.avatarContainer.position.set(0, 0);

    this.app.stage.addChild(this.worldContainer!, this.avatarContainer!);
    this.app.stage.sortChildren();
  }

  public destroy(): void {
    this.clear();

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, baseTexture: true });
      this.app = null;
    }

    this.worldContainer = null;
    this.avatarContainer = null;
  }

  public resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
  }

  public setAssetCatalog(assets: DiscoveredAsset[]): void {
    this.assets.clear();
    assets.forEach((asset) => this.assets.set(asset.assetKey, asset));
  }

  public setCurrentModelId(modelId: string | null): void {
    this.currentModelId = modelId;
    useSceneItemsStore.getState().setCurrentModelId(modelId);
  }

  public clear(): void {
    this.items.forEach((item) => {
      item.pixiRef.removeListener("pointerdown");
      item.pixiRef.removeListener("pointermove");
      item.pixiRef.removeListener("pointerup");
      item.pixiRef.removeListener("pointerupoutside");
      item.pixiRef.removeListener("pointercancel");
      item.pixiRef.parent?.removeChild(item.pixiRef);
      item.live2dRef?.destroy({ children: true });
    });
    this.items.clear();
    useSceneItemsStore.getState().setActiveItems([]);
  }

  public setAvatarTransform(position: { x: number; y: number }, scale: number): void {
    if (!this.avatarContainer) return;
    this.avatarContainer.position.set(position.x, position.y);
    this.avatarContainer.scale.set(scale);
    this.avatarScale = scale;

    this.items.forEach((item) => {
      if (!item.pinnedToAvatar || !item.localPosition) {
        return;
      }
      const world = this.localToWorld(item.localPosition);
      item.worldPosition = world;
      const localScale = item.localScale ?? item.pixiRef.scale.x;
      item.worldScale = localScale * this.avatarScale;
      useSceneItemsStore.getState().updateActiveItem(item.itemId, {
        worldPosition: { ...item.worldPosition },
        worldScale: item.worldScale,
      });
    });
  }

  public async loadAvatarModel(modelJsonUrl: string): Promise<Live2DModel | null> {
    if (!this.avatarContainer) {
      console.warn("[ItemSceneManager] Cannot load avatar model: avatarContainer missing");
      return null;
    }

    await ensureCubismRuntime();
    const Live2DModelClass = await ensureLive2DModelCtor();

    if (this.avatarModel) {
      try {
        this.avatarModel.off("frame", this.updateAttachments, this);
        this.avatarModel.destroy({ children: true, texture: true, baseTexture: true });
      } catch (error) {
        console.warn("[ItemSceneManager] Failed to destroy previous avatar model", error);
      }
      this.avatarModel = null;
    }

    try {
      const model = (await Live2DModelClass.from(modelJsonUrl, { autoInteract: false })) as any;
      model.anchor.set(0.5);
      model.eventMode = "passive";
      model.cursor = "default";
      model.zIndex = 100;
      ensureInteractiveMethod(model);
      const displayModel = model as unknown as PIXI.DisplayObject;
      this.avatarContainer.addChild(displayModel);
      this.avatarContainer.sortChildren();
      this.avatarModel = model;
      this.avatarAttachTargets = this.discoverAttachTargets(model);
      model.on("frame", this.updateAttachments, this);
      return model;
    } catch (error) {
      console.error("[ItemSceneManager] Failed to load avatar model", error);
      return null;
    }
  }

  private newItemId(): string {
    this.itemCounter += 1;
    return `item-${this.itemCounter}`;
  }

  private discoverAttachTargets(model: Live2DModel): SceneDisplayObject[] {
    // Placeholder for future attach-point discovery; items currently don't attach to avatar bones.
    return [model as unknown as SceneDisplayObject];
  }

  private updateAttachments = (): void => {
    if (!this.avatarModel || !this.avatarAttachTargets.length) return;
    // No-op: kept to satisfy frame listener; add attachment sync logic here when needed.
  };

  private async createDisplayObject(
    asset: DiscoveredAsset,
    restored: RestoredSceneItem,
  ): Promise<SceneDisplayObject> {
    await ensureCubismRuntime();
    const Live2DModelClass = await ensureLive2DModelCtor();

    const toFileUrl = async (fsPath: string) => {
      if (!fsPath) return fsPath;
      if (fsPath.startsWith("file://")) return fsPath;
      if (/^(https?|app):\/\//i.test(fsPath)) return fsPath;
      if (windowApi?.resolveFileUrl) {
        try {
          return await windowApi.resolveFileUrl(fsPath);
        } catch (error) {
          console.warn("[ItemSceneManager] resolveFileUrl failed, using fallback", error);
        }
      }
      const normalized = fsPath.replace(/\\/g, "/");
      if (/^[a-zA-Z]:/.test(normalized)) {
        return `file:///${normalized}`;
      }
      return `file://${normalized}`;
    };

    if (asset.kind === "png") {
      let url: string | null = null;
      if (asset.pngUrl) {
        url = asset.pngUrl;
      } else if (asset.pngPath) {
        url = await toFileUrl(asset.pngPath);
      }
      if (!url) {
        throw new Error(`PNG asset ${asset.assetKey} missing accessible source`);
      }
      const texture = await PIXI.Assets.load(url);
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.eventMode = "dynamic";
      sprite.cursor = "pointer";
      ensureInteractiveMethod(sprite);
      return sprite;
    }

    const modelSource = asset.modelJsonUrl ?? asset.modelJsonPath;

    if (!modelSource) {
      throw new Error(`Live2D asset ${asset.assetKey} missing model source`);
    }

    const jsonUrl =
      asset.modelJsonUrl ??
      (await toFileUrl(asset.modelJsonPath!));
    const model = (await Live2DModelClass.from(jsonUrl, {
      autoInteract: false,
    })) as any;
    model.anchor.set(0.5);
    model.interactive = true;
    model.eventMode = "dynamic";
    model.cursor = "pointer";
    // Avatar model z-index relative to its container; container zIndex is set high on stage.
    model.zIndex = 50;
    ensureInteractiveMethod(model);
    if (restored.enableLipSync) {
      const coreModel = (model.internalModel as any)?.coreModel;
      coreModel?.setLipSyncValue?.(0);
    }
    return model as unknown as SceneDisplayObject;
  }

  private bindInteractions(sceneItem: SceneItemInternal): void {
    const display = sceneItem.pixiRef;
    if (!display) return;

    display.eventMode = "dynamic";
    display.on("pointerdown", (event: PIXI.FederatedPointerEvent) => {
      event.stopPropagation();
      display.cursor = "grabbing";
      const { parent } = display;
      if (!parent) {
        return;
      }
      const global = event.getLocalPosition(parent);
      const offsetX = display.position.x - global.x;
      const offsetY = display.position.y - global.y;
      sceneItem.dragData = {
        pointerId: event.pointerId,
        offsetX,
        offsetY,
      };
      display.on("pointermove", this.handlePointerMove, this);
      display.on("pointerup", this.handlePointerUp, this);
      display.on("pointerupoutside", this.handlePointerUp, this);
      display.on("pointercancel", this.handlePointerUp, this);
    });
  }

  private handlePointerMove(event: PIXI.FederatedPointerEvent): void {
    event.stopPropagation();
    const display = event.currentTarget as SceneDisplayObject;
    const item = Array.from(this.items.values()).find(
      (entry) => entry.pixiRef === display,
    );
    if (!item || !item.dragData) return;
    const { parent } = display;
    if (!parent) return;
    const global = event.getLocalPosition(parent);
    const x = global.x + item.dragData.offsetX;
    const y = global.y + item.dragData.offsetY;
    display.position.set(x, y);

    if (item.pinnedToAvatar) {
      item.localPosition = { x, y };
      const world = this.localToWorld({ x, y });
      item.worldPosition = world;
    } else {
      item.worldPosition = { x, y };
      if (item.localPosition) {
        item.localPosition = undefined;
      }
    }

    useSceneItemsStore.getState().updateActiveItem(item.itemId, {
      worldPosition: { ...item.worldPosition },
      localPosition: item.localPosition ? { ...item.localPosition } : undefined,
    });
  }

  private handlePointerUp(event: PIXI.FederatedPointerEvent): void {
    event.stopPropagation();
    const display = event.currentTarget as SceneDisplayObject;
    display.cursor = "pointer";
    const item = Array.from(this.items.values()).find(
      (entry) => entry.pixiRef === display,
    );
    if (!item) return;
    display.removeListener("pointermove", this.handlePointerMove, this);
    display.removeListener("pointerup", this.handlePointerUp, this);
    display.removeListener("pointerupoutside", this.handlePointerUp, this);
    display.removeListener("pointercancel", this.handlePointerUp, this);
    item.dragData = undefined;
    this.callbacks.onDragComplete(item);
  }

  private applyTransform(display: SceneDisplayObject, transform: PersistedTransform): void {
    display.position.set(transform.x, transform.y);
    display.scale.set(transform.scale);
    display.zIndex = transform.zIndex;
  }

  private worldToLocal(position: { x: number; y: number }): { x: number; y: number } {
    if (!this.avatarContainer) return position;
    const point = new PIXI.Point(position.x, position.y);
    const local = this.avatarContainer.toLocal(point);
    return { x: local.x, y: local.y };
  }

  private localToWorld(position: { x: number; y: number }): { x: number; y: number } {
    if (!this.avatarContainer) return position;
    const point = new PIXI.Point(position.x, position.y);
    const global = this.avatarContainer.toGlobal(point);
    return { x: global.x, y: global.y };
  }

  private extractLive2DMetadata(model: Live2DModel | null | undefined) {
    if (!model) {
      return {
        expressions: [] as string[],
        motions: [] as string[],
      };
    }

    const expressions: string[] = [];
    const motions: string[] = [];

    try {
      const settings = (model as any).internalModel?.settings;
      if (settings?.expressions) {
        for (const expr of settings.expressions) {
          if (expr.Name) {
            expressions.push(expr.Name);
          } else if (expr.name) {
            expressions.push(expr.name);
          }
        }
      }
      if (settings?.motions) {
        for (const groupName of Object.keys(settings.motions)) {
          const group = settings.motions[groupName];
          if (Array.isArray(group)) {
            group.forEach((entry: any, index: number) => {
              if (entry.File) {
                motions.push(`${groupName}:${index}`);
              } else if (entry.name) {
                motions.push(entry.name);
              }
            });
          }
        }
      }
    } catch (error) {
      console.warn("[ItemSceneManager] Failed to read Live2D metadata", error);
    }

    return {
      expressions,
      motions,
    };
  }

  private applyLive2DState(
    model: Live2DModel | null | undefined,
    restored: RestoredSceneItem,
  ): void {
    if (!model) return;
    if (restored.lastExpression) {
      try {
        (model as any).expression = restored.lastExpression;
      } catch (error) {
        console.warn("[ItemSceneManager] Failed to set Live2D expression", error);
      }
    }

    if (restored.lastMotion) {
      const [groupName, motionIndexRaw] = restored.lastMotion.split(":");
      const index = Number(motionIndexRaw);
      if (Number.isFinite(index)) {
        try {
          (model as any).motion(groupName, index);
        } catch (error) {
          console.warn("[ItemSceneManager] Failed to set Live2D motion", error);
        }
      }
    }
  }

  public async spawnItem(
    assetKey: string,
    restored: RestoredSceneItem,
    options: { itemId?: string } = {},
  ): Promise<RuntimeSceneItem> {
    if (!this.worldContainer || !this.avatarContainer || !this.currentModelId) {
      throw new Error("ItemSceneManager not initialized with model context");
    }

    const needsDefaultTransform =
      (!restored.worldTransform || Number.isNaN(restored.worldTransform.x)) &&
      (!restored.localTransform || Number.isNaN(restored.localTransform.x));
    if (needsDefaultTransform) {
      const { width, height } = this.getStageSize();
      const center = { x: width / 2, y: height / 2 };
      const defaultScale =
        restored.worldTransform?.scale ?? restored.localTransform?.scale ?? DEFAULT_ITEM_SCALE;
      const defaultZ = restored.worldTransform?.zIndex ?? restored.localTransform?.zIndex ?? 0;
      if (this.avatarContainer) {
        // Spawn on the avatar: place at its origin in local space, then compute world
        const local = this.avatarContainer.toLocal(new PIXI.Point(center.x, center.y));
        restored.localTransform = {
          x: local.x,
          y: local.y,
          scale: defaultScale,
          zIndex: defaultZ,
        };
        restored.pinnedToAvatar = true;
      } else {
        restored.worldTransform = {
          x: center.x,
          y: center.y,
          scale: defaultScale,
          zIndex: defaultZ,
        };
      }
    }

    const catalogAsset = this.assets.get(assetKey);
    if (!catalogAsset) {
      throw new Error(`Asset ${assetKey} not found in catalog`);
    }

    const pixiRef = await this.createDisplayObject(catalogAsset, restored);
    const itemId = options.itemId ?? this.newItemId();

    const live2dRef = catalogAsset.kind === "live2d" ? asLive2DModel(pixiRef) : null;

    const sceneItem: SceneItemInternal = {
      itemId,
      assetKey,
      kind: catalogAsset.kind,
      pixiRef,
      visible: true,
      pinnedToAvatar: restored.pinnedToAvatar,
      worldPosition: restored.worldTransform
        ? { ...restored.worldTransform }
        : restored.localTransform
          ? this.localToWorld(restored.localTransform)
          : { x: 0, y: 0 },
      worldScale:
        restored.worldTransform?.scale ?? restored.localTransform?.scale ?? DEFAULT_ITEM_SCALE,
      worldZIndex: restored.worldTransform?.zIndex ?? restored.localTransform?.zIndex ?? 0,
      localPosition: restored.localTransform
        ? { ...restored.localTransform }
        : restored.pinnedToAvatar
          ? this.worldToLocal(restored.worldTransform ?? { x: 0, y: 0 })
          : undefined,
      localScale: restored.localTransform?.scale,
      localZIndex: restored.localTransform?.zIndex,
      availableExpressions: undefined,
      availableMotions: undefined,
      currentExpression: restored.lastExpression ?? null,
      currentMotion: restored.lastMotion ?? null,
      enableLipSync: restored.enableLipSync ?? false,
      asset: catalogAsset,
      live2dRef,
    };

    if (restored.pinnedToAvatar) {
      const transform = restored.localTransform ?? {
        x: sceneItem.worldPosition.x,
        y: sceneItem.worldPosition.y,
        scale: restored.worldTransform?.scale ?? DEFAULT_ITEM_SCALE,
        zIndex: restored.worldTransform?.zIndex ?? 0,
      };
      this.avatarContainer!.addChild(pixiRef);
      this.avatarContainer!.sortChildren();
      this.applyTransform(pixiRef, transform);
      sceneItem.localPosition = { x: pixiRef.position.x, y: pixiRef.position.y };
      sceneItem.localScale = pixiRef.scale.x;
      sceneItem.localZIndex = pixiRef.zIndex;
      sceneItem.worldPosition = this.localToWorld({ x: pixiRef.position.x, y: pixiRef.position.y });
      sceneItem.worldScale = pixiRef.scale.x * this.avatarScale;
    } else {
      const transform = restored.worldTransform ?? {
        x: sceneItem.worldPosition.x,
        y: sceneItem.worldPosition.y,
        scale: sceneItem.worldScale,
        zIndex: sceneItem.worldZIndex,
      };
      this.app!.stage.addChild(pixiRef);
      this.app!.stage.sortChildren();
      this.applyTransform(pixiRef, transform);
      sceneItem.worldPosition = { x: pixiRef.position.x, y: pixiRef.position.y };
      sceneItem.worldScale = pixiRef.scale.x;
      sceneItem.worldZIndex = pixiRef.zIndex;
    }

    this.bindInteractions(sceneItem);

    if (catalogAsset.kind === "live2d") {
      const metadata = this.extractLive2DMetadata(sceneItem.live2dRef);
      sceneItem.availableExpressions = metadata.expressions;
      sceneItem.availableMotions = metadata.motions;
      this.applyLive2DState(sceneItem.live2dRef, restored);
    }

    this.items.set(itemId, sceneItem);
    useSceneItemsStore.getState().addActiveItem(sceneItem);
    return sceneItem;
  }

  public getItem(itemId: string): SceneItemInternal | undefined {
    return this.items.get(itemId);
  }

  public getItemsByAsset(assetKey: string): SceneItemInternal[] {
    return Array.from(this.items.values()).filter((item) => item.assetKey === assetKey);
  }

  public removeItem(itemId: string): void {
    const item = this.items.get(itemId);
    if (!item) return;
    if (item.live2dRef) {
      item.live2dRef.destroy({ children: true });
    }
    item.pixiRef.removeAllListeners();
    item.pixiRef.parent?.removeChild(item.pixiRef);
    this.items.delete(itemId);
    useSceneItemsStore.getState().removeActiveItem(itemId);
  }

  public listActiveSummaries(): SceneItemSummary[] {
    return useSceneItemsStore.getState().getSummaries();
  }

  public getStageSize(): { width: number; height: number } {
    if (!this.app) {
      return { width: 0, height: 0 };
    }
    return {
      width: this.app.renderer.width,
      height: this.app.renderer.height,
    };
  }

  public recenterItem(itemId: string): SceneItemInternal | undefined {
    const item = this.items.get(itemId);
    if (!item) return undefined;
    const { width, height } = this.getStageSize();
    const targetPosition = { x: width / 2, y: height / 2 };

    if (item.pinnedToAvatar) {
      const local = this.avatarContainer
        ? this.avatarContainer.toLocal(new PIXI.Point(targetPosition.x, targetPosition.y))
        : targetPosition;
      const localScale =
        item.localScale !== undefined
          ? item.localScale
          : item.worldScale / (this.avatarScale === 0 ? 1 : this.avatarScale);
      this.setItemLocalTransform(itemId, {
        x: local.x,
        y: local.y,
        scale: localScale,
        zIndex: item.localZIndex ?? item.worldZIndex,
      });
    } else {
      this.setItemWorldTransform(itemId, {
        x: targetPosition.x,
        y: targetPosition.y,
        scale: item.worldScale,
        zIndex: item.worldZIndex,
      });
    }

    return this.items.get(itemId);
  }

  public getOutgoingItemsPayload() {
    return Array.from(this.items.values()).map((item) => ({
      assetKey: item.assetKey,
      kind: item.kind as ItemKind,
      pinnedToAvatar: item.pinnedToAvatar,
      worldPosition: {
        x: item.worldPosition.x,
        y: item.worldPosition.y,
      },
      worldScale: item.worldScale,
      worldZIndex: item.worldZIndex,
      localPosition: item.localPosition
        ? { x: item.localPosition.x, y: item.localPosition.y }
        : undefined,
      localScale: item.localScale,
      localZIndex: item.localZIndex,
      currentExpression: item.currentExpression ?? null,
      currentMotion: item.currentMotion ?? null,
      enableLipSync: item.enableLipSync ?? false,
    }));
  }

  public setItemPinned(itemId: string, pinned: boolean): SceneItemInternal | undefined {
    const item = this.items.get(itemId);
    if (!item || !this.avatarContainer || !this.worldContainer || !this.app) return undefined;
    const display = item.pixiRef;
    const globalPos = display.parent?.toGlobal(display.position) ?? new PIXI.Point(display.position.x, display.position.y);
    const avatarScaleSafe = this.avatarScale === 0 ? 1 : this.avatarScale;

    if (pinned) {
      const local = this.avatarContainer.toLocal(globalPos);
      const worldScaleBefore = item.worldScale ?? display.scale.x;
      const localScale = worldScaleBefore / avatarScaleSafe;
      display.parent?.removeChild(display);
      this.avatarContainer.addChild(display);
      this.avatarContainer.sortChildren();
      display.position.copyFrom(local);
      display.scale.set(localScale);
      item.pinnedToAvatar = true;
      item.localPosition = { x: local.x, y: local.y };
      item.localScale = localScale;
      item.localZIndex = display.zIndex;
      item.worldPosition = this.localToWorld({ x: local.x, y: local.y });
      item.worldScale = worldScaleBefore;
    } else {
      const world = this.app.stage.toLocal(globalPos);
      const worldScaleBefore = item.worldScale ?? (display.scale.x * avatarScaleSafe);
      display.parent?.removeChild(display);
      this.app.stage.addChild(display);
      this.app.stage.sortChildren();
      display.position.copyFrom(world);
      display.scale.set(worldScaleBefore);
      item.pinnedToAvatar = false;
      item.localPosition = undefined;
      item.localScale = undefined;
      item.localZIndex = undefined;
      item.worldPosition = { x: world.x, y: world.y };
      item.worldScale = worldScaleBefore;
    }

    item.worldZIndex = display.zIndex;

    useSceneItemsStore.getState().updateActiveItem(itemId, {
      pinnedToAvatar: item.pinnedToAvatar,
      worldPosition: { ...item.worldPosition },
      worldScale: item.worldScale,
      worldZIndex: item.worldZIndex,
      localPosition: item.localPosition ? { ...item.localPosition } : undefined,
      localScale: item.localScale,
      localZIndex: item.localZIndex,
    });

    return item;
  }

  public setItemWorldTransform(itemId: string, transform: PersistedTransform): void {
    const item = this.items.get(itemId);
    if (!item) return;
    const display = item.pixiRef;
    display.position.set(transform.x, transform.y);
    display.scale.set(transform.scale);
    display.zIndex = transform.zIndex;
    item.worldPosition = { x: transform.x, y: transform.y };
    item.worldScale = transform.scale;
    item.worldZIndex = transform.zIndex;
    if (item.pinnedToAvatar) {
      item.localPosition = this.worldToLocal(item.worldPosition);
      item.localScale = transform.scale / this.avatarScale;
      item.localZIndex = transform.zIndex;
    }
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      worldPosition: { ...item.worldPosition },
      worldScale: item.worldScale,
      worldZIndex: item.worldZIndex,
      localPosition: item.localPosition ? { ...item.localPosition } : undefined,
      localScale: item.localScale,
      localZIndex: item.localZIndex,
    });
  }

  public setItemLocalTransform(itemId: string, transform: PersistedTransform): void {
    const item = this.items.get(itemId);
    if (!item) return;
    const display = item.pixiRef;
    display.position.set(transform.x, transform.y);
    display.scale.set(transform.scale);
    display.zIndex = transform.zIndex;
    item.localPosition = { x: transform.x, y: transform.y };
    item.localScale = transform.scale;
    item.localZIndex = transform.zIndex;
    item.worldPosition = this.localToWorld(item.localPosition);
    item.worldScale = transform.scale * this.avatarScale;
    item.worldZIndex = transform.zIndex;
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      worldPosition: { ...item.worldPosition },
      worldScale: item.worldScale,
      worldZIndex: item.worldZIndex,
      localPosition: { ...item.localPosition },
      localScale: item.localScale,
      localZIndex: item.localZIndex,
    });
  }

  public setItemScale(itemId: string, scale: number): void {
    const item = this.items.get(itemId);
    if (!item) return;
    item.pixiRef.scale.set(scale);
    if (item.pinnedToAvatar) {
      item.localScale = scale;
      item.worldScale = scale * this.avatarScale;
      item.pixiRef.parent?.sortChildren();
    } else {
      item.worldScale = scale;
      this.app?.stage.sortChildren();
    }
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      worldScale: item.worldScale,
      localScale: item.localScale,
    });
    this.callbacks.onScaleChange(item);
  }

  public adjustItemScale(itemId: string, deltaY: number): SceneItemInternal | undefined {
    const item = this.items.get(itemId);
    if (!item) return undefined;
    const baseScale = item.pinnedToAvatar
      ? item.localScale ?? item.worldScale
      : item.worldScale;
    const sensitivity = 0.0015;
    const factor = 1 - deltaY * sensitivity;
    const nextScale = clampScale(baseScale * factor);
    this.setItemScale(itemId, nextScale);
    return this.items.get(itemId);
  }

  public setItemZIndex(itemId: string, zIndex: number): void {
    const item = this.items.get(itemId);
    if (!item) return;
    item.pixiRef.zIndex = zIndex;
    if (item.pinnedToAvatar) {
      item.localZIndex = zIndex;
      item.pixiRef.parent?.sortChildren();
    } else {
      item.worldZIndex = zIndex;
      item.pixiRef.parent?.sortChildren();
    }
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      worldZIndex: item.worldZIndex,
      localZIndex: item.localZIndex,
    });
  }

  public setItemExpression(itemId: string, expression: string | null): void {
    const item = this.items.get(itemId);
    if (!item || item.kind !== "live2d" || !item.live2dRef) return;
    item.currentExpression = expression;
    if (expression) {
      try {
        (item.live2dRef as any).expression = expression;
      } catch (error) {
        console.warn("[ItemSceneManager] Failed to set expression", error);
      }
    }
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      currentExpression: expression,
    });
  }

  public playItemMotion(itemId: string, motion: string | null): void {
    const item = this.items.get(itemId);
    if (!item || item.kind !== "live2d" || !item.live2dRef || !motion) return;
    const [group, indexRaw] = motion.split(":");
    const index = Number(indexRaw);
    try {
      if (Number.isFinite(index)) {
        (item.live2dRef as any).motion(group, index);
        item.currentMotion = motion;
        useSceneItemsStore.getState().updateActiveItem(itemId, {
          currentMotion: motion,
        });
      }
    } catch (error) {
      console.warn("[ItemSceneManager] Failed to play motion", error);
    }
  }

  public setItemLipSync(itemId: string, enabled: boolean): void {
    const item = this.items.get(itemId);
    if (!item) return;
    item.enableLipSync = enabled;
    useSceneItemsStore.getState().updateActiveItem(itemId, {
      enableLipSync: enabled,
    });
  }

  public applyLipSyncValue(value: number): void {
    if (!this.app || this.items.size === 0) return;
    const clamped = Math.max(0, Math.min(1, value));
    for (const item of this.items.values()) {
      if (!item.enableLipSync || item.kind !== "live2d" || !item.live2dRef) continue;
      const coreModel = (item.live2dRef as any)?.internalModel?.coreModel;
      coreModel?.setLipSyncValue?.(clamped);
      // Also drive the mouth open parameter directly for models that don't react to lipSyncValue
      coreModel?.setParameterValueById?.("ParamMouthOpenY", clamped);
    }
  }

  public isPointerOverItem(domX: number, domY: number): boolean {
    if (!this.app) return false;
    const renderer: any = this.app.renderer as any;
    const pos = new PIXI.Point(domX, domY);
    if (renderer?.events?.mapPositionToPoint) {
      renderer.events.mapPositionToPoint(pos, domX, domY);
    }
    for (const item of this.items.values()) {
      const bounds = item.pixiRef.getBounds();
      if (bounds.contains(pos.x, pos.y)) {
        return true;
      }
    }
    return false;
  }

  public getItemAtPoint(domX: number, domY: number): SceneItemInternal | null {
    if (!this.app) return null;
    const renderer: any = this.app.renderer as any;
    const pos = new PIXI.Point(domX, domY);
    if (renderer?.events?.mapPositionToPoint) {
      renderer.events.mapPositionToPoint(pos, domX, domY);
    }
    let hit: SceneItemInternal | null = null;
    let topZ = -Infinity;
    this.items.forEach((item) => {
      const bounds = item.pixiRef.getBounds();
      if (!bounds.contains(pos.x, pos.y)) return;
      const z = item.pixiRef.zIndex ?? 0;
      if (hit === null || z >= topZ) {
        hit = item;
        topZ = z;
      }
    });
    return hit;
  }
}
