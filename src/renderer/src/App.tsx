/* eslint-disable no-shadow */
// import { StrictMode } from 'react';
import { Box, Flex, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useState, useEffect } from "react";
// import Canvas from './components/canvas/canvas'; // Likely unused now
import Sidebar from "./components/sidebar/sidebar";
import Footer from "./components/footer/footer";
import { AiStateProvider } from "./context/ai-state-context";
import { Live2DConfigProvider } from "./context/live2d-config-context";
import { SubtitleProvider } from "./context/subtitle-context";
import { BgUrlProvider } from "./context/bgurl-context";
import { layoutStyles } from "./layout";
import WebSocketHandler from "./services/websocket-handler";
import { CameraProvider } from "./context/camera-context";
import { ChatHistoryProvider } from "./context/chat-history-context";
import { CharacterConfigProvider } from "./context/character-config-context";
import { Toaster } from "./components/ui/toaster";
import { VADProvider } from "./context/vad-context";
import { Live2D } from "./components/canvas/live2d";
import TitleBar from "./components/electron/title-bar";
import { InputSubtitle } from "./components/electron/input-subtitle";
import { ProactiveSpeakProvider } from "./context/proactive-speak-context";
import { ScreenCaptureProvider } from "./context/screen-capture-context";
import { GroupProvider } from "./context/group-context";
import { BrowserProvider } from "./context/browser-context";
import {
  AutomationProvider,
  useAutomation,
} from "./context/automation-context";
// eslint-disable-next-line import/no-extraneous-dependencies, import/newline-after-import
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Background from "./components/canvas/background";
import WebSocketStatus from "./components/canvas/ws-status";
import Subtitle from "./components/canvas/subtitle";
import { ModeProvider, useMode } from "./context/mode-context";
import { AudioDeviceProvider } from "./context/audio-device-context";

const COLLAPSED_SIDEBAR_WIDTH = 24;
const DEFAULT_SIDEBAR_WIDTH = 680;
const MIN_SIDEBAR_WIDTH = 420;
const MAX_SIDEBAR_WIDTH = 1200;
const SIDEBAR_WIDTH_STORAGE_KEY = "open-llm-vtuber.sidebar-width";

