/* eslint-disable class-methods-use-this, no-nested-ternary */
import {
  DiscoveredAsset,
  LoadMainModelPayload,
  LoadMainModelResult,
  PersistedTransform,
  RestoredSceneItem,
  RuntimeSceneItem,
  SceneItemSummary,
} from "../../../../shared/items";
import { ItemSceneManager } from "./item-scene-manager";
import { useSceneItemsStore } from "../../store/scene-items-store";

type DragCompleteHandler = (item: RuntimeSceneItem) => void;
type ScaleChangeHandler = (item: RuntimeSceneItem) => void;

const windowApi = (window as any).api;

export class ItemsRuntime {
  private scene: ItemSceneManager;

  private assetsCatalog: DiscoveredAsset[] = [];

  private currentModelId: string | null = null;

  private itemsBaseUrl: string | null = null;

  private dragCompleteHandler: DragCompleteHandler;

  private scaleChangeHandler: ScaleChangeHandler;

  private pendingOutgoing: LoadMainModelPayload["outgoingItems"] | null = null;

  private pendingModelId: string | null = null;

  private static normalizeTransform(
    item: RestoredSceneItem,
  ): { pinned: boolean; transform: PersistedTransform } {
    const fallback: PersistedTransform = { x: 0, y: 0, scale: 1, zIndex: 0 };
    if (item.pinnedToAvatar) {
      return {
        pinned: true,
        transform: item.localTransform ?? item.worldTransform ?? fallback,
      };
    }
    return {
      pinned: false,
      transform: item.worldTransform ?? item.localTransform ?? fallback,
    };
  }

  private async enforceSingleLive2dOnLoad(
    modelId: string,
    sceneItems: RestoredSceneItem[],
  ): Promise<RestoredSceneItem[]> {
    const live2dItems = sceneItems.filter((item) => item.kind === "live2d");
    if (live2dItems.length <= 1) {
      return sceneItems;
    }

    const [keep, ...toRemove] = live2dItems;
    await Promise.all(
      toRemove.map(async (item) => {
        const { pinned, transform } = ItemsRuntime.normalizeTransform(item);
        await windowApi.hideItem({
          modelId,
          assetKey: item.assetKey,
          pinned,
          transform,
          expression: item.lastExpression ?? null,
          motion: item.lastMotion ?? null,
          enableLipSync: item.enableLipSync ?? false,
        });
      }),
    );

    return sceneItems.filter(
      (item) => item.kind !== "live2d" || item.assetKey === keep.assetKey,
    );
  }

  private async enforceSingleLive2dActive(): Promise<void> {
    const live2dItems = this.getActiveSceneItems().filter((item) => item.kind === "live2d");
    if (live2dItems.length <= 1) return;
    // Keep the first, hide the rest
    const [, ...toHide] = live2dItems;
    await Promise.all(
      toHide.map((item) => this.hideItem(item.itemId).catch(() => undefined)),
    );
  }

  constructor(opts: { onDragComplete: DragCompleteHandler; onScaleChange: ScaleChangeHandler }) {
    this.dragCompleteHandler = opts.onDragComplete;
    this.scaleChangeHandler = opts.onScaleChange;
    this.scene = new ItemSceneManager({
      onDragComplete: (item) => this.dragCompleteHandler(item),
      onScaleChange: (item) => this.scaleChangeHandler(item),
    });
  }

  public async initialize(canvas: HTMLCanvasElement): Promise<void> {
    await this.scene.initialize(canvas);
    if (this.assetsCatalog.length === 0) {
      await this.refreshCatalog();
    }
  }

  public destroy(): void {
    this.pendingOutgoing = this.scene.getOutgoingItemsPayload();
    this.pendingModelId = this.currentModelId;
    this.scene.destroy();
    this.currentModelId = null;
  }

  public resize(width: number, height: number): void {
    this.scene.resize(width, height);
  }

  public setAvatarTransform(position: { x: number; y: number }, scale: number): void {
    this.scene.setAvatarTransform(position, scale);
  }

  public async refreshCatalog(): Promise<DiscoveredAsset[]> {
    const catalog = await windowApi.listAvailableItemAssets();
    this.assetsCatalog = catalog;
    this.scene.setAssetCatalog(catalog);
    return catalog;
  }

