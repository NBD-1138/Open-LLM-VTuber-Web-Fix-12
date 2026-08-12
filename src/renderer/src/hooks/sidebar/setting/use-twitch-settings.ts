import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TwitchStatusMessage, useWebSocket } from '@/context/websocket-context';

type RestartAwareField =
  | 'enabled'
  | 'channel'
  | 'broadcaster_id'
  | 'talkback_enabled'
  | 'read_chat_aloud'
  | 'chat_tts_volume'
  | 'notify_subscriptions'
  | 'notify_first_observed_chatters'
  | 'first_observed_chatter_viewer_threshold'
  | 'redemptions_enabled'
  | 'self_moderation_enabled'
  | 'debug';

const defaultTwitchStatus: TwitchStatusMessage = {
  type: 'live/twitch/status',
  enabled: false,
  status: 'disabled',
  authenticated: false,
  channel: '',
  broadcaster_id: '',
  talkback_enabled: true,
  read_chat_aloud: true,
  chat_tts_volume: 1,
  notify_subscriptions: true,
  notify_first_observed_chatters: true,
  first_observed_chatter_viewer_threshold: 5,
  redemptions_enabled: true,
  self_moderation_enabled: false,
  debug: false,
  restart_required_fields: [],
  reauth_available: false,
  auth_flow_pending: false,
  oauth_redirect_uri: '',
  token_storage: '',
  detail: null,
};

const serviceStatusTranslationKey: Record<TwitchStatusMessage['status'], string> = {
  disabled: 'settings.twitch.serviceStates.disabled',
  unconfigured: 'settings.twitch.serviceStates.unconfigured',
  unauthenticated: 'settings.twitch.serviceStates.unauthenticated',
  disconnected: 'settings.twitch.serviceStates.disconnected',
  connecting: 'settings.twitch.serviceStates.connecting',
  connected: 'settings.twitch.serviceStates.connected',
  reconnecting: 'settings.twitch.serviceStates.reconnecting',
  error: 'settings.twitch.serviceStates.error',
  stopping: 'settings.twitch.serviceStates.stopping',
};

export function useTwitchSettings() {
  const { t } = useTranslation();
  const { wsState, twitchStatus, baseUrl } = useWebSocket();

  const resolvedStatus = twitchStatus ?? defaultTwitchStatus;
  const restartRequiredFields = useMemo(
    () => new Set<RestartAwareField>(
      (twitchStatus?.restart_required_fields ?? []) as RestartAwareField[],
    ),
    [twitchStatus],
  );

  const backendConnectionLabel = useMemo(() => {
    if (wsState === 'OPEN') {
      return t('settings.twitch.transport.connected');
    }
    if (wsState === 'CONNECTING') {
      return t('settings.twitch.transport.connecting');
    }
    return t('settings.twitch.transport.disconnected');
  }, [t, wsState]);

  const serviceStatusLabel = useMemo(() => {
    if (!twitchStatus) {
      return t('settings.twitch.statusUnavailable');
    }
    return t(serviceStatusTranslationKey[twitchStatus.status]);
  }, [t, twitchStatus]);

  const authenticationLabel = useMemo(() => {
    if (!twitchStatus) {
      return t('settings.twitch.auth.unknown');
    }
    return twitchStatus.authenticated
      ? t('settings.twitch.auth.authenticated')
      : t('settings.twitch.auth.notAuthenticated');
  }, [t, twitchStatus]);

  const detailText = useMemo(() => {
    if (wsState !== 'OPEN') {
      return t('settings.twitch.detail.backendDisconnected');
    }
    if (!twitchStatus) {
      return t('settings.twitch.detail.missingStatus');
    }
    return twitchStatus.detail || t('settings.twitch.detail.noAdditionalInfo');
  }, [t, twitchStatus, wsState]);

  const getConfigLabel = useCallback(
    (field: RestartAwareField, translationKey: string) => {
      const label = t(translationKey);
      if (!restartRequiredFields.has(field)) {
        return label;
      }
      return `${label} ${t('settings.twitch.restartRequiredSuffix')}`;
    },
    [restartRequiredFields, t],
  );

  return {
    baseUrl,
    backendConnectionLabel,
    authenticationLabel,
    authFlowPending: resolvedStatus.auth_flow_pending,
    canStartAuthorization: wsState === 'OPEN' && resolvedStatus.reauth_available,
    detailText,
    getConfigLabel,
    hasStatus: twitchStatus !== null,
    oauthRedirectUri: resolvedStatus.oauth_redirect_uri,
    resolvedStatus,
    serviceStatusLabel,
    tokenStorage: resolvedStatus.token_storage,
    wsState,
  };
}
