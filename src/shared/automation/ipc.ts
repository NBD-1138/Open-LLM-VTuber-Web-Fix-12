import type {
  AssistantSpeechMode,
  AutomationAssistantDecision,
  AutomationAutonomyPolicy,
  AutomationLlmAccess,
  AutomationAssistantStateSnapshot,
  AutomationExecutionRecord,
  AutomationExecutionStatus,
  AutomationProfileSelectionMode,
  AutomationProfileSelectionSource,
  AutomationProfile,
  AutomationProfileSummary,
  AutomationRiskLevel,
  AutomationRuntimeStatus,
  AutomationSettings,
  AutomationStatusSnapshot,
  AutomationTelemetrySettings,
  AutomationTelemetryStateSnapshot,
  AutomationTriggerSource,
  VoiceCommandAcknowledgementMode,
  VoiceCommandActivationMode,
  VoiceCommandResolutionResult,
  OverlayAnimation,
  OverlayPlacement,
} from './schema';
import type { AutomationVoiceAttackExecutionOutcome } from './voiceattack-script';
import type {
  ImportedAutomationProfileReviewReport,
  VoiceAttackImportProfileResult,
  VoiceAttackImportRequest,
  VoiceAttackInspectionResult,
  VoiceAttackProfilePreview,
} from './voiceattack';

export interface AutomationExecuteOptions {
  dryRun?: boolean;
  source?: AutomationTriggerSource;
  requestId?: string;
  variables?: Record<string, string>;
  allowDisabled?: boolean;
}

export interface AutomationSceneActionRequest {
  requestId: string;
  actionId: string;
  actionType:
    | 'play_sound'
    | 'set_mic_state'
    | 'speak_fixed'
    | 'set_background'
    | 'restore_background'
    | 'show_overlay'
    | 'remove_overlay'
    | 'screen_shake';
  assetId?: string;
  localAssetPath?: string;
  playbackUrl?: string;
  volume?: number;
  enabled?: boolean;
  text?: string;
  interruptPolicy?: 'queue' | 'interrupt';
  backgroundId?: string;
  overlayId?: string;
  durationMs?: number;
  placement?: OverlayPlacement;
  animationName?: OverlayAnimation;
  intensity?: number;
}

