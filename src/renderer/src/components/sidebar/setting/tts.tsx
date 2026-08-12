/* eslint-disable import/no-extraneous-dependencies */
import { useCallback, useEffect, useState } from "react";
import { Box, Flex, Stack, Text, createListCollection } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { settingStyles } from "./setting-styles";
import { SelectField } from "./common";
import {
  clampTtsPlaybackVolume,
  loadTtsPlaybackVolume,
  saveTtsPlaybackVolume,
} from "@/hooks/sidebar/setting/tts-playback-settings";
import { useAudioDevices } from "@/context/audio-device-context";

interface TTSProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

function TTS({ onSave, onCancel }: TTSProps): JSX.Element {
  const { t } = useTranslation();
  const {
    isLoading,
    isOutputSelectionSupported,
    outputDevices,
    selectedOutputDeviceId,
    setSelectedOutputDeviceId,
  } = useAudioDevices();
  const [playbackVolume, setPlaybackVolume] = useState(() =>
    loadTtsPlaybackVolume(),
  );
  const [savedPlaybackVolume, setSavedPlaybackVolume] = useState(() =>
    loadTtsPlaybackVolume(),
  );
  const [outputDeviceId, setOutputDeviceId] = useState(selectedOutputDeviceId);
  const [savedOutputDeviceId, setSavedOutputDeviceId] = useState(
    selectedOutputDeviceId,
  );

  useEffect(() => {
    setOutputDeviceId(selectedOutputDeviceId);
  }, [selectedOutputDeviceId]);

  const outputDeviceCollection = createListCollection({
    items: outputDevices.map((device) => ({
      label: device.label,
      value: device.deviceId,
    })),
  });

  const handlePlaybackVolumeChange = useCallback(
    (nextPercent: number): void => {
      const normalized = clampTtsPlaybackVolume(nextPercent / 100);
      setPlaybackVolume(normalized);
      saveTtsPlaybackVolume(normalized);
    },
    [],
  );

  const handleOutputDeviceChange = useCallback(
    (value: string[]): void => {
      const [nextOutputDeviceId = ""] = value;
      setOutputDeviceId(nextOutputDeviceId);
      setSelectedOutputDeviceId(nextOutputDeviceId);
    },
    [setSelectedOutputDeviceId],
  );

  const handleSave = useCallback((): void => {
    const persisted = saveTtsPlaybackVolume(playbackVolume);
    setPlaybackVolume(persisted);
    setSavedPlaybackVolume(persisted);
    setSavedOutputDeviceId(outputDeviceId);
  }, [outputDeviceId, playbackVolume]);

  const handleCancel = useCallback((): void => {
    setPlaybackVolume(savedPlaybackVolume);
    saveTtsPlaybackVolume(savedPlaybackVolume);
    setOutputDeviceId(savedOutputDeviceId);
    setSelectedOutputDeviceId(savedOutputDeviceId);
  }, [savedOutputDeviceId, savedPlaybackVolume, setSelectedOutputDeviceId]);

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [handleCancel, handleSave, onCancel, onSave]);

  return (
    <Stack {...settingStyles.common.container}>
      <SelectField
        label={t("settings.tts.outputDevice", {
          defaultValue: "Output device",
        })}
        value={[outputDeviceId]}
        onChange={handleOutputDeviceChange}
        collection={outputDeviceCollection}
        placeholder={t("settings.tts.outputDevicePlaceholder", {
          defaultValue: "Choose speaker",
        })}
        help={
          isOutputSelectionSupported
            ? t("settings.tts.outputDeviceDesc", {
                defaultValue:
                  "Choose where spoken responses and automation sounds play. Applies to newly started audio.",
              })
            : t("settings.tts.outputDeviceUnsupported", {
                defaultValue:
                  "This environment does not support choosing an audio output device. Playback will use the system default speaker.",
              })
        }
        disabled={isLoading || !isOutputSelectionSupported}
      />

      <Field
        {...settingStyles.general.field}
        label={
          <Flex align="center" justify="space-between" width="100%" gap={3}>
            <Text {...settingStyles.general.field.label}>
              {t("settings.general.ttsPlaybackVolume", {
                defaultValue: "TTS Playback Volume",
              })}
            </Text>
            <Text color="whiteAlpha.700" fontSize="sm">
              {Math.round(playbackVolume * 100)}%
            </Text>
          </Flex>
        }
        helperText={t("settings.general.ttsPlaybackVolumeHelp", {
          defaultValue:
            "Adjusts frontend playback volume for spoken responses. Applies to newly started speech clips.",
        })}
      >
        <Box px={1} pt={2} width="100%">
          <Slider
            aria-label={["tts-playback-volume"]}
            colorPalette="blue"
            width="100%"
            size="lg"
            value={[Math.round(playbackVolume * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(details) => {
              const [nextVolume] = details.value;
              if (typeof nextVolume === "number") {
                handlePlaybackVolumeChange(nextVolume);
              }
            }}
          />
        </Box>
      </Field>
    </Stack>
  );
}

export default TTS;
