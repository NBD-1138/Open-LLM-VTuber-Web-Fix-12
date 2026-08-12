/* eslint-disable import/no-extraneous-dependencies */
import {
  Box,
  Tabs,
  Button,
  DrawerRoot,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerBackdrop,
  DrawerCloseTrigger,
} from '@chakra-ui/react';
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseButton } from '@/components/ui/close-button';

import { settingStyles } from './setting-styles';
import General from './general';
import Live2D from './live2d';
import ASR from './asr';
import TTS from './tts';
import Agent from './agent';
import About from './about';
import Twitch from './twitch';
import Assistant from './assistant';

export type SettingsTabValue =
  | 'general'
  | 'live2d'
  | 'asr'
  | 'tts'
  | 'agent'
  | 'twitch'
  | 'about'
  | 'assistant';

interface SettingUIProps {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
  drawerWidth: number;
  activeTab: SettingsTabValue;
  onActiveTabChange: (tab: SettingsTabValue) => void;
}

function SettingUI({
  open,
  onClose,
  drawerWidth,
  activeTab,
  onActiveTabChange,
}: SettingUIProps): JSX.Element {
  const { t } = useTranslation();
  const [saveHandlers, setSaveHandlers] = useState<(() => void)[]>([]);
  const [cancelHandlers, setCancelHandlers] = useState<(() => void)[]>([]);

  const handleSaveCallback = useCallback((handler: () => void) => {
    setSaveHandlers((prev) => [...prev, handler]);
    return (): void => {
      setSaveHandlers((prev) => prev.filter((h) => h !== handler));
    };
  }, []);

  const handleCancelCallback = useCallback((handler: () => void) => {
    setCancelHandlers((prev) => [...prev, handler]);
    return (): void => {
      setCancelHandlers((prev) => prev.filter((h) => h !== handler));
    };
  }, []);

  const handleSave = useCallback((): void => {
    saveHandlers.forEach((handler) => handler());
    onClose();
  }, [saveHandlers, onClose]);

  const handleCancel = useCallback((): void => {
    cancelHandlers.forEach((handler) => handler());
    onClose();
  }, [cancelHandlers, onClose]);

  const tabsContent = useMemo(
    () => (
      <Tabs.ContentGroup>
        <Tabs.Content value="general" {...settingStyles.settingUI.tabs.content}>
          <General
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="live2d" {...settingStyles.settingUI.tabs.content}>
          <Live2D
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="asr" {...settingStyles.settingUI.tabs.content}>
          <ASR onSave={handleSaveCallback} onCancel={handleCancelCallback} />
        </Tabs.Content>
        <Tabs.Content value="tts" {...settingStyles.settingUI.tabs.content}>
          <TTS onSave={handleSaveCallback} onCancel={handleCancelCallback} />
        </Tabs.Content>
        <Tabs.Content value="agent" {...settingStyles.settingUI.tabs.content}>
          <Agent
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="twitch" {...settingStyles.settingUI.tabs.content}>
          <Twitch />
        </Tabs.Content>
        <Tabs.Content value="about" {...settingStyles.settingUI.tabs.content}>
          <About />
        </Tabs.Content>
        <Tabs.Content value="assistant" {...settingStyles.settingUI.tabs.content}>
          <Assistant
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
      </Tabs.ContentGroup>
    ),
    [handleSaveCallback, handleCancelCallback],
  );

  return (
    <DrawerRoot
      open={open}
      lazyMount={false}
      unmountOnExit={false}
      onOpenChange={(e) => (e.open ? null : onClose())}
      placement="start"
    >
      <DrawerBackdrop />
      <DrawerContent
        {...settingStyles.settingUI.drawerContent}
        width={`${drawerWidth}px`}
        maxWidth={`min(95vw, ${drawerWidth}px)`}
      >
        <DrawerHeader {...settingStyles.settingUI.drawerHeader}>
          <DrawerTitle {...settingStyles.settingUI.drawerTitle}>
            {t('common.settings')}
          </DrawerTitle>
          <div {...settingStyles.settingUI.closeButton}>
            <DrawerCloseTrigger asChild>
              <CloseButton size="sm" color="white" />
            </DrawerCloseTrigger>
          </div>
        </DrawerHeader>

        <DrawerBody
          display="flex"
          flexDirection="column"
          overflow="hidden"
          minH={0}
        >
          <Tabs.Root
            value={activeTab}
            onValueChange={(details) => onActiveTabChange(details.value as SettingsTabValue)}
            {...settingStyles.settingUI.tabs.root}
          >
            <Tabs.List {...settingStyles.settingUI.tabs.list}>
              <Tabs.Trigger
                value="general"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.general')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="live2d"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.live2d')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="asr"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.asr')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="tts"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.tts')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="agent"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.agent')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="twitch"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.twitch')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="about"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.about')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="assistant"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.assistant')}
              </Tabs.Trigger>
            </Tabs.List>

            <Box
              width="100%"
              minW={0}
              flex="1"
              minH={0}
              overflowY="auto"
              overflowX="hidden"
              css={settingStyles.settingUI.container.css}
            >
              {tabsContent}
            </Box>
          </Tabs.Root>
        </DrawerBody>

        <DrawerFooter>
          <Button colorPalette="red" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button colorPalette="blue" onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

export default SettingUI;
