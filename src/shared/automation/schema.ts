import type {
  AutomationImportedVoiceAttackCommand,
  AutomationVoiceAttackExecutionOutcome,
} from "./voiceattack-script";

export const AUTOMATION_SCHEMA_VERSION = 1 as const;
export const MAX_WAIT_MS = 60_000;
export const MAX_COMMAND_DURATION_MS = 300_000;
export const MAX_OVERLAY_DURATION_MS = 30_000;
export const MAX_SCREEN_SHAKE_DURATION_MS = 10_000;
export const MAX_SCREEN_SHAKE_INTENSITY = 18;
export const MAX_KEY_HOLD_DURATION_MS = 10_000;
export const MAX_MACRO_DEPTH = 4;
export const MAX_STEP_COUNT = 1024;
export const MAX_SCRIPT_LENGTH = 16_000;
export const MAX_SCRIPT_LINE_COUNT = 256;
export const MAX_SCRIPT_BLOCK_DEPTH = 16;
export const MAX_SCRIPT_VARIABLE_COUNT = 128;

export const AUTOMATION_TRIGGER_SOURCES = [
  "manual",
  "hotkey",
  "player_voice",
  "vtuber",
  "twitch",
  "redemption",
  "game_event",
] as const;

export const AUTOMATION_AUTONOMY_POLICIES = [
  "disabled",
  "suggest_only",
  "confirmation_required",
  "autonomous",
] as const;

export const AUTOMATION_RISK_LEVELS = [
  "harmless",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const AUTOMATION_CONFIRMATION_POLICIES = [
  "never",
  "high_risk",
  "always",
] as const;

export const AUTOMATION_CONCURRENCY_POLICIES = [
  "allow_parallel",
  "reject_duplicates",
  "single_instance",
] as const;

export const AUTOMATION_RUNTIME_STATUSES = [
  "ready",
  "executing",
  "cancelled",
  "emergency_stopped",
  "disconnected",
  "error",
] as const;

export const AUTOMATION_PROFILE_SELECTION_MODES = [
  "automatic",
  "manual",
  "disabled",
] as const;

export const AUTOMATION_PROFILE_SELECTION_SOURCES = [
  "automatic",
  "manual",
  "none",
] as const;

export const ASSISTANT_SPEECH_MODES = [
  "action",
  "exploration",
  "conversation",
] as const;

export const VOICE_COMMAND_ACTIVATION_MODES = [
  "disabled",
  "wake_phrase",
  "push_to_command",
  "always_listening",
] as const;

export const VOICE_COMMAND_ACKNOWLEDGEMENT_MODES = [
  "none",
  "fixed_original",
  "llm_in_character",
] as const;

export const VOICE_COMMAND_RESOLUTION_RESULTS = [
  "no_match",
  "exact_match",
  "normalized_match",
  "ambiguous_match",
  "blocked_match",
  "activation_not_met",
] as const;

export const AUTOMATION_EXECUTION_STATUSES = [
  "started",
  "completed",
  "cancelled",
  "blocked",
  "failed",
] as const;

export const OVERLAY_PLACEMENTS = [
  "center",
  "top_left",
  "top_center",
  "top_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
] as const;

export const OVERLAY_ANIMATIONS = [
  "fade",
  "pulse",
  "slide_up",
  "none",
] as const;

export const SOUND_INTERRUPT_POLICIES = ["queue", "interrupt"] as const;

export const RESPONSE_PLACEHOLDER_REPLACEMENT_MODES = [
  "none",
  "fixed_original",
  "llm_in_character",
  "approved_local_sound",
] as const;

export const VALID_MODIFIER_KEYS = ["ctrl", "alt", "shift", "meta"] as const;

export const VALID_KEY_IDENTIFIERS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
  "tab",
  "enter",
  "escape",
  "space",
  "backspace",
  "delete",
  "arrow_up",
  "arrow_down",
  "arrow_left",
  "arrow_right",
  "home",
  "end",
  "page_up",
  "page_down",
  "insert",
  "ctrl",
  "alt",
  "shift",
  "meta",
] as const;

export type AutomationTriggerSource =
  (typeof AUTOMATION_TRIGGER_SOURCES)[number];
export type AutomationAutonomyPolicy =
  (typeof AUTOMATION_AUTONOMY_POLICIES)[number];
export type AutomationRiskLevel = (typeof AUTOMATION_RISK_LEVELS)[number];
export type AutomationConfirmationPolicy =
  (typeof AUTOMATION_CONFIRMATION_POLICIES)[number];
export type AutomationConcurrencyPolicy =
  (typeof AUTOMATION_CONCURRENCY_POLICIES)[number];
export type AutomationRuntimeStatus =
  (typeof AUTOMATION_RUNTIME_STATUSES)[number];
export type AutomationProfileSelectionMode =
  (typeof AUTOMATION_PROFILE_SELECTION_MODES)[number];
export type AutomationProfileSelectionSource =
  (typeof AUTOMATION_PROFILE_SELECTION_SOURCES)[number];
export type AutomationExecutionStatus =
  (typeof AUTOMATION_EXECUTION_STATUSES)[number];
export type AutomationLlmAccess =
  | "none"
  | "suggest"
  | "request_confirmation"
  | "autonomous";
export type AssistantSpeechMode = (typeof ASSISTANT_SPEECH_MODES)[number];
export type VoiceCommandActivationMode =
  (typeof VOICE_COMMAND_ACTIVATION_MODES)[number];
export type VoiceCommandAcknowledgementMode =
  (typeof VOICE_COMMAND_ACKNOWLEDGEMENT_MODES)[number];
export type VoiceCommandResolutionResult =
  (typeof VOICE_COMMAND_RESOLUTION_RESULTS)[number];
export type OverlayPlacement = (typeof OVERLAY_PLACEMENTS)[number];
export type OverlayAnimation = (typeof OVERLAY_ANIMATIONS)[number];
export type SoundInterruptPolicy = (typeof SOUND_INTERRUPT_POLICIES)[number];
export type ResponsePlaceholderReplacementMode =
  (typeof RESPONSE_PLACEHOLDER_REPLACEMENT_MODES)[number];
export type ValidModifierKey = (typeof VALID_MODIFIER_KEYS)[number];
export type ValidKeyIdentifier = (typeof VALID_KEY_IDENTIFIERS)[number];
export type AutomationImportSource = "voiceattack";
export type AutomationImportReviewStatus = "required" | "reviewed";

export interface WaitAction {
  type: "wait";
  milliseconds: number;
}

export interface PlaySoundAction {
  type: "play_sound";
  assetId?: string;
  localAssetPath?: string;
  volume?: number;
}

export interface WriteLogAction {
  type: "write_log";
  message: string;
}

export interface SpeakFixedAction {
  type: "speak_fixed";
  text: string;
  interruptPolicy?: SoundInterruptPolicy;
}

export interface SetMicStateAction {
  type: "set_mic_state";
  enabled: boolean;
}

export interface SetBackgroundAction {
  type: "set_background";
  backgroundId: string;
}

export interface RestoreBackgroundAction {
  type: "restore_background";
}

export interface ShowOverlayAction {
  type: "show_overlay";
  overlayId: string;
  durationMs: number;
  placement: OverlayPlacement;
  animationName?: OverlayAnimation;
}

export interface RemoveOverlayAction {
  type: "remove_overlay";
  overlayId: string;
}

export interface ScreenShakeAction {
  type: "screen_shake";
  durationMs: number;
  intensity: number;
}

export interface KeyPressAction {
  type: "key_press";
  key: ValidKeyIdentifier;
  durationMs?: number;
}

export interface KeyDownAction {
  type: "key_down";
  key: ValidKeyIdentifier;
}

export interface KeyUpAction {
  type: "key_up";
  key: ValidKeyIdentifier;
}

export interface KeyCombinationAction {
  type: "key_combination";
  modifiers: ValidModifierKey[];
  key: ValidKeyIdentifier;
}

export interface RunMacroAction {
  type: "run_macro";
  commandId: string;
}

export interface ScriptAction {
  type: "script";
  script: string;
}

export interface UnsupportedImportAction {
  type: "unsupported_import_action";
  sourceType: string;
  summary: string;
}

export interface ResponsePlaceholderAction {
  type: "response_placeholder";
  originalResponsePresent: boolean;
  replacementRequired: boolean;
  replacementMode: ResponsePlaceholderReplacementMode;
}

export type AutomationAction =
  | WaitAction
  | PlaySoundAction
  | WriteLogAction
  | SpeakFixedAction
  | SetMicStateAction
  | SetBackgroundAction
  | RestoreBackgroundAction
  | ShowOverlayAction
  | RemoveOverlayAction
  | ScreenShakeAction
  | KeyPressAction
  | KeyDownAction
  | KeyUpAction
  | KeyCombinationAction
  | ScriptAction
  | RunMacroAction
  | UnsupportedImportAction
  | ResponsePlaceholderAction;

export type AutomationScriptValue = string | number | boolean | null;

interface AutomationScriptBaseStatement {
  kind: string;
  lineNumber: number;
  raw: string;
}

export interface AutomationScriptSetVariableStatement
  extends AutomationScriptBaseStatement {
  kind: "set_variable";
  variableName: string;
  expression: string;
}

export interface AutomationScriptLogStatement
  extends AutomationScriptBaseStatement {
  kind: "write_log";
  expression: string;
}

export interface AutomationScriptSpeakStatement
  extends AutomationScriptBaseStatement {
  kind: "speak";
  expression: string;
}

export interface AutomationScriptWaitStatement
  extends AutomationScriptBaseStatement {
  kind: "wait";
  expression: string;
}

export interface AutomationScriptMicStatement
  extends AutomationScriptBaseStatement {
  kind: "set_mic_state";
  enabled: boolean;
}

export interface AutomationScriptKeyPressStatement
  extends AutomationScriptBaseStatement {
  kind: "key_press";
  key: ValidKeyIdentifier;
  durationExpression?: string;
}

export interface AutomationScriptKeyDownStatement
  extends AutomationScriptBaseStatement {
  kind: "key_down";
  key: ValidKeyIdentifier;
}

export interface AutomationScriptKeyUpStatement
  extends AutomationScriptBaseStatement {
  kind: "key_up";
  key: ValidKeyIdentifier;
}

export interface AutomationScriptKeyCombinationStatement
  extends AutomationScriptBaseStatement {
  kind: "key_combination";
  modifiers: ValidModifierKey[];
  key: ValidKeyIdentifier;
}

export interface AutomationScriptCallCommandStatement
  extends AutomationScriptBaseStatement {
  kind: "call_command";
  commandId: string;
}

