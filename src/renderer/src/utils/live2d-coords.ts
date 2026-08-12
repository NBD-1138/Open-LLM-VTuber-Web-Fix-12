/* eslint-disable @typescript-eslint/ban-ts-comment */
import { LAppDelegate } from "../../WebSDK/src/lappdelegate";

interface ModelPosition {
  x: number;
  y: number;
}

const getCanvasElement = (provided?: HTMLCanvasElement | null) => {
  if (provided) {
    return provided;
  }
  return document.getElementById("canvas") as HTMLCanvasElement | null;
};

const getCanvasScale = (canvas: HTMLCanvasElement): number => {
  const logicalWidth = canvas.width || canvas.clientWidth || 1;
  const cssWidth = canvas.clientWidth || logicalWidth || 1;
  return logicalWidth / cssWidth || 1;
};

/**
 * Converts a model-space translation (values stored in the Live2D model matrix)
 * into CSS pixel coordinates that align with the renderer overlay.
 */
export const modelToCanvasPosition = (
  position: ModelPosition,
  canvas?: HTMLCanvasElement | null,
): ModelPosition => {
  const view = LAppDelegate.getInstance()?.getView?.();
  const targetCanvas = getCanvasElement(canvas);
  if (!view || !targetCanvas) {
    return { ...position };
  }

  // `transformX` was used to map device -> model; invert to go back to device space.
  const deviceX =
    typeof view._deviceToScreen?.invertTransformX === "function"
      ? view._deviceToScreen.invertTransformX(position.x)
      : position.x;
  const deviceY =
    typeof view._deviceToScreen?.invertTransformY === "function"
      ? view._deviceToScreen.invertTransformY(position.y)
      : position.y;

  const scale = getCanvasScale(targetCanvas);
  return {
    x: deviceX / scale,
    y: deviceY / scale,
  };
};
