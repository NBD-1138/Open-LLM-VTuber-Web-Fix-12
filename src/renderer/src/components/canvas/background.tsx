import { Box, Image } from '@chakra-ui/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canvasStyles } from './canvas-styles';
import { useCamera } from '@/context/camera-context';
import { useBgUrl } from '@/context/bgurl-context';
import { useWebSocket } from '@/context/websocket-context';

const isBackendBackgroundUrl = (url: string, baseUrl: string): boolean => {
  if (!url) {
    return false;
  }

  try {
    const resolvedUrl = new URL(url, baseUrl);
    const resolvedBaseUrl = new URL(baseUrl);
    return (
      resolvedUrl.origin === resolvedBaseUrl.origin
      && resolvedUrl.pathname.startsWith('/bg/')
    );
  } catch {
    return url.startsWith('/bg/') || url.includes('/bg/');
  }
};

const appendRetryToken = (url: string, baseUrl: string, retryToken: number): string => {
  if (!retryToken) {
    return url;
  }

  try {
    const resolvedUrl = new URL(url, baseUrl);
    resolvedUrl.searchParams.set('__bgRetry', String(retryToken));
    return resolvedUrl.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}__bgRetry=${retryToken}`;
  }
};

const Background = memo(({ children }: { children?: React.ReactNode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    backgroundStream, isBackgroundStreaming, startBackgroundCamera, stopBackgroundCamera,
  } = useCamera();
  const { useCameraBackground, backgroundUrl } = useBgUrl();
  const { wsState, baseUrl } = useWebSocket();
  const [retryToken, setRetryToken] = useState(0);
  const [retryOnReconnect, setRetryOnReconnect] = useState(false);
  const previousWsStateRef = useRef(wsState);

  const backendBackground = useMemo(
    () => !useCameraBackground && isBackendBackgroundUrl(backgroundUrl, baseUrl),
    [backgroundUrl, baseUrl, useCameraBackground],
  );

  const resolvedBackgroundUrl = useMemo(
    () => appendRetryToken(backgroundUrl, baseUrl, backendBackground ? retryToken : 0),
    [backgroundUrl, baseUrl, backendBackground, retryToken],
  );

  useEffect(() => {
    if (useCameraBackground) {
      startBackgroundCamera();
    } else {
      stopBackgroundCamera();
    }
  }, [useCameraBackground, startBackgroundCamera, stopBackgroundCamera]);

  useEffect(() => {
    if (videoRef.current && backgroundStream) {
      videoRef.current.srcObject = backgroundStream;
    }
  }, [backgroundStream]);

  useEffect(() => {
    const previousState = previousWsStateRef.current;
    previousWsStateRef.current = wsState;

    if (
      previousState !== 'OPEN'
      && wsState === 'OPEN'
      && retryOnReconnect
      && backendBackground
    ) {
      setRetryToken((current) => current + 1);
      setRetryOnReconnect(false);
    }
  }, [backendBackground, retryOnReconnect, wsState]);

  useEffect(() => {
    setRetryOnReconnect(false);
  }, [backgroundUrl]);

  const handleImageError = useCallback(() => {
    if (backendBackground) {
      setRetryOnReconnect(true);
    }
  }, [backendBackground]);

  const handleImageLoad = useCallback(() => {
    setRetryOnReconnect(false);
  }, []);

  return (
    <Box {...canvasStyles.background.container}>
      {useCameraBackground ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            ...canvasStyles.background.video,
            display: isBackgroundStreaming ? 'block' : 'none',
            transform: 'scaleX(-1)',
          }}
        />
      ) : (
        <Image
          {...canvasStyles.background.image}
          key={resolvedBackgroundUrl}
          src={resolvedBackgroundUrl}
          alt="background"
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      )}
      {children}
    </Box>
  );
});

Background.displayName = 'Background';

export default Background;