export interface AutomationScriptSetBackgroundStatement
  extends AutomationScriptBaseStatement {
  kind: "set_background";
  backgroundId: string;
}

export interface AutomationScriptRestoreBackgroundStatement
  extends AutomationScriptBaseStatement {
  kind: "restore_background";
}

export interface AutomationScriptIfStatement
  extends AutomationScriptBaseStatement {
  kind: "if";
  condition: string;
}

export interface AutomationScriptElseStatement
  extends AutomationScriptBaseStatement {
  kind: "else";
}

export interface AutomationScriptEndIfStatement
  extends AutomationScriptBaseStatement {
  kind: "endif";
}

export interface AutomationScriptReturnStatement
  extends AutomationScriptBaseStatement {
  kind: "return";
}

export type AutomationScriptStatement =
  | AutomationScriptSetVariableStatement
  | AutomationScriptLogStatement
  | AutomationScriptSpeakStatement
  | AutomationScriptWaitStatement
  | AutomationScriptMicStatement
  | AutomationScriptKeyPressStatement
  | AutomationScriptKeyDownStatement
  | AutomationScriptKeyUpStatement
  | AutomationScriptKeyCombinationStatement
  | AutomationScriptCallCommandStatement
  | AutomationScriptSetBackgroundStatement
  | AutomationScriptRestoreBackgroundStatement
  | AutomationScriptIfStatement
  | AutomationScriptElseStatement
  | AutomationScriptEndIfStatement
  | AutomationScriptReturnStatement;

export interface AutomationImportedProfileMetadata {
  imported: true;
  importSource: AutomationImportSource;
  sourceBasename: string;
  sourceHash: string;
  importedAt: string;
  reviewStatus: AutomationImportReviewStatus;
  importWarnings: string[];
  originalProfileVersion: string | null;
}

export interface AutomationCommand {
  commandId: string;
  label: string;
  description: string;
  aliases: string[];
  category: string;
  enabled: boolean;
  cooldownMs: number;
  maxDurationMs: number;
  riskLevel: AutomationRiskLevel;
  allowedTriggerSources: AutomationTriggerSource[];
  autonomyPolicy: AutomationAutonomyPolicy;
  confirmationPolicy: AutomationConfirmationPolicy;
  concurrencyPolicy: AutomationConcurrencyPolicy;
  defaultDryRun: boolean;
  steps: AutomationAction[];
  voiceAttack?: AutomationImportedVoiceAttackCommand;
}

export interface AutomationProfile {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  profileId: string;
  displayName: string;
  description: string;
  enabled: boolean;
  processNames: string[];
  commands: AutomationCommand[];
  importMetadata?: AutomationImportedProfileMetadata;
}

export interface AutomationProfileSummary {
  profileId: string;
  displayName: string;
  enabled: boolean;
  processNames: string[];
  commands: Array<{
    commandId: string;
    label: string;
    enabled: boolean;
  }>;
}

export interface AutomationExecutionRecord {
  requestId: string;
  profileId: string;
  commandId: string;
  status: AutomationExecutionStatus;
  source: AutomationTriggerSource;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  dryRun: boolean;
  outcome?: AutomationVoiceAttackExecutionOutcome;
}

export interface AutomationDetectedApplication {
  processName: string;
  windowTitle: string;
  detectedAt: string;
  confidence: number;
}

export interface AutomationAssistantEventSummary {
  eventId: string;
  eventType: string;
  summary: string;
  importance: number;
  urgency: number;
  confidence: number;
  timestamp: string;
  policyReason: string | null;
}

export interface AutomationAssistantQueueSummary {
  total: number;
  highPriority: number;
  conversational: number;
  suppressed: number;
}

export interface AutomationAssistantActivityEntry {
  activityId: string;
  eventId: string | null;
  eventType: string;
  status:
    | "noticed"
    | "queued"
    | "suppressed"
    | "sent_to_llm"
    | "acted"
    | "remained_silent";
  summary: string;
  policyReason: string | null;
  createdAt: string;
}

export interface AutomationTelemetryCommentarySettings {
  announceDockingEvents: boolean;
  announceJumpEvents: boolean;
  announceMissionEvents: boolean;
  announceDiscoveries: boolean;
  announceMaterialCollection: boolean;
}

export interface AutomationTelemetrySettings {
  enabled: boolean;
  automaticJournalDiscovery: boolean;
  manualJournalDirectory: string | null;
  lowFuelThreshold: number;
  criticalFuelThreshold: number;
  hullWarningThresholds: number[];
  explorationCommentaryCooldownMs: number;
  commentary: AutomationTelemetryCommentarySettings;
}

export interface AutomationTelemetryEliteSessionSnapshot {
  gameMode: string | null;
  commanderName: string | null;
  modeCategory: "open" | "solo" | "private_group" | "group" | "unknown" | null;
  shipType: string | null;
  shipName: string | null;
  shipIdent: string | null;
  starSystem: string | null;
  stationName: string | null;
  bodyName: string | null;
  docked: boolean | null;
  landed: boolean | null;
  activityMode: string | null;
}

export interface AutomationTelemetryEliteShipSnapshot {
  hullPercent: number | null;
  shieldsUp: boolean | null;
  fuelLevel: number | null;
  fuelCapacity: number | null;
  cargoCount: number | null;
  cargoCapacity: number | null;
  landingGearDeployed: boolean | null;
  hardpointsDeployed: boolean | null;
  cargoScoopDeployed: boolean | null;
  lightsOn: boolean | null;
  silentRunning: boolean | null;
  flightAssistOff: boolean | null;
  heatWarning: boolean | null;
  lowFuelWarning: boolean | null;
  fsdStatus: string | null;
  supercruise: boolean | null;
}

export interface AutomationTelemetryEliteNavigationSnapshot {
  currentSystem: string | null;
  destinationSystem: string | null;
  jumpInProgress: boolean | null;
  lastJumpCompletedAt: string | null;
  dockingRequested: boolean | null;
  dockingGranted: boolean | null;
  dockingDenied: boolean | null;
  docked: boolean | null;
  undockedAt: string | null;
}

export interface AutomationTelemetryEliteCombatSnapshot {
  inDanger: boolean | null;
  interdicted: boolean | null;
  interdicting: boolean | null;
  shieldsFailed: boolean | null;
  lastHullThreshold: number | null;
  targetName: string | null;
  targetShieldHealth: number | null;
  bountyAwarded: boolean | null;
  combatBondAwarded: boolean | null;
  lastDeathAt: string | null;
}

export interface AutomationTelemetryEliteMissionSnapshot {
  activeMissionCount: number | null;
  lastAcceptedMission: string | null;
  lastCompletedMission: string | null;
  lastFailedMission: string | null;
  lastCollectedMaterial: string | null;
  lastDiscovery: string | null;
}

export interface AutomationTelemetryHighlight {
  key: string;
  label: string;
  value: string;
  level: "default" | "good" | "warning" | "danger";
}

export interface AutomationTelemetryStructuredSnapshot {
  sourceTimestamp: string | null;
  lastUpdateTimestamp: string | null;
  confidence: number;
  stale: boolean;
  session:
    & Record<string, unknown>
    & Partial<AutomationTelemetryEliteSessionSnapshot>;
  ship:
    & Record<string, unknown>
    & Partial<AutomationTelemetryEliteShipSnapshot>;
  navigation:
    & Record<string, unknown>
    & Partial<AutomationTelemetryEliteNavigationSnapshot>;
  combat:
    & Record<string, unknown>
    & Partial<AutomationTelemetryEliteCombatSnapshot>;
  missions:
    & Record<string, unknown>
    & Partial<AutomationTelemetryEliteMissionSnapshot>;
  world: Record<string, unknown>;
  automation: Record<string, unknown>;
  highlights: AutomationTelemetryHighlight[];
}

export interface AutomationTelemetryStateSnapshot {
  adapterId: string | null;
  gameId: string | null;
  gameDisplayName: string | null;
  status: "stopped" | "starting" | "running" | "error" | "replay";
  replayMode: boolean;
  error: string | null;
  sourceKind: string | null;
  sourceDirectoryStatus:
    | "automatic"
    | "manual"
    | "missing"
    | "error"
    | "unavailable";
  sourceDirectoryLabel: string | null;
  currentSource: string | null;
  journalDirectoryStatus:
    | "automatic"
    | "manual"
    | "missing"
    | "error"
    | "unavailable";
  journalDirectoryLabel: string | null;
  currentJournalFile: string | null;
  lastEventAt: string | null;
  snapshot: AutomationTelemetryStructuredSnapshot | null;
}

export interface AutomationSettings {
  activeProfileId: string | null;
  manualProfileId: string | null;
  profileSelectionMode: AutomationProfileSelectionMode;
  dryRun: boolean;
  emergencyStopHotkey: string;
  llmAutomationEnabled: boolean;
  allowAutonomousHarmlessCommands: boolean;
  allowAutonomousLowRiskCommands: boolean;
  confirmationTimeoutMs: number;
  maxPendingConfirmations: number;
  announceBlockedCommandRequests: boolean;
  includeCommandSuggestionsInSpeech: boolean;
  resultAcknowledgementsEnabled: boolean;
  confirmationPhrases: string[];
  cancellationPhrases: string[];
  activeApplicationPollIntervalMs: number;
  profileSwitchDebounceMs: number;
  detectionFailureGracePeriodMs: number;
  defaultSpeechMode: AssistantSpeechMode;
  proactiveCommentaryEnabled: boolean;
  minimumCommentaryIntervalMs: number;
  maxQueuedConversationEvents: number;
  announceApplicationChanges: boolean;
  acknowledgeRoutineAutomationSuccess: boolean;
  voiceCommandActivationMode: VoiceCommandActivationMode;
  voiceCommandWakePhrases: string[];
  voiceCommandPushToCommandHotkey: string;
  voiceCommandAmbiguityTimeoutMs: number;
  voiceCommandAcknowledgementMode: VoiceCommandAcknowledgementMode;
  telemetry: AutomationTelemetrySettings;
}

export interface AutomationAssistantSettings {
  llmAutomationEnabled: boolean;
  allowAutonomousHarmlessCommands: boolean;
  allowAutonomousLowRiskCommands: boolean;
  confirmationTimeoutMs: number;
  maxPendingConfirmations: number;
  announceBlockedCommandRequests: boolean;
  includeCommandSuggestionsInSpeech: boolean;
  resultAcknowledgementsEnabled: boolean;
  confirmationPhrases: string[];
  cancellationPhrases: string[];
  defaultSpeechMode: AssistantSpeechMode;
  proactiveCommentaryEnabled: boolean;
  minimumCommentaryIntervalMs: number;
  maxQueuedConversationEvents: number;
  announceApplicationChanges: boolean;
  acknowledgeRoutineAutomationSuccess: boolean;
  voiceCommandActivationMode: VoiceCommandActivationMode;
  voiceCommandWakePhrases: string[];
  voiceCommandPushToCommandHotkey: string;
  voiceCommandAmbiguityTimeoutMs: number;
  voiceCommandAcknowledgementMode: VoiceCommandAcknowledgementMode;
  telemetry: AutomationTelemetrySettings;
}

