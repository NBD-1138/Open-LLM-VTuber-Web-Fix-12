import { Box, Button, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useTwitchSettings } from '@/hooks/sidebar/setting/use-twitch-settings';
import { InputField, NumberField, SwitchField } from './common';

const noop = () => {};

function Twitch(): JSX.Element {
  const { t } = useTranslation();
  const {
    authFlowPending,
    baseUrl,
    backendConnectionLabel,
    authenticationLabel,
    canStartAuthorization,
    detailText,
    getConfigLabel,
    hasStatus,
    oauthRedirectUri,
    resolvedStatus,
    serviceStatusLabel,
    tokenStorage,
  } = useTwitchSettings();

  const handleAuthorize = () => {
    if (!canStartAuthorization) {
      return;
    }
    window.open(`${baseUrl.replace(/\/+$/, '')}/auth/twitch/start?force_verify=true`, '_blank');
  };

  return (
    <Stack gap={6} width="100%" maxW="full" align="stretch">
      <Box bg="whiteAlpha.100" borderRadius="md" p={4}>
        <Text color="white" fontSize="sm" fontWeight="semibold" mb={2}>
          {t('settings.twitch.readOnlyTitle')}
        </Text>
        <Text color="whiteAlpha.800" fontSize="sm">
          {t('settings.twitch.readOnlyDescription')}
        </Text>
      </Box>

      <InputField
        label={t('settings.twitch.backendConnection')}
        value={backendConnectionLabel}
        onChange={noop}
        disabled
      />

      <InputField
        label={t('settings.twitch.serviceStatus')}
        value={serviceStatusLabel}
        onChange={noop}
        disabled
      />

      <InputField
        label={t('settings.twitch.authenticationStatus')}
        value={authenticationLabel}
        onChange={noop}
        disabled
      />

      <InputField
        label={t('settings.twitch.statusDetail')}
        value={detailText}
        onChange={noop}
        disabled
      />

      <InputField
        label={t('settings.twitch.tokenStorage')}
        value={tokenStorage}
        onChange={noop}
        disabled
      />

      <InputField
        label={t('settings.twitch.oauthRedirectUri')}
        value={oauthRedirectUri}
        onChange={noop}
        disabled
      />

      <SwitchField
        label={getConfigLabel('enabled', 'settings.twitch.enabled')}
        checked={resolvedStatus.enabled}
        onChange={noop}
        disabled
      />

      <InputField
        label={getConfigLabel('channel', 'settings.twitch.channel')}
        value={resolvedStatus.channel}
        onChange={noop}
        placeholder={hasStatus ? '' : t('settings.twitch.statusUnavailable')}
        disabled
      />

      <InputField
        label={getConfigLabel('broadcaster_id', 'settings.twitch.broadcasterId')}
        value={resolvedStatus.broadcaster_id}
        onChange={noop}
        placeholder={hasStatus ? '' : t('settings.twitch.statusUnavailable')}
        disabled
      />

      <SwitchField
        label={getConfigLabel('talkback_enabled', 'settings.twitch.talkbackEnabled')}
        checked={resolvedStatus.talkback_enabled}
        onChange={noop}
        disabled
      />

      <SwitchField
        label={getConfigLabel('read_chat_aloud', 'settings.twitch.readChatAloud')}
        checked={resolvedStatus.read_chat_aloud}
        onChange={noop}
        disabled
      />

      <NumberField
        label={getConfigLabel('chat_tts_volume', 'settings.twitch.chatTtsVolume')}
        value={resolvedStatus.chat_tts_volume}
        onChange={noop}
        min={0}
        max={1}
        step={0.1}
        disabled
      />

      <SwitchField
        label={getConfigLabel(
          'notify_subscriptions',
          'settings.twitch.notifySubscriptions',
        )}
        checked={resolvedStatus.notify_subscriptions}
        onChange={noop}
        disabled
      />

      <SwitchField
        label={getConfigLabel(
          'notify_first_observed_chatters',
          'settings.twitch.notifyFirstObservedChatters',
        )}
        checked={resolvedStatus.notify_first_observed_chatters}
        onChange={noop}
        disabled
      />

      <NumberField
        label={getConfigLabel(
          'first_observed_chatter_viewer_threshold',
          'settings.twitch.viewerThreshold',
        )}
        value={resolvedStatus.first_observed_chatter_viewer_threshold}
        onChange={noop}
        min={0}
        step={1}
        disabled
      />

      <SwitchField
        label={getConfigLabel(
          'redemptions_enabled',
          'settings.twitch.redemptionsEnabled',
        )}
        checked={resolvedStatus.redemptions_enabled}
        onChange={noop}
        disabled
      />

      <SwitchField
        label={getConfigLabel(
          'self_moderation_enabled',
          'settings.twitch.selfModerationEnabled',
        )}
        checked={resolvedStatus.self_moderation_enabled}
        onChange={noop}
        disabled
      />

      <SwitchField
        label={getConfigLabel('debug', 'settings.twitch.debugLogging')}
        checked={resolvedStatus.debug}
        onChange={noop}
        disabled
      />

      <Button
        width="100%"
        disabled={!canStartAuthorization}
        onClick={handleAuthorize}
      >
        {authFlowPending
          ? t('settings.twitch.connectPending')
          : resolvedStatus.authenticated
            ? t('settings.twitch.reauthorize')
            : t('settings.twitch.authorize')}
      </Button>

      <Text color="whiteAlpha.700" fontSize="sm">
        {canStartAuthorization
          ? authFlowPending
            ? t('settings.twitch.connectPendingDescription')
            : t('settings.twitch.connectDescription')
          : t('settings.twitch.connectUnavailableDescription')}
      </Text>

      <Text color="whiteAlpha.700" fontSize="sm">
        {t('settings.twitch.redirectUriDescription')}
      </Text>

      <Text color="orange.200" fontSize="sm">
        {t('settings.twitch.restartRequiredNotice')}
      </Text>
    </Stack>
  );
}

export default Twitch;
