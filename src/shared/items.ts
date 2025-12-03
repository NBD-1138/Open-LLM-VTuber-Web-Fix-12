export type ItemKind = "png" | "live2d";

export interface DiscoveredAsset {
  kind: ItemKind;
  assetKey: string;
  displayName: string;
  pngPath?: string;
  pngUrl?: string;
  modelJsonPath?: string;
  modelJsonUrl?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  hasExpressions?: boolean;
  hasMotions?: boolean;
}

export interface SceneLayout {
  items: Record<string, PersistedItemState>;
  scenes: Record<string, SceneVisibilityState>;
}

export interface SceneVisibilityState {
  visibleItems: string[];
}

export interface PersistedItemState {
  lastWorld?: PersistedTransform;
  perModel?: Record<string, ModelScopedItemState>;
  lastExpression?: string | null;
  lastMotion?: string | null;
  enableLipSync?: boolean;
}

export interface PersistedTransform {
  x: number;
  y: number;
  scale: number;
  zIndex: number;
}

export interface ModelScopedItemState extends PersistedTransform {
  pinned: boolean;
}

export interface SceneItemSummary {
  itemId: string;
  assetKey: string;
  kind: ItemKind;
  pinnedToAvatar: boolean;
  worldX: number;
  worldY: number;
  scale: number;
  zIndex: number;
  visible: boolean;
  currentExpression?: string | null;
  currentMotion?: string | null;
  enableLipSync?: boolean;
}

export interface RuntimeSceneItem {
  itemId: string;
  assetKey: string;
  kind: ItemKind;
  pixiRef: any;
  visible: boolean;
  pinnedToAvatar: boolean;
  worldPosition: { x: number; y: number };
  worldScale: number;
  worldZIndex: number;
  localPosition?: { x: number; y: number };
  localScale?: number;
  localZIndex?: number;
  availableExpressions?: string[];
  availableMotions?: string[];
  currentExpression?: string | null;
  currentMotion?: string | null;
  enableLipSync?: boolean;
}

export interface LoadMainModelPayload {
  currentModelId: string | null;
  newModelId: string;
  itemsBaseUrl?: string | null;
  outgoingItems: Array<{
    assetKey: string;
    kind: ItemKind;
    pinnedToAvatar: boolean;
    worldPosition: { x: number; y: number };
    worldScale: number;
    worldZIndex: number;
    localPosition?: { x: number; y: number };
    localScale?: number;
    localZIndex?: number;
    currentExpression?: string | null;
    currentMotion?: string | null;
    enableLipSync?: boolean;
  }>;
}

export interface ItemTransformUpdate {
  modelId: string;
  assetKey: string;
  pinned: boolean;
  transform: PersistedTransform;
}

export interface RestoredSceneItem {
  assetKey: string;
  kind: ItemKind;
  pinnedToAvatar: boolean;
  worldTransform?: PersistedTransform;
  localTransform?: PersistedTransform;
  lastExpression?: string | null;
  lastMotion?: string | null;
  enableLipSync?: boolean;
}

export interface LoadMainModelResult {
  modelId: string;
  sceneItems: RestoredSceneItem[];
  visibleItems: string[];
}