export interface AutomationSceneActionResult {
  requestId: string;
  actionId: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

export type AutomationManagerEvent =
  | {
    type: 'status';
    snapshot: AutomationStatusSnapshot;
  }
  | {
    type: 'execution';
    record: AutomationExecutionRecord;
  }
  | {
    type: 'profiles';
    profiles: AutomationProfileSummary[];
    activeProfileId: string | null;
  }
  | {
    type: 'scene-action';
    action: AutomationSceneActionRequest;
  };

export interface AutomationImportResult {
  importedProfileIds: string[];
}

export interface AutomationExportOptions {
  profileId: string;
  format: 'json' | 'yaml';
}

export interface AutomationBridgeApi {
  listProfiles(): Promise<AutomationProfileSummary[]>;
  getProfile(profileId: string): Promise<AutomationProfile | null>;
  saveProfile(profile: AutomationProfile): Promise<AutomationProfile>;
  deleteProfile(profileId: string): Promise<boolean>;
  executeCommand(profileId: string, commandId: string, options?: AutomationExecuteOptions): Promise<{ requestId: string; status: AutomationExecutionStatus }>;
  cancel(requestId: string): Promise<boolean>;
  cancelAll(): Promise<number>;
  emergencyStop(): Promise<void>;
  getStatus(): Promise<AutomationStatusSnapshot>;
  resetEmergencyStop(): Promise<AutomationStatusSnapshot>;
  setActiveProfile(profileId: string | null): Promise<AutomationStatusSnapshot>;
  updateSettings(settingsPatch: Partial<AutomationSettings>): Promise<AutomationStatusSnapshot>;
  setVoiceCommandListeningActive(active: boolean): Promise<AutomationStatusSnapshot>;
  importProfiles(): Promise<AutomationImportResult>;
  inspectVoiceAttackSource(): Promise<VoiceAttackInspectionResult | null>;
  previewVoiceAttackImport(options: {
    importId: string;
    candidateId: string;
  }): Promise<VoiceAttackProfilePreview>;
  exportVoiceAttackDiagnosticReport(options: {
    importId: string;
    candidateId: string;
  }): Promise<boolean>;
  importVoiceAttackProfile(options: VoiceAttackImportRequest): Promise<VoiceAttackImportProfileResult>;
  cancelVoiceAttackImport(importId: string): Promise<boolean>;
  validateImportedProfile(profileId: string): Promise<ImportedAutomationProfileReviewReport>;
  markImportedProfileReviewed(profileId: string): Promise<AutomationProfile>;
  exportProfile(options: AutomationExportOptions): Promise<boolean>;
  selectTelemetryDirectory(): Promise<string | null>;
  respondToSceneAction(result: AutomationSceneActionResult): Promise<boolean>;
  syncAssistantState(snapshot: AutomationAssistantStateSnapshot | null): Promise<boolean>;
  subscribeToEvents(callback: (event: AutomationManagerEvent) => void): () => void;
}

export interface AutomationResultOutcomeWsMessage {
  command_id: string;
  result_type: AutomationVoiceAttackExecutionOutcome["resultType"];
  reason: string;
  physical_input_sent: boolean;
  telemetry_confirmed: boolean;
  skipped_actions: string[];
  blocking_actions: string[];
  unsupported_actions: string[];
  nested_command_trace: string[];
  duration_ms: number;
  final_observed_state: Record<string, unknown> | null;
  trace: Array<{
    command_id: string;
    node_id: string;
    kind: string;
    status: AutomationVoiceAttackExecutionOutcome["trace"][number]["status"];
    summary: string;
  }>;
  semantic_capability_id?: string | null;
}

export interface AutomationExecuteWsMessage {
  type: 'automation/execute';
  request_id: string;
  profile_id: string;
  command_id: string;
  source: AutomationTriggerSource;
  variables: Record<string, string>;
}

export interface AutomationResultWsMessage {
  type: 'automation/result';
  request_id: string;
  profile_id: string;
  command_id: string;
  status: AutomationExecutionStatus;
  duration_ms?: number;
  error: string | null;
  outcome?: AutomationResultOutcomeWsMessage;
}

export interface AutomationStatusWsMessage {
  type: 'automation/status';
  status: AutomationRuntimeStatus;
  emergency_stopped: boolean;
  active_profile_id: string | null;
  profiles: Array<{
    profile_id: string;
    display_name: string;
    enabled: boolean;
    process_names: string[];
    commands: Array<{
      command_id: string;
      label: string;
      enabled: boolean;
    }>;
  }>;
  running_requests: string[];
  last_error?: string;
}

export interface AutomationCancelWsMessage {
  type: 'automation/cancel';
  request_id: string;
}

export interface AutomationEmergencyStopWsMessage {
  type: 'automation/emergency_stop';
  emergency_stopped: boolean;
  reason?: string;
}

export interface AutomationCapabilityWsEntry {
  profile_id: string;
  command_id: string;
  label: string;
  description: string;
  aliases: string[];
  category: string;
  enabled: boolean;
  available: boolean;
  risk: AutomationRiskLevel;
  autonomy_policy: AutomationAutonomyPolicy;
  allowed_trigger_sources: AutomationTriggerSource[];
  cooldown_remaining_ms: number;
  blocked_reason?: string | null;
}

export interface AutomationCapabilitiesWsMessage {
  type: 'automation/capabilities';
  active_profile_id: string | null;
  revision: number;
  capabilities: AutomationCapabilityWsEntry[];
}

export interface AutomationAssistantSettingsWsMessage {
  type: 'automation/assistant-settings';
  llm_automation_enabled: boolean;
  allow_autonomous_harmless_commands: boolean;
  allow_autonomous_low_risk_commands: boolean;
  confirmation_timeout_ms: number;
  max_pending_confirmations: number;
  announce_blocked_command_requests: boolean;
  include_command_suggestions_in_speech: boolean;
  result_acknowledgements_enabled: boolean;
  confirmation_phrases: string[];
  cancellation_phrases: string[];
  default_speech_mode: AssistantSpeechMode;
  proactive_commentary_enabled: boolean;
  minimum_commentary_interval_ms: number;
  max_queued_conversation_events: number;
  announce_application_changes: boolean;
  acknowledge_routine_automation_success: boolean;
  voice_command_activation_mode: VoiceCommandActivationMode;
  voice_command_wake_phrases: string[];
  voice_command_push_to_command_hotkey: string;
  voice_command_ambiguity_timeout_ms: number;
  voice_command_acknowledgement_mode: VoiceCommandAcknowledgementMode;
  telemetry: AutomationTelemetrySettings;
}

export interface AutomationConfirmationResponseWsMessage {
  type: 'automation/confirmation-response';
  request_id: string;
  action: 'confirm' | 'reject';
  source?: 'manual' | 'player_voice';
}

export interface AutomationAssistantCapabilityStateWsEntry extends AutomationCapabilityWsEntry {
  llm_access: AutomationLlmAccess;
  blocked_reason: string | null;
  recommended: boolean;
  avoid_reason: string | null;
}

export interface AutomationAssistantDecisionWsEntry {
  decision_id: string;
  decision_type: AutomationAssistantDecision['decisionType'];
  profile_id: string | null;
  command_id: string | null;
  command_label: string | null;
  reason: string | null;
  risk: AutomationRiskLevel | null;
  blocked_reason: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AutomationAssistantPendingConfirmationWsEntry {
  request_id: string;
  profile_id: string;
  command_id: string;
  command_label: string;
  concise_reason: string;
  risk: AutomationRiskLevel;
  created_at: string;
  expires_at: string;
  source: string;
}

export interface AutomationAssistantStateWsMessage {
  type: 'automation/assistant-state';
  active_profile_id: string | null;
  capability_revision: number;
  state_version: number;
  detected_application: AssistantActiveApplicationWsMessage | null;
  matched_profile_id: string | null;
  effective_profile_id: string | null;
  profile_selection_mode: AutomationProfileSelectionMode;
  profile_selection_source: AutomationProfileSelectionSource;
  profile_match_confidence: number | null;
  last_profile_transition_at: string | null;
  speech_mode: AssistantSpeechMode;
  settings: AutomationAssistantSettingsWsMessage & { type?: 'automation/assistant-settings' };
  telemetry: AutomationTelemetryStateSnapshot | null;
  capabilities: AutomationAssistantCapabilityStateWsEntry[];
  pending_confirmations: AutomationAssistantPendingConfirmationWsEntry[];
  recent_decisions: AutomationAssistantDecisionWsEntry[];
  last_blocked_reason: string | null;
  queue_summary: {
    total: number;
    high_priority: number;
    conversational: number;
    suppressed: number;
  };
  current_event: {
    event_id: string;
    event_type: string;
    summary: string;
    importance: number;
    urgency: number;
    confidence: number;
    timestamp: string;
    policy_reason: string | null;
  } | null;
  suppressed_event_count: number;
  activity: Array<{
    activity_id: string;
    event_id: string | null;
    event_type: string;
    status: 'noticed' | 'queued' | 'suppressed' | 'sent_to_llm' | 'acted' | 'remained_silent';
    summary: string;
    policy_reason: string | null;
    created_at: string;
  }>;
  vtuber_speaking: boolean;
  player_speaking: boolean | null;
  last_player_request: string | null;
  pending_ambiguity: {
    ambiguity_id: string;
    transcript: string;
    normalized_phrase: string;
    candidates: Array<{
      command_id: string;
      label: string;
    }>;
    expires_at: string;
  } | null;
  resolver_activity: Array<{
    activity_id: string;
    transcript: string;
    normalized_phrase: string | null;
    activation_mode: VoiceCommandActivationMode;
    activation_met: boolean;
    result: VoiceCommandResolutionResult;
    matched_command_id: string | null;
    matched_command_label: string | null;
    candidate_command_labels: string[];
    blocked_reason: string | null;
    request_id: string | null;
    fell_back_to_conversation: boolean;
    created_at: string;
  }>;
}

export interface AssistantActiveApplicationWsMessage {
  type: 'assistant/active-application';
  process_name: string;
  window_title: string;
  detected_at: string;
  confidence: number;
}

export interface AssistantContextSyncWsMessage {
  type: 'assistant/context-sync';
  version: number;
  matched_profile_id: string | null;
  effective_profile_id: string | null;
  manual_profile_id: string | null;
  profile_selection_mode: AutomationProfileSelectionMode;
  profile_selection_source: AutomationProfileSelectionSource;
  profile_match_confidence: number | null;
  last_profile_transition_at: string | null;
  speech_mode: AssistantSpeechMode;
  proactive_commentary_enabled: boolean;
  minimum_commentary_interval_ms: number;
  max_queued_conversation_events: number;
  announce_application_changes: boolean;
  acknowledge_routine_automation_success: boolean;
  player_speaking: boolean | null;
}

export interface AssistantPlayerStateWsMessage {
  type: 'assistant/player-state';
  speaking: boolean;
  timestamp?: string;
  confidence?: number;
}

export interface AssistantVoiceCommandStateWsMessage {
  type: 'assistant/voice-command-state';
  listening_active: boolean;
}

export interface AutomationVoiceCommandAmbiguityResponseWsMessage {
  type: 'automation/voice-command-ambiguity-response';
  ambiguity_id: string;
  action: 'select' | 'cancel';
  command_id?: string;
}

export interface AutomationVoiceCommandResolveTestWsMessage {
  type: 'automation/voice-command-resolve-test';
  text: string;
}

export interface AutomationVoiceCommandResolveResultWsMessage {
  type: 'automation/voice-command-resolve-result';
  transcript: string;
  normalized_phrase: string | null;
  activation_mode: VoiceCommandActivationMode;
  activation_met: boolean;
  result: VoiceCommandResolutionResult;
  matched_command_id: string | null;
  matched_command_label: string | null;
  candidate_command_labels: string[];
  blocked_reason: string | null;
}

export const toAutomationAssistantSettingsWsMessage = (
  settings: AutomationSettings,
): AutomationAssistantSettingsWsMessage => ({
  type: 'automation/assistant-settings',
  llm_automation_enabled: settings.llmAutomationEnabled,
  allow_autonomous_harmless_commands: settings.allowAutonomousHarmlessCommands,
  allow_autonomous_low_risk_commands: settings.allowAutonomousLowRiskCommands,
  confirmation_timeout_ms: settings.confirmationTimeoutMs,
  max_pending_confirmations: settings.maxPendingConfirmations,
  announce_blocked_command_requests: settings.announceBlockedCommandRequests,
  include_command_suggestions_in_speech: settings.includeCommandSuggestionsInSpeech,
  result_acknowledgements_enabled: settings.resultAcknowledgementsEnabled,
  confirmation_phrases: [...settings.confirmationPhrases],
  cancellation_phrases: [...settings.cancellationPhrases],
  default_speech_mode: settings.defaultSpeechMode,
  proactive_commentary_enabled: settings.proactiveCommentaryEnabled,
  minimum_commentary_interval_ms: settings.minimumCommentaryIntervalMs,
  max_queued_conversation_events: settings.maxQueuedConversationEvents,
  announce_application_changes: settings.announceApplicationChanges,
  acknowledge_routine_automation_success: settings.acknowledgeRoutineAutomationSuccess,
  voice_command_activation_mode: settings.voiceCommandActivationMode,
  voice_command_wake_phrases: [...settings.voiceCommandWakePhrases],
  voice_command_push_to_command_hotkey: settings.voiceCommandPushToCommandHotkey,
  voice_command_ambiguity_timeout_ms: settings.voiceCommandAmbiguityTimeoutMs,
  voice_command_acknowledgement_mode: settings.voiceCommandAcknowledgementMode,
  telemetry: settings.telemetry,
});
