/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import { Stack, createListCollection } from "@chakra-ui/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { settingStyles } from "./setting-styles";
import { useASRSettings } from "@/hooks/sidebar/setting/use-asr-settings";
import { SelectField, SwitchField, NumberField } from "./common";

interface ASRProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

function ASR({ onSave, onCancel }: ASRProps): JSX.Element {
  const { t } = useTranslation();
  const {
    localSettings,
    inputDevices,
    isLoading,
    localInputDeviceId,
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStopMic,
    setAutoStartMicOn,
    setAutoStartMicOnConvEnd,
    handleInputDeviceChange,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useASRSettings();

  const inputDeviceCollection = createListCollection({
    items: inputDevices.map((device) => ({
      label: device.label,
      value: device.deviceId,
    })),
  });

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel]);

  return (
    <Stack {...settingStyles.common.container}>
      <SelectField
        label={t("settings.asr.inputDevice", {
          defaultValue: "Input device",
        })}
        value={[localInputDeviceId]}
        onChange={handleInputDeviceChange}
        collection={inputDeviceCollection}
        placeholder={t("settings.asr.inputDevicePlaceholder", {
          defaultValue: "Choose microphone",
        })}
        help={t("settings.asr.inputDeviceDesc", {
          defaultValue:
            "Choose which microphone voice input listens to. If the mic is already running, it restarts on the new device.",
        })}
        disabled={isLoading}
      />

      <SwitchField
        label={t("settings.asr.autoStopMic")}
        checked={autoStopMic}
        onChange={setAutoStopMic}
      />

      <SwitchField
        label={t("settings.asr.autoStartMicOnConvEnd")}
        checked={autoStartMicOnConvEnd}
        onChange={setAutoStartMicOnConvEnd}
      />

      <SwitchField
        label={t("settings.asr.autoStartMicOn")}
        checked={autoStartMicOn}
        onChange={setAutoStartMicOn}
      />

      <NumberField
        label={t("settings.asr.positiveSpeechThreshold")}
        help={t("settings.asr.positiveSpeechThresholdDesc")}
        value={localSettings.positiveSpeechThreshold}
        onChange={(value) =>
          handleInputChange("positiveSpeechThreshold", value)
        }
        min={1}
        max={100}
      />

      <NumberField
        label={t("settings.asr.negativeSpeechThreshold")}
        help={t("settings.asr.negativeSpeechThresholdDesc")}
        value={localSettings.negativeSpeechThreshold}
        onChange={(value) =>
          handleInputChange("negativeSpeechThreshold", value)
        }
        min={0}
        max={100}
      />

      <NumberField
        label={t("settings.asr.redemptionFrames")}
        help={t("settings.asr.redemptionFramesDesc")}
        value={localSettings.redemptionFrames}
        onChange={(value) => handleInputChange("redemptionFrames", value)}
        min={1}
        max={100}
      />
    </Stack>
  );
}

export default ASR;
