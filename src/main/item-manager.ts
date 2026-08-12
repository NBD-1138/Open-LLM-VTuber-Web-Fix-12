import { existsSync, promises as fs, readdirSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import {
  DiscoveredAsset,
  ItemTransformUpdate,
  ItemKind,
  LoadMainModelPayload,
  PersistedItemState,
  PersistedTransform,
  SceneLayout,
  SceneVisibilityState,
  RestoredSceneItem,
  LoadMainModelResult,
} from "../shared/items";

const LAYOUT_FILENAME = "scene_layout.json";
function toForwardSlashes(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

function sortAndUnique(items: string[]): string[] {
  return Array.from(new Set(items)).sort();
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function encodeUrlPath(relativePath: string): string {
  return relativePath
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export interface ItemManagerOptions {
  live2dRoot: string;
  itemsBaseUrl?: string | null;
  layoutDir?: string | null;
}

export class ItemManager {
  private readonly live2dRoot: string;

  private readonly itemsDir: string;

  private readonly layoutPath: string;

  private itemsBaseUrl: string | null;

  private layout: SceneLayout = { items: {}, scenes: {} };

  private cachedAssets: DiscoveredAsset[] | null = null;

  private lastAssetScanMtime: number | null = null;

  private safeReadDirSync(dir: string): Dirent[] | null {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
  }

  private buildAssetUrl(sourcePath: string | null | undefined): string | undefined {
    if (!sourcePath) {
      return undefined;
    }
    if (!this.itemsBaseUrl) {
      return undefined;
    }
    const relative = encodeRelativePath(path.relative(this.itemsDir, sourcePath));
    return `${this.itemsBaseUrl}/${relative}`;
  }

  constructor(options: ItemManagerOptions) {
    const { live2dRoot, itemsBaseUrl, layoutDir } = options;
    this.live2dRoot = live2dRoot;
    this.itemsDir = path.join(this.live2dRoot, "items");
    // Default layout location: project root (frontend) if provided, otherwise userData/live2d root
    const layoutRoot = layoutDir ?? process.cwd();
    this.layoutPath = path.join(layoutRoot, LAYOUT_FILENAME);
    this.itemsBaseUrl = null;
    this.setItemsBaseUrl(itemsBaseUrl ?? process.env.ITEMS_BASE_URL ?? null);
  }

  public async initialize(): Promise<void> {
    await this.ensureItemsDirectory();
    await this.loadLayout();
  }

  public getLayout(): SceneLayout {
    return this.layout;
  }

  public setItemsBaseUrl(baseUrl: string | null | undefined): void {
    const normalized = baseUrl ? baseUrl.replace(/\/+$/, "") : null;
    if (this.itemsBaseUrl === normalized) {
      return;
    }
    this.itemsBaseUrl = normalized;
    // Invalidate cached asset URLs so a subsequent scan recalculates them.
    this.cachedAssets = null;
  }

  public async listAvailableAssets(): Promise<DiscoveredAsset[]> {
    // Only use backend-served catalog; do not scan local filesystem to support remote setups.
    const remote = await this.fetchRemoteCatalog().catch((error) => {
      console.warn("[ItemManager] Remote catalog fetch failed", error);
      return null;
    });
    if (remote && remote.length > 0) {
      this.cachedAssets = remote;
      this.lastAssetScanMtime = Date.now();
      return remote;
    }

    // If remote fetch fails, return last known catalog (may be empty) but avoid local scan.
    if (this.cachedAssets) {
      return this.cachedAssets;
    }

    return [];
  }

  public ensureScene(modelId: string): SceneVisibilityState {
    if (!this.layout.scenes[modelId]) {
      this.layout.scenes[modelId] = { visibleItems: [] };
    }
    return this.layout.scenes[modelId];
  }

  public ensureItem(assetKey: string): PersistedItemState {
    if (!this.layout.items[assetKey]) {
      this.layout.items[assetKey] = { perModel: {} };
    } else if (!this.layout.items[assetKey].perModel) {
      this.layout.items[assetKey].perModel = {};
    }
    return this.layout.items[assetKey];
  }

  public async setSceneVisibility(
    modelId: string,
    visibleItems: string[],
  ): Promise<void> {
    const scene = this.ensureScene(modelId);
    scene.visibleItems = sortAndUnique(visibleItems);
    await this.persistLayout();
  }

  public async addVisibleItem(
    modelId: string,
    assetKey: string,
  ): Promise<void> {
    const scene = this.ensureScene(modelId);
    if (!scene.visibleItems.includes(assetKey)) {
      scene.visibleItems.push(assetKey);
      scene.visibleItems = sortAndUnique(scene.visibleItems);
      await this.persistLayout();
    }
  }

  public async removeVisibleItem(
    modelId: string,
    assetKey: string,
  ): Promise<void> {
    const scene = this.ensureScene(modelId);
    const filtered = scene.visibleItems.filter((key) => key !== assetKey);
    if (filtered.length !== scene.visibleItems.length) {
      scene.visibleItems = filtered;
      await this.persistLayout();
    }
  }

  public async updateItemTransform({
    modelId,
    assetKey,
    pinned,
    transform,
  }: ItemTransformUpdate): Promise<void> {
    const item = this.ensureItem(assetKey);
    if (!item.perModel) {
      item.perModel = {};
    }

    item.perModel[modelId] = {
      pinned,
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      zIndex: transform.zIndex,
    };

    if (!pinned) {
      item.lastWorld = {
        x: transform.x,
        y: transform.y,
        scale: transform.scale,
        zIndex: transform.zIndex,
      };
    }

    await this.persistLayout();
  }

  public async updateItemWorldOnly(
    assetKey: string,
    transform: PersistedTransform,
  ): Promise<void> {
    const item = this.ensureItem(assetKey);
    item.lastWorld = { ...transform };
    await this.persistLayout();
  }

  public async setItemExpression(
    assetKey: string,
    expression: string | null,
  ): Promise<void> {
    const item = this.ensureItem(assetKey);
    item.lastExpression = expression;
    await this.persistLayout();
  }

  public async setItemMotion(
    assetKey: string,
    motion: string | null,
  ): Promise<void> {
    const item = this.ensureItem(assetKey);
    item.lastMotion = motion;
    await this.persistLayout();
  }

  public async setItemLipSync(
    assetKey: string,
    enableLipSync: boolean,
  ): Promise<void> {
    const item = this.ensureItem(assetKey);
    item.enableLipSync = enableLipSync;
    await this.persistLayout();
  }

  public async saveOutgoingScene(
    payload: LoadMainModelPayload,
  ): Promise<void> {
    if (!payload.currentModelId) {
      return;
    }

    const scene = this.ensureScene(payload.currentModelId);
    const visibleAssetKeys = sortAndUnique(
      payload.outgoingItems
        .filter((item) => item)
        .map((item) => item.assetKey),
    );
    scene.visibleItems = visibleAssetKeys;

    for (const item of payload.outgoingItems) {
      const persisted = this.ensureItem(item.assetKey);

      if (!persisted.perModel) {
        persisted.perModel = {};
      }

      if (item.pinnedToAvatar) {
        const local = item.localPosition ?? { x: 0, y: 0 };
        const localScale = item.localScale ?? item.worldScale;
        const localZIndex = item.localZIndex ?? item.worldZIndex;
        persisted.perModel[payload.currentModelId] = {
          pinned: true,
          x: local.x,
          y: local.y,
          scale: localScale,
          zIndex: localZIndex,
        };
      } else {
        const world = {
          x: item.worldPosition.x,
          y: item.worldPosition.y,
          scale: item.worldScale,
          zIndex: item.worldZIndex,
        };
        persisted.lastWorld = world;
        persisted.perModel[payload.currentModelId] = {
          pinned: false,
          x: world.x,
          y: world.y,
          scale: world.scale,
          zIndex: world.zIndex,
        };
      }

      if (item.kind === "live2d") {
        persisted.lastExpression = item.currentExpression ?? null;
        persisted.lastMotion = item.currentMotion ?? null;
        if (typeof item.enableLipSync === "boolean") {
          persisted.enableLipSync = item.enableLipSync;
        }
      }
    }

    await this.persistLayout();
  }

  public buildRestoredSceneItem(
    modelId: string,
    assetKey: string,
    kind: ItemKind,
  ): RestoredSceneItem {
    const persisted = this.ensureItem(assetKey);
    const perModel = persisted.perModel?.[modelId];
    const pinned = !!perModel?.pinned;

    const base: RestoredSceneItem = {
      assetKey,
      kind,
      pinnedToAvatar: pinned,
      lastExpression: persisted.lastExpression ?? null,
      lastMotion: persisted.lastMotion ?? null,
      enableLipSync: persisted.enableLipSync ?? false,
    };

    if (pinned && perModel) {
      base.localTransform = {
        x: perModel.x,
        y: perModel.y,
        scale: perModel.scale,
        zIndex: perModel.zIndex,
      };
    } else if (perModel && !perModel.pinned) {
      base.worldTransform = {
        x: perModel.x,
        y: perModel.y,
        scale: perModel.scale,
        zIndex: perModel.zIndex,
      };
    } else if (persisted.lastWorld) {
      base.worldTransform = { ...persisted.lastWorld };
    }

    return base;
  }

  public async loadSceneForModel(
    modelId: string,
  ): Promise<LoadMainModelResult> {
    const assets = await this.listAvailableAssets();
    const assetMap = new Map<string, DiscoveredAsset>();
    for (const asset of assets) {
      assetMap.set(asset.assetKey, asset);
    }

    const scene = this.ensureScene(modelId);
    const sceneItems: RestoredSceneItem[] = [];
    const filteredVisible: string[] = [];
    let live2dSeen = false;

    for (const assetKey of scene.visibleItems) {
      const asset = assetMap.get(assetKey);
      if (!asset) {
        continue;
      }
      if (asset.kind === "live2d") {
        if (live2dSeen) {
          // Skip additional Live2D items to avoid multiple item models loaded at once
          continue;
        }
        live2dSeen = true;
      }
      filteredVisible.push(assetKey);
      sceneItems.push(
        this.buildRestoredSceneItem(modelId, assetKey, asset.kind),
      );
    }

    // Persist filtered visible list if we dropped extras
    if (filteredVisible.length !== scene.visibleItems.length) {
      scene.visibleItems = filteredVisible;
      await this.persistLayout();
    }

    return {
      modelId,
      sceneItems,
      visibleItems: [...filteredVisible],
    };
  }

  private async ensureItemsDirectory(): Promise<void> {
    if (!existsSync(this.itemsDir)) {
      await fs.mkdir(this.itemsDir, { recursive: true });
    }
  }

  private async loadLayout(): Promise<void> {
    if (!existsSync(this.layoutPath)) {
      await this.persistLayout();
      return;
    }

    try {
      const raw = await fs.readFile(this.layoutPath, "utf8");
      const parsed = JSON.parse(raw) as SceneLayout;
      this.layout = {
        items: parsed.items ?? {},
        scenes: parsed.scenes ?? {},
      };
    } catch (error) {
      console.error(
        `[ItemManager] Failed to parse scene layout JSON: ${(error as Error).message}`,
      );
      this.layout = { items: {}, scenes: {} };
      await this.persistLayout();
    }
  }

  private async persistLayout(): Promise<void> {
    await fs.mkdir(path.dirname(this.layoutPath), { recursive: true });
    const serialized = JSON.stringify(this.layout, null, 2);
    await fs.writeFile(this.layoutPath, `${serialized}
`, "utf8");
  }

  private async fetchRemoteCatalog(): Promise<DiscoveredAsset[] | null> {
    if (!this.itemsBaseUrl) return null;
    try {
      // Normalize to avoid duplicated live2d-models segments in the path
      const base = this.itemsBaseUrl
        .replace(/\/+$/, "")
        .replace(/(live2d-models\/)+(items)$/, "live2d-models/items");
      const candidates = [
        `${base}/catalog.json`,
        // Fallback: if base already ends with /live2d-models/items, try /items as a last resort
        base.endsWith("/live2d-models/items")
          ? `${base.replace(/\\/g, "/").replace(/\\/g, "/").replace(/\/live2d-models\/items$/, "")}/items/catalog.json`
          : null,
      ].filter(Boolean) as string[];

      let data: any = null;
      let ok = false;
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            lastError = new Error(`HTTP ${response.status} (${url})`);
            continue;
          }
          data = await response.json();
          ok = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!ok || !data) {
        throw lastError ?? new Error("Failed to fetch catalog");
      }

      const baseUrl = data.base_url
        ? `${base.replace(/\/+$/, "")}` // base already points to items root
        : base;
      const items = Array.isArray(data.items) ? data.items : [];
      const mapped: DiscoveredAsset[] = items
        .map((item: any) => {
          if (item.type === "live2d" && item.model_path) {
            const rel = item.relative_path || item.model_path;
            const assetKey = item.name || item.id || rel;
            const modelUrl = item.model_path.startsWith("http")
              ? item.model_path
              : `${baseUrl}/${encodeUrlPath(rel)}`;
            return {
              kind: "live2d" as const,
              assetKey,
              displayName: item.name || assetKey,
              modelJsonUrl: modelUrl,
              modelJsonPath: modelUrl,
              thumbnailUrl: item.thumbnail_path
                ? item.thumbnail_path.startsWith("http")
                  ? item.thumbnail_path
                  : `${baseUrl}/${encodeUrlPath(item.thumbnail_path)}`
                : undefined,
            };
          }
          if (item.type === "image" && item.image_path) {
            const rel = item.relative_path || item.image_path;
            const assetKey = item.name || item.id || rel;
            const imageUrl = item.image_path.startsWith("http")
              ? item.image_path
              : `${baseUrl}/${encodeUrlPath(rel)}`;
            return {
              kind: "png" as const,
              assetKey,
              displayName: item.name || assetKey,
              pngUrl: imageUrl,
              pngPath: imageUrl,
            };
          }
          return null;
        })
        .filter(Boolean) as DiscoveredAsset[];
      console.log("[ItemManager] Fetched remote catalog assets:", mapped.length);
      return mapped;
    } catch (error) {
      console.warn("[ItemManager] Failed to fetch remote catalog", error);
      return null;
    }
  }

  private hasModelJsonRecursive(dirPath: string): boolean {
    const stack: string[] = [dirPath];
    while (stack.length) {
      const dir = stack.pop()!;
      const entries = this.safeReadDirSync(dir);
      if (!entries) continue;
      let foundModel = false;
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".model3.json")) {
          foundModel = true;
          break;
        }
        if (entry.isDirectory()) {
          stack.push(full);
        }
      }
      if (foundModel) return true;
    }
    return false;
  }

  private async scanItemsDirectory(): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = [];

    const entries = await this.safeReadDir(this.itemsDir);
    if (!entries) {
      console.warn(
        "[ItemManager] Items directory missing or unreadable:",
        this.itemsDir,
      );
      return assets;
    }

    const live2dDirectories = new Set<string>();

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const directoryPath = path.join(this.itemsDir, entry.name);
        const modelJsonPath = await this.findModelJson(directoryPath);
        if (modelJsonPath) {
          const assetKey = entry.name;
          const displayName = entry.name.replace(/\.model3?\.json$/i, "");
          live2dDirectories.add(toForwardSlashes(directoryPath));
          const metadata = await this.inspectLive2DModel(modelJsonPath);
          const modelJsonUrl = this.buildAssetUrl(modelJsonPath);
          const normalizedModelJsonPath = toForwardSlashes(modelJsonPath);
          assets.push({
            kind: 'live2d',
            assetKey,
            displayName,
            modelJsonPath: normalizedModelJsonPath,
            modelJsonUrl,
            thumbnailPath: metadata.thumbnailPath
              ? toForwardSlashes(metadata.thumbnailPath)
              : undefined,
            thumbnailUrl: metadata.thumbnailPath
              ? this.buildAssetUrl(metadata.thumbnailPath)
              : undefined,
            hasExpressions: metadata.hasExpressions,
            hasMotions: metadata.hasMotions,
          });
          console.log('[ItemManager] Found Live2D item:', directoryPath);
          console.log("[ItemManager] Found Live2D item:", assetKey);
        } else if (this.hasModelJsonRecursive(directoryPath)) {
          // Skip PNG collection for any folder tree that contains a Live2D model.
          console.log(
            "[ItemManager] Skipping PNG discovery inside Live2D subtree:",
            directoryPath,
          );
          continue;
        } else {
          const pngAssets = await this.collectPngAssets(directoryPath, entry.name);
          assets.push(...pngAssets);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        const assetKey = entry.name;
        const filePath = path.join(this.itemsDir, entry.name);
        assets.push({
          kind: "png",
          assetKey,
          displayName: path.parse(assetKey).name,
          pngPath: toForwardSlashes(filePath),
          pngUrl: this.buildAssetUrl(filePath),
        });
        console.log("[ItemManager] Found PNG item:", filePath);
      }
    }

    return assets.filter((asset) => {
      if (asset.kind !== "png" || !asset.pngPath) {
        return true;
      }
      for (const dir of live2dDirectories) {
        if (asset.pngPath.startsWith(`${dir}/`)) {
          return false;
        }
      }
      return true;
    });
  }

  private async collectPngAssets(
    dirPath: string,
    relativeRoot: string,
  ): Promise<DiscoveredAsset[]> {
    const collected: DiscoveredAsset[] = [];
    const stack: Array<{ dir: string; relative: string }> = [
      { dir: dirPath, relative: relativeRoot },
    ];

    while (stack.length) {
      const { dir, relative } = stack.pop()!;
      const entries = await this.safeReadDir(dir);
      if (!entries) continue;

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(relative, entry.name);
        if (entry.isDirectory()) {
          // Skip subtrees that contain Live2D models
          if (this.hasModelJsonRecursive(fullPath)) {
            console.log(
              "[ItemManager] Skipping PNG subtree containing Live2D model:",
              fullPath,
            );
            continue;
          }
          stack.push({ dir: fullPath, relative: path.join(relative, entry.name) });
        } else if (
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".png")
        ) {
          collected.push({
            kind: "png",
            assetKey: toForwardSlashes(relativePath),
            displayName: path.parse(entry.name).name,
            pngPath: toForwardSlashes(fullPath),
            pngUrl: this.buildAssetUrl(fullPath),
          });
        }
      }
    }

    return collected;
  }

  private async findModelJson(dir: string): Promise<string | null> {
    const entries = await this.safeReadDir(dir);
    if (!entries) return null;

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".model3.json")) {
        return fullPath;
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const result = await this.findModelJson(path.join(dir, entry.name));
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  private async inspectLive2DModel(modelJsonPath: string): Promise<{
    hasExpressions: boolean;
    hasMotions: boolean;
    thumbnailPath?: string;
  }> {
    try {
      const raw = await fs.readFile(modelJsonPath, "utf8");
      const parsed = JSON.parse(raw);
      const expressions =
        parsed?.FileReferences?.Expressions ??
        parsed?.FileReferences?.Expression ??
        [];
      const motions = parsed?.FileReferences?.Motions ?? {};

      const hasExpressions = Array.isArray(expressions)
        ? expressions.length > 0
        : typeof expressions === "object" &&
          expressions != null &&
          Object.keys(expressions).length > 0;

      const hasMotions =
        motions && typeof motions === "object"
          ? Object.values(motions).some(
            (group: unknown) => Array.isArray(group) && group.length > 0,
          )
          : false;

      const possibleThumbs = [
        "thumbnail.png",
        "thumb.png",
        "icon.png",
        "cover.png",
      ];

      let thumbnailPath: string | undefined;
      const modelDir = path.dirname(modelJsonPath);
      const dirEntries = await this.safeReadDir(modelDir);
      if (dirEntries) {
        for (const entry of dirEntries) {
          if (!entry.isFile()) continue;
          const nameLower = entry.name.toLowerCase();
          if (possibleThumbs.includes(nameLower) || nameLower.includes("thumb")) {
            thumbnailPath = path.join(modelDir, entry.name);
            break;
          }
        }
      }

      return { hasExpressions, hasMotions, thumbnailPath };
    } catch (error) {
      console.error(
        `[ItemManager] Failed to inspect Live2D model: ${(error as Error).message}`,
      );
      return { hasExpressions: false, hasMotions: false };
    }
  }

  private async safeReadDir(dirPath: string): Promise<Dirent[] | null> {
    try {
      return await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.error(
        `[ItemManager] Failed to read directory ${dirPath}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async tryStat(targetPath: string): Promise<Stats | null> {
    try {
      return await fs.stat(targetPath);
    } catch {
      return null;
    }
  }
}
