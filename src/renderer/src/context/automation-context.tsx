import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toaster } from "@/components/ui/toaster";
import { useAiState } from "@/context/ai-state-context";
import { useBgUrl } from "@/context/bgurl-context";
import { useVAD } from "@/context/vad-context";
import { useWebSocket } from "@/context/websocket-context";
import { wsService, MessageEvent } from "@/services/websocket-service";
import { subscribeToAutomationAudioCompleted } from "@/utils/automation-audio-events";
import { applyStoredAudioOutputDevice } from "@/utils/audio-device-settings";
import { APPROVED_OVERLAY_ASSETS } from "../../../shared/automation/assets";
import type {
  AssistantActiveApplicationWsMessage,
  AssistantContextSyncWsMessage,
  AssistantVoiceCommandStateWsMessage,
  AutomationBridgeApi,
  AutomationAssistantSettingsWsMessage,
  AutomationAssistantStateWsMessage,
  AutomationCapabilitiesWsMessage,
  AutomationConfirmationResponseWsMessage,
  AutomationVoiceCommandAmbiguityResponseWsMessage,
  AutomationExportOptions,
  AutomationEmergencyStopWsMessage,
  AutomationExecuteWsMessage,
  AutomationManagerEvent,
  AutomationVoiceCommandResolveResultWsMessage,
  AutomationVoiceCommandResolveTestWsMessage,
  AutomationResultWsMessage,
  AutomationSceneActionRequest,
  AutomationSceneActionResult,
  AutomationStatusWsMessage,
} from "../../../shared/automation/ipc";
import { toAutomationAssistantSettingsWsMessage } from "../../../shared/automation/ipc";
import type {
  AutomationAssistantSettings,
  AutomationAssistantStateSnapshot,
  AutomationDetectedApplication,
  AutomationExecutionRecord,
  AutomationProfile,
  AutomationProfileSummary,
  AutomationSettings,
  AutomationStatusSnapshot,
} from "../../../shared/automation/schema";
import {
  buildAutomationCapabilityCatalog,
  getDefaultAutomationAssistantSettings,
} from "../../../shared/automation/schema";
import type {
  ImportedAutomationProfileReviewReport,
  VoiceAttackImportProfileResult,
  VoiceAttackImportRequest,
  VoiceAttackInspectionResult,
  VoiceAttackProfilePreview,
} from "../../../shared/automation/voiceattack";

type OverlayState = {
  requestId: string;
  overlayId: string;
  placement: string;
  animationName?: string;
  dataUrl: string;
};

type BackgroundSnapshot = {
  backgroundUrl: string;
  useCameraBackground: boolean;
};

interface AutomationContextValue {
  available: boolean;
  snapshot: AutomationStatusSnapshot | null;
  assistantState: AutomationAssistantStateSnapshot | null;
  voiceCommandResolveResult: AutomationVoiceCommandResolveResultWsMessage | null;
  backendConnected: boolean;
  overlays: OverlayState[];
  sceneOffset: { x: number; y: number };
  listProfiles: () => Promise<AutomationProfileSummary[]>;
  getProfile: (profileId: string) => Promise<AutomationProfile | null>;
  saveProfile: (profile: AutomationProfile) => Promise<AutomationProfile>;
  deleteProfile: (profileId: string) => Promise<boolean>;
  executeCommand: AutomationBridgeApi["executeCommand"];
  cancel: (requestId: string) => Promise<boolean>;
  cancelAll: () => Promise<number>;
  emergencyStop: () => Promise<void>;
  getStatus: () => Promise<AutomationStatusSnapshot>;
  resetEmergencyStop: () => Promise<AutomationStatusSnapshot>;
  setActiveProfile: (
    profileId: string | null,
  ) => Promise<AutomationStatusSnapshot>;
  updateSettings: (
    settingsPatch: Partial<AutomationSettings>,
  ) => Promise<AutomationStatusSnapshot>;
  importProfiles: AutomationBridgeApi["importProfiles"];
  inspectVoiceAttackSource: () => Promise<VoiceAttackInspectionResult | null>;
  previewVoiceAttackImport: (options: {
    importId: string;
    candidateId: string;
  }) => Promise<VoiceAttackProfilePreview>;
  exportVoiceAttackDiagnosticReport: (options: {
    importId: string;
    candidateId: string;
  }) => Promise<boolean>;
  importVoiceAttackProfile: (
    options: VoiceAttackImportRequest,
  ) => Promise<VoiceAttackImportProfileResult>;
  cancelVoiceAttackImport: (importId: string) => Promise<boolean>;
  validateImportedProfile: (
    profileId: string,
  ) => Promise<ImportedAutomationProfileReviewReport>;
  markImportedProfileReviewed: (
    profileId: string,
  ) => Promise<AutomationProfile>;
  exportProfile: (options: AutomationExportOptions) => Promise<boolean>;
  selectTelemetryDirectory: () => Promise<string | null>;
  setVoiceCommandListeningActive: (active: boolean) => Promise<void>;
  resolveVoiceCommandTest: (text: string) => void;
  respondToVoiceCommandAmbiguity: (
    ambiguityId: string,
    action: "select" | "cancel",
    commandId?: string,
  ) => void;
  respondToAssistantConfirmation: (
    requestId: string,
    action: "confirm" | "reject",
    source?: "manual" | "player_voice",
  ) => void;
  refreshStatus: () => Promise<void>;
}

const AutomationContext = createContext<AutomationContextValue | null>(null);

const getAutomationBridge = (): AutomationBridgeApi | null =>
  window.automation ?? null;

const createBackendStatusMessage = (
  snapshot: AutomationStatusSnapshot,
): AutomationStatusWsMessage => ({
  type: "automation/status",
  status: snapshot.status,
  emergency_stopped: snapshot.emergencyStopped,
  active_profile_id: snapshot.activeProfileId,
  profiles: snapshot.profiles.map((profile) => ({
    profile_id: profile.profileId,
    display_name: profile.displayName,
    enabled: profile.enabled,
    process_names: [...profile.processNames],
    commands: profile.commands.map((command) => ({
      command_id: command.commandId,
      label: command.label,
      enabled: command.enabled,
    })),
  })),
  running_requests: snapshot.runningRequestIds,
  last_error: snapshot.lastError,
});

