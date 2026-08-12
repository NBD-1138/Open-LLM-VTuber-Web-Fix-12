export const DEFAULT_AUDIO_DEVICE_ID = "";
export const AUDIO_INPUT_DEVICE_STORAGE_KEY =
  "open-llm-vtuber.audio-input-device-id";
export const AUDIO_OUTPUT_DEVICE_STORAGE_KEY =
  "open-llm-vtuber.audio-output-device-id";

type SinkCapableMediaElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const loadStoredDeviceId = (key: string): string => {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_DEVICE_ID;
  }

  const stored = window.localStorage.getItem(key);
  if (stored === null) {
    return DEFAULT_AUDIO_DEVICE_ID;
  }

  try {
    const parsed = JSON.parse(stored);
    return typeof parsed === "string" ? parsed : DEFAULT_AUDIO_DEVICE_ID;
  } catch {
    return DEFAULT_AUDIO_DEVICE_ID;
  }
};

const saveStoredDeviceId = (key: string, deviceId: string): string => {
  const normalized =
    typeof deviceId === "string" ? deviceId : DEFAULT_AUDIO_DEVICE_ID;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(normalized));
  }

  return normalized;
};

export const loadSelectedInputDeviceId = (): string =>
  loadStoredDeviceId(AUDIO_INPUT_DEVICE_STORAGE_KEY);

export const saveSelectedInputDeviceId = (deviceId: string): string =>
  saveStoredDeviceId(AUDIO_INPUT_DEVICE_STORAGE_KEY, deviceId);

export const loadSelectedOutputDeviceId = (): string =>
  loadStoredDeviceId(AUDIO_OUTPUT_DEVICE_STORAGE_KEY);

export const saveSelectedOutputDeviceId = (deviceId: string): string =>
  saveStoredDeviceId(AUDIO_OUTPUT_DEVICE_STORAGE_KEY, deviceId);

export const supportsAudioOutputSelection = (): boolean => {
  if (typeof HTMLMediaElement === "undefined") {
    return false;
  }

  return (
    typeof (HTMLMediaElement.prototype as SinkCapableMediaElement).setSinkId ===
    "function"
  );
};

export const applyStoredAudioOutputDevice = async (
  mediaElement: HTMLMediaElement,
): Promise<boolean> => {
  if (!supportsAudioOutputSelection()) {
    return false;
  }

  const setSinkId = (mediaElement as SinkCapableMediaElement).setSinkId;
  if (typeof setSinkId !== "function") {
    return false;
  }

  const selectedOutputDeviceId = loadSelectedOutputDeviceId();
  if (!selectedOutputDeviceId) {
    return false;
  }

  await setSinkId.call(
    mediaElement as SinkCapableMediaElement,
    selectedOutputDeviceId,
  );
  return true;
};
