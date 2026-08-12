import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_AUDIO_DEVICE_ID,
  loadSelectedInputDeviceId,
  loadSelectedOutputDeviceId,
  saveSelectedInputDeviceId,
  saveSelectedOutputDeviceId,
  supportsAudioOutputSelection,
} from "@/utils/audio-device-settings";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

interface AudioDeviceContextValue {
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  setSelectedInputDeviceId: (deviceId: string) => void;
  setSelectedOutputDeviceId: (deviceId: string) => void;
  refreshDevices: () => Promise<void>;
  isOutputSelectionSupported: boolean;
  isLoading: boolean;
}

const defaultInputDevice: AudioDeviceOption = {
  deviceId: DEFAULT_AUDIO_DEVICE_ID,
  label: "System default microphone",
};

const defaultOutputDevice: AudioDeviceOption = {
  deviceId: DEFAULT_AUDIO_DEVICE_ID,
  label: "System default speaker",
};

const AudioDeviceContext = createContext<AudioDeviceContextValue | null>(null);

const dedupeDevices = (devices: MediaDeviceInfo[]): MediaDeviceInfo[] => {
  const byId = new Map<string, MediaDeviceInfo>();
  devices.forEach((device) => {
    if (!byId.has(device.deviceId)) {
      byId.set(device.deviceId, device);
    }
  });
  return Array.from(byId.values());
};

const mapDevices = (
  devices: MediaDeviceInfo[],
  kind: "audioinput" | "audiooutput",
): AudioDeviceOption[] => {
  const labelPrefix = kind === "audioinput" ? "Microphone" : "Speaker";

  return dedupeDevices(devices.filter((device) => device.kind === kind)).map(
    (device, index) => ({
      deviceId: device.deviceId,
      label: device.label?.trim() || `${labelPrefix} ${index + 1}`,
    }),
  );
};

export function AudioDeviceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([
    defaultInputDevice,
  ]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([
    defaultOutputDevice,
  ]);
  const [selectedInputDeviceId, setSelectedInputDeviceIdState] = useState(() =>
    loadSelectedInputDeviceId(),
  );
  const [selectedOutputDeviceId, setSelectedOutputDeviceIdState] = useState(
    () => loadSelectedOutputDeviceId(),
  );
  const [isLoading, setIsLoading] = useState(false);

  const setSelectedInputDeviceId = useCallback((deviceId: string) => {
    const persisted = saveSelectedInputDeviceId(deviceId);
    setSelectedInputDeviceIdState(persisted);
  }, []);

  const setSelectedOutputDeviceId = useCallback((deviceId: string) => {
    const persisted = saveSelectedOutputDeviceId(deviceId);
    setSelectedOutputDeviceIdState(persisted);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.enumerateDevices
    ) {
      return;
    }

    setIsLoading(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextInputDevices = [
        defaultInputDevice,
        ...mapDevices(devices, "audioinput"),
      ];
      const nextOutputDevices = [
        defaultOutputDevice,
        ...mapDevices(devices, "audiooutput"),
      ];

      setInputDevices(nextInputDevices);
      setOutputDevices(nextOutputDevices);

      if (
        !nextInputDevices.some(
          (device) => device.deviceId === selectedInputDeviceId,
        )
      ) {
        setSelectedInputDeviceId(DEFAULT_AUDIO_DEVICE_ID);
      }

      if (
        !nextOutputDevices.some(
          (device) => device.deviceId === selectedOutputDeviceId,
        )
      ) {
        setSelectedOutputDeviceId(DEFAULT_AUDIO_DEVICE_ID);
      }
    } catch (error) {
      console.warn("[AudioDevices] Failed to enumerate audio devices", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedInputDeviceId,
    selectedOutputDeviceId,
    setSelectedInputDeviceId,
    setSelectedOutputDeviceId,
  ]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return undefined;
    }

    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => {
      void refreshDevices();
    };

    if (typeof mediaDevices.addEventListener === "function") {
      mediaDevices.addEventListener("devicechange", handleDeviceChange);
      return () => {
        mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      };
    }

    mediaDevices.ondevicechange = handleDeviceChange;
    return () => {
      if (mediaDevices.ondevicechange === handleDeviceChange) {
        mediaDevices.ondevicechange = null;
      }
    };
  }, [refreshDevices]);

  const value = useMemo(
    () => ({
      inputDevices,
      outputDevices,
      selectedInputDeviceId,
      selectedOutputDeviceId,
      setSelectedInputDeviceId,
      setSelectedOutputDeviceId,
      refreshDevices,
      isOutputSelectionSupported: supportsAudioOutputSelection(),
      isLoading,
    }),
    [
      inputDevices,
      outputDevices,
      selectedInputDeviceId,
      selectedOutputDeviceId,
      setSelectedInputDeviceId,
      setSelectedOutputDeviceId,
      refreshDevices,
      isLoading,
    ],
  );

  return (
    <AudioDeviceContext.Provider value={value}>
      {children}
    </AudioDeviceContext.Provider>
  );
}

export function useAudioDevices(): AudioDeviceContextValue {
  const context = useContext(AudioDeviceContext);
  if (!context) {
    throw new Error("useAudioDevices must be used within AudioDeviceProvider");
  }
  return context;
}
