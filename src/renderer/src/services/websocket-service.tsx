/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-use-before-define */
import { Subject } from 'rxjs';
import { ModelInfo } from '@/context/live2d-config-context';
import { HistoryInfo, TwitchServiceStatus } from '@/context/websocket-context';
import { ConfigFile } from '@/context/character-config-context';
import { toaster } from '@/components/ui/toaster';

export interface DisplayText {
  text: string;
  name: string;
  avatar: string;
}

interface BackgroundFile {
  name: string;
  url: string;
}

export interface AudioPayload {
  type: 'audio';
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  display_text?: DisplayText;
  actions?: Actions;
  mime_type?: string;
  automation_request_id?: string;
}

export interface Message {
  id: string;
  content: string;
  role: "ai" | "human";
  timestamp: string;
  name?: string;
  avatar?: string;

  // Fields for different message types (make optional)
  type?: 'text' | 'tool_call_status'; // Add possible types, default to 'text' if omitted
  tool_id?: string; // Specific to tool calls
  tool_name?: string; // Specific to tool calls
  status?: 'running' | 'completed' | 'error'; // Specific to tool calls
}

export interface Actions {
  expressions?: string[] | number [];
  pictures?: string[];
  sounds?: string[];
}

export interface MessageEvent {
  tool_id?: string;
  tool_name?: string;
  name?: string;
  status?: 'running' | 'completed' | 'error' | TwitchServiceStatus;
  content: string;
  timestamp: string;
  type: string;
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  files?: BackgroundFile[];
  actions?: Actions;
  mime_type?: string;
  text?: string;
  model_info?: ModelInfo;
  conf_name?: string;
  conf_uid?: string;
  uids?: string[];
  messages?: Message[];
  history_uid?: string;
  success?: boolean;
  histories?: HistoryInfo[];
  configs?: ConfigFile[];
  message?: string;
  members?: string[];
  is_owner?: boolean;
  client_uid?: string;
  forwarded?: boolean;
  display_text?: DisplayText;
  automation_request_id?: string;
  enabled?: boolean;
  authenticated?: boolean;
  channel?: string;
  broadcaster_id?: string;
  talkback_enabled?: boolean;
  read_chat_aloud?: boolean;
  chat_tts_volume?: number;
  notify_subscriptions?: boolean;
  notify_first_observed_chatters?: boolean;
  first_observed_chatter_viewer_threshold?: number;
  redemptions_enabled?: boolean;
  self_moderation_enabled?: boolean;
  debug?: boolean;
  restart_required_fields?: string[];
  reauth_available?: boolean;
  auth_flow_pending?: boolean;
  oauth_redirect_uri?: string;
  token_storage?: string;
  detail?: string | null;
  request_id?: string;
  profile_id?: string;
  command_id?: string;
  source?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  variables?: Record<string, string>;
  duration_ms?: number;
  error?: string | null;
  emergency_stopped?: boolean;
  active_profile_id?: string | null;
  running_requests?: string[];
  revision?: number;
  capability_revision?: number;
  action?: 'confirm' | 'reject';
  settings?: Record<string, unknown>;
  capabilities?: Array<{
    profile_id: string;
    command_id: string;
    label: string;
    description: string;
    category: string;
    enabled: boolean;
    available: boolean;
    risk: string;
    autonomy_policy: string;
    allowed_trigger_sources: string[];
    cooldown_remaining_ms: number;
    llm_access?: string;
    blocked_reason?: string | null;
  }>;
  pending_confirmations?: Array<{
    request_id: string;
    profile_id: string;
    command_id: string;
    command_label: string;
    concise_reason: string;
    risk: string;
    created_at: string;
    expires_at: string;
    source: string;
  }>;
  recent_decisions?: Array<{
    decision_id: string;
    decision_type: string;
    profile_id: string | null;
    command_id: string | null;
    command_label: string | null;
    reason: string | null;
    risk: string | null;
    blocked_reason: string | null;
    request_id: string | null;
    created_at: string;
  }>;
  last_blocked_reason?: string | null;
  profiles?: Array<{
    profile_id: string;
    display_name: string;
    enabled: boolean;
    commands: Array<{
      command_id: string;
      label: string;
      enabled: boolean;
    }>;
  }>;
  live2d_model?: string;
  browser_view?: {
    debuggerFullscreenUrl: string;
    debuggerUrl: string;
    pages: {
      id: string;
      url: string;
      faviconUrl: string;
      title: string;
      debuggerUrl: string;
      debuggerFullscreenUrl: string;
    }[];
    wsUrl: string;
    sessionId?: string;
  };
}

// Get translation function for error messages
const getTranslation = () => {
  try {
    const i18next = require('i18next').default;
    return i18next.t.bind(i18next);
  } catch (e) {
    // Fallback if i18next is not available
    return (key: string) => key;
  }
};

class WebSocketService {
  private static instance: WebSocketService;

  private ws: WebSocket | null = null;

  private messageSubject = new Subject<MessageEvent>();

  private stateSubject = new Subject<'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'>();

  private currentState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' = 'CLOSED';

  private currentUrl: string | null = null;

  static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeConnection() {
    this.sendMessage({
      type: 'fetch-backgrounds',
    });
    this.sendMessage({
      type: 'fetch-configs',
    });
    this.sendMessage({
      type: 'fetch-history-list',
    });
    this.sendMessage({
      type: 'create-new-history',
    });
  }

  connect(url: string, force = false) {
    if (
      !force
      && this.ws
      && this.currentUrl === url
      && (
        this.ws.readyState === WebSocket.CONNECTING
        || this.ws.readyState === WebSocket.OPEN
      )
    ) {
      return;
    }

    if (
      this.ws?.readyState === WebSocket.CONNECTING
      || this.ws?.readyState === WebSocket.OPEN
    ) {
      this.disconnect();
    }

    try {
      this.ws = new WebSocket(url);
      this.currentUrl = url;
      this.currentState = 'CONNECTING';
      this.stateSubject.next('CONNECTING');

      this.ws.onopen = () => {
        this.currentState = 'OPEN';
        this.stateSubject.next('OPEN');
        this.initializeConnection();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.messageSubject.next(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          toaster.create({
            title: `${getTranslation()('error.failedParseWebSocket')}: ${error}`,
            type: "error",
            duration: 2000,
          });
        }
      };

      this.ws.onclose = () => {
        this.currentUrl = null;
        this.currentState = 'CLOSED';
        this.stateSubject.next('CLOSED');
      };

      this.ws.onerror = () => {
        this.currentUrl = null;
        this.currentState = 'CLOSED';
        this.stateSubject.next('CLOSED');
      };
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      this.currentState = 'CLOSED';
      this.stateSubject.next('CLOSED');
    }
  }

  sendMessage(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not open. Unable to send message:', message);
      toaster.create({
        title: getTranslation()('error.websocketNotOpen'),
        type: 'error',
        duration: 2000,
      });
    }
  }

  onMessage(callback: (message: MessageEvent) => void) {
    return this.messageSubject.subscribe(callback);
  }

  onStateChange(callback: (state: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED') => void) {
    return this.stateSubject.subscribe(callback);
  }

  disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.currentState = 'CLOSING';
      this.stateSubject.next('CLOSING');
    }
    this.ws?.close();
    this.ws = null;
    this.currentUrl = null;
  }

  getCurrentState() {
    return this.currentState;
  }
}

export const wsService = WebSocketService.getInstance();