  public getCatalog(): DiscoveredAsset[] {
    return this.assetsCatalog;
  }

  public getSceneManager(): ItemSceneManager {
    return this.scene;
  }

  public isPointerOverItem(domX: number, domY: number): boolean {
    return this.scene.isPointerOverItem(domX, domY);
  }

  private buildLoadPayload(newModelId: string): LoadMainModelPayload {
    const outgoing = this.scene.getOutgoingItemsPayload();
    const outgoingItems =
      outgoing.length > 0
        ? outgoing
        : this.pendingOutgoing
          ? [...this.pendingOutgoing]
          : [];
    const currentModelId = this.currentModelId ?? this.pendingModelId ?? null;

    return {
      currentModelId,
      newModelId,
      itemsBaseUrl: this.itemsBaseUrl ?? null,
      outgoingItems,
    };
  }

  private async spawnRestoredItems(result: LoadMainModelResult): Promise<void> {
    const { sceneItems } = result;
    const spawnPromises = sceneItems.map((restored) => this.scene.spawnItem(restored.assetKey, restored));
    await Promise.all(spawnPromises);
  }

  public async loadMainModel(
    newModelId: string,
    itemsBaseUrl?: string | null,
  ): Promise<void> {
    if (!this.scene.isReady()) {
      throw new Error("ItemsRuntime not initialized");
    }

    let baseChanged = false;
    if (itemsBaseUrl !== undefined) {
      const normalized =
        itemsBaseUrl && itemsBaseUrl.length > 0
          ? itemsBaseUrl.replace(/\/+$/, "")
          : null;
      baseChanged = normalized !== this.itemsBaseUrl;
      this.itemsBaseUrl = normalized;
    }

    const payload = this.buildLoadPayload(newModelId);
    const result: LoadMainModelResult = await windowApi.loadMainModelScene(payload);

    this.scene.clear();

    this.currentModelId = newModelId;
    this.pendingOutgoing = null;
    this.pendingModelId = null;
    this.scene.setCurrentModelId(newModelId);

    // Ensure catalog covers all restored assets
    const missingAssets = result.sceneItems
      .map((item) => item.assetKey)
      .filter((assetKey) => !this.assetsCatalog.find((asset) => asset.assetKey === assetKey));
    if (missingAssets.length > 0) {
      await this.refreshCatalog();
    } else if (baseChanged || this.assetsCatalog.length === 0) {
      await this.refreshCatalog();
    }

    const normalizedSceneItems = await this.enforceSingleLive2dOnLoad(newModelId, result.sceneItems);
    const normalizedResult: LoadMainModelResult = {
      ...result,
      sceneItems: normalizedSceneItems,
      visibleItems: normalizedSceneItems.map((item) => item.assetKey),
    };

    await this.spawnRestoredItems(normalizedResult);
  }

  public listActiveItems(): SceneItemSummary[] {
    return this.scene.listActiveSummaries();
  }

  public getActiveSceneItems(): RuntimeSceneItem[] {
    return useSceneItemsStore.getState().activeItems;
  }

  public async showItem(assetKey: string): Promise<RuntimeSceneItem> {
    if (!this.currentModelId) {
      throw new Error("Cannot show item before model is loaded");
    }

    const catalogAsset = this.assetsCatalog.find((asset) => asset.assetKey === assetKey);
    if (catalogAsset?.kind === "live2d") {
      await this.enforceSingleLive2dActive();
    }

    const restored: RestoredSceneItem = await windowApi.showItem(this.currentModelId, assetKey);
    const item = await this.scene.spawnItem(assetKey, restored);
    await this.refreshCatalog(); // ensure catalog contains new entry updates if any
    return item;
  }

