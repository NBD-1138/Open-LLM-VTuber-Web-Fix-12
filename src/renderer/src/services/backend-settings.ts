import {
  DEFAULT_BACKEND_BASE_URL,
  DEFAULT_BACKEND_WS_URL,
  DEFAULT_BASIC_AUTH_USERNAME,
  DEFAULT_BASIC_AUTH_PASSWORD,
} from '@/constants/backend';

export interface BasicAuthConfig {
  enabled: boolean;
  username: string;
  password: string;
}

export interface BackendConfig {
  baseUrl: string;
  wsUrl: string;
  basicAuth: BasicAuthConfig;
}

let currentConfig: BackendConfig = {
  baseUrl: DEFAULT_BACKEND_BASE_URL,
  wsUrl: DEFAULT_BACKEND_WS_URL,
  basicAuth: {
    enabled: false,
    username: DEFAULT_BASIC_AUTH_USERNAME,
    password: DEFAULT_BASIC_AUTH_PASSWORD,
  },
};

export const normalizeHttpOrigin = (value: string): string => {
  if (/^ws:\/\//i.test(value)) {
    return value.replace(/^ws:\/\//i, 'http://');
  }
  if (/^wss:\/\//i.test(value)) {
    return value.replace(/^wss:\/\//i, 'https://');
  }
  return value;
};

const encodeCredentials = (username: string, password: string): string => {
  const raw = `${username}:${password}`;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'utf-8').toString('base64');
  }
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const utf8 = encodeURIComponent(raw).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(Number.parseInt(p1, 16)),
    );
    return window.btoa(utf8);
  }
  throw new Error('No base64 encoder available');
};

export const updateBackendConfig = (partial: Partial<Omit<BackendConfig, 'basicAuth'>> & {
  basicAuth?: Partial<BasicAuthConfig>
}) => {
  const nextBase = partial.baseUrl !== undefined
    ? normalizeHttpOrigin(partial.baseUrl)
    : currentConfig.baseUrl;
  currentConfig = {
    ...currentConfig,
    ...partial,
    baseUrl: nextBase,
    basicAuth: {
      ...currentConfig.basicAuth,
      ...(partial.basicAuth ?? {}),
    },
  };

  if (typeof window !== 'undefined') {
    const api = (window as unknown as { api?: { updateBackendAuth?: (config: { baseUrl: string; basicAuth: BasicAuthConfig }) => void } }).api;
    api?.updateBackendAuth?.({
      baseUrl: currentConfig.baseUrl,
      basicAuth: { ...currentConfig.basicAuth },
    });
  }
};

export const getBackendConfig = (): BackendConfig => ({
  baseUrl: currentConfig.baseUrl,
  wsUrl: currentConfig.wsUrl,
  basicAuth: { ...currentConfig.basicAuth },
});

export const deriveWsUrl = (baseUrlOverride?: string, wsUrlOverride?: string): string => {
  const baseUrl = normalizeHttpOrigin(baseUrlOverride || currentConfig.baseUrl);
  const wsUrl = wsUrlOverride || currentConfig.wsUrl;
  try {
    const url = new URL(wsUrl);
    return url.toString();
  } catch {
    // If wsUrl is relative, build from baseUrl
    try {
      const base = new URL(baseUrl);
      const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = wsUrl.startsWith('/') ? wsUrl : `/${wsUrl || 'client-ws'}`;
      return `${protocol}//${base.host}${path}`;
    } catch {
      // Fallback to defaults if parsing fails
      return DEFAULT_BACKEND_WS_URL;
    }
  }
};

export const buildAuthorizationHeader = (auth?: BasicAuthConfig): string | undefined => {
  const config = auth ?? currentConfig.basicAuth;
  if (!config.enabled) {
    return undefined;
  }
  return `Basic ${encodeCredentials(config.username, config.password)}`;
};

export const getBasicAuthHeader = () => buildAuthorizationHeader();

export const getBasicAuthConfig = (): BasicAuthConfig => ({ ...currentConfig.basicAuth });
