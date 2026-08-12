/* eslint-disable no-shadow */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  memo,
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useIpcHandlers } from "@/hooks/utils/use-ipc-handlers";
import { useInterrupt } from "@/hooks/utils/use-interrupt";
import { useAudioTask } from "@/hooks/utils/use-audio-task";
import { useLive2DModel } from "@/hooks/canvas/use-live2d-model";
import { useLive2DResize } from "@/hooks/canvas/use-live2d-resize";
import { useAiState, AiStateEnum } from "@/context/ai-state-context";
import { useLive2DExpression } from "@/hooks/canvas/use-live2d-expression";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { useMode } from "@/context/mode-context";
import { itemsRuntime } from "@/services/items/items-runtime";
import { useSceneItemsStore } from "@/store/scene-items-store";

interface Live2DProps {
  showSidebar?: boolean;
}

export const Live2D = memo(
  ({ showSidebar }: Live2DProps): JSX.Element => {
    const { forceIgnoreMouse } = useForceIgnoreMouse();
    const { modelInfo } = useLive2DConfig();
    const { mode } = useMode();
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const itemsCanvasRef = useRef<HTMLCanvasElement>(null);
    const isAvatarPointerRef = useRef(false);
    const [itemsReady, setItemsReady] = useState(false);
    const { aiState } = useAiState();
    const { resetExpression } = useLive2DExpression();
    const isPet = mode === 'pet';
    const editingItemId = useSceneItemsStore((state) => state.editingItemId);
    const maxItemZIndex = useSceneItemsStore((state) => state.activeItems.reduce((max, item) => {
      const itemZ = item.pinnedToAvatar
        ? item.localZIndex ?? item.worldZIndex ?? 0
        : item.worldZIndex ?? 0;
      return Math.max(max, itemZ);
    }, 0));

    const { canvasRef } = useLive2DResize({
      containerRef: internalContainerRef,
      modelInfo,
      showSidebar,
    });

    const { isDragging, handlers } = useLive2DModel({
      modelInfo,
      canvasRef,
      allowAvatarInteraction: !editingItemId,
    });
    const sceneManager = itemsRuntime.getSceneManager();

    useEffect(() => {
      const canvas = itemsCanvasRef.current;
      if (!canvas || sceneManager.isReady()) {
        return undefined;
      }

      let cancelled = false;
      itemsRuntime.initialize(canvas)
        .then(() => {
          if (!cancelled) {
            setItemsReady(true);
          }
        })
        .catch((error: unknown) => {
          console.error("[Live2D] Failed to initialize item runtime", error);
        });

      return () => {
        cancelled = true;
        itemsRuntime.destroy();
        setItemsReady(false);
      };
    }, [sceneManager]);

    const deriveModelId = useCallback(() => {
      if (modelInfo?.name && modelInfo.name.trim().length > 0) {
        return modelInfo.name.trim();
      }
      if (modelInfo?.url) {
        try {
          const url = new URL(modelInfo.url, window.location.origin);
          const segments = url.pathname.split("/").filter(Boolean);
          const modelsIndex = segments.lastIndexOf("live2d-models");
          if (modelsIndex !== -1 && segments.length > modelsIndex + 1) {
            return segments[modelsIndex + 1];
          }
        } catch (error) {
          console.debug("[Live2D] Unable to derive model id from url", error);
        }
      }
      return null;
    }, [modelInfo?.name, modelInfo?.url]);

    const deriveItemsBaseUrl = useCallback(() => {
      if (!modelInfo?.url) {
        return null;
      }
      try {
        const url = new URL(modelInfo.url, window.location.origin);
        const segments = url.pathname.split("/").filter(Boolean);
        const live2dIndex = segments.lastIndexOf("live2d-models");
        if (live2dIndex === -1) {
          return null;
        }
        const origin = `${url.protocol}//${url.host}`;
        const baseSegments = segments.slice(0, live2dIndex + 1).concat("items");
        return `${origin}/${baseSegments.join("/")}`;
      } catch (error) {
        console.debug("[Live2D] Unable to derive items base url from model url", error);
      }
      return null;
    }, [modelInfo?.url]);

    useEffect(() => {
      if (!itemsReady) return;
      const modelId = deriveModelId();
      if (!modelId) return;
      const itemsBaseUrl = deriveItemsBaseUrl();
      itemsRuntime
        .loadMainModel(modelId, itemsBaseUrl)
        .catch((error: unknown) => {
          console.error("[Live2D] Failed to load items for model", error);
        });
    }, [itemsReady, deriveModelId, deriveItemsBaseUrl]);

    useIpcHandlers();
    useInterrupt();
    useAudioTask();

    useEffect(() => {
      if (aiState === AiStateEnum.IDLE) {
        const lappAdapter = (window as any).getLAppAdapter?.();
        if (lappAdapter) {
          resetExpression(lappAdapter, modelInfo);
        }
      }
    }, [aiState, modelInfo, resetExpression]);

    const handlePointerDown = (e: React.PointerEvent) => {
      if (editingItemId) {
        return;
      }
      handlers.onMouseDown(e);
    };

    const handleItemsPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const currentScene = itemsRuntime.getSceneManager();
      if (editingItemId) {
        isAvatarPointerRef.current = false;
        return;
      }

      if (!itemsReady || !currentScene.isReady()) {
        isAvatarPointerRef.current = true;
        handlers.onMouseDown(e);
        return;
      }
      const overItem = currentScene.isPointerOverItem(e.clientX, e.clientY);
      if (!overItem) {
        isAvatarPointerRef.current = true;
        handlers.onMouseDown(e);
      } else {
        isAvatarPointerRef.current = false;
      }
    };

    const handleItemsPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (editingItemId) {
        return;
      }
      if (isAvatarPointerRef.current) {
        handlers.onMouseMove(e);
      }
    };

    const handleItemsPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (editingItemId) {
        return;
      }
      if (isAvatarPointerRef.current) {
        handlers.onMouseUp(e);
        isAvatarPointerRef.current = false;
      }
    };

    const handleItemsPointerLeave = () => {
      if (editingItemId) {
        return;
      }
      if (isAvatarPointerRef.current) {
        handlers.onMouseLeave();
        isAvatarPointerRef.current = false;
      }
    };

    const handleItemsWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
      const currentScene = itemsRuntime.getSceneManager();
      if (editingItemId && itemsReady && currentScene.isReady()) {
        const hit = currentScene.getItemAtPoint(e.clientX, e.clientY);
        if (hit && hit.itemId === editingItemId) {
          e.preventDefault();
          e.stopPropagation();
          itemsRuntime.adjustItemScaleFromWheel(editingItemId, e.deltaY).catch((error: unknown) => {
            console.error("[Live2D] Failed to adjust item scale from wheel", error);
          });
          return;
        }
      }

      if (editingItemId || !canvasRef.current) {
        return;
      }

      const {
        deltaX,
        deltaY,
        deltaZ,
        deltaMode,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        clientX,
        clientY,
      } = e.nativeEvent;
      const wheelEvent = new WheelEvent("wheel", {
        deltaX,
        deltaY,
        deltaZ,
        deltaMode,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      });
      canvasRef.current.dispatchEvent(wheelEvent);
    };

    const handleAvatarWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      if (!modelInfo?.scrollToResize || !canvasRef.current) {
        return;
      }

      const {
        deltaX,
        deltaY,
        deltaZ,
        deltaMode,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        clientX,
        clientY,
      } = e.nativeEvent;
      const wheelEvent = new WheelEvent("wheel", {
        deltaX,
        deltaY,
        deltaZ,
        deltaMode,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      });
      canvasRef.current.dispatchEvent(wheelEvent);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      if (!isPet) {
        return;
      }

      e.preventDefault();
      window.api?.showContextMenu?.();
    };

    return (
      <div
        ref={internalContainerRef}
        id="live2d-internal-wrapper"
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto",
          overflow: "hidden",
          position: "relative",
          cursor: isDragging ? "grabbing" : "default",
        }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        onWheel={handleAvatarWheel}
        {...handlers}
      >
        <canvas
          id="canvas"
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 2,
            pointerEvents: "none",
            display: "block",
            cursor: isDragging ? "grabbing" : "default",
          }}
        />
        <canvas
          id="items-canvas"
          ref={itemsCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: maxItemZIndex > 0 ? 3 : 1,
            pointerEvents: editingItemId
              ? (isPet && forceIgnoreMouse ? "none" : "auto")
              : "none",
          }}
          onPointerDown={handleItemsPointerDown}
          onPointerMove={handleItemsPointerMove}
          onPointerUp={handleItemsPointerUp}
          onPointerLeave={handleItemsPointerLeave}
          onWheel={handleItemsWheel}
        />
      </div>
    );
  },
);

Live2D.displayName = "Live2D";

export { useInterrupt, useAudioTask };
