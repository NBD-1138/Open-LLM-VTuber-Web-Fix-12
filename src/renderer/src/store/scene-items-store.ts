import { create } from "zustand";
import type {
  RuntimeSceneItem,
  SceneItemSummary,
} from "../../../shared/items";

export interface SceneItemsState {
  currentModelId: string | null;
  activeItems: RuntimeSceneItem[];
  editingItemId: string | null;
  setCurrentModelId: (modelId: string | null) => void;
  setActiveItems: (items: RuntimeSceneItem[]) => void;
  addActiveItem: (item: RuntimeSceneItem) => void;
  updateActiveItem: (
    itemId: string,
    updater: Partial<RuntimeSceneItem>,
  ) => void;
  removeActiveItem: (itemId: string) => void;
  setEditingItemId: (itemId: string | null) => void;
  getSummaries: () => SceneItemSummary[];
}

export const useSceneItemsStore = create<SceneItemsState>((set, get) => ({
  currentModelId: null,
  activeItems: [],
  editingItemId: null,
  setCurrentModelId: (modelId) => set({ currentModelId: modelId }),
  setActiveItems: (items) => set({ activeItems: items }),
  addActiveItem: (item) => set((state) => ({
    activeItems: [...state.activeItems, item],
  })),
  updateActiveItem: (itemId, updater) => set((state) => ({
    activeItems: state.activeItems.map((item) => (item.itemId === itemId ? { ...item, ...updater } : item)),
  })),
  removeActiveItem: (itemId) => set((state) => ({
    activeItems: state.activeItems.filter((item) => item.itemId !== itemId),
  })),
  setEditingItemId: (itemId) => set({ editingItemId: itemId }),
  getSummaries: () => {
    const state = get();
    return state.activeItems.map((item) => ({
      itemId: item.itemId,
      assetKey: item.assetKey,
      kind: item.kind,
      pinnedToAvatar: item.pinnedToAvatar,
      worldX: item.worldPosition.x,
      worldY: item.worldPosition.y,
      scale: item.worldScale,
      zIndex: item.worldZIndex,
      visible: item.visible,
      currentExpression: item.currentExpression,
      currentMotion: item.currentMotion,
      enableLipSync: item.enableLipSync,
    }));
  },
}));