const createBackendResultMessage = (
  record: AutomationExecutionRecord,
): AutomationResultWsMessage => ({
  type: "automation/result",
  request_id: record.requestId,
  profile_id: record.profileId,
  command_id: record.commandId,
  status: record.status,
  duration_ms: record.durationMs,
  error: record.error ?? null,
  outcome: record.outcome
    ? {
        command_id: record.outcome.commandId,
        result_type: record.outcome.resultType,
        reason: record.outcome.reason,
        physical_input_sent: record.outcome.physicalInputSent,
        telemetry_confirmed: record.outcome.telemetryConfirmed,
        skipped_actions: [...record.outcome.skippedActions],
        blocking_actions: [...record.outcome.blockingActions],
        unsupported_actions: [...record.outcome.unsupportedActions],
        nested_command_trace: [...record.outcome.nestedCommandTrace],
        duration_ms: record.outcome.durationMs,
        final_observed_state: record.outcome.finalObservedState
          ? { ...record.outcome.finalObservedState }
          : null,
        trace: record.outcome.trace.map((entry) => ({
          command_id: entry.commandId,
          node_id: entry.nodeId,
          kind: entry.kind,
          status: entry.status,
          summary: entry.summary,
        })),
        semantic_capability_id: record.outcome.semanticCapabilityId ?? null,
      }
    : undefined,
});

const createAssistantSettingsMessage = (
  snapshot: AutomationStatusSnapshot,
): AutomationAssistantSettingsWsMessage =>
  toAutomationAssistantSettingsWsMessage(snapshot);

const createCapabilitiesMessage = (
  snapshot: AutomationStatusSnapshot,
  profile: AutomationProfile | null,
  revision: number,
): AutomationCapabilitiesWsMessage => ({
  type: "automation/capabilities",
  active_profile_id: snapshot.activeProfileId,
  revision,
  capabilities: buildAutomationCapabilityCatalog(profile, snapshot).map(
    (capability) => ({
      profile_id: capability.profileId,
      command_id: capability.commandId,
      label: capability.label,
      description: capability.description,
      aliases: [...capability.aliases],
      category: capability.category,
      enabled: capability.enabled,
      available: capability.available,
      risk: capability.risk,
      autonomy_policy: capability.autonomyPolicy,
      allowed_trigger_sources: [...capability.allowedTriggerSources],
      cooldown_remaining_ms: capability.cooldownRemainingMs,
      blocked_reason: capability.blockedReason ?? null,
    }),
  ),
});

const createActiveApplicationMessage = (
  application: AutomationDetectedApplication,
): AssistantActiveApplicationWsMessage => ({
  type: "assistant/active-application",
  process_name: application.processName,
  window_title: application.windowTitle,
  detected_at: application.detectedAt,
  confidence: application.confidence,
});

const createContextSyncMessage = (
  snapshot: AutomationStatusSnapshot,
  version: number,
): AssistantContextSyncWsMessage => ({
  type: "assistant/context-sync",
  version,
  matched_profile_id: snapshot.matchedProfileId,
  effective_profile_id: snapshot.effectiveProfileId,
  manual_profile_id: snapshot.manualProfileId,
  profile_selection_mode: snapshot.profileSelectionMode,
  profile_selection_source: snapshot.profileSelectionSource,
  profile_match_confidence: snapshot.profileMatchConfidence,
  last_profile_transition_at: snapshot.lastProfileTransitionAt,
  speech_mode: snapshot.speechMode,
  proactive_commentary_enabled: snapshot.proactiveCommentaryEnabled,
  minimum_commentary_interval_ms: snapshot.minimumCommentaryIntervalMs,
  max_queued_conversation_events: snapshot.maxQueuedConversationEvents,
  announce_application_changes: snapshot.announceApplicationChanges,
  acknowledge_routine_automation_success:
    snapshot.acknowledgeRoutineAutomationSuccess,
  player_speaking: null,
});

const createVoiceCommandStateMessage = (
  snapshot: AutomationStatusSnapshot,
): AssistantVoiceCommandStateWsMessage => ({
  type: "assistant/voice-command-state",
  listening_active: snapshot.voiceCommandListeningActive,
});