  public async hideItem(itemId: string): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || !this.currentModelId) return;

    await windowApi.hideItem({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: {
        x: item.pinnedToAvatar ? item.localPosition?.x ?? 0 : item.worldPosition.x,
        y: item.pinnedToAvatar ? item.localPosition?.y ?? 0 : item.worldPosition.y,
        scale: item.pinnedToAvatar ? item.localScale ?? item.worldScale : item.worldScale,
        zIndex: item.pinnedToAvatar
          ? item.localZIndex ?? item.worldZIndex
          : item.worldZIndex,
      },
      expression: item.currentExpression ?? null,
      motion: item.currentMotion ?? null,
      enableLipSync: item.enableLipSync ?? false,
    });

    this.scene.removeItem(itemId);
  }

  public async setItemPinned(itemId: string, pinned: boolean): Promise<void> {
    const item = this.scene.setItemPinned(itemId, pinned);
    if (!item || !this.currentModelId) return;
    await windowApi.setItemPinned({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      localTransform: item.localPosition
        ? {
          x: item.localPosition.x,
          y: item.localPosition.y,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : undefined,
      worldTransform: {
        x: item.worldPosition.x,
        y: item.worldPosition.y,
        scale: item.worldScale,
        zIndex: item.worldZIndex,
      },
    });
  }

  public async moveItem(itemId: string, position: { x: number; y: number }): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || !this.currentModelId) return;
    if (item.pinnedToAvatar) {
      this.scene.setItemLocalTransform(itemId, {
        x: position.x,
        y: position.y,
        scale: item.localScale ?? item.worldScale,
        zIndex: item.localZIndex ?? item.worldZIndex,
      });
    } else {
      this.scene.setItemWorldTransform(itemId, {
        x: position.x,
        y: position.y,
        scale: item.worldScale,
        zIndex: item.worldZIndex,
      });
    }

    await windowApi.setItemTransform({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? position.x,
          y: item.localPosition?.y ?? position.y,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  }

  public async setItemScale(itemId: string, scale: number): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || !this.currentModelId) return;
    this.scene.setItemScale(itemId, scale);

    await windowApi.setItemScale({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? scale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  }

  public async adjustItemScaleFromWheel(itemId: string, deltaY: number): Promise<void> {
    const item = this.scene.adjustItemScale(itemId, deltaY);
    if (!item || !this.currentModelId) return;
    await windowApi.setItemScale({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  }

  public async setItemZIndex(itemId: string, zIndex: number): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || !this.currentModelId) return;
    this.scene.setItemZIndex(itemId, zIndex);

    await windowApi.setItemZIndex({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? zIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  }

  public async setItemExpression(itemId: string, expression: string | null): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || item.kind !== "live2d" || !this.currentModelId) return;
    this.scene.setItemExpression(itemId, expression);
    await windowApi.setItemExpression(item.assetKey, expression);
  }

  public async playItemMotion(itemId: string, motion: string | null): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || item.kind !== "live2d" || !this.currentModelId) return;
    if (!motion) return;
    this.scene.playItemMotion(itemId, motion);
    await windowApi.playItemMotion(item.assetKey, motion);
  }

  public async setItemLipSync(itemId: string, enabled: boolean): Promise<void> {
    const item = this.scene.getItem(itemId);
    if (!item || item.kind !== "live2d" || !this.currentModelId) return;
    this.scene.setItemLipSync(itemId, enabled);
    await windowApi.setItemLipSync(item.assetKey, enabled);
  }

  public applyMicLipSync(value: number): void {
    if (!this.scene.isReady()) return;
    this.scene.applyLipSyncValue(value);
  }

  public async recenterItem(itemId: string): Promise<void> {
    const item = this.scene.recenterItem(itemId);
    if (!item || !this.currentModelId) return;
    await windowApi.setItemTransform({
      modelId: this.currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  }
}

export const itemsRuntime = new ItemsRuntime({
  onDragComplete: async (item: RuntimeSceneItem) => {
    if (!itemsRuntime) return;
    const { currentModelId } = useSceneItemsStore.getState();
    if (!currentModelId) return;
    await windowApi.setItemTransform({
      modelId: currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  },
  onScaleChange: async (item: RuntimeSceneItem) => {
    if (!itemsRuntime) return;
    const { currentModelId } = useSceneItemsStore.getState();
    if (!currentModelId) return;
    await windowApi.setItemScale({
      modelId: currentModelId,
      assetKey: item.assetKey,
      pinned: item.pinnedToAvatar,
      transform: item.pinnedToAvatar
        ? {
          x: item.localPosition?.x ?? 0,
          y: item.localPosition?.y ?? 0,
          scale: item.localScale ?? item.worldScale,
          zIndex: item.localZIndex ?? item.worldZIndex,
        }
        : {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        },
    });
  },
});
/* eslint-disable class-methods-use-this, no-nested-ternary */
