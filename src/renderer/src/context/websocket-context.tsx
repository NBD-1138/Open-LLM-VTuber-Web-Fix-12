/* eslint-disable react/jsx-no-constructed-context-values */
import React, { useContext, useCallback } from 'react';
import { wsService } from '@/services/websocket-service';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

const DEFAULT_WS_URL = 'ws://127.0.0.1:12393/client-ws';
const DEFAULT_BASE_URL = 'http://127.0.0.1:12393';

export interface HistoryInfo {
  uid: string;
  latest_message: {
    role: 'human' | 'ai';
    timestamp: string;
    content: string;
  } | null;
  timestamp: string | null;
}

export type TwitchServiceStatus =
  | 'disabled'
  | 'unconfigured'
  | 'unauthenticated'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'stopping';

export interface TwitchStatusMessage {
  type: 'live/twitch/status';
  enabled: boolean;
  status: TwitchServiceStatus;
  authenticated: boolean;
  channel: string;
  broadcaster_id: string;
  talkback_enabled: boolean;
  read_chat_aloud: boolean;
  chat_tts_volume: number;
  notify_subscriptions: boolean;
  notify_first_observed_chatters: boolean;
  first_observed_chatter_viewer_threshold: number;
  redemptions_enabled: boolean;
  self_moderation_enabled: boolean;
  debug: boolean;
  restart_required_fields: string[];
  reauth_available: boolean;
  auth_flow_pending: boolean;
  oauth_redirect_uri: string;
  token_storage: string;
  detail?: string | null;
}

interface WebSocketContextProps {
  sendMessage: (message: object) => void;
  wsState: string;
  reconnect: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  twitchStatus: TwitchStatusMessage | null;
}

export const WebSocketContext = React.createContext<WebSocketContextProps>({
  sendMessage: wsService.sendMessage.bind(wsService),
  wsState: 'CLOSED',
  reconnect: () => wsService.connect(DEFAULT_WS_URL, true),
  wsUrl: DEFAULT_WS_URL,
  setWsUrl: () => {},
  baseUrl: DEFAULT_BASE_URL,
  setBaseUrl: () => {},
  twitchStatus: null,
});

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export const defaultWsUrl = DEFAULT_WS_URL;
export const defaultBaseUrl = DEFAULT_BASE_URL;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsUrl, setWsUrl] = useLocalStorage('wsUrl', DEFAULT_WS_URL);
  const [baseUrl, setBaseUrl] = useLocalStorage('baseUrl', DEFAULT_BASE_URL);
  const handleSetWsUrl = useCallback((url: string) => {
    setWsUrl(url);
    wsService.connect(url, true);
  }, [setWsUrl]);

  const value = {
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState: 'CLOSED',
    reconnect: () => wsService.connect(wsUrl, true),
    wsUrl,
    setWsUrl: handleSetWsUrl,
    baseUrl,
    setBaseUrl,
    twitchStatus: null,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