const mapAssistantSettings = (
  message: AutomationAssistantStateWsMessage["settings"] | undefined,
): AutomationAssistantSettings => {
  const defaults = getDefaultAutomationAssistantSettings();
  if (!message) {
    return defaults;
  }
  return {
    llmAutomationEnabled:
      typeof message.llm_automation_enabled === "boolean"
        ? message.llm_automation_enabled
        : defaults.llmAutomationEnabled,
    allowAutonomousHarmlessCommands:
      typeof message.allow_autonomous_harmless_commands === "boolean"
        ? message.allow_autonomous_harmless_commands
        : defaults.allowAutonomousHarmlessCommands,
    allowAutonomousLowRiskCommands:
      typeof message.allow_autonomous_low_risk_commands === "boolean"
        ? message.allow_autonomous_low_risk_commands
        : defaults.allowAutonomousLowRiskCommands,
    confirmationTimeoutMs:
      typeof message.confirmation_timeout_ms === "number"
        ? message.confirmation_timeout_ms
        : defaults.confirmationTimeoutMs,
    maxPendingConfirmations:
      typeof message.max_pending_confirmations === "number"
        ? message.max_pending_confirmations
        : defaults.maxPendingConfirmations,
    announceBlockedCommandRequests:
      typeof message.announce_blocked_command_requests === "boolean"
        ? message.announce_blocked_command_requests
        : defaults.announceBlockedCommandRequests,
    includeCommandSuggestionsInSpeech:
      typeof message.include_command_suggestions_in_speech === "boolean"
        ? message.include_command_suggestions_in_speech
        : defaults.includeCommandSuggestionsInSpeech,
    resultAcknowledgementsEnabled:
      typeof message.result_acknowledgements_enabled === "boolean"
        ? message.result_acknowledgements_enabled
        : defaults.resultAcknowledgementsEnabled,
    confirmationPhrases: Array.isArray(message.confirmation_phrases)
      ? [...message.confirmation_phrases]
      : defaults.confirmationPhrases,
    cancellationPhrases: Array.isArray(message.cancellation_phrases)
      ? [...message.cancellation_phrases]
      : defaults.cancellationPhrases,
    defaultSpeechMode:
      typeof message.default_speech_mode === "string"
        ? message.default_speech_mode
        : defaults.defaultSpeechMode,
    proactiveCommentaryEnabled:
      typeof message.proactive_commentary_enabled === "boolean"
        ? message.proactive_commentary_enabled
        : defaults.proactiveCommentaryEnabled,
    minimumCommentaryIntervalMs:
      typeof message.minimum_commentary_interval_ms === "number"
        ? message.minimum_commentary_interval_ms
        : defaults.minimumCommentaryIntervalMs,
    maxQueuedConversationEvents:
      typeof message.max_queued_conversation_events === "number"
        ? message.max_queued_conversation_events
        : defaults.maxQueuedConversationEvents,
    announceApplicationChanges:
      typeof message.announce_application_changes === "boolean"
        ? message.announce_application_changes
        : defaults.announceApplicationChanges,
    acknowledgeRoutineAutomationSuccess:
      typeof message.acknowledge_routine_automation_success === "boolean"
        ? message.acknowledge_routine_automation_success
        : defaults.acknowledgeRoutineAutomationSuccess,
    voiceCommandActivationMode:
      typeof message.voice_command_activation_mode === "string"
        ? message.voice_command_activation_mode
        : defaults.voiceCommandActivationMode,
    voiceCommandWakePhrases: Array.isArray(message.voice_command_wake_phrases)
      ? [...message.voice_command_wake_phrases]
      : defaults.voiceCommandWakePhrases,
    voiceCommandPushToCommandHotkey:
      typeof message.voice_command_push_to_command_hotkey === "string"
        ? message.voice_command_push_to_command_hotkey
        : defaults.voiceCommandPushToCommandHotkey,
    voiceCommandAmbiguityTimeoutMs:
      typeof message.voice_command_ambiguity_timeout_ms === "number"
        ? message.voice_command_ambiguity_timeout_ms
        : defaults.voiceCommandAmbiguityTimeoutMs,
    voiceCommandAcknowledgementMode:
      typeof message.voice_command_acknowledgement_mode === "string"
        ? message.voice_command_acknowledgement_mode
        : defaults.voiceCommandAcknowledgementMode,
    telemetry:
      message.telemetry && typeof message.telemetry === "object"
        ? {
            ...defaults.telemetry,
            ...message.telemetry,
            hullWarningThresholds: Array.isArray(
              message.telemetry.hullWarningThresholds,
            )
              ? [...message.telemetry.hullWarningThresholds]
              : defaults.telemetry.hullWarningThresholds,
            commentary:
              message.telemetry.commentary &&
              typeof message.telemetry.commentary === "object"
                ? {
                    ...defaults.telemetry.commentary,
                    ...message.telemetry.commentary,
                  }
                : defaults.telemetry.commentary,
          }
        : defaults.telemetry,
  };
};

const mapAssistantState = (
  message: AutomationAssistantStateWsMessage,
): AutomationAssistantStateSnapshot => ({
  activeProfileId: message.active_profile_id,
  capabilityRevision: message.capability_revision,
  stateVersion: message.state_version,
  detectedApplication: message.detected_application
    ? {
        processName: message.detected_application.process_name,
        windowTitle: message.detected_application.window_title,
        detectedAt: message.detected_application.detected_at,
        confidence: message.detected_application.confidence,
      }
    : null,
  matchedProfileId: message.matched_profile_id,
  effectiveProfileId: message.effective_profile_id,
  profileSelectionMode: message.profile_selection_mode,
  profileSelectionSource: message.profile_selection_source,
  profileMatchConfidence: message.profile_match_confidence,
  lastProfileTransitionAt: message.last_profile_transition_at,
  speechMode: message.speech_mode,
  settings: mapAssistantSettings(message.settings),
  telemetry: message.telemetry,
  capabilities: message.capabilities.map((capability) => ({
    profileId: capability.profile_id,
    commandId: capability.command_id,
    label: capability.label,
    description: capability.description,
    aliases: [...capability.aliases],
    category: capability.category,
    enabled: capability.enabled,
    available: capability.available,
    risk: capability.risk,
    autonomyPolicy: capability.autonomy_policy,
    allowedTriggerSources: [...capability.allowed_trigger_sources],
    cooldownRemainingMs: capability.cooldown_remaining_ms,
    llmAccess: capability.llm_access,
    blockedReason: capability.blocked_reason ?? null,
    recommended: capability.recommended,
    avoidReason: capability.avoid_reason ?? null,
  })),
  pendingConfirmations: message.pending_confirmations.map((pending) => ({
    requestId: pending.request_id,
    profileId: pending.profile_id,
    commandId: pending.command_id,
    commandLabel: pending.command_label,
    conciseReason: pending.concise_reason,
    risk: pending.risk,
    createdAt: pending.created_at,
    expiresAt: pending.expires_at,
    source: pending.source,
  })),
  recentDecisions: message.recent_decisions.map((decision) => ({
    decisionId: decision.decision_id,
    decisionType: decision.decision_type,
    profileId: decision.profile_id,
    commandId: decision.command_id,
    commandLabel: decision.command_label,
    reason: decision.reason,
    risk: decision.risk,
    blockedReason: decision.blocked_reason,
    requestId: decision.request_id,
    createdAt: decision.created_at,
  })),
  lastBlockedReason: message.last_blocked_reason ?? null,
  queueSummary: {
    total: message.queue_summary.total,
    highPriority: message.queue_summary.high_priority,
    conversational: message.queue_summary.conversational,
    suppressed: message.queue_summary.suppressed,
  },
  currentEvent: message.current_event
    ? {
        eventId: message.current_event.event_id,
        eventType: message.current_event.event_type,
        summary: message.current_event.summary,
        importance: message.current_event.importance,
        urgency: message.current_event.urgency,
        confidence: message.current_event.confidence,
        timestamp: message.current_event.timestamp,
        policyReason: message.current_event.policy_reason,
      }
    : null,
  suppressedEventCount: message.suppressed_event_count,
  activity: message.activity.map((entry) => ({
    activityId: entry.activity_id,
    eventId: entry.event_id,
    eventType: entry.event_type,
    status: entry.status,
    summary: entry.summary,
    policyReason: entry.policy_reason,
    createdAt: entry.created_at,
  })),
  vtuberSpeaking: message.vtuber_speaking,
  playerSpeaking: message.player_speaking,
  lastPlayerRequest: message.last_player_request,
  pendingAmbiguity: message.pending_ambiguity
    ? {
        ambiguityId: message.pending_ambiguity.ambiguity_id,
        transcript: message.pending_ambiguity.transcript,
        normalizedPhrase: message.pending_ambiguity.normalized_phrase,
        candidates: message.pending_ambiguity.candidates.map((candidate) => ({
          commandId: candidate.command_id,
          label: candidate.label,
        })),
        expiresAt: message.pending_ambiguity.expires_at,
      }
    : null,
  resolverActivity: message.resolver_activity.map((entry) => ({
    activityId: entry.activity_id,
    transcript: entry.transcript,
    normalizedPhrase: entry.normalized_phrase,
    activationMode: entry.activation_mode,
    activationMet: entry.activation_met,
    result: entry.result,
    matchedCommandId: entry.matched_command_id,
    matchedCommandLabel: entry.matched_command_label,
    candidateCommandLabels: [...entry.candidate_command_labels],
    blockedReason: entry.blocked_reason,
    requestId: entry.request_id,
    fellBackToConversation: entry.fell_back_to_conversation,
    createdAt: entry.created_at,
  })),
});