export interface AutomationStatusSnapshot {
  status: AutomationRuntimeStatus;
  emergencyStopped: boolean;
  activeProfileId: string | null;
  effectiveProfileId: string | null;
  manualProfileId: string | null;
  profileSelectionMode: AutomationProfileSelectionMode;
  profileSelectionSource: AutomationProfileSelectionSource;
  detectedApplication: AutomationDetectedApplication | null;
  matchedProfileId: string | null;
  profileMatchConfidence: number | null;
  lastProfileTransitionAt: string | null;
  defaultSpeechMode: AssistantSpeechMode;
  speechMode: AssistantSpeechMode;
  dryRun: boolean;
  emergencyStopHotkey: string;
  llmAutomationEnabled: boolean;
  allowAutonomousHarmlessCommands: boolean;
  allowAutonomousLowRiskCommands: boolean;
  confirmationTimeoutMs: number;
  maxPendingConfirmations: number;
  announceBlockedCommandRequests: boolean;
  includeCommandSuggestionsInSpeech: boolean;
  resultAcknowledgementsEnabled: boolean;
  confirmationPhrases: string[];
  cancellationPhrases: string[];
  runningRequestIds: string[];
  profiles: AutomationProfileSummary[];
  history: AutomationExecutionRecord[];
  lastError?: string;
  activeApplicationPollIntervalMs: number;
  profileSwitchDebounceMs: number;
  detectionFailureGracePeriodMs: number;
  proactiveCommentaryEnabled: boolean;
  minimumCommentaryIntervalMs: number;
  maxQueuedConversationEvents: number;
  announceApplicationChanges: boolean;
  acknowledgeRoutineAutomationSuccess: boolean;
  voiceCommandActivationMode: VoiceCommandActivationMode;
  voiceCommandWakePhrases: string[];
  voiceCommandPushToCommandHotkey: string;
  voiceCommandAmbiguityTimeoutMs: number;
  voiceCommandAcknowledgementMode: VoiceCommandAcknowledgementMode;
  voiceCommandListeningActive: boolean;
  voiceCommandHotkeyRegistered: boolean;
  voiceCommandHotkeyError: string | null;
  telemetry: AutomationTelemetrySettings;
}

export interface AutomationAssistantCapability {
  profileId: string;
  commandId: string;
  label: string;
  description: string;
  aliases: string[];
  category: string;
  enabled: boolean;
  available: boolean;
  risk: AutomationRiskLevel;
  autonomyPolicy: AutomationAutonomyPolicy;
  allowedTriggerSources: AutomationTriggerSource[];
  cooldownRemainingMs: number;
  blockedReason?: string | null;
}

export interface AutomationAssistantCapabilityState
  extends AutomationAssistantCapability {
  llmAccess: AutomationLlmAccess;
  blockedReason: string | null;
  recommended: boolean;
  avoidReason: string | null;
}

const MAX_ASSISTANT_CAPABILITY_CATEGORY_LENGTH = 48;
export const MAX_ASSISTANT_CAPABILITY_CATALOG_SIZE = 128;

const normalizeAssistantCapabilityCategory = (category: string): string => {
  const cleaned = category.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "general";
  }
  if (cleaned.length <= MAX_ASSISTANT_CAPABILITY_CATEGORY_LENGTH) {
    return cleaned;
  }
  const separator = " ... ";
  const available =
    MAX_ASSISTANT_CAPABILITY_CATEGORY_LENGTH - separator.length;
  const prefixLength = Math.ceil(available / 2);
  const suffixLength = Math.floor(available / 2);
  return `${cleaned.slice(0, prefixLength).trimEnd()}${separator}${cleaned
    .slice(-suffixLength)
    .trimStart()}`;
};

export interface AutomationAssistantPendingConfirmation {
  requestId: string;
  profileId: string;
  commandId: string;
  commandLabel: string;
  conciseReason: string;
  risk: AutomationRiskLevel;
  createdAt: string;
  expiresAt: string;
  source: string;
}

export type AutomationAssistantDecisionType =
  | "suggested"
  | "request_blocked"
  | "suggestion_blocked"
  | "confirmation_pending"
  | "confirmed"
  | "rejected"
  | "expired"
  | "started"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "silent";

export interface AutomationAssistantDecision {
  decisionId: string;
  decisionType: AutomationAssistantDecisionType;
  profileId: string | null;
  commandId: string | null;
  commandLabel: string | null;
  reason: string | null;
  risk: AutomationRiskLevel | null;
  blockedReason: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AutomationVoiceCommandAmbiguityCandidate {
  commandId: string;
  label: string;
}

export interface AutomationVoiceCommandAmbiguity {
  ambiguityId: string;
  transcript: string;
  normalizedPhrase: string;
  candidates: AutomationVoiceCommandAmbiguityCandidate[];
  expiresAt: string;
}

export interface AutomationVoiceCommandResolverActivity {
  activityId: string;
  transcript: string;
  normalizedPhrase: string | null;
  activationMode: VoiceCommandActivationMode;
  activationMet: boolean;
  result: VoiceCommandResolutionResult;
  matchedCommandId: string | null;
  matchedCommandLabel: string | null;
  candidateCommandLabels: string[];
  blockedReason: string | null;
  requestId: string | null;
  fellBackToConversation: boolean;
  createdAt: string;
}

export interface AutomationAssistantStateSnapshot {
  activeProfileId: string | null;
  capabilityRevision: number;
  settings: AutomationAssistantSettings;
  telemetry: AutomationTelemetryStateSnapshot | null;
  capabilities: AutomationAssistantCapabilityState[];
  pendingConfirmations: AutomationAssistantPendingConfirmation[];
  recentDecisions: AutomationAssistantDecision[];
  lastBlockedReason: string | null;
  stateVersion: number;
  detectedApplication: AutomationDetectedApplication | null;
  matchedProfileId: string | null;
  effectiveProfileId: string | null;
  profileSelectionMode: AutomationProfileSelectionMode;
  profileSelectionSource: AutomationProfileSelectionSource;
  profileMatchConfidence: number | null;
  lastProfileTransitionAt: string | null;
  speechMode: AssistantSpeechMode;
  queueSummary: AutomationAssistantQueueSummary;
  currentEvent: AutomationAssistantEventSummary | null;
  suppressedEventCount: number;
  activity: AutomationAssistantActivityEntry[];
  vtuberSpeaking: boolean;
  playerSpeaking: boolean | null;
  lastPlayerRequest: string | null;
  pendingAmbiguity: AutomationVoiceCommandAmbiguity | null;
  resolverActivity: AutomationVoiceCommandResolverActivity[];
}

export class AutomationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationValidationError";
  }
}

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9_:-]{1,63}$/;
const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9 _-]{0,62}[a-z0-9])?$/;
const DEFAULT_CONFIRMATION_PHRASES = [
  "confirm",
  "do it",
  "yes, run it",
] as const;
const DEFAULT_CANCELLATION_PHRASES = ["cancel", "never mind", "stop"] as const;
const DEFAULT_VOICE_COMMAND_WAKE_PHRASES = ["assistant", "computer"] as const;
const DEFAULT_HULL_WARNING_THRESHOLDS = [75, 50, 25, 10] as const;
const VOICE_COMMAND_EDGE_PUNCTUATION =
  /^[\s"'`“”‘’.,!?;:()[\]{}<>_-]+|[\s"'`“”‘’.,!?;:()[\]{}<>_-]+$/g;

const normalizeTelemetryThresholdList = (
  value: unknown,
  fallback: readonly number[],
): number[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .filter(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item),
    )
    .map((item) => Math.max(1, Math.min(100, Math.round(item))))
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((left, right) => right - left);
  return normalized.length > 0 ? normalized : [...fallback];
};

export const getDefaultAutomationTelemetrySettings =
  (): AutomationTelemetrySettings => ({
    enabled: true,
    automaticJournalDiscovery: true,
    manualJournalDirectory: null,
    lowFuelThreshold: 0.25,
    criticalFuelThreshold: 0.1,
    hullWarningThresholds: [...DEFAULT_HULL_WARNING_THRESHOLDS],
    explorationCommentaryCooldownMs: 90_000,
    commentary: {
      announceDockingEvents: true,
      announceJumpEvents: true,
      announceMissionEvents: true,
      announceDiscoveries: true,
      announceMaterialCollection: false,
    },
  });

const normalizeAutomationTelemetrySettings = (
  candidate: unknown,
): AutomationTelemetrySettings => {
  const defaults = getDefaultAutomationTelemetrySettings();
  const record =
    candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : {};
  const commentary =
    record.commentary && typeof record.commentary === "object"
      ? (record.commentary as Record<string, unknown>)
      : {};
  const lowFuelThreshold =
    typeof record.lowFuelThreshold === "number" &&
    Number.isFinite(record.lowFuelThreshold)
      ? Math.max(0.01, Math.min(0.95, Number(record.lowFuelThreshold)))
      : defaults.lowFuelThreshold;
  const criticalFuelThreshold =
    typeof record.criticalFuelThreshold === "number" &&
    Number.isFinite(record.criticalFuelThreshold)
      ? Math.max(
          0.01,
          Math.min(lowFuelThreshold, Number(record.criticalFuelThreshold)),
        )
      : defaults.criticalFuelThreshold;
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
    automaticJournalDiscovery:
      typeof record.automaticJournalDiscovery === "boolean"
        ? record.automaticJournalDiscovery
        : defaults.automaticJournalDiscovery,
    manualJournalDirectory:
      typeof record.manualJournalDirectory === "string"
        ? record.manualJournalDirectory.trim() || null
        : defaults.manualJournalDirectory,
    lowFuelThreshold,
    criticalFuelThreshold,
    hullWarningThresholds: normalizeTelemetryThresholdList(
      record.hullWarningThresholds,
      DEFAULT_HULL_WARNING_THRESHOLDS,
    ),
    explorationCommentaryCooldownMs:
      typeof record.explorationCommentaryCooldownMs === "number" &&
      Number.isFinite(record.explorationCommentaryCooldownMs)
        ? Math.max(
            5_000,
            Math.min(
              600_000,
              Math.round(record.explorationCommentaryCooldownMs),
            ),
          )
        : defaults.explorationCommentaryCooldownMs,
    commentary: {
      announceDockingEvents:
        typeof commentary.announceDockingEvents === "boolean"
          ? commentary.announceDockingEvents
          : defaults.commentary.announceDockingEvents,
      announceJumpEvents:
        typeof commentary.announceJumpEvents === "boolean"
          ? commentary.announceJumpEvents
          : defaults.commentary.announceJumpEvents,
      announceMissionEvents:
        typeof commentary.announceMissionEvents === "boolean"
          ? commentary.announceMissionEvents
          : defaults.commentary.announceMissionEvents,
      announceDiscoveries:
        typeof commentary.announceDiscoveries === "boolean"
          ? commentary.announceDiscoveries
          : defaults.commentary.announceDiscoveries,
      announceMaterialCollection:
        typeof commentary.announceMaterialCollection === "boolean"
          ? commentary.announceMaterialCollection
          : defaults.commentary.announceMaterialCollection,
    },
  };
};

