import React, { useRef, useState, useEffect } from "react";
import { useVAD, VADSettings } from "@/context/vad-context";
import { useAudioDevices } from "@/context/audio-device-context";

export const useASRSettings = () => {
  const {
    settings,
    updateSettings,
    autoStopMic,
    setAutoStopMic,
    autoStartMicOn,
    setAutoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStartMicOnConvEnd,
  } = useVAD();
  const {
    inputDevices,
    isLoading,
    selectedInputDeviceId,
    setSelectedInputDeviceId,
  } = useAudioDevices();

  const localSettingsRef = useRef<VADSettings>(settings);
  const originalSettingsRef = useRef(settings);
  const originalAutoStopMicRef = useRef(autoStopMic);
  const originalAutoStartMicOnRef = useRef(autoStartMicOn);
  const originalAutoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const originalInputDeviceIdRef = useRef(selectedInputDeviceId);
  const [localVoiceInterruption, setLocalVoiceInterruption] =
    useState(autoStopMic);
  const [localAutoStartMic, setLocalAutoStartMic] = useState(autoStartMicOn);
  const [localAutoStartMicOnConvEnd, setLocalAutoStartMicOnConvEnd] = useState(
    autoStartMicOnConvEnd,
  );
  const [localInputDeviceId, setLocalInputDeviceId] = useState(
    selectedInputDeviceId,
  );
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  useEffect(() => {
    setLocalVoiceInterruption(autoStopMic);
    setLocalAutoStartMic(autoStartMicOn);
    setLocalAutoStartMicOnConvEnd(autoStartMicOnConvEnd);
    setLocalInputDeviceId(selectedInputDeviceId);
  }, [
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    selectedInputDeviceId,
  ]);

  const handleInputChange = (
    key: keyof VADSettings,
    value: number | string,
  ): void => {
    if (value === "" || value === "-") {
      localSettingsRef.current = { ...localSettingsRef.current, [key]: value };
    } else {
      const parsed = Number(value);
      // eslint-disable-next-line no-restricted-globals
      if (!isNaN(parsed)) {
        localSettingsRef.current = {
          ...localSettingsRef.current,
          [key]: parsed,
        };
      }
    }
    forceUpdate();
  };

  const handleVoiceInterruptionChange = (value: boolean) => {
    setLocalVoiceInterruption(value);
    setAutoStopMic(value);
  };

  const handleAutoStartMicChange = (value: boolean) => {
    setLocalAutoStartMic(value);
    setAutoStartMicOn(value);
  };

  const handleAutoStartMicOnConvEndChange = (value: boolean) => {
    setLocalAutoStartMicOnConvEnd(value);
    setAutoStartMicOnConvEnd(value);
  };

  const handleInputDeviceChange = (value: string[]) => {
    const [nextInputDeviceId = ""] = value;
    setLocalInputDeviceId(nextInputDeviceId);
    setSelectedInputDeviceId(nextInputDeviceId);
  };

  const handleSave = (): void => {
    updateSettings(localSettingsRef.current);
    originalSettingsRef.current = localSettingsRef.current;
    originalAutoStopMicRef.current = localVoiceInterruption;
    originalAutoStartMicOnRef.current = localAutoStartMic;
    originalAutoStartMicOnConvEndRef.current = localAutoStartMicOnConvEnd;
    originalInputDeviceIdRef.current = localInputDeviceId;
  };

  const handleCancel = (): void => {
    localSettingsRef.current = originalSettingsRef.current;
    setLocalVoiceInterruption(originalAutoStopMicRef.current);
    setLocalAutoStartMic(originalAutoStartMicOnRef.current);
    setAutoStopMic(originalAutoStopMicRef.current);
    setAutoStartMicOn(originalAutoStartMicOnRef.current);
    setLocalAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setLocalInputDeviceId(originalInputDeviceIdRef.current);
    setSelectedInputDeviceId(originalInputDeviceIdRef.current);
    forceUpdate();
  };

  return {
    inputDevices,
    isLoading,
    localSettings: localSettingsRef.current,
    localInputDeviceId,
    autoStopMic: localVoiceInterruption,
    autoStartMicOn: localAutoStartMic,
    autoStartMicOnConvEnd: localAutoStartMicOnConvEnd,
    setAutoStopMic: handleVoiceInterruptionChange,
    setAutoStartMicOn: handleAutoStartMicChange,
    setAutoStartMicOnConvEnd: handleAutoStartMicOnConvEndChange,
    handleInputDeviceChange,
    handleInputChange,
    handleSave,
    handleCancel,
  };
};