export function AutomationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const automation = getAutomationBridge();
  const available = Boolean(automation);
  const { aiState, setAiState } = useAiState();
  const { wsState, sendMessage, baseUrl } = useWebSocket();
  const { autoStartMicOnConvEnd, micOn, startMic, stopMic } = useVAD();
  const {
    backgroundUrl,
    setBackgroundUrl,
    backgroundFiles,
    useCameraBackground,
    setUseCameraBackground,
  } = useBgUrl();

  const [snapshot, setSnapshot] = useState<AutomationStatusSnapshot | null>(
    null,
  );
  const [assistantState, setAssistantState] =
    useState<AutomationAssistantStateSnapshot | null>(null);
  const [voiceCommandResolveResult, setVoiceCommandResolveResult] =
    useState<AutomationVoiceCommandResolveResultWsMessage | null>(null);
  const [activeProfile, setActiveProfileState] =
    useState<AutomationProfile | null>(null);
  const [overlays, setOverlays] = useState<OverlayState[]>([]);
  const [sceneOffset, setSceneOffset] = useState({ x: 0, y: 0 });

  const backgroundSnapshotsRef = useRef<Record<string, BackgroundSnapshot>>({});
  const pendingSpeakRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const assistantStateRef = useRef<AutomationAssistantStateSnapshot | null>(
    null,
  );
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const micOnRef = useRef(micOn);
  const aiStateRef = useRef(aiState);
  const pendingVoiceFollowupRef = useRef(false);
  const overlayTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const shakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capabilityRevisionRef = useRef(0);
  const assistantContextVersionRef = useRef(0);
  const backendConnected = wsState === "OPEN";

  useEffect(() => {
    assistantStateRef.current = assistantState;
  }, [assistantState]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    micOnRef.current = micOn;
  }, [micOn]);

  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  const resumeVoiceCaptureAfterAutomationPrompt = useCallback(() => {
    if (!pendingVoiceFollowupRef.current) {
      return;
    }
    const currentAssistantState = assistantStateRef.current;
    const needsSpokenFollowup = Boolean(
      currentAssistantState &&
        (currentAssistantState.pendingConfirmations.length > 0 ||
          currentAssistantState.pendingAmbiguity),
    );
    if (!needsSpokenFollowup) {
      return;
    }

    pendingVoiceFollowupRef.current = false;
    setAiState((currentState) =>
      currentState === "thinking-speaking" ? "idle" : currentState,
    );
    if (autoStartMicOnConvEndRef.current && !micOnRef.current) {
      void startMic();
    }
  }, [setAiState, startMic]);

  const refreshStatus = useCallback(async () => {
    if (!automation) {
      return;
    }
    const nextSnapshot = await automation.getStatus();
    setSnapshot(nextSnapshot);
  }, [automation]);

  const refreshActiveProfile = useCallback(
    async (profileId: string | null | undefined) => {
      if (!automation || !profileId) {
        setActiveProfileState(null);
        return;
      }
      const profile = await automation.getProfile(profileId);
      setActiveProfileState(profile);
    },
    [automation],
  );

  useEffect(() => {
    if (!automation) {
      return undefined;
    }

    let mounted = true;
    void automation.getStatus().then((nextSnapshot) => {
      if (mounted) {
        setSnapshot(nextSnapshot);
      }
    });

    const unsubscribeEvents = automation.subscribeToEvents(
      (event: AutomationManagerEvent) => {
        if (!mounted) {
          return;
        }
        switch (event.type) {
          case "status":
            setSnapshot(event.snapshot);
            break;
          case "execution":
            if (backendConnected) {
              sendMessage(createBackendResultMessage(event.record));
            }
            break;
          case "profiles":
            setSnapshot((current) =>
              current
                ? {
                    ...current,
                    profiles: event.profiles,
                    activeProfileId: event.activeProfileId,
                  }
                : current,
            );
            break;
          case "scene-action":
            void handleSceneAction(event.action);
            break;
          default:
            break;
        }
      },
    );

    const unsubscribeAudio = subscribeToAutomationAudioCompleted(
      (requestId) => {
        const pending = pendingSpeakRequestsRef.current.get(requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        pendingSpeakRequestsRef.current.delete(requestId);
        pending.resolve();
        pendingVoiceFollowupRef.current =
          aiStateRef.current === "thinking-speaking";
        resumeVoiceCaptureAfterAutomationPrompt();
      },
    );

    return () => {
      mounted = false;
      unsubscribeEvents();
      unsubscribeAudio();
      Object.values(overlayTimersRef.current).forEach((timer) =>
        clearTimeout(timer),
      );
      overlayTimersRef.current = {};
      pendingSpeakRequestsRef.current.forEach((pending) =>
        clearTimeout(pending.timeout),
      );
      pendingSpeakRequestsRef.current.clear();
      if (shakeTimerRef.current) {
        clearInterval(shakeTimerRef.current);
      }
    };
  }, [automation, backendConnected, sendMessage]);

  useEffect(() => {
    void refreshActiveProfile(snapshot?.activeProfileId ?? null);
  }, [refreshActiveProfile, snapshot?.activeProfileId]);

  useEffect(() => {
    if (!automation || !snapshot || !backendConnected) {
      return;
    }
    sendMessage(createBackendStatusMessage(snapshot));
    if (snapshot.emergencyStopped) {
      const emergencyMessage: AutomationEmergencyStopWsMessage = {
        type: "automation/emergency_stop",
        emergency_stopped: true,
        reason: snapshot.lastError,
      };
      sendMessage(emergencyMessage);
    }
  }, [automation, snapshot, backendConnected, sendMessage]);

  useEffect(() => {
    if (!snapshot || !backendConnected) {
      return;
    }
    sendMessage(createAssistantSettingsMessage(snapshot));
  }, [
    backendConnected,
    sendMessage,
    snapshot?.llmAutomationEnabled,
    snapshot?.allowAutonomousHarmlessCommands,
    snapshot?.allowAutonomousLowRiskCommands,
    snapshot?.confirmationTimeoutMs,
    snapshot?.maxPendingConfirmations,
    snapshot?.announceBlockedCommandRequests,
    snapshot?.includeCommandSuggestionsInSpeech,
    snapshot?.resultAcknowledgementsEnabled,
    snapshot?.confirmationPhrases,
    snapshot?.cancellationPhrases,
    snapshot?.defaultSpeechMode,
    snapshot?.proactiveCommentaryEnabled,
    snapshot?.minimumCommentaryIntervalMs,
    snapshot?.maxQueuedConversationEvents,
    snapshot?.announceApplicationChanges,
    snapshot?.acknowledgeRoutineAutomationSuccess,
    snapshot?.voiceCommandActivationMode,
    snapshot?.voiceCommandWakePhrases,
    snapshot?.voiceCommandPushToCommandHotkey,
    snapshot?.voiceCommandAmbiguityTimeoutMs,
    snapshot?.voiceCommandAcknowledgementMode,
  ]);

  useEffect(() => {
    if (!snapshot || !backendConnected) {
      return;
    }
    sendMessage(createVoiceCommandStateMessage(snapshot));
  }, [backendConnected, sendMessage, snapshot?.voiceCommandListeningActive]);

  useEffect(() => {
    if (!snapshot || !backendConnected) {
      return;
    }
    assistantContextVersionRef.current += 1;
    if (snapshot.detectedApplication) {
      sendMessage(createActiveApplicationMessage(snapshot.detectedApplication));
    }
    sendMessage(
      createContextSyncMessage(snapshot, assistantContextVersionRef.current),
    );
  }, [
    backendConnected,
    sendMessage,
    snapshot?.detectedApplication?.processName,
    snapshot?.detectedApplication?.windowTitle,
    snapshot?.detectedApplication?.detectedAt,
    snapshot?.detectedApplication?.confidence,
    snapshot?.matchedProfileId,
    snapshot?.effectiveProfileId,
    snapshot?.manualProfileId,
    snapshot?.profileSelectionMode,
    snapshot?.profileSelectionSource,
    snapshot?.profileMatchConfidence,
    snapshot?.lastProfileTransitionAt,
    snapshot?.speechMode,
    snapshot?.proactiveCommentaryEnabled,
    snapshot?.minimumCommentaryIntervalMs,
    snapshot?.maxQueuedConversationEvents,
    snapshot?.announceApplicationChanges,
    snapshot?.acknowledgeRoutineAutomationSuccess,
  ]);

  useEffect(() => {
    if (!snapshot || !backendConnected) {
      return;
    }
    if (snapshot.activeProfileId && !activeProfile) {
      return;
    }
    capabilityRevisionRef.current += 1;
    sendMessage(
      createCapabilitiesMessage(
        snapshot,
        activeProfile,
        capabilityRevisionRef.current,
      ),
    );
  }, [activeProfile, backendConnected, sendMessage, snapshot]);

  useEffect(() => {
    if (!automation) {
      return;
    }
    void automation.syncAssistantState(backendConnected ? assistantState : null);
  }, [assistantState, automation, backendConnected]);

  useEffect(() => {
    const subscription = wsService.onMessage((message: MessageEvent) => {
      if (!automation) {
        return;
      }

      switch (message.type) {
        case "automation/execute":
          void handleBackendExecute(
            message as unknown as AutomationExecuteWsMessage,
          );
          break;
        case "automation/cancel":
          if (message.request_id) {
            void automation.cancel(message.request_id);
          }
          break;
        case "automation/emergency_stop":
          if (message.emergency_stopped) {
            void automation.emergencyStop();
          } else {
            void automation.resetEmergencyStop();
          }
          break;
        case "automation/speak-fixed-error":
          if (message.request_id) {
            const pending = pendingSpeakRequestsRef.current.get(
              message.request_id,
            );
            if (pending) {
              clearTimeout(pending.timeout);
              pendingSpeakRequestsRef.current.delete(message.request_id);
              pending.reject(
                new Error(message.message || "Automation speech failed."),
              );
            }
          }
          break;
        case "automation/assistant-state":
          {
            const nextAssistantState = mapAssistantState(
              message as unknown as AutomationAssistantStateWsMessage,
            );
            assistantStateRef.current = nextAssistantState;
            if (
              nextAssistantState.pendingConfirmations.length === 0 &&
              !nextAssistantState.pendingAmbiguity
            ) {
              pendingVoiceFollowupRef.current = false;
            }
            setAssistantState(nextAssistantState);
            resumeVoiceCaptureAfterAutomationPrompt();
          }
          break;
        case "automation/voice-command-resolve-result":
          setVoiceCommandResolveResult(
            message as unknown as AutomationVoiceCommandResolveResultWsMessage,
          );
          break;
        default:
          break;
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [automation, resumeVoiceCaptureAfterAutomationPrompt]);

  const playSound = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      if (!action.playbackUrl) {
        return {
          requestId: action.requestId,
          actionId: action.actionId,
          ok: true,
          skipped: true,
        };
      }
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(action.playbackUrl);
        audio.volume = Math.max(0, Math.min(1, action.volume ?? 1));
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener(
          "error",
          () => reject(new Error("Unable to play automation sound.")),
          { once: true },
        );
        void applyStoredAudioOutputDevice(audio)
          .catch((error) => {
            console.warn(
              "[AudioDevices] Unable to route automation sound to the selected output device",
              error,
            );
          })
          .finally(() => {
            void audio.play().catch((error) => reject(error));
          });
      });
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [],
  );

  const handleSpeakFixed = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      if (!backendConnected) {
        throw new Error("Backend websocket is disconnected.");
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingSpeakRequestsRef.current.delete(action.requestId);
          reject(
            new Error("Timed out waiting for automation speech playback."),
          );
        }, 30_000);

        pendingSpeakRequestsRef.current.set(action.requestId, {
          resolve,
          reject,
          timeout,
        });
        sendMessage({
          type: "automation/speak-fixed",
          request_id: action.requestId,
          text: action.text,
          interrupt_policy: action.interruptPolicy,
        });
      });
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [backendConnected, sendMessage],
  );

  const handleSetMicState = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      const enabled = Boolean(action.enabled);
      if (enabled === micOnRef.current) {
        return {
          requestId: action.requestId,
          actionId: action.actionId,
          ok: true,
          skipped: true,
        };
      }

      if (enabled) {
        await startMic();
      } else {
        stopMic();
      }

      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [startMic, stopMic],
  );

  const handleSetBackground = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      if (!backgroundSnapshotsRef.current[action.requestId]) {
        backgroundSnapshotsRef.current[action.requestId] = {
          backgroundUrl,
          useCameraBackground,
        };
      }

      const match = backgroundFiles.find(
        (file) => file.name === action.backgroundId,
      );
      if (!match) {
        return {
          requestId: action.requestId,
          actionId: action.actionId,
          ok: true,
          skipped: true,
        };
      }

      setUseCameraBackground(false);
      const fullUrl = match.url.startsWith("http")
        ? match.url
        : `${baseUrl}${match.url}`;
      setBackgroundUrl(fullUrl);
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [
      backgroundFiles,
      backgroundUrl,
      baseUrl,
      setBackgroundUrl,
      setUseCameraBackground,
      useCameraBackground,
    ],
  );

  const handleRestoreBackground = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      const snapshotForRequest =
        backgroundSnapshotsRef.current[action.requestId];
      if (!snapshotForRequest) {
        return {
          requestId: action.requestId,
          actionId: action.actionId,
          ok: true,
          skipped: true,
        };
      }
      setBackgroundUrl(snapshotForRequest.backgroundUrl);
      setUseCameraBackground(snapshotForRequest.useCameraBackground);
      delete backgroundSnapshotsRef.current[action.requestId];
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [setBackgroundUrl, setUseCameraBackground],
  );

  const handleShowOverlay = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      if (!action.overlayId) {
        throw new Error("Overlay ID is required.");
      }
      const overlay = APPROVED_OVERLAY_ASSETS[action.overlayId];
      if (!overlay) {
        throw new Error(`Overlay asset "${action.overlayId}" is not approved.`);
      }
      setOverlays((current) => [
        ...current.filter(
          (entry) =>
            !(
              entry.requestId === action.requestId &&
              entry.overlayId === action.overlayId
            ),
        ),
        {
          requestId: action.requestId,
          overlayId: action.overlayId!,
          placement: action.placement || "center",
          animationName: action.animationName,
          dataUrl: overlay.dataUrl,
        },
      ]);
      if (action.durationMs && action.durationMs > 0) {
        const timerKey = `${action.requestId}:${action.overlayId}`;
        if (overlayTimersRef.current[timerKey]) {
          clearTimeout(overlayTimersRef.current[timerKey]);
        }
        overlayTimersRef.current[timerKey] = setTimeout(() => {
          setOverlays((current) =>
            current.filter(
              (entry) =>
                !(
                  entry.requestId === action.requestId &&
                  entry.overlayId === action.overlayId
                ),
            ),
          );
          delete overlayTimersRef.current[timerKey];
        }, action.durationMs);
      }
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [],
  );

  const handleRemoveOverlay = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      setOverlays((current) =>
        current.filter(
          (entry) =>
            !(
              entry.requestId === action.requestId &&
              entry.overlayId === action.overlayId
            ),
        ),
      );
      const timerKey = `${action.requestId}:${action.overlayId}`;
      if (overlayTimersRef.current[timerKey]) {
        clearTimeout(overlayTimersRef.current[timerKey]);
        delete overlayTimersRef.current[timerKey];
      }
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [],
  );

  const handleScreenShake = useCallback(
    async (
      action: AutomationSceneActionRequest,
    ): Promise<AutomationSceneActionResult> => {
      if (shakeTimerRef.current) {
        clearInterval(shakeTimerRef.current);
      }
      const intensity = action.intensity ?? 0;
      const startedAt = Date.now();
      shakeTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= (action.durationMs ?? 0)) {
          if (shakeTimerRef.current) {
            clearInterval(shakeTimerRef.current);
            shakeTimerRef.current = null;
          }
          setSceneOffset({ x: 0, y: 0 });
          return;
        }
        setSceneOffset({
          x: (Math.random() - 0.5) * intensity * 2,
          y: (Math.random() - 0.5) * intensity * 2,
        });
      }, 48);
      return {
        requestId: action.requestId,
        actionId: action.actionId,
        ok: true,
      };
    },
    [],
  );

  const handleSceneAction = useCallback(
    async (action: AutomationSceneActionRequest) => {
      if (!automation) {
        return;
      }

      let result: AutomationSceneActionResult;
      try {
        switch (action.actionType) {
          case "play_sound":
            result = await playSound(action);
            break;
          case "set_mic_state":
            result = await handleSetMicState(action);
            break;
          case "speak_fixed":
            result = await handleSpeakFixed(action);
            break;
          case "set_background":
            result = await handleSetBackground(action);
            break;
          case "restore_background":
            result = await handleRestoreBackground(action);
            break;
          case "show_overlay":
            result = await handleShowOverlay(action);
            break;
          case "remove_overlay":
            result = await handleRemoveOverlay(action);
            break;
          case "screen_shake":
            result = await handleScreenShake(action);
            break;
          default:
            result = {
              requestId: action.requestId,
              actionId: action.actionId,
              ok: false,
              error: `Unsupported scene action "${action.actionType}".`,
            };
            break;
        }
      } catch (error: any) {
        result = {
          requestId: action.requestId,
          actionId: action.actionId,
          ok: false,
          error:
            error instanceof Error ? error.message : "Scene action failed.",
        };
      }

      await automation.respondToSceneAction(result);
    },
    [
      automation,
      handleRemoveOverlay,
      handleRestoreBackground,
      handleScreenShake,
      handleSetBackground,
      handleSetMicState,
      handleShowOverlay,
      handleSpeakFixed,
      playSound,
    ],
  );

  const handleBackendExecute = useCallback(
    async (message: AutomationExecuteWsMessage) => {
      if (!automation) {
        return;
      }
      try {
        await automation.executeCommand(
          message.profile_id,
          message.command_id,
          {
            requestId: message.request_id,
            source: message.source,
            variables: message.variables,
          },
        );
      } catch (error: any) {
        const failedResult: AutomationResultWsMessage = {
          type: "automation/result",
          request_id: message.request_id,
          profile_id: message.profile_id,
          command_id: message.command_id,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Unable to execute automation command.",
        };
        sendMessage(failedResult);
      }
    },
    [automation, sendMessage],
  );

  const listProfiles = useCallback(async () => {
    if (!automation) {
      return [];
    }
    return automation.listProfiles();
  }, [automation]);

  const getProfile = useCallback(
    async (profileId: string) => {
      if (!automation) {
        return null;
      }
      return automation.getProfile(profileId);
    },
    [automation],
  );

  const saveProfile = useCallback(
    async (profile: AutomationProfile) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      const saved = await automation.saveProfile(profile);
      if (
        !snapshot?.activeProfileId ||
        snapshot.activeProfileId === saved.profileId
      ) {
        setActiveProfileState(saved);
      }
      return saved;
    },
    [automation, snapshot?.activeProfileId],
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (!automation) {
        return false;
      }
      const deleted = await automation.deleteProfile(profileId);
      if (deleted && snapshot?.activeProfileId === profileId) {
        setActiveProfileState(null);
      }
      return deleted;
    },
    [automation, snapshot?.activeProfileId],
  );

  const executeCommand = useCallback<AutomationBridgeApi["executeCommand"]>(
    async (profileId, commandId, options) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      return automation.executeCommand(profileId, commandId, options);
    },
    [automation],
  );

  const cancel = useCallback(
    async (requestId: string) => {
      if (!automation) {
        return false;
      }
      return automation.cancel(requestId);
    },
    [automation],
  );

  const cancelAll = useCallback(async () => {
    if (!automation) {
      return 0;
    }
    return automation.cancelAll();
  }, [automation]);

  const emergencyStop = useCallback(async () => {
    if (!automation) {
      return;
    }
    await automation.emergencyStop();
    if (backendConnected) {
      const emergencyMessage: AutomationEmergencyStopWsMessage = {
        type: "automation/emergency_stop",
        emergency_stopped: true,
        reason: "manual stop",
      };
      sendMessage(emergencyMessage);
    }
  }, [automation, backendConnected, sendMessage]);

  const getStatus = useCallback(async () => {
    if (!automation) {
      throw new Error("Automation is unavailable outside Electron.");
    }
    const nextSnapshot = await automation.getStatus();
    setSnapshot(nextSnapshot);
    void refreshActiveProfile(nextSnapshot.activeProfileId);
    return nextSnapshot;
  }, [automation, refreshActiveProfile]);

  const resetEmergencyStop = useCallback(async () => {
    if (!automation) {
      throw new Error("Automation is unavailable outside Electron.");
    }
    const nextSnapshot = await automation.resetEmergencyStop();
    setSnapshot(nextSnapshot);
    if (backendConnected) {
      const emergencyMessage: AutomationEmergencyStopWsMessage = {
        type: "automation/emergency_stop",
        emergency_stopped: false,
      };
      sendMessage(emergencyMessage);
    }
    return nextSnapshot;
  }, [automation, backendConnected, sendMessage]);

  const setActiveProfile = useCallback(
    async (profileId: string | null) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      const nextSnapshot = await automation.setActiveProfile(profileId);
      setSnapshot(nextSnapshot);
      void refreshActiveProfile(nextSnapshot.activeProfileId);
      return nextSnapshot;
    },
    [automation, refreshActiveProfile],
  );

  const updateSettings = useCallback(
    async (settingsPatch: Partial<AutomationSettings>) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      const nextSnapshot = await automation.updateSettings(settingsPatch);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    },
    [automation],
  );

  const importProfiles = useCallback(async () => {
    if (!automation) {
      return { importedProfileIds: [] };
    }
    const result = await automation.importProfiles();
    toaster.create({
      title:
        result.importedProfileIds.length > 0
          ? `Imported ${result.importedProfileIds.length} profile(s).`
          : "Import cancelled.",
      type: result.importedProfileIds.length > 0 ? "success" : "info",
      duration: 2500,
    });
    if (snapshot?.activeProfileId) {
      void refreshActiveProfile(snapshot.activeProfileId);
    }
    return result;
  }, [automation, refreshActiveProfile, snapshot?.activeProfileId]);

  const inspectVoiceAttackSource = useCallback(async () => {
    if (!automation) {
      return null;
    }
    return automation.inspectVoiceAttackSource();
  }, [automation]);

  const previewVoiceAttackImport = useCallback(
    async (options: { importId: string; candidateId: string }) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      return automation.previewVoiceAttackImport(options);
    },
    [automation],
  );

  const exportVoiceAttackDiagnosticReport = useCallback(
    async (options: { importId: string; candidateId: string }) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      return automation.exportVoiceAttackDiagnosticReport(options);
    },
    [automation],
  );

  const importVoiceAttackProfile = useCallback(
    async (options: VoiceAttackImportRequest) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      const result = await automation.importVoiceAttackProfile(options);
      toaster.create({
        title: `Saved imported draft "${result.displayName}".`,
        type: "success",
        duration: 3000,
      });
      return result;
    },
    [automation],
  );

  const cancelVoiceAttackImport = useCallback(
    async (importId: string) => {
      if (!automation) {
        return false;
      }
      return automation.cancelVoiceAttackImport(importId);
    },
    [automation],
  );

  const validateImportedProfile = useCallback(
    async (profileId: string) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      return automation.validateImportedProfile(profileId);
    },
    [automation],
  );

  const markImportedProfileReviewed = useCallback(
    async (profileId: string) => {
      if (!automation) {
        throw new Error("Automation is unavailable outside Electron.");
      }
      const saved = await automation.markImportedProfileReviewed(profileId);
      if (snapshot?.activeProfileId === saved.profileId) {
        setActiveProfileState(saved);
      }
      return saved;
    },
    [automation, snapshot?.activeProfileId],
  );

  const exportProfile = useCallback(
    async (options: AutomationExportOptions) => {
      if (!automation) {
        return false;
      }
      const saved = await automation.exportProfile(options);
      toaster.create({
        title: saved ? "Profile exported." : "Export cancelled.",
        type: saved ? "success" : "info",
        duration: 2500,
      });
      return saved;
    },
    [automation],
  );

  const selectTelemetryDirectory = useCallback(async () => {
    if (!automation) {
      return null;
    }
    return automation.selectTelemetryDirectory();
  }, [automation]);

  const setVoiceCommandListeningActive = useCallback(
    async (active: boolean) => {
      if (!automation) {
        return;
      }
      const nextSnapshot =
        await automation.setVoiceCommandListeningActive(active);
      setSnapshot(nextSnapshot);
    },
    [automation],
  );

  const resolveVoiceCommandTest = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const message: AutomationVoiceCommandResolveTestWsMessage = {
        type: "automation/voice-command-resolve-test",
        text: trimmed,
      };
      sendMessage(message);
    },
    [sendMessage],
  );

  const respondToVoiceCommandAmbiguity = useCallback(
    (ambiguityId: string, action: "select" | "cancel", commandId?: string) => {
      const message: AutomationVoiceCommandAmbiguityResponseWsMessage = {
        type: "automation/voice-command-ambiguity-response",
        ambiguity_id: ambiguityId,
        action,
        command_id: commandId,
      };
      sendMessage(message);
    },
    [sendMessage],
  );

  const respondToAssistantConfirmation = useCallback(
    (
      requestId: string,
      action: "confirm" | "reject",
      source: "manual" | "player_voice" = "manual",
    ) => {
      const message: AutomationConfirmationResponseWsMessage = {
        type: "automation/confirmation-response",
        request_id: requestId,
        action,
        source,
      };
      sendMessage(message);
    },
    [sendMessage],
  );

  const value = useMemo<AutomationContextValue>(
    () => ({
      available,
      snapshot,
      assistantState,
      voiceCommandResolveResult,
      backendConnected,
      overlays,
      sceneOffset,
      listProfiles,
      getProfile,
      saveProfile,
      deleteProfile,
      executeCommand,
      cancel,
      cancelAll,
      emergencyStop,
      getStatus,
      resetEmergencyStop,
      setActiveProfile,
      updateSettings,
      importProfiles,
      inspectVoiceAttackSource,
      previewVoiceAttackImport,
      exportVoiceAttackDiagnosticReport,
      importVoiceAttackProfile,
      cancelVoiceAttackImport,
      validateImportedProfile,
      markImportedProfileReviewed,
      exportProfile,
      selectTelemetryDirectory,
      setVoiceCommandListeningActive,
      resolveVoiceCommandTest,
      respondToVoiceCommandAmbiguity,
      respondToAssistantConfirmation,
      refreshStatus,
    }),
    [
      available,
      snapshot,
      assistantState,
      voiceCommandResolveResult,
      backendConnected,
      overlays,
      sceneOffset,
      listProfiles,
      getProfile,
      saveProfile,
      deleteProfile,
      executeCommand,
      cancel,
      cancelAll,
      emergencyStop,
      getStatus,
      resetEmergencyStop,
      setActiveProfile,
      updateSettings,
      importProfiles,
      inspectVoiceAttackSource,
      previewVoiceAttackImport,
      exportVoiceAttackDiagnosticReport,
      importVoiceAttackProfile,
      cancelVoiceAttackImport,
      validateImportedProfile,
      markImportedProfileReviewed,
      exportProfile,
      selectTelemetryDirectory,
      setVoiceCommandListeningActive,
      resolveVoiceCommandTest,
      respondToVoiceCommandAmbiguity,
      respondToAssistantConfirmation,
      refreshStatus,
    ],
  );

  return (
    <AutomationContext.Provider value={value}>
      {children}
    </AutomationContext.Provider>
  );
}

export function useAutomation() {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error("useAutomation must be used within an AutomationProvider.");
  }
  return context;
}