const normalizePhraseList = (
  value: unknown,
  fallback: readonly string[],
): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(
      (item, index, list) => item.length > 0 && list.indexOf(item) === index,
    );
  return normalized.length > 0 ? normalized : [...fallback];
};

export const normalizeVoiceCommandExactPhrase = (value: string): string =>
  value
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const normalizeVoiceCommandPhrase = (value: string): string =>
  normalizeVoiceCommandExactPhrase(value)
    .replace(VOICE_COMMAND_EDGE_PUNCTUATION, "")
    .trim();

const ensureObject = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new AutomationValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const ensureAllowedKeys = (
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void => {
  const extras = Object.keys(record).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (extras.length > 0) {
    throw new AutomationValidationError(
      `${label} contains unsupported fields: ${extras.join(", ")}.`,
    );
  }
};

const ensureString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  options?: { pattern?: RegExp; allowEmpty?: boolean },
): string => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AutomationValidationError(`${label}.${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (!options?.allowEmpty && trimmed.length === 0) {
    throw new AutomationValidationError(`${label}.${key} cannot be empty.`);
  }
  if (options?.pattern && trimmed && !options.pattern.test(trimmed)) {
    throw new AutomationValidationError(`${label}.${key} is malformed.`);
  }
  return trimmed;
};

const ensureBoolean = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new AutomationValidationError(`${label}.${key} must be a boolean.`);
  }
  return value;
};

const ensureNumber = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  bounds?: { min?: number; max?: number; integer?: boolean },
): number => {
  const value = record[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new AutomationValidationError(`${label}.${key} must be a number.`);
  }
  if (bounds?.integer && !Number.isInteger(value)) {
    throw new AutomationValidationError(`${label}.${key} must be an integer.`);
  }
  if (bounds?.min !== undefined && value < bounds.min) {
    throw new AutomationValidationError(
      `${label}.${key} must be at least ${bounds.min}.`,
    );
  }
  if (bounds?.max !== undefined && value > bounds.max) {
    throw new AutomationValidationError(
      `${label}.${key} must be at most ${bounds.max}.`,
    );
  }
  return value;
};

const ensureArray = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new AutomationValidationError(`${label}.${key} must be an array.`);
  }
  return value;
};

const ensureOptionalString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  options?: { pattern?: RegExp; allowEmpty?: boolean },
): string | undefined => {
  if (record[key] === undefined || record[key] === null) {
    return undefined;
  }
  return ensureString(record, key, label, options);
};

const ensureStringArray = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  options?: { pattern?: RegExp; dedupe?: boolean; allowEmptyItems?: boolean },
): string[] => {
  const items = ensureArray(record, key, label).map((item, index) => {
    if (typeof item !== "string") {
      throw new AutomationValidationError(
        `${label}.${key}[${index}] must be a string.`,
      );
    }
    const trimmed = item.trim();
    if (!options?.allowEmptyItems && trimmed.length === 0) {
      throw new AutomationValidationError(
        `${label}.${key}[${index}] cannot be empty.`,
      );
    }
    if (options?.pattern && trimmed && !options.pattern.test(trimmed)) {
      throw new AutomationValidationError(
        `${label}.${key}[${index}] is malformed.`,
      );
    }
    return trimmed;
  });

  if (options?.dedupe) {
    const normalized = items.map((item) => item.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      throw new AutomationValidationError(
        `${label}.${key} contains duplicates.`,
      );
    }
  }
  return items;
};

const ensureEnum = <T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  label: string,
  allowed: T,
): T[number] => {
  const value = ensureString(record, key, label);
  if (!allowed.includes(value as T[number])) {
    throw new AutomationValidationError(`${label}.${key} is not supported.`);
  }
  return value as T[number];
};

const ensureKeyIdentifier = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): ValidKeyIdentifier => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AutomationValidationError(`${label}.${key} must be a string.`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new AutomationValidationError(`${label}.${key} cannot be empty.`);
  }
  if (!VALID_KEY_IDENTIFIERS.includes(normalized as ValidKeyIdentifier)) {
    throw new AutomationValidationError(`${label}.${key} is not supported.`);
  }
  return normalized as ValidKeyIdentifier;
};

const ensureModifierKeyArray = (
  record: Record<string, unknown>,
  key: string,
  label: string,
): ValidModifierKey[] => {
  const items = ensureArray(record, key, label).map((item, index) => {
    if (typeof item !== "string") {
      throw new AutomationValidationError(
        `${label}.${key}[${index}] must be a string.`,
      );
    }

    const normalized = item.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new AutomationValidationError(
        `${label}.${key}[${index}] cannot be empty.`,
      );
    }
    if (!VALID_MODIFIER_KEYS.includes(normalized as ValidModifierKey)) {
      throw new AutomationValidationError(
        `${label}.${key} contains unsupported value "${item}".`,
      );
    }
    return normalized as ValidModifierKey;
  });

  return Array.from(new Set(items));
};

const ensureEnumArray = <T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  label: string,
  allowed: T,
): T[number][] => {
  const items = ensureStringArray(record, key, label, { dedupe: true });
  items.forEach((item) => {
    if (!allowed.includes(item as T[number])) {
      throw new AutomationValidationError(
        `${label}.${key} contains unsupported value "${item}".`,
      );
    }
  });
  return items as T[number][];
};

const SCRIPT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const formatScriptLineLabel = (label: string, lineNumber: number): string =>
  `${label} line ${lineNumber}`;

const stripAutomationScriptComment = (value: string): string => {
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (character === "\\") {
        escaping = true;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") {
      return value.slice(0, index);
    }
    if (character === "/" && value[index + 1] === "/") {
      return value.slice(0, index);
    }
  }

  return value;
};

const decodeAutomationScriptEscape = (
  value: string,
  lineLabel: string,
): string => {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "'":
      return "'";
    default:
      throw new AutomationValidationError(
        `${lineLabel} uses unsupported escape sequence "\\${value}".`,
      );
  }
};

const splitAutomationScriptWords = (
  value: string,
  lineLabel: string,
): string[] => {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  const pushWord = () => {
    if (current.length > 0) {
      words.push(current);
      current = "";
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (escaping) {
        current += decodeAutomationScriptEscape(character, lineLabel);
        escaping = false;
        continue;
      }
      if (character === "\\") {
        escaping = true;
        continue;
      }
      if (character === quote) {
        quote = null;
        continue;
      }
      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushWord();
      continue;
    }
    current += character;
  }

  if (escaping) {
    throw new AutomationValidationError(
      `${lineLabel} ends with an unfinished escape sequence.`,
    );
  }
  if (quote) {
    throw new AutomationValidationError(
      `${lineLabel} has an unterminated quoted string.`,
    );
  }

  pushWord();
  return words;
};

const ensureAutomationScriptExpression = (
  expression: string,
  lineLabel: string,
  keyword: string,
): string => {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new AutomationValidationError(
      `${lineLabel} requires an expression after "${keyword}".`,
    );
  }
  return trimmed;
};

const ensureAutomationScriptVariableName = (
  value: string,
  lineLabel: string,
): string => {
  if (!SCRIPT_VARIABLE_PATTERN.test(value)) {
    throw new AutomationValidationError(
      `${lineLabel} has an invalid variable name "${value}".`,
    );
  }
  return value;
};

const ensureAutomationScriptKey = (
  value: string,
  lineLabel: string,
): ValidKeyIdentifier => {
  const normalized = value.trim().toLowerCase();
  if (!VALID_KEY_IDENTIFIERS.includes(normalized as ValidKeyIdentifier)) {
    throw new AutomationValidationError(
      `${lineLabel} references unsupported key "${value}".`,
    );
  }
  return normalized as ValidKeyIdentifier;
};

const ensureAutomationScriptCombo = (
  value: string,
  lineLabel: string,
): { modifiers: ValidModifierKey[]; key: ValidKeyIdentifier } => {
  const segments = value
    .split("+")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (segments.length < 2) {
    throw new AutomationValidationError(
      `${lineLabel} requires at least one modifier and one key.`,
    );
  }

  const keySegment = segments[segments.length - 1];
  if (!keySegment) {
    throw new AutomationValidationError(
      `${lineLabel} requires a final key identifier.`,
    );
  }

  const modifiers = segments.slice(0, -1).map((segment) => {
    if (!VALID_MODIFIER_KEYS.includes(segment as ValidModifierKey)) {
      throw new AutomationValidationError(
        `${lineLabel} references unsupported modifier "${segment}".`,
      );
    }
    return segment as ValidModifierKey;
  });

  if (new Set(modifiers).size !== modifiers.length) {
    throw new AutomationValidationError(
      `${lineLabel} contains duplicate key modifiers.`,
    );
  }

  return {
    modifiers,
    key: ensureAutomationScriptKey(keySegment, lineLabel),
  };
};

const parseAutomationScriptLine = (
  line: string,
  label: string,
  lineNumber: number,
): AutomationScriptStatement => {
  const lineLabel = formatScriptLineLabel(label, lineNumber);
  const trimmed = line.trim();

  if (trimmed === "else") {
    return { kind: "else", lineNumber, raw: trimmed };
  }
  if (trimmed === "endif") {
    return { kind: "endif", lineNumber, raw: trimmed };
  }
  if (trimmed === "return") {
    return { kind: "return", lineNumber, raw: trimmed };
  }

  const assignmentMatch = trimmed.match(
    /^(?:let|set)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i,
  );
  if (assignmentMatch) {
    const [, variableName, expression] = assignmentMatch;
    return {
      kind: "set_variable",
      lineNumber,
      raw: trimmed,
      variableName: ensureAutomationScriptVariableName(variableName, lineLabel),
      expression: ensureAutomationScriptExpression(
        expression,
        lineLabel,
        "let/set",
      ),
    };
  }

  const keywordMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/);
  if (!keywordMatch) {
    throw new AutomationValidationError(
      `${lineLabel} does not start with a supported statement keyword.`,
    );
  }

  const keyword = keywordMatch[1].toLowerCase();
  const remainder = keywordMatch[2].trim();

  switch (keyword) {
    case "if":
      return {
        kind: "if",
        lineNumber,
        raw: trimmed,
        condition: ensureAutomationScriptExpression(remainder, lineLabel, "if"),
      };
    case "log":
      return {
        kind: "write_log",
        lineNumber,
        raw: trimmed,
        expression: ensureAutomationScriptExpression(
          remainder,
          lineLabel,
          "log",
        ),
      };
    case "speak":
      return {
        kind: "speak",
        lineNumber,
        raw: trimmed,
        expression: ensureAutomationScriptExpression(
          remainder,
          lineLabel,
          "speak",
        ),
      };
    case "wait":
      return {
        kind: "wait",
        lineNumber,
        raw: trimmed,
        expression: ensureAutomationScriptExpression(
          remainder,
          lineLabel,
          "wait",
        ),
      };
    case "mic": {
      const state = remainder.toLowerCase();
      if (!["on", "off", "true", "false"].includes(state)) {
        throw new AutomationValidationError(
          `${lineLabel} expects "mic on" or "mic off".`,
        );
      }
      return {
        kind: "set_mic_state",
        lineNumber,
        raw: trimmed,
        enabled: state === "on" || state === "true",
      };
    }
    case "press": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length === 0) {
        throw new AutomationValidationError(
          `${lineLabel} requires a key after "press".`,
        );
      }
      if (words.length > 1 && words[1].toLowerCase() !== "for") {
        throw new AutomationValidationError(
          `${lineLabel} supports only "press <key>" or "press <key> for <milliseconds>".`,
        );
      }
      return {
        kind: "key_press",
        lineNumber,
        raw: trimmed,
        key: ensureAutomationScriptKey(words[0], lineLabel),
        durationExpression:
          words.length > 1
            ? ensureAutomationScriptExpression(
                words.slice(2).join(" "),
                lineLabel,
                "press",
              )
            : undefined,
      };
    }
    case "keydown": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length !== 1) {
        throw new AutomationValidationError(
          `${lineLabel} expects exactly one key after "keydown".`,
        );
      }
      return {
        kind: "key_down",
        lineNumber,
        raw: trimmed,
        key: ensureAutomationScriptKey(words[0], lineLabel),
      };
    }
    case "keyup": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length !== 1) {
        throw new AutomationValidationError(
          `${lineLabel} expects exactly one key after "keyup".`,
        );
      }
      return {
        kind: "key_up",
        lineNumber,
        raw: trimmed,
        key: ensureAutomationScriptKey(words[0], lineLabel),
      };
    }
    case "combo": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length !== 1) {
        throw new AutomationValidationError(
          `${lineLabel} expects a single key chord after "combo".`,
        );
      }
      const chord = ensureAutomationScriptCombo(words[0], lineLabel);
      return {
        kind: "key_combination",
        lineNumber,
        raw: trimmed,
        modifiers: chord.modifiers,
        key: chord.key,
      };
    }
    case "call": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length !== 1 || !COMMAND_ID_PATTERN.test(words[0])) {
        throw new AutomationValidationError(
          `${lineLabel} requires a valid command id after "call".`,
        );
      }
      return {
        kind: "call_command",
        lineNumber,
        raw: trimmed,
        commandId: words[0],
      };
    }
    case "background": {
      const words = splitAutomationScriptWords(remainder, lineLabel);
      if (words.length !== 1) {
        throw new AutomationValidationError(
          `${lineLabel} expects one background id after "background".`,
        );
      }
      return {
        kind: "set_background",
        lineNumber,
        raw: trimmed,
        backgroundId: words[0],
      };
    }
    case "restore_background":
      if (remainder.length > 0) {
        throw new AutomationValidationError(
          `${lineLabel} does not accept extra arguments.`,
        );
      }
      return {
        kind: "restore_background",
        lineNumber,
        raw: trimmed,
      };
    default:
      throw new AutomationValidationError(
        `${lineLabel} uses unsupported statement "${keyword}".`,
      );
  }
};

export const parseAutomationScript = (
  script: string,
  label = "script",
): AutomationScriptStatement[] => {
  const normalized = script.replace(/\r\n/g, "\n");
  if (normalized.length > MAX_SCRIPT_LENGTH) {
    throw new AutomationValidationError(
      `${label} exceeds the maximum script length of ${MAX_SCRIPT_LENGTH} characters.`,
    );
  }

  const lines = normalized.split("\n");
  if (lines.length > MAX_SCRIPT_LINE_COUNT) {
    throw new AutomationValidationError(
      `${label} exceeds the maximum script length of ${MAX_SCRIPT_LINE_COUNT} lines.`,
    );
  }

  const statements: AutomationScriptStatement[] = [];
  const blockStack: Array<{ lineNumber: number; sawElse: boolean }> = [];

  lines.forEach((line, index) => {
    const stripped = stripAutomationScriptComment(line).trim();
    if (!stripped) {
      return;
    }

    const lineNumber = index + 1;
    const statement = parseAutomationScriptLine(stripped, label, lineNumber);

    switch (statement.kind) {
      case "if":
        blockStack.push({ lineNumber, sawElse: false });
        if (blockStack.length > MAX_SCRIPT_BLOCK_DEPTH) {
          throw new AutomationValidationError(
            `${formatScriptLineLabel(label, lineNumber)} exceeds the maximum block depth of ${MAX_SCRIPT_BLOCK_DEPTH}.`,
          );
        }
        break;
      case "else": {
        const currentBlock = blockStack[blockStack.length - 1];
        if (!currentBlock) {
          throw new AutomationValidationError(
            `${formatScriptLineLabel(label, lineNumber)} has an unexpected else.`,
          );
        }
        if (currentBlock.sawElse) {
          throw new AutomationValidationError(
            `${formatScriptLineLabel(label, lineNumber)} has a duplicate else for the same if block.`,
          );
        }
        currentBlock.sawElse = true;
        break;
      }
      case "endif":
        if (blockStack.length === 0) {
          throw new AutomationValidationError(
            `${formatScriptLineLabel(label, lineNumber)} has an unexpected endif.`,
          );
        }
        blockStack.pop();
        break;
      default:
        break;
    }

    statements.push(statement);
  });

  if (blockStack.length > 0) {
    const unclosedBlock = blockStack[blockStack.length - 1];
    throw new AutomationValidationError(
      `${label} is missing an endif for the if block opened on line ${unclosedBlock?.lineNumber}.`,
    );
  }

  return statements;
};

const normalizeSafeRelativePath = (value: string, label: string): string => {
  const normalized = value.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new AutomationValidationError(`${label} must be a relative path.`);
  }
  const resolved = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .reduce<string[]>((segments, segment) => {
      if (segment === "..") {
        throw new AutomationValidationError(
          `${label} cannot traverse outside the asset directory.`,
        );
      }
      segments.push(segment);
      return segments;
    }, [])
    .join("/");
  if (resolved.startsWith("../") || resolved === "..") {
    throw new AutomationValidationError(
      `${label} cannot traverse outside the asset directory.`,
    );
  }
  return resolved;
};

const validateAction = (
  candidate: unknown,
  label: string,
): AutomationAction => {
  const record = ensureObject(candidate, label);
  const actionType = ensureString(record, "type", label);

  switch (actionType) {
    case "wait": {
      ensureAllowedKeys(record, ["type", "milliseconds"], label);
      return {
        type: "wait",
        milliseconds: ensureNumber(record, "milliseconds", label, {
          min: 0,
          max: MAX_WAIT_MS,
          integer: true,
        }),
      };
    }
    case "play_sound": {
      ensureAllowedKeys(
        record,
        ["type", "assetId", "localAssetPath", "volume"],
        label,
      );
      const assetId = ensureOptionalString(record, "assetId", label);
      const localAssetPath = ensureOptionalString(
        record,
        "localAssetPath",
        label,
      );
      if (!assetId && !localAssetPath) {
        throw new AutomationValidationError(
          `${label} requires either assetId or localAssetPath.`,
        );
      }
      if (assetId && localAssetPath) {
        throw new AutomationValidationError(
          `${label} cannot define both assetId and localAssetPath.`,
        );
      }
      return {
        type: "play_sound",
        assetId,
        localAssetPath: localAssetPath
          ? normalizeSafeRelativePath(localAssetPath, `${label}.localAssetPath`)
          : undefined,
        volume:
          record.volume === undefined
            ? undefined
            : ensureNumber(record, "volume", label, { min: 0, max: 1 }),
      };
    }
    case "write_log": {
      ensureAllowedKeys(record, ["type", "message"], label);
      return {
        type: "write_log",
        message: ensureString(record, "message", label, { allowEmpty: true }),
      };
    }
    case "speak_fixed": {
      ensureAllowedKeys(record, ["type", "text", "interruptPolicy"], label);
      return {
        type: "speak_fixed",
        text: ensureString(record, "text", label),
        interruptPolicy:
          record.interruptPolicy === undefined
            ? undefined
            : ensureEnum(
                record,
                "interruptPolicy",
                label,
                SOUND_INTERRUPT_POLICIES,
              ),
      };
    }
    case "set_mic_state": {
      ensureAllowedKeys(record, ["type", "enabled"], label);
      return {
        type: "set_mic_state",
        enabled: ensureBoolean(record, "enabled", label),
      };
    }
    case "set_background": {
      ensureAllowedKeys(record, ["type", "backgroundId"], label);
      return {
        type: "set_background",
        backgroundId: ensureString(record, "backgroundId", label),
      };
    }
    case "restore_background": {
      ensureAllowedKeys(record, ["type"], label);
      return { type: "restore_background" };
    }
    case "show_overlay": {
      ensureAllowedKeys(
        record,
        ["type", "overlayId", "durationMs", "placement", "animationName"],
        label,
      );
      return {
        type: "show_overlay",
        overlayId: ensureString(record, "overlayId", label),
        durationMs: ensureNumber(record, "durationMs", label, {
          min: 0,
          max: MAX_OVERLAY_DURATION_MS,
          integer: true,
        }),
        placement: ensureEnum(record, "placement", label, OVERLAY_PLACEMENTS),
        animationName:
          record.animationName === undefined
            ? undefined
            : ensureEnum(record, "animationName", label, OVERLAY_ANIMATIONS),
      };
    }
    case "remove_overlay": {
      ensureAllowedKeys(record, ["type", "overlayId"], label);
      return {
        type: "remove_overlay",
        overlayId: ensureString(record, "overlayId", label),
      };
    }
    case "screen_shake": {
      ensureAllowedKeys(record, ["type", "durationMs", "intensity"], label);
      return {
        type: "screen_shake",
        durationMs: ensureNumber(record, "durationMs", label, {
          min: 0,
          max: MAX_SCREEN_SHAKE_DURATION_MS,
          integer: true,
        }),
        intensity: ensureNumber(record, "intensity", label, {
          min: 0,
          max: MAX_SCREEN_SHAKE_INTENSITY,
        }),
      };
    }
    case "key_press": {
      ensureAllowedKeys(record, ["type", "key", "durationMs"], label);
      return {
        type: "key_press",
        key: ensureKeyIdentifier(record, "key", label),
        durationMs:
          record.durationMs === undefined
            ? undefined
            : ensureNumber(record, "durationMs", label, {
                min: 0,
                max: MAX_KEY_HOLD_DURATION_MS,
                integer: true,
              }),
      };
    }
    case "key_down": {
      ensureAllowedKeys(record, ["type", "key"], label);
      return {
        type: "key_down",
        key: ensureKeyIdentifier(record, "key", label),
      };
    }
    case "key_up": {
      ensureAllowedKeys(record, ["type", "key"], label);
      return {
        type: "key_up",
        key: ensureKeyIdentifier(record, "key", label),
      };
    }
    case "key_combination": {
      ensureAllowedKeys(record, ["type", "modifiers", "key"], label);
      return {
        type: "key_combination",
        modifiers: ensureModifierKeyArray(record, "modifiers", label),
        key: ensureKeyIdentifier(record, "key", label),
      };
    }
    case "script": {
      ensureAllowedKeys(record, ["type", "script"], label);
      const script = ensureString(record, "script", label);
      parseAutomationScript(script, `${label}.script`);
      return {
        type: "script",
        script,
      };
    }
    case "run_macro": {
      ensureAllowedKeys(record, ["type", "commandId"], label);
      return {
        type: "run_macro",
        commandId: ensureString(record, "commandId", label, {
          pattern: COMMAND_ID_PATTERN,
        }),
      };
    }
    case "unsupported_import_action": {
      ensureAllowedKeys(record, ["type", "sourceType", "summary"], label);
      return {
        type: "unsupported_import_action",
        sourceType: ensureString(record, "sourceType", label),
        summary: ensureString(record, "summary", label),
      };
    }
    case "response_placeholder": {
      ensureAllowedKeys(
        record,
        [
          "type",
          "originalResponsePresent",
          "replacementRequired",
          "replacementMode",
        ],
        label,
      );
      return {
        type: "response_placeholder",
        originalResponsePresent: ensureBoolean(
          record,
          "originalResponsePresent",
          label,
        ),
        replacementRequired: ensureBoolean(
          record,
          "replacementRequired",
          label,
        ),
        replacementMode: ensureEnum(
          record,
          "replacementMode",
          label,
          RESPONSE_PLACEHOLDER_REPLACEMENT_MODES,
        ),
      };
    }
    default:
      throw new AutomationValidationError(
        `${label}.type "${actionType}" is not supported.`,
      );
  }
};

const validateCommand = (
  candidate: unknown,
  label: string,
): AutomationCommand => {
  const record = ensureObject(candidate, label);
  ensureAllowedKeys(
    record,
    [
      "commandId",
      "label",
      "description",
      "aliases",
      "category",
      "enabled",
      "cooldownMs",
      "maxDurationMs",
      "riskLevel",
      "allowedTriggerSources",
      "autonomyPolicy",
      "confirmationPolicy",
      "concurrencyPolicy",
      "defaultDryRun",
      "steps",
      "voiceAttack",
    ],
    label,
  );

  const steps = ensureArray(record, "steps", label).map((step, index) =>
    validateAction(step, `${label}.steps[${index}]`),
  );
  if (steps.length === 0) {
    throw new AutomationValidationError(`${label}.steps must not be empty.`);
  }
  if (steps.length > MAX_STEP_COUNT) {
    throw new AutomationValidationError(
      `${label}.steps exceeds the maximum step count.`,
    );
  }

  return {
    commandId: ensureString(record, "commandId", label, {
      pattern: COMMAND_ID_PATTERN,
    }),
    label: ensureString(record, "label", label),
    description: ensureString(record, "description", label, {
      allowEmpty: true,
    }),
    aliases: ensureStringArray(record, "aliases", label, {
      pattern: ALIAS_PATTERN,
      dedupe: true,
    }),
    category: ensureString(record, "category", label),
    enabled: ensureBoolean(record, "enabled", label),
    cooldownMs: ensureNumber(record, "cooldownMs", label, {
      min: 0,
      max: MAX_COMMAND_DURATION_MS,
      integer: true,
    }),
    maxDurationMs: ensureNumber(record, "maxDurationMs", label, {
      min: 1_000,
      max: MAX_COMMAND_DURATION_MS,
      integer: true,
    }),
    riskLevel: ensureEnum(record, "riskLevel", label, AUTOMATION_RISK_LEVELS),
    allowedTriggerSources: ensureEnumArray(
      record,
      "allowedTriggerSources",
      label,
      AUTOMATION_TRIGGER_SOURCES,
    ),
    autonomyPolicy: ensureEnum(
      record,
      "autonomyPolicy",
      label,
      AUTOMATION_AUTONOMY_POLICIES,
    ),
    confirmationPolicy: ensureEnum(
      record,
      "confirmationPolicy",
      label,
      AUTOMATION_CONFIRMATION_POLICIES,
    ),
    concurrencyPolicy: ensureEnum(
      record,
      "concurrencyPolicy",
      label,
      AUTOMATION_CONCURRENCY_POLICIES,
    ),
    defaultDryRun: ensureBoolean(record, "defaultDryRun", label),
    steps,
    voiceAttack:
      record.voiceAttack === undefined
        ? undefined
        : (() => {
            ensureObject(record.voiceAttack, `${label}.voiceAttack`);
            return structuredClone(
              record.voiceAttack,
            ) as AutomationImportedVoiceAttackCommand;
          })(),
  };
};

const validateProfileGraph = (profile: AutomationProfile): void => {
  const commandsById = new Map(
    profile.commands.map((command) => [command.commandId, command]),
  );
  const stack = new Set<string>();
  const visited = new Set<string>();

  const visit = (commandId: string) => {
    if (stack.has(commandId)) {
      throw new AutomationValidationError(
        `Recursive macro call detected for command "${commandId}".`,
      );
    }
    if (visited.has(commandId)) {
      return;
    }
    const command = commandsById.get(commandId);
    if (!command) {
      throw new AutomationValidationError(
        `Command "${commandId}" references an unknown macro.`,
      );
    }
    stack.add(commandId);
    command.steps.forEach((step) => {
      if (step.type === "run_macro") {
        if (!commandsById.has(step.commandId)) {
          throw new AutomationValidationError(
            `Command "${commandId}" references unknown command "${step.commandId}".`,
          );
        }
        visit(step.commandId);
        return;
      }
      if (step.type === "script") {
        const statements = parseAutomationScript(
          step.script,
          `Command "${commandId}" script`,
        );
        statements.forEach((statement) => {
          if (statement.kind !== "call_command") {
            return;
          }
          if (!commandsById.has(statement.commandId)) {
            throw new AutomationValidationError(
              `Command "${commandId}" references unknown command "${statement.commandId}".`,
            );
          }
          visit(statement.commandId);
        });
      }
    });
    stack.delete(commandId);
    visited.add(commandId);
  };

  profile.commands.forEach((command) => visit(command.commandId));
};

const getVoiceCommandPhrases = (command: AutomationCommand): string[] => {
  const unique = new Map<string, string>();
  [command.label, ...command.aliases].forEach((phrase) => {
    const trimmed = phrase.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  });
  return [...unique.values()];
};

const validateVoiceCommandAliases = (profile: AutomationProfile): void => {
  const voiceCommands = profile.commands.filter(
    (command) =>
      command.enabled && command.allowedTriggerSources.includes("player_voice"),
  );
  const exactMap = new Map<string, string>();
  const normalizedMap = new Map<string, string>();

  voiceCommands.forEach((command) => {
    getVoiceCommandPhrases(command).forEach((phrase) => {
      const exactKey = normalizeVoiceCommandExactPhrase(phrase);
      if (exactKey) {
        const existingCommandId = exactMap.get(exactKey);
        if (existingCommandId && existingCommandId !== command.commandId) {
          throw new AutomationValidationError(
            `Voice alias "${phrase}" duplicates another player_voice command phrase.`,
          );
        }
        exactMap.set(exactKey, command.commandId);
      }

      const normalizedKey = normalizeVoiceCommandPhrase(phrase);
      if (normalizedKey) {
        const existingCommandId = normalizedMap.get(normalizedKey);
        if (existingCommandId && existingCommandId !== command.commandId) {
          throw new AutomationValidationError(
            `Voice alias "${phrase}" is ambiguous after normalization.`,
          );
        }
        normalizedMap.set(normalizedKey, command.commandId);
      }
    });
  });
};

export const validateAutomationProfile = (
  candidate: unknown,
): AutomationProfile => {
  const record = ensureObject(candidate, "profile");
  ensureAllowedKeys(
    record,
    [
      "schemaVersion",
      "profileId",
      "displayName",
      "description",
      "enabled",
      "processNames",
      "commands",
      "importMetadata",
    ],
    "profile",
  );

  const commands = ensureArray(record, "commands", "profile").map(
    (command, index) => validateCommand(command, `profile.commands[${index}]`),
  );
  const commandIds = commands.map((command) => command.commandId);
  if (new Set(commandIds).size !== commandIds.length) {
    throw new AutomationValidationError(
      "Duplicate command IDs are not allowed.",
    );
  }

  const profile: AutomationProfile = {
    schemaVersion: ensureNumber(record, "schemaVersion", "profile", {
      integer: true,
    }) as typeof AUTOMATION_SCHEMA_VERSION,
    profileId: ensureString(record, "profileId", "profile", {
      pattern: PROFILE_ID_PATTERN,
    }),
    displayName: ensureString(record, "displayName", "profile"),
    description: ensureString(record, "description", "profile", {
      allowEmpty: true,
    }),
    enabled: ensureBoolean(record, "enabled", "profile"),
    processNames: ensureStringArray(record, "processNames", "profile", {
      dedupe: true,
    }),
    commands,
    importMetadata:
      record.importMetadata === undefined
        ? undefined
        : (() => {
            const metadata = ensureObject(
              record.importMetadata,
              "profile.importMetadata",
            );
            ensureAllowedKeys(
              metadata,
              [
                "imported",
                "importSource",
                "sourceBasename",
                "sourceHash",
                "importedAt",
                "reviewStatus",
                "importWarnings",
                "originalProfileVersion",
              ],
              "profile.importMetadata",
            );
            return {
              imported: (() => {
                const imported = ensureBoolean(
                  metadata,
                  "imported",
                  "profile.importMetadata",
                );
                if (!imported) {
                  throw new AutomationValidationError(
                    "profile.importMetadata.imported must be true.",
                  );
                }
                return true as const;
              })(),
              importSource: ensureEnum(
                metadata,
                "importSource",
                "profile.importMetadata",
                ["voiceattack"] as const,
              ),
              sourceBasename: ensureString(
                metadata,
                "sourceBasename",
                "profile.importMetadata",
              ),
              sourceHash: ensureString(
                metadata,
                "sourceHash",
                "profile.importMetadata",
              ),
              importedAt: ensureString(
                metadata,
                "importedAt",
                "profile.importMetadata",
              ),
              reviewStatus: ensureEnum(
                metadata,
                "reviewStatus",
                "profile.importMetadata",
                ["required", "reviewed"] as const,
              ),
              importWarnings: ensureStringArray(
                metadata,
                "importWarnings",
                "profile.importMetadata",
                {
                  dedupe: true,
                },
              ),
              originalProfileVersion:
                ensureOptionalString(
                  metadata,
                  "originalProfileVersion",
                  "profile.importMetadata",
                ) ?? null,
            };
          })(),
  };

  if (profile.schemaVersion !== AUTOMATION_SCHEMA_VERSION) {
    throw new AutomationValidationError(
      `Unsupported schema version "${profile.schemaVersion}".`,
    );
  }

  validateProfileGraph(profile);
  validateVoiceCommandAliases(profile);
  return profile;
};

export const createProfileSummary = (
  profile: AutomationProfile,
): AutomationProfileSummary => ({
  profileId: profile.profileId,
  displayName: profile.displayName,
  enabled: profile.enabled,
  processNames: [...profile.processNames],
  commands: profile.commands.map((command) => ({
    commandId: command.commandId,
    label: command.label,
    enabled: command.enabled,
  })),
});

export const isValidKeyIdentifier = (
  value: string,
): value is ValidKeyIdentifier =>
  VALID_KEY_IDENTIFIERS.includes(value as ValidKeyIdentifier);

export const getDefaultAutomationSettings = (): AutomationSettings => ({
  activeProfileId: "assistant-test-profile",
  manualProfileId: "assistant-test-profile",
  profileSelectionMode: "manual",
  dryRun: true,
  emergencyStopHotkey: "CommandOrControl+Alt+Shift+F12",
  llmAutomationEnabled: false,
  allowAutonomousHarmlessCommands: false,
  allowAutonomousLowRiskCommands: false,
  confirmationTimeoutMs: 10_000,
  maxPendingConfirmations: 1,
  announceBlockedCommandRequests: false,
  includeCommandSuggestionsInSpeech: true,
  resultAcknowledgementsEnabled: false,
  confirmationPhrases: [...DEFAULT_CONFIRMATION_PHRASES],
  cancellationPhrases: [...DEFAULT_CANCELLATION_PHRASES],
  activeApplicationPollIntervalMs: 1500,
  profileSwitchDebounceMs: 1200,
  detectionFailureGracePeriodMs: 3000,
  defaultSpeechMode: "action",
  proactiveCommentaryEnabled: false,
  minimumCommentaryIntervalMs: 15000,
  maxQueuedConversationEvents: 5,
  announceApplicationChanges: false,
  acknowledgeRoutineAutomationSuccess: false,
  voiceCommandActivationMode: "wake_phrase",
  voiceCommandWakePhrases: [...DEFAULT_VOICE_COMMAND_WAKE_PHRASES],
  voiceCommandPushToCommandHotkey: "CommandOrControl+Alt+Shift+F11",
  voiceCommandAmbiguityTimeoutMs: 15_000,
  voiceCommandAcknowledgementMode: "none",
  telemetry: getDefaultAutomationTelemetrySettings(),
});

export const getDefaultAutomationAssistantSettings =
  (): AutomationAssistantSettings => {
    const defaults = getDefaultAutomationSettings();
    return {
      llmAutomationEnabled: defaults.llmAutomationEnabled,
      allowAutonomousHarmlessCommands: defaults.allowAutonomousHarmlessCommands,
      allowAutonomousLowRiskCommands: defaults.allowAutonomousLowRiskCommands,
      confirmationTimeoutMs: defaults.confirmationTimeoutMs,
      maxPendingConfirmations: defaults.maxPendingConfirmations,
      announceBlockedCommandRequests: defaults.announceBlockedCommandRequests,
      includeCommandSuggestionsInSpeech:
        defaults.includeCommandSuggestionsInSpeech,
      resultAcknowledgementsEnabled: defaults.resultAcknowledgementsEnabled,
      confirmationPhrases: [...defaults.confirmationPhrases],
      cancellationPhrases: [...defaults.cancellationPhrases],
      defaultSpeechMode: defaults.defaultSpeechMode,
      proactiveCommentaryEnabled: defaults.proactiveCommentaryEnabled,
      minimumCommentaryIntervalMs: defaults.minimumCommentaryIntervalMs,
      maxQueuedConversationEvents: defaults.maxQueuedConversationEvents,
      announceApplicationChanges: defaults.announceApplicationChanges,
      acknowledgeRoutineAutomationSuccess:
        defaults.acknowledgeRoutineAutomationSuccess,
      voiceCommandActivationMode: defaults.voiceCommandActivationMode,
      voiceCommandWakePhrases: [...defaults.voiceCommandWakePhrases],
      voiceCommandPushToCommandHotkey: defaults.voiceCommandPushToCommandHotkey,
      voiceCommandAmbiguityTimeoutMs: defaults.voiceCommandAmbiguityTimeoutMs,
      voiceCommandAcknowledgementMode: defaults.voiceCommandAcknowledgementMode,
      telemetry: normalizeAutomationTelemetrySettings(defaults.telemetry),
    };
  };

export const normalizeAutomationSettings = (
  candidate:
    | Partial<AutomationSettings>
    | Record<string, unknown>
    | null
    | undefined,
): AutomationSettings => {
  const defaults = getDefaultAutomationSettings();
  const record =
    candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : {};
  return {
    activeProfileId:
      typeof record.activeProfileId === "string"
        ? record.activeProfileId
        : record.activeProfileId === null
          ? null
          : defaults.activeProfileId,
    manualProfileId:
      typeof record.manualProfileId === "string"
        ? record.manualProfileId
        : record.manualProfileId === null
          ? null
          : defaults.manualProfileId,
    profileSelectionMode:
      typeof record.profileSelectionMode === "string" &&
      AUTOMATION_PROFILE_SELECTION_MODES.includes(
        record.profileSelectionMode as AutomationProfileSelectionMode,
      )
        ? (record.profileSelectionMode as AutomationProfileSelectionMode)
        : defaults.profileSelectionMode,
    dryRun:
      typeof record.dryRun === "boolean" ? record.dryRun : defaults.dryRun,
    emergencyStopHotkey:
      typeof record.emergencyStopHotkey === "string" &&
      record.emergencyStopHotkey.trim().length > 0
        ? record.emergencyStopHotkey.trim()
        : defaults.emergencyStopHotkey,
    llmAutomationEnabled:
      typeof record.llmAutomationEnabled === "boolean"
        ? record.llmAutomationEnabled
        : defaults.llmAutomationEnabled,
    allowAutonomousHarmlessCommands:
      typeof record.allowAutonomousHarmlessCommands === "boolean"
        ? record.allowAutonomousHarmlessCommands
        : defaults.allowAutonomousHarmlessCommands,
    allowAutonomousLowRiskCommands:
      typeof record.allowAutonomousLowRiskCommands === "boolean"
        ? record.allowAutonomousLowRiskCommands
        : defaults.allowAutonomousLowRiskCommands,
    confirmationTimeoutMs:
      typeof record.confirmationTimeoutMs === "number" &&
      Number.isFinite(record.confirmationTimeoutMs)
        ? Math.max(
            1000,
            Math.min(120000, Math.round(record.confirmationTimeoutMs)),
          )
        : defaults.confirmationTimeoutMs,
    maxPendingConfirmations:
      typeof record.maxPendingConfirmations === "number" &&
      Number.isFinite(record.maxPendingConfirmations)
        ? Math.max(1, Math.min(5, Math.round(record.maxPendingConfirmations)))
        : defaults.maxPendingConfirmations,
    announceBlockedCommandRequests:
      typeof record.announceBlockedCommandRequests === "boolean"
        ? record.announceBlockedCommandRequests
        : defaults.announceBlockedCommandRequests,
    includeCommandSuggestionsInSpeech:
      typeof record.includeCommandSuggestionsInSpeech === "boolean"
        ? record.includeCommandSuggestionsInSpeech
        : defaults.includeCommandSuggestionsInSpeech,
    resultAcknowledgementsEnabled:
      typeof record.resultAcknowledgementsEnabled === "boolean"
        ? record.resultAcknowledgementsEnabled
        : defaults.resultAcknowledgementsEnabled,
    confirmationPhrases: normalizePhraseList(
      record.confirmationPhrases,
      DEFAULT_CONFIRMATION_PHRASES,
    ),
    cancellationPhrases: normalizePhraseList(
      record.cancellationPhrases,
      DEFAULT_CANCELLATION_PHRASES,
    ),
    activeApplicationPollIntervalMs:
      typeof record.activeApplicationPollIntervalMs === "number" &&
      Number.isFinite(record.activeApplicationPollIntervalMs)
        ? Math.max(
            500,
            Math.min(10000, Math.round(record.activeApplicationPollIntervalMs)),
          )
        : defaults.activeApplicationPollIntervalMs,
    profileSwitchDebounceMs:
      typeof record.profileSwitchDebounceMs === "number" &&
      Number.isFinite(record.profileSwitchDebounceMs)
        ? Math.max(
            250,
            Math.min(10000, Math.round(record.profileSwitchDebounceMs)),
          )
        : defaults.profileSwitchDebounceMs,
    detectionFailureGracePeriodMs:
      typeof record.detectionFailureGracePeriodMs === "number" &&
      Number.isFinite(record.detectionFailureGracePeriodMs)
        ? Math.max(
            500,
            Math.min(30000, Math.round(record.detectionFailureGracePeriodMs)),
          )
        : defaults.detectionFailureGracePeriodMs,
    defaultSpeechMode:
      typeof record.defaultSpeechMode === "string" &&
      ASSISTANT_SPEECH_MODES.includes(
        record.defaultSpeechMode as AssistantSpeechMode,
      )
        ? (record.defaultSpeechMode as AssistantSpeechMode)
        : defaults.defaultSpeechMode,
    proactiveCommentaryEnabled:
      typeof record.proactiveCommentaryEnabled === "boolean"
        ? record.proactiveCommentaryEnabled
        : defaults.proactiveCommentaryEnabled,
    minimumCommentaryIntervalMs:
      typeof record.minimumCommentaryIntervalMs === "number" &&
      Number.isFinite(record.minimumCommentaryIntervalMs)
        ? Math.max(
            1000,
            Math.min(120000, Math.round(record.minimumCommentaryIntervalMs)),
          )
        : defaults.minimumCommentaryIntervalMs,
    maxQueuedConversationEvents:
      typeof record.maxQueuedConversationEvents === "number" &&
      Number.isFinite(record.maxQueuedConversationEvents)
        ? Math.max(
            1,
            Math.min(20, Math.round(record.maxQueuedConversationEvents)),
          )
        : defaults.maxQueuedConversationEvents,
    announceApplicationChanges:
      typeof record.announceApplicationChanges === "boolean"
        ? record.announceApplicationChanges
        : defaults.announceApplicationChanges,
    acknowledgeRoutineAutomationSuccess:
      typeof record.acknowledgeRoutineAutomationSuccess === "boolean"
        ? record.acknowledgeRoutineAutomationSuccess
        : defaults.acknowledgeRoutineAutomationSuccess,
    voiceCommandActivationMode:
      typeof record.voiceCommandActivationMode === "string" &&
      VOICE_COMMAND_ACTIVATION_MODES.includes(
        record.voiceCommandActivationMode as VoiceCommandActivationMode,
      )
        ? (record.voiceCommandActivationMode as VoiceCommandActivationMode)
        : defaults.voiceCommandActivationMode,
    voiceCommandWakePhrases: normalizePhraseList(
      record.voiceCommandWakePhrases,
      DEFAULT_VOICE_COMMAND_WAKE_PHRASES,
    ),
    voiceCommandPushToCommandHotkey:
      typeof record.voiceCommandPushToCommandHotkey === "string" &&
      record.voiceCommandPushToCommandHotkey.trim().length > 0
        ? record.voiceCommandPushToCommandHotkey.trim()
        : defaults.voiceCommandPushToCommandHotkey,
    voiceCommandAmbiguityTimeoutMs:
      typeof record.voiceCommandAmbiguityTimeoutMs === "number" &&
      Number.isFinite(record.voiceCommandAmbiguityTimeoutMs)
        ? Math.max(
            2_000,
            Math.min(
              120_000,
              Math.round(record.voiceCommandAmbiguityTimeoutMs),
            ),
          )
        : defaults.voiceCommandAmbiguityTimeoutMs,
    voiceCommandAcknowledgementMode:
      typeof record.voiceCommandAcknowledgementMode === "string" &&
      VOICE_COMMAND_ACKNOWLEDGEMENT_MODES.includes(
        record.voiceCommandAcknowledgementMode as VoiceCommandAcknowledgementMode,
      )
        ? (record.voiceCommandAcknowledgementMode as VoiceCommandAcknowledgementMode)
        : defaults.voiceCommandAcknowledgementMode,
    telemetry: normalizeAutomationTelemetrySettings(record.telemetry),
  };
};

const getCommandCooldownRemainingMs = (
  snapshot: AutomationStatusSnapshot,
  profileId: string,
  command: AutomationCommand,
  nowMs: number,
): number => {
  if (command.cooldownMs <= 0) {
    return 0;
  }
  const latestRecord = snapshot.history.find(
    (record) =>
      record.profileId === profileId && record.commandId === command.commandId,
  );
  if (!latestRecord) {
    return 0;
  }
  const startedAtMs = Date.parse(latestRecord.startedAt);
  if (Number.isNaN(startedAtMs)) {
    return 0;
  }
  return Math.max(0, command.cooldownMs - (nowMs - startedAtMs));
};

const isCommandBlockedByConcurrency = (
  snapshot: AutomationStatusSnapshot,
  profileId: string,
  command: AutomationCommand,
): boolean => {
  const runningRecords = snapshot.history.filter(
    (record) =>
      snapshot.runningRequestIds.includes(record.requestId) &&
      record.profileId === profileId,
  );
  if (command.concurrencyPolicy === "allow_parallel") {
    return false;
  }
  if (command.concurrencyPolicy === "reject_duplicates") {
    return runningRecords.some(
      (record) => record.commandId === command.commandId,
    );
  }
  return runningRecords.length > 0;
};

const getCommandBlockedReason = (
  profile: AutomationProfile,
  snapshot: AutomationStatusSnapshot,
  command: AutomationCommand,
  cooldownRemainingMs: number,
): string | null => {
  if (!profile.enabled) {
    return `Automation profile "${profile.displayName}" is disabled.`;
  }
  if (!command.enabled) {
    return `Automation command "${command.label}" is disabled.`;
  }
  if (
    profile.importMetadata?.imported &&
    profile.importMetadata.reviewStatus !== "reviewed"
  ) {
    return "Imported automation profiles must be reviewed before voice use.";
  }
  if (command.voiceAttack?.executability === "blocked") {
    return "This imported VoiceAttack command still contains blocking actions or dependency errors.";
  }
  if (command.voiceAttack?.executability === "metadata_only") {
    return "This imported VoiceAttack command does not reach any executable automation actions.";
  }
  if (command.steps.some((step) => step.type === "unsupported_import_action")) {
    return "Imported placeholder actions require manual replacement before execution.";
  }
  if (
    command.steps.some(
      (step) =>
        step.type === "response_placeholder" && step.replacementRequired,
    )
  ) {
    return "Imported response placeholders require manual replacement before execution.";
  }
  if (snapshot.emergencyStopped) {
    return "Automation is emergency stopped.";
  }
  if (cooldownRemainingMs > 0) {
    return `Command "${command.label}" is still on cooldown.`;
  }
  if (isCommandBlockedByConcurrency(snapshot, profile.profileId, command)) {
    return `Command "${command.label}" already has a running request.`;
  }
  return null;
};

export const buildAutomationCapabilityCatalog = (
  profile: AutomationProfile | null,
  snapshot: AutomationStatusSnapshot | null,
): AutomationAssistantCapability[] => {
  if (!profile || !snapshot || snapshot.activeProfileId !== profile.profileId) {
    return [];
  }
  const nowMs = Date.now();
  const riskRank: Record<AutomationRiskLevel, number> = {
    harmless: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  const triggerRank = (capability: AutomationAssistantCapability): number =>
    capability.allowedTriggerSources.includes("player_voice") ||
    capability.allowedTriggerSources.includes("vtuber")
      ? 0
      : 1;

  return [...profile.commands]
    .filter(
      (command) => command.voiceAttack?.hiddenFromCapabilityCatalog !== true,
    )
    .map((command) => {
      const cooldownRemainingMs = getCommandCooldownRemainingMs(
        snapshot,
        profile.profileId,
        command,
        nowMs,
      );
      const blockedReason = getCommandBlockedReason(
        profile,
        snapshot,
        command,
        cooldownRemainingMs,
      );
      const available = blockedReason === null;
      return {
        profileId: profile.profileId,
        commandId: command.commandId,
        label: command.label,
        description: command.description,
        aliases: [...command.aliases],
        category: normalizeAssistantCapabilityCategory(command.category),
        enabled: command.enabled,
        available,
        risk: command.riskLevel,
        autonomyPolicy: command.autonomyPolicy,
        allowedTriggerSources: [...command.allowedTriggerSources],
        cooldownRemainingMs,
        blockedReason,
      };
    })
    .sort(
      (left, right) =>
        Number(right.available) - Number(left.available) ||
        Number(right.enabled) - Number(left.enabled) ||
        triggerRank(left) - triggerRank(right) ||
        riskRank[left.risk] - riskRank[right.risk] ||
        left.category.localeCompare(right.category) ||
        left.label.localeCompare(right.label),
    )
    .slice(0, MAX_ASSISTANT_CAPABILITY_CATALOG_SIZE);
};

export const createAssistantTestProfile = (): AutomationProfile => ({
  schemaVersion: AUTOMATION_SCHEMA_VERSION,
  profileId: "assistant-test-profile",
  displayName: "Assistant Test Profile",
  description:
    "Safe example profile for validating the assistant automation pipeline with named commands and confirmation.",
  enabled: true,
  processNames: [],
  commands: [
    {
      commandId: "assistant_test_sequence",
      label: "Assistant Test Sequence",
      description:
        "Demonstrates background, sound, TTS, overlay, and screen shake actions without depending on any specific Live2D model.",
      aliases: ["assistant test", "test sequence"],
      category: "testing",
      enabled: true,
      cooldownMs: 0,
      maxDurationMs: 45_000,
      riskLevel: "harmless",
      allowedTriggerSources: ["manual", "vtuber"],
      autonomyPolicy: "confirmation_required",
      confirmationPolicy: "always",
      concurrencyPolicy: "reject_duplicates",
      defaultDryRun: true,
      steps: [
        {
          type: "set_background",
          backgroundId: "ceiling-window-room-night.jpeg",
        },
        { type: "play_sound", assetId: "assistant_test_ping", volume: 0.35 },
        {
          type: "speak_fixed",
          text: "Assistant automation test started.",
          interruptPolicy: "queue",
        },
        {
          type: "show_overlay",
          overlayId: "assistant_generic_overlay",
          durationMs: 1_500,
          placement: "center",
          animationName: "fade",
        },
        { type: "screen_shake", durationMs: 650, intensity: 4 },
        { type: "wait", milliseconds: 1_000 },
        { type: "remove_overlay", overlayId: "assistant_generic_overlay" },
        { type: "restore_background" },
        {
          type: "speak_fixed",
          text: "Assistant automation test complete.",
          interruptPolicy: "queue",
        },
      ],
    },
    {
      commandId: "assistant_test_key_input",
      label: "Assistant Test Key Input",
      description:
        "Disabled dry-run key input test. Review and change the key before allowing live input.",
      aliases: ["assistant key test"],
      category: "testing",
      enabled: false,
      cooldownMs: 0,
      maxDurationMs: 10_000,
      riskLevel: "low",
      allowedTriggerSources: ["manual"],
      autonomyPolicy: "disabled",
      confirmationPolicy: "always",
      concurrencyPolicy: "reject_duplicates",
      defaultDryRun: true,
      steps: [{ type: "key_press", key: "f8", durationMs: 120 }],
    },
  ],
});
