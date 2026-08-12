type AudioCompletionCallback = (requestId: string) => void;

const listeners = new Set<AudioCompletionCallback>();

export const emitAutomationAudioCompleted = (requestId: string): void => {
  listeners.forEach((listener) => listener(requestId));
};

export const subscribeToAutomationAudioCompleted = (
  callback: AudioCompletionCallback,
): (() => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