const getOverlayPosition = (placement: string) => {
  switch (placement) {
    case "top_left":
      return { top: "24px", left: "24px" };
    case "top_center":
      return { top: "24px", left: "50%", transform: "translateX(-50%)" };
    case "top_right":
      return { top: "24px", right: "24px" };
    case "bottom_left":
      return { bottom: "24px", left: "24px" };
    case "bottom_center":
      return { bottom: "24px", left: "50%", transform: "translateX(-50%)" };
    case "bottom_right":
      return { bottom: "24px", right: "24px" };
    case "center":
    default:
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
};

function AutomationOverlayLayer() {
  const { overlays } = useAutomation();

  return (
    <Box position="absolute" inset="0" pointerEvents="none" zIndex={9}>
      {overlays.map((overlay) => (
        <Box
          key={`${overlay.requestId}:${overlay.overlayId}`}
          position="absolute"
          maxW={{ base: "70vw", md: "42vw" }}
          {...getOverlayPosition(overlay.placement)}
          css={{
            filter: "drop-shadow(0 18px 36px rgba(0, 0, 0, 0.28))",
            animation:
              overlay.animationName === "pulse"
                ? "assistant-pulse 900ms ease-in-out infinite"
                : overlay.animationName === "slide_up"
                  ? "assistant-slide-up 500ms ease-out"
                  : overlay.animationName === "fade"
                    ? "assistant-fade-in 300ms ease-out"
                    : undefined,
            "@keyframes assistant-pulse": {
              "0%": { transform: "scale(1)" },
              "50%": { transform: "scale(1.04)" },
              "100%": { transform: "scale(1)" },
            },
            "@keyframes assistant-slide-up": {
              "0%": { opacity: 0, transform: "translate(-50%, -40%)" },
              "100%": { opacity: 1, transform: "translate(-50%, -50%)" },
            },
            "@keyframes assistant-fade-in": {
              "0%": { opacity: 0 },
              "100%": { opacity: 1 },
            },
          }}
        >
          <img
            src={overlay.dataUrl}
            alt={overlay.overlayId}
            style={{
              width: "100%",
              maxHeight: "32vh",
              objectFit: "contain",
            }}
          />
        </Box>
      ))}
    </Box>
  );
}

function AppContent(): JSX.Element {
  const [showSidebar, setShowSidebar] = useState(true);
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const [isStackedLayout, setIsStackedLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.innerWidth < 768;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SIDEBAR_WIDTH;
    }
    const stored = Number(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
    );
    if (Number.isFinite(stored)) {
      return stored;
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const { mode } = useMode();
  const { sceneOffset } = useAutomation();
  const isElectron = window.api !== undefined;
  const sceneTransform = `translate(${sceneOffset.x}px, ${sceneOffset.y}px)`;

  const clampSidebarWidth = (value: number) => {
    if (typeof window === "undefined") {
      return value;
    }
    const viewportMax = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 120),
    );
    return Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(viewportMax, Math.round(value)),
    );
  };

  useEffect(() => {
    const handleResize = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
      setIsStackedLayout(window.innerWidth < 768);
      setSidebarWidth((current) => clampSidebarWidth(current));
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(sidebarWidth)),
    );
  }, [sidebarWidth]);

  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.documentElement.style.position = "fixed";
  document.body.style.position = "fixed";
  document.documentElement.style.width = "100%";
  document.body.style.width = "100%";

  // Define base style properties shared across modes/breakpoints
  const live2dBaseStyle = {
    position: "absolute" as const,
    overflow: "hidden",
    transition: "all 0.3s ease-in-out", // Optional transition
    pointerEvents: "auto" as const,
  };

  // Define styles specifically for the "window" mode.
  const live2dWindowStyle = {
    ...live2dBaseStyle,
    inset: 0,
    zIndex: 1,
  };

  // Define styles specifically for the "pet" mode
  const live2dPetStyle = {
    ...live2dBaseStyle,
    top: 0, // Override position for pet mode
    left: 0,
    width: "100vw", // Full viewport
    height: "100vh",
    zIndex: 15, // Higher zIndex for pet mode overlay
  };

  const sceneLeft =
    mode === "pet"
      ? "0"
      : isStackedLayout
        ? "0"
        : showSidebar
          ? `${sidebarWidth}px`
          : `${COLLAPSED_SIDEBAR_WIDTH}px`;
  const sceneTop = mode === "pet" ? "0" : isElectron ? "30px" : "0";

  return (
    <>
      <Box
        position="fixed"
        top={sceneTop}
        left={sceneLeft}
        right="0"
        bottom="0"
        overflow="hidden"
        zIndex={mode === "pet" ? 15 : 1}
        pointerEvents="auto"
        style={{ transform: sceneTransform }}
      >
        {mode === "window" && <Background />}
        <Box {...(mode === "pet" ? live2dPetStyle : live2dWindowStyle)}>
          <Live2D showSidebar={showSidebar} />
        </Box>
        {mode === "window" && <AutomationOverlayLayer />}
      </Box>

      {/* Conditional Rendering of Window UI */}
      {mode === "window" && (
        <>
          {isElectron && <TitleBar />}
          {/* Apply styles by spreading */}
          <Flex {...layoutStyles.appContainer}>
            <Box
              {...layoutStyles.sidebar(
                showSidebar
                  ? `${sidebarWidth}px`
                  : `${COLLAPSED_SIDEBAR_WIDTH}px`,
              )}
            >
              <Sidebar
                isCollapsed={!showSidebar}
                onToggle={() => setShowSidebar(!showSidebar)}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
              />
            </Box>
            <Box {...layoutStyles.mainContent}>
              <Box position="absolute" top="20px" left="20px" zIndex={10}>
                <WebSocketStatus />
              </Box>
              <Box
                position="absolute"
                bottom={isFooterCollapsed ? "39px" : "135px"}
                left="50%"
                transform="translateX(-50%)"
                zIndex={10}
                width="60%"
              >
                <Subtitle />
              </Box>
              <Box
                {...layoutStyles.footer}
                position="absolute"
                left="0"
                right="0"
                bottom="0"
                zIndex={10}
                {...(isFooterCollapsed && layoutStyles.collapsedFooter)}
              >
                <Footer
                  isCollapsed={isFooterCollapsed}
                  onToggle={() => setIsFooterCollapsed(!isFooterCollapsed)}
                />
              </Box>
            </Box>
          </Flex>
        </>
      )}

      {/* Conditional Rendering of Pet Mode UI */}
      {mode === "pet" && <InputSubtitle />}
    </>
  );
}

function App(): JSX.Element {
  return (
    <ChakraProvider value={defaultSystem}>
      {/* ModeProvider needs to wrap AppContent to provide mode to getGlobalStyles */}
      <ModeProvider>
        <AppWithGlobalStyles />
      </ModeProvider>
    </ChakraProvider>
  );
}

// New component to access mode for global styles
function AppWithGlobalStyles(): JSX.Element {
  return (
    <>
      <CameraProvider>
        <ScreenCaptureProvider>
          <CharacterConfigProvider>
            <ChatHistoryProvider>
              <AiStateProvider>
                <ProactiveSpeakProvider>
                  <Live2DConfigProvider>
                    <SubtitleProvider>
                      <AudioDeviceProvider>
                        <VADProvider>
                          <BgUrlProvider>
                            <GroupProvider>
                              <BrowserProvider>
                                <WebSocketHandler>
                                  <AutomationProvider>
                                    <Toaster />
                                    <AppContent />
                                  </AutomationProvider>
                                </WebSocketHandler>
                              </BrowserProvider>
                            </GroupProvider>
                          </BgUrlProvider>
                        </VADProvider>
                      </AudioDeviceProvider>
                    </SubtitleProvider>
                  </Live2DConfigProvider>
                </ProactiveSpeakProvider>
              </AiStateProvider>
            </ChatHistoryProvider>
          </CharacterConfigProvider>
        </ScreenCaptureProvider>
      </CameraProvider>
    </>
  );
}

export default App;
