import path from 'node:path';

export interface ActiveApplicationSnapshot {
  processName: string;
  windowTitle: string;
  detectedAt: string;
  confidence: number;
}

export interface ActiveApplicationAdapter {
  pollActiveApplication(): Promise<ActiveApplicationSnapshot | null>;
  dispose?(): Promise<void>;
}

type GetWindowsResult = {
  title?: string | null;
  owner?: {
    name?: string | null;
    path?: string | null;
  } | null;
} | undefined;

const MAX_PROCESS_NAME_LENGTH = 80;
const MAX_WINDOW_TITLE_LENGTH = 160;

const sanitizeWhitespace = (value: string): string => value
  .replace(/[\u0000-\u001F\u007F]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const sanitizeProcessName = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const baseName = path.basename(value);
  const sanitized = sanitizeWhitespace(baseName).replace(/[^A-Za-z0-9._()\- ]+/g, '_');
  if (!sanitized) {
    return null;
  }
  return sanitized.slice(0, MAX_PROCESS_NAME_LENGTH);
};

export const sanitizeWindowTitle = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const sanitized = sanitizeWhitespace(value);
  if (!sanitized) {
    return null;
  }
  return sanitized.slice(0, MAX_WINDOW_TITLE_LENGTH);
};

export const sanitizeActiveApplication = (
  snapshot: Omit<ActiveApplicationSnapshot, 'detectedAt'> & { detectedAt?: string },
): ActiveApplicationSnapshot | null => {
  const processName = sanitizeProcessName(snapshot.processName);
  const windowTitle = sanitizeWindowTitle(snapshot.windowTitle);
  if (!processName || !windowTitle) {
    return null;
  }
  return {
    processName,
    windowTitle,
    detectedAt: snapshot.detectedAt ?? new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, snapshot.confidence)),
  };
};

export const getActiveApplicationSignature = (
  snapshot: ActiveApplicationSnapshot | null,
): string => (
  snapshot
    ? `${snapshot.processName.toLowerCase()}::${snapshot.windowTitle.toLowerCase()}`
    : 'none'
);

export class WindowsActiveApplicationAdapter implements ActiveApplicationAdapter {
  private activeWindowLoader: ((options?: Record<string, unknown>) => Promise<GetWindowsResult>) | null = null;

  private async loadActiveWindow() {
    if (!this.activeWindowLoader) {
      const module = await import('get-windows');
      this.activeWindowLoader = module.activeWindow as (
        options?: Record<string, unknown>,
      ) => Promise<GetWindowsResult>;
    }
    return this.activeWindowLoader;
  }

  async pollActiveApplication(): Promise<ActiveApplicationSnapshot | null> {
    const activeWindow = await this.loadActiveWindow();
    const result = await activeWindow();
    if (!result) {
      return null;
    }

    const processName = sanitizeProcessName(
      result.owner?.path
      ?? result.owner?.name
      ?? null,
    );
    const windowTitle = sanitizeWindowTitle(result.title ?? null);
    if (!processName || !windowTitle) {
      return null;
    }

    return {
      processName,
      windowTitle,
      detectedAt: new Date().toISOString(),
      confidence: 1,
    };
  }
}

class UnsupportedPlatformActiveApplicationAdapter implements ActiveApplicationAdapter {
  async pollActiveApplication(): Promise<ActiveApplicationSnapshot | null> {
    return null;
  }
}

export const createActiveApplicationAdapter = (
  platform: NodeJS.Platform = process.platform,
): ActiveApplicationAdapter => {
  if (platform === 'win32') {
    return new WindowsActiveApplicationAdapter();
  }
  return new UnsupportedPlatformActiveApplicationAdapter();
};
