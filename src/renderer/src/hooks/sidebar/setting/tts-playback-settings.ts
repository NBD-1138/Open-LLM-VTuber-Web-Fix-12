export const TTS_PLAYBACK_VOLUME_KEY = 'appTtsPlaybackVolume';
export const DEFAULT_TTS_PLAYBACK_VOLUME = 1;

export const clampTtsPlaybackVolume = (value: number): number => (
  Math.min(1, Math.max(0, value))
);

export const parseTtsPlaybackVolume = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampTtsPlaybackVolume(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampTtsPlaybackVolume(parsed);
    }
  }

  return null;
};

export const loadTtsPlaybackVolume = (): number => {
  const storedValue = window.localStorage.getItem(TTS_PLAYBACK_VOLUME_KEY);
  if (!storedValue) {
    return DEFAULT_TTS_PLAYBACK_VOLUME;
  }

  try {
    const parsedJson = JSON.parse(storedValue);
    return parseTtsPlaybackVolume(parsedJson) ?? DEFAULT_TTS_PLAYBACK_VOLUME;
  } catch {
    return parseTtsPlaybackVolume(storedValue) ?? DEFAULT_TTS_PLAYBACK_VOLUME;
  }
};

export const saveTtsPlaybackVolume = (value: number): number => {
  const normalized = clampTtsPlaybackVolume(value);
  window.localStorage.setItem(
    TTS_PLAYBACK_VOLUME_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
};
