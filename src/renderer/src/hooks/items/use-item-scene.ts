import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DiscoveredAsset,
  ItemKind,
} from "../../../../shared/items";
import { itemsRuntime } from "../../services/items/items-runtime";
import { useSceneItemsStore } from "../../store/scene-items-store";

export interface ActiveSceneItem {
  itemId: string;
  assetKey: string;
  kind: ItemKind;
  pinnedToAvatar: boolean;
  worldX: number;
  worldY: number;
  scale: number;
  zIndex: number;
  visible: boolean;
  availableExpressions?: string[];
  availableMotions?: string[];
  currentExpression?: string | null;
  currentMotion?: string | null;
  enableLipSync?: boolean;
}

export const useItemScene = () => {
  const activeItemsRaw = useSceneItemsStore((state) => state.activeItems);
  const currentModelId = useSceneItemsStore((state) => state.currentModelId);
  const editingItemId = useSceneItemsStore((state) => state.editingItemId);
  const setEditingItemId = useSceneItemsStore((state) => state.setEditingItemId);
  const [catalog, setCatalog] = useState<DiscoveredAsset[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const activeItems: ActiveSceneItem[] = useMemo(
    () => activeItemsRaw.map((item) => ({
      itemId: item.itemId,
      assetKey: item.assetKey,
      kind: item.kind,
      pinnedToAvatar: item.pinnedToAvatar,
      worldX: item.worldPosition.x,
      worldY: item.worldPosition.y,
      scale: item.pinnedToAvatar
        ? item.localScale ?? item.worldScale
        : item.worldScale,
      zIndex: item.pinnedToAvatar
        ? item.localZIndex ?? item.worldZIndex
        : item.worldZIndex,
      visible: item.visible,
      availableExpressions: item.availableExpressions,
      availableMotions: item.availableMotions,
      currentExpression: item.currentExpression,
      currentMotion: item.currentMotion,
      enableLipSync: item.enableLipSync,
    })),
    [activeItemsRaw],
  );

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const assets = await itemsRuntime.refreshCatalog();
      setCatalog(assets);
    } catch (error) {
      console.error("[useItemScene] Failed to refresh catalog", error);
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    if (!currentModelId) {
      return;
    }
    refreshCatalog();
  }, [refreshCatalog, currentModelId]);

  useEffect(() => {
    if (!editingItemId) return;
    const stillExists = activeItemsRaw.some((item) => item.itemId === editingItemId);
    if (!stillExists) {
      setEditingItemId(null);
    }
  }, [activeItemsRaw, editingItemId, setEditingItemId]);

  const showItem = useCallback(
    async (assetKey: string) => {
      if (!currentModelId) {
        return;
      }
      await itemsRuntime.showItem(assetKey);
    },
    [currentModelId],
  );

  const hideItem = useCallback(async (itemId: string) => {
    if (!currentModelId) return;
    await itemsRuntime.hideItem(itemId);
  }, [currentModelId]);

  const setPinned = useCallback(
    async (itemId: string, pinned: boolean) => {
      if (!currentModelId) return;
      await itemsRuntime.setItemPinned(itemId, pinned);
    },
    [currentModelId],
  );

  const moveItem = useCallback(
    async (itemId: string, position: { x: number; y: number }) => {
      if (!currentModelId) return;
      await itemsRuntime.moveItem(itemId, position);
    },
    [currentModelId],
  );

  const setScale = useCallback(
    async (itemId: string, scale: number) => {
      if (!currentModelId) return;
      await itemsRuntime.setItemScale(itemId, scale);
    },
    [currentModelId],
  );

  const setZIndex = useCallback(
    async (itemId: string, zIndex: number) => {
      if (!currentModelId) return;
      await itemsRuntime.setItemZIndex(itemId, zIndex);
    },
    [currentModelId],
  );

  const setExpression = useCallback(
    async (itemId: string, expression: string | null) => {
      if (!currentModelId) return;
      await itemsRuntime.setItemExpression(itemId, expression);
    },
    [currentModelId],
  );

  const playMotion = useCallback(
    async (itemId: string, motion: string | null) => {
      if (!currentModelId || !motion) return;
      await itemsRuntime.playItemMotion(itemId, motion);
    },
    [currentModelId],
  );

  const setLipSync = useCallback(
    async (itemId: string, enabled: boolean) => {
      if (!currentModelId) return;
      await itemsRuntime.setItemLipSync(itemId, enabled);
    },
    [currentModelId],
  );

  const recenterItem = useCallback(async (itemId: string) => {
    if (!currentModelId) return;
    await itemsRuntime.recenterItem(itemId);
  }, [currentModelId]);

  return {
    catalog,
    loadingCatalog,
    activeItems,
    runtimeReady: Boolean(currentModelId),
    currentModelId,
    editingItemId,
    showItem,
    hideItem,
    setPinned,
    moveItem,
    setScale,
    setZIndex,
    setExpression,
    playMotion,
    setLipSync,
    recenterItem,
    refreshCatalog,
    setEditingItemId,
  };
};
