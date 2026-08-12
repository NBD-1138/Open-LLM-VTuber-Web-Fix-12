import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";
import { toaster } from "@/components/ui/toaster";
import { useAutomation } from "@/context/automation-context";
import type {
  AssistantSpeechMode,
  AutomationProfile,
  AutomationCommand,
  AutomationAction,
  AutomationProfileSelectionMode,
  AutomationProfileSummary,
  AutomationRuntimeStatus,
  ValidKeyIdentifier,
  VoiceCommandActivationMode,
  VoiceCommandAcknowledgementMode,
} from "../../../../../shared/automation/schema";
import {
  ASSISTANT_SPEECH_MODES,
  AutomationValidationError,
  AUTOMATION_AUTONOMY_POLICIES,
  AUTOMATION_CONCURRENCY_POLICIES,
  AUTOMATION_CONFIRMATION_POLICIES,
  AUTOMATION_PROFILE_SELECTION_MODES,
  AUTOMATION_RISK_LEVELS,
  AUTOMATION_TRIGGER_SOURCES,
  COMMAND_ID_PATTERN,
  OVERLAY_ANIMATIONS,
  OVERLAY_PLACEMENTS,
  VALID_KEY_IDENTIFIERS,
  VOICE_COMMAND_ACKNOWLEDGEMENT_MODES,
  VOICE_COMMAND_ACTIVATION_MODES,
  validateAutomationProfile,
} from "../../../../../shared/automation/schema";
import type {
  ImportedAutomationProfileReviewReport,
  VoiceAttackInspectionResult,
  VoiceAttackProfilePreview,
  VoiceAttackSourceFormat,
} from "../../../../../shared/automation/voiceattack";
import {
  buildImportedProfileReviewReport,
  getImportedCommandSupportStatus,
} from "../../../../../shared/automation/voiceattack";
import { settingStyles } from "./setting-styles";

interface AssistantProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "#1f2937",
  color: "#f8fafc",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "8px",
  padding: "8px 10px",
};

const outlineButtonStyle = {
  variant: "outline" as const,
  color: "#f8fafc",
  borderColor: "rgba(255,255,255,0.28)",
  bg: "rgba(255,255,255,0.02)",
  _hover: {
    bg: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.40)",
  },
  _active: {
    bg: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.40)",
  },
};

const dangerOutlineButtonStyle = {
  ...outlineButtonStyle,
  color: "#fca5a5",
  borderColor: "rgba(248,113,113,0.55)",
  bg: "rgba(248,113,113,0.03)",
  _hover: {
    bg: "rgba(248, 113, 113, 0.10)",
    borderColor: "rgba(252,165,165,0.72)",
  },
  _active: {
    bg: "rgba(248, 113, 113, 0.16)",
    borderColor: "rgba(252,165,165,0.72)",
  },
};

const smallButtonStyle = {
  size: "xs" as const,
  ...outlineButtonStyle,
};

const smallDangerButtonStyle = {
  size: "xs" as const,
  ...dangerOutlineButtonStyle,
};

const sectionCardProps = {
  p: 3,
  borderRadius: "lg",
  bg: "whiteAlpha.100",
  border: "1px solid",
  borderColor: "whiteAlpha.200",
} as const;

const insetCardProps = {
  p: 3,
  borderRadius: "md",
  bg: "rgba(15,23,42,0.55)",
  border: "1px solid rgba(255,255,255,0.08)",
} as const;

const detailsSummaryStyle: React.CSSProperties = {
  listStyle: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  color: "#f8fafc",
  fontWeight: 600,
};

const detailsMetaStyle: React.CSSProperties = {
  color: "rgba(248,250,252,0.72)",
  fontSize: "0.85rem",
  fontWeight: 500,
};

const formatVoiceAttackSourceFormat = (
  format: VoiceAttackSourceFormat,
): string => {
  switch (format) {
    case "vap_xml":
      return "VAP XML";
    case "vap_wrapped_binary":
      return "VAP wrapped binary";
    case "vax_container":
      return "VAX container";
    case "vax_wrapped_binary":
      return "VAX wrapped binary";
    default:
      return "Unknown";
  }
};

const formatVoiceAttackDecoderStatus = (status: string): string =>
  status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatVoiceAttackTriggerMode = (
  mode: VoiceAttackProfilePreview["commands"][number]["triggerMode"],
): string => {
  switch (mode) {
    case "spoken":
      return "Spoken";
    case "internal":
      return "Internal";
    case "hotkey":
      return "Hotkey";
    case "mixed":
      return "Mixed";
    default:
      return "Unknown";
  }
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  color: "#f8fafc",
};

const validationMessageStyle: React.CSSProperties = {
  color: "#fca5a5",
  fontSize: "0.82rem",
  marginTop: "6px",
};

const getValidatedFieldStyle = (hasError: boolean): React.CSSProperties =>
  hasError
    ? {
        ...fieldStyle,
        borderColor: "rgba(248,113,113,0.75)",
        boxShadow: "0 0 0 1px rgba(248,113,113,0.22)",
      }
    : fieldStyle;

const COMMAND_ID_RULE =
  "Use 2-64 lowercase letters, numbers, underscores, hyphens, or colons.";

const isModifierKeyIdentifier = (value: ValidKeyIdentifier): boolean =>
  ["ctrl", "alt", "shift", "meta"].includes(value);

const buildStepKeyCaptureId = (index: number): string => `step-key-${index}`;
const buildStepShortcutCaptureId = (index: number): string =>
  `step-shortcut-${index}`;

const extractCaptureStepIndex = (
  captureId: string,
  prefix: string,
): number | null => {
  if (!captureId.startsWith(prefix)) {
    return null;
  }
  const rawIndex = captureId.slice(prefix.length);
  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const captureModifierKeys = (event: KeyboardEvent) =>
  (["ctrl", "alt", "shift", "meta"] as const).filter((modifier) => {
    switch (modifier) {
      case "ctrl":
        return event.ctrlKey;
      case "alt":
        return event.altKey;
      case "shift":
        return event.shiftKey;
      case "meta":
        return event.metaKey;
      default:
        return false;
    }
  });

const STEP_TYPE_OPTIONS: AutomationAction["type"][] = [
  "wait",
  "play_sound",
  "write_log",
  "speak_fixed",
  "set_mic_state",
  "set_background",
  "restore_background",
  "show_overlay",
  "remove_overlay",
  "screen_shake",
  "key_press",
  "key_down",
  "key_up",
  "key_combination",
  "script",
  "run_macro",
];

const DEFAULT_SCRIPT_STEP = [
  "# Comments can start with # or //",
  "let delay_ms = 120",
  "if dry_run",
  '  log "Previewing the command."',
  "else",
  '  speak "Running the command now."',
  "  press f8 for delay_ms",
  "endif",
].join("\n");

const createBlankStep = (
  type: AutomationAction["type"] = "wait",
): AutomationAction => {
  switch (type) {
    case "wait":
      return { type: "wait", milliseconds: 1000 };
    case "play_sound":
      return {
        type: "play_sound",
        assetId: "assistant_test_ping",
        volume: 0.35,
      };
    case "write_log":
      return { type: "write_log", message: "Imported VoiceAttack log line." };
    case "speak_fixed":
      return {
        type: "speak_fixed",
        text: "Assistant says hello.",
        interruptPolicy: "queue",
      };
    case "set_mic_state":
      return { type: "set_mic_state", enabled: true };
    case "set_background":
      return {
        type: "set_background",
        backgroundId: "ceiling-window-room-night.jpeg",
      };
    case "restore_background":
      return { type: "restore_background" };
    case "show_overlay":
      return {
        type: "show_overlay",
        overlayId: "assistant_generic_overlay",
        durationMs: 1500,
        placement: "center",
        animationName: "fade",
      };
    case "remove_overlay":
      return { type: "remove_overlay", overlayId: "assistant_generic_overlay" };
    case "screen_shake":
      return { type: "screen_shake", durationMs: 650, intensity: 4 };
    case "key_press":
      return { type: "key_press", key: "f8", durationMs: 120 };
    case "key_down":
      return { type: "key_down", key: "shift" };
    case "key_up":
      return { type: "key_up", key: "shift" };
    case "key_combination":
      return { type: "key_combination", modifiers: ["ctrl"], key: "a" };
    case "script":
      return { type: "script", script: DEFAULT_SCRIPT_STEP };
    case "run_macro":
      return { type: "run_macro", commandId: "assistant_test_sequence" };
    default:
      return { type: "wait", milliseconds: 1000 };
  }
};

const createBlankCommand = (): AutomationCommand => ({
  commandId: `command_${Date.now()}`,
  label: "New Command",
  description: "",
  aliases: [],
  category: "general",
  enabled: false,
  cooldownMs: 0,
  maxDurationMs: 30_000,
  riskLevel: "low",
  allowedTriggerSources: ["manual"],
  autonomyPolicy: "disabled",
  confirmationPolicy: "always",
  concurrencyPolicy: "reject_duplicates",
  defaultDryRun: true,
  steps: [createBlankStep("wait")],
});

const createBlankProfile = (profileId: string): AutomationProfile => ({
  schemaVersion: 1,
  profileId,
  displayName: DEFAULT_PROFILE_DISPLAY_NAME,
  description: "",
  enabled: false,
  processNames: [],
  commands: [createBlankCommand()],
});

const commandAllowsPlayerVoiceExecution = (
  command: AutomationCommand | null | undefined,
): boolean => {
  if (!command) {
    return false;
  }
  return command.allowedTriggerSources.includes("player_voice");
};

const applyVoiceReadyDefaultsToCommand = (
  command: AutomationCommand,
): AutomationCommand => ({
  ...command,
  enabled: true,
  allowedTriggerSources: Array.from(
    new Set([...command.allowedTriggerSources, "player_voice"]),
  ),
  autonomyPolicy:
    command.autonomyPolicy === "autonomous" ||
    command.autonomyPolicy === "confirmation_required"
      ? command.autonomyPolicy
      : "confirmation_required",
});

const eventToKeyIdentifier = (
  event: KeyboardEvent,
): ValidKeyIdentifier | null => {
  const key = event.key.toLowerCase();
  if (key.length === 1 && /^[a-z0-9]$/.test(key)) {
    return key as ValidKeyIdentifier;
  }
  const namedKeys: Record<string, ValidKeyIdentifier> = {
    escape: "escape",
    esc: "escape",
    enter: "enter",
    tab: "tab",
    " ": "space",
    spacebar: "space",
    backspace: "backspace",
    delete: "delete",
    home: "home",
    end: "end",
    pageup: "page_up",
    pagedown: "page_down",
    insert: "insert",
    arrowup: "arrow_up",
    arrowdown: "arrow_down",
    arrowleft: "arrow_left",
    arrowright: "arrow_right",
    shift: "shift",
    control: "ctrl",
    alt: "alt",
    meta: "meta",
  };
  if (namedKeys[key]) {
    return namedKeys[key];
  }
  if (
    /^f\d{1,2}$/.test(key) &&
    VALID_KEY_IDENTIFIERS.includes(key as ValidKeyIdentifier)
  ) {
    return key as ValidKeyIdentifier;
  }
  return null;
};

const selectStyles: React.CSSProperties = {
  ...fieldStyle,
  minHeight: "36px",
};

const optionStyles: React.CSSProperties = {
  background: "#111827",
  color: "#f8fafc",
};

const readOnlyFieldStyle: React.CSSProperties = {
  ...fieldStyle,
  background: "#111827",
  color: "#cbd5f5",
};

const phraseListToText = (phrases: string[]): string => phrases.join(", ");

const parsePhraseList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(
      (item, index, list) => item.length > 0 && list.indexOf(item) === index,
    );

const formatCountdown = (expiresAt: string, nowMs: number): string => {
  const remainingMs = Math.max(0, Date.parse(expiresAt) - nowMs);
  return `${Math.ceil(remainingMs / 1000)}s`;
};

const thresholdListToText = (thresholds: number[]): string =>
  thresholds.join(", ");

const parseThresholdList = (value: string): number[] =>
  value
    .split(/[\n,]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.max(1, Math.min(100, Math.round(item))))
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((left, right) => right - left);

const formatTelemetryDirectory = (value: string | null): string => {
  if (!value) {
    return "";
  }
  const segments = value.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-3).join("\\");
};

const formatTelemetryPercent = (value: number | null | undefined): string =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "Unknown";

type VoiceAttackSupportFilter =
  | "all"
  | "supported"
  | "partially_supported"
  | "unsupported";
type VoiceAttackSupportStatus = Exclude<VoiceAttackSupportFilter, "all">;
type EditorCommandSupportStatus = VoiceAttackSupportStatus | "manual";
type EditorCommandSupportFilter = VoiceAttackSupportFilter | "manual";

const DEFAULT_PROFILE_DISPLAY_NAME = "New Assistant Profile";

const PROFILE_ID_FALLBACK = "assistant-profile";

const slugifyProfileIdBase = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const candidate = normalized || PROFILE_ID_FALLBACK;
  const trimmed = candidate.slice(0, 64).replace(/-+$/g, "");
  return trimmed || PROFILE_ID_FALLBACK;
};

const appendProfileIdSuffix = (base: string, suffix: number): string => {
  const suffixText = `-${suffix}`;
  const maxBaseLength = Math.max(2, 64 - suffixText.length);
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, "");
  return `${trimmedBase || PROFILE_ID_FALLBACK}${suffixText}`;
};

const deriveUniqueProfileId = (
  displayName: string,
  existingProfileIds: string[],
  options: {
    currentProfileId?: string | null;
    persistedProfileId?: string | null;
  } = {},
): string => {
  const base = slugifyProfileIdBase(
    displayName || DEFAULT_PROFILE_DISPLAY_NAME,
  );
  const blockedIds = new Set(
    existingProfileIds.filter(
      (profileId) =>
        profileId !== options.currentProfileId &&
        profileId !== options.persistedProfileId,
    ),
  );

  if (!blockedIds.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = appendProfileIdSuffix(base, suffix);
    if (!blockedIds.has(candidate)) {
      return candidate;
    }
  }

  return appendProfileIdSuffix(base, Date.now() % 10_000);
};

const summarizeVoiceAttackCommandSearch = (
  command: VoiceAttackProfilePreview["commands"][number],
): string =>
  [
    command.label,
    command.commandId,
    command.description,
    command.aliases.join(" "),
    command.category,
    command.actionTypes.join(" "),
    command.actionSummaries.join(" "),
    command.warnings.join(" "),
  ]
    .join(" ")
    .toLowerCase();

const summarizeDraftCommandSearch = (command: AutomationCommand): string =>
  [
    command.label,
    command.commandId,
    command.description,
    command.category,
    command.aliases.join(" "),
    command.allowedTriggerSources.join(" "),
    command.steps.map((step) => step.type).join(" "),
  ]
    .join(" ")
    .toLowerCase();

type VoiceAttackPreviewCommand = VoiceAttackProfilePreview["commands"][number];
type VoiceAttackPreviewAction = VoiceAttackPreviewCommand["actions"][number];

interface VoiceAttackSupportReasonSummary {
  supportStatus: VoiceAttackPreviewAction["supportStatus"];
  summary: string;
  count: number;
  actionTypes: string[];
}

const formatImportSupportStatus = (
  status: VoiceAttackPreviewCommand["supportStatus"],
): string => status.replace(/_/g, " ");

const formatEditorCommandSupportStatus = (
  status: EditorCommandSupportStatus,
): string =>
  status === "manual" ? "manual" : formatImportSupportStatus(status);

const getDraftCommandSupportStatus = (
  command: AutomationCommand,
  imported: boolean,
): EditorCommandSupportStatus =>
  imported ? getImportedCommandSupportStatus(command) : "manual";

const formatSupportTone = (
  status: VoiceAttackProfilePreview["commands"][number]["supportStatus"],
): string => {
  if (status === "supported") {
    return "#86efac";
  }
  if (status === "partially_supported") {
    return "#fcd34d";
  }
  return "#fca5a5";
};

const buildVoiceAttackSupportReasonSummaries = (
  command: VoiceAttackPreviewCommand,
): VoiceAttackSupportReasonSummary[] => {
  const groupedReasons = new Map<string, VoiceAttackSupportReasonSummary>();

  for (const action of command.actions) {
    if (action.supportStatus === "supported") {
      continue;
    }

    const reasonKey = `${action.supportStatus}:${action.summary}`;
    const existing = groupedReasons.get(reasonKey);
    if (existing) {
      existing.count += 1;
      if (!existing.actionTypes.includes(action.actionType)) {
        existing.actionTypes.push(action.actionType);
      }
      continue;
    }

    groupedReasons.set(reasonKey, {
      supportStatus: action.supportStatus,
      summary: action.summary,
      count: 1,
      actionTypes: [action.actionType],
    });
  }

  const supportPriority = {
    unsupported: 0,
    partially_supported: 1,
    supported: 2,
  } satisfies Record<VoiceAttackPreviewAction["supportStatus"], number>;

  return Array.from(groupedReasons.values()).sort((left, right) => {
    const bySupport =
      supportPriority[left.supportStatus] -
      supportPriority[right.supportStatus];
    if (bySupport !== 0) {
      return bySupport;
    }
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.summary.localeCompare(right.summary);
  });
};

const summarizeAutomationStep = (step: AutomationAction): string => {
  switch (step.type) {
    case "wait":
      return `${step.milliseconds} ms delay`;
    case "play_sound":
      return `play ${step.assetId ?? "sound asset"}`;
    case "write_log":
      return step.message || "write empty log line";
    case "speak_fixed":
      return step.text || "speak fixed text";
    case "set_mic_state":
      return step.enabled ? "unmute microphone" : "mute microphone";
    case "set_background":
      return `background ${step.backgroundId}`;
    case "restore_background":
      return "restore previous background";
    case "show_overlay":
      return `${step.overlayId} for ${step.durationMs} ms`;
    case "remove_overlay":
      return `remove ${step.overlayId}`;
    case "screen_shake":
      return `${step.durationMs} ms @ ${step.intensity}`;
    case "key_press":
      return `${step.key}${step.durationMs ? ` for ${step.durationMs} ms` : ""}`;
    case "key_down":
      return `hold ${step.key}`;
    case "key_up":
      return `release ${step.key}`;
    case "key_combination":
      return `${step.modifiers.join("+")}${step.modifiers.length ? "+" : ""}${step.key}`;
    case "script": {
      const nonEmptyLines = step.script
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const preview = nonEmptyLines[0] ?? "empty script";
      return nonEmptyLines.length > 1
        ? `script (${nonEmptyLines.length} lines): ${preview}`
        : `script: ${preview}`;
    }
    case "run_macro":
      return `run command ${step.commandId}`;
    case "unsupported_import_action":
      return `${step.sourceType}: ${step.summary}`;
    case "response_placeholder":
      return `placeholder (${step.replacementMode})`;
    default: {
      const exhaustiveCheck: never = step;
      return String(exhaustiveCheck);
    }
  }
};

const llmAccessColorMap: Record<string, string> = {
  none: "#f87171",
  suggest: "#facc15",
  request_confirmation: "#60a5fa",
  autonomous: "#4ade80",
};

function Assistant({ onSave, onCancel }: AssistantProps): JSX.Element {
  const { t } = useTranslation();
  const {
    available,
    snapshot,
    assistantState,
    backendConnected,
    getProfile,
    saveProfile,
    deleteProfile,
    executeCommand,
    cancel,
    emergencyStop,
    resetEmergencyStop,
    updateSettings,
    importProfiles,
    inspectVoiceAttackSource,
    previewVoiceAttackImport,
    exportVoiceAttackDiagnosticReport,
    importVoiceAttackProfile,
    cancelVoiceAttackImport,
    markImportedProfileReviewed,
    exportProfile,
    selectTelemetryDirectory,
    voiceCommandResolveResult,
    setVoiceCommandListeningActive,
    resolveVoiceCommandTest,
    respondToVoiceCommandAmbiguity,
    respondToAssistantConfirmation,
  } = useAutomation();

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(
    null,
  );
  const [draftProfile, setDraftProfile] = useState<AutomationProfile | null>(
    null,
  );
  const [savedProfileSnapshot, setSavedProfileSnapshot] =
    useState<AutomationProfile | null>(null);
  const [dryRunDraft, setDryRunDraft] = useState<boolean>(true);
  const [hotkeyDraft, setHotkeyDraft] = useState<string>(
    "CommandOrControl+Alt+Shift+F12",
  );
  const [llmAutomationEnabledDraft, setLlmAutomationEnabledDraft] =
    useState(false);
  const [allowAutonomousHarmlessDraft, setAllowAutonomousHarmlessDraft] =
    useState(false);
  const [allowAutonomousLowRiskDraft, setAllowAutonomousLowRiskDraft] =
    useState(false);
  const [profileSelectionModeDraft, setProfileSelectionModeDraft] =
    useState<AutomationProfileSelectionMode>("manual");
  const [manualProfileIdDraft, setManualProfileIdDraft] = useState<
    string | null
  >(null);
  const [defaultSpeechModeDraft, setDefaultSpeechModeDraft] =
    useState<AssistantSpeechMode>("action");
  const [proactiveCommentaryDraft, setProactiveCommentaryDraft] =
    useState(false);
  const [minimumCommentaryIntervalDraft, setMinimumCommentaryIntervalDraft] =
    useState("15000");
  const [
    maxQueuedConversationEventsDraft,
    setMaxQueuedConversationEventsDraft,
  ] = useState("5");
  const [announceApplicationChangesDraft, setAnnounceApplicationChangesDraft] =
    useState(false);
  const [
    acknowledgeRoutineAutomationSuccessDraft,
    setAcknowledgeRoutineAutomationSuccessDraft,
  ] = useState(false);
  const [confirmationTimeoutDraft, setConfirmationTimeoutDraft] =
    useState<string>("10000");
  const [maxPendingConfirmationsDraft, setMaxPendingConfirmationsDraft] =
    useState<string>("1");
  const [
    announceBlockedCommandRequestsDraft,
    setAnnounceBlockedCommandRequestsDraft,
  ] = useState(false);
  const [includeCommandSuggestionsDraft, setIncludeCommandSuggestionsDraft] =
    useState(true);
  const [resultAcknowledgementsDraft, setResultAcknowledgementsDraft] =
    useState(false);
  const [confirmationPhrasesDraft, setConfirmationPhrasesDraft] = useState(
    "confirm, do it, yes, run it",
  );
  const [cancellationPhrasesDraft, setCancellationPhrasesDraft] = useState(
    "cancel, never mind, stop",
  );
  const [voiceCommandActivationModeDraft, setVoiceCommandActivationModeDraft] =
    useState<VoiceCommandActivationMode>("wake_phrase");
  const [voiceCommandWakePhrasesDraft, setVoiceCommandWakePhrasesDraft] =
    useState("assistant, computer");
  const [
    voiceCommandPushToCommandHotkeyDraft,
    setVoiceCommandPushToCommandHotkeyDraft,
  ] = useState("CommandOrControl+Alt+Shift+F11");
  const [
    voiceCommandAmbiguityTimeoutDraft,
    setVoiceCommandAmbiguityTimeoutDraft,
  ] = useState("15000");
  const [
    voiceCommandAcknowledgementModeDraft,
    setVoiceCommandAcknowledgementModeDraft,
  ] = useState<VoiceCommandAcknowledgementMode>("none");
  const [telemetryEnabledDraft, setTelemetryEnabledDraft] = useState(true);
  const [automaticJournalDiscoveryDraft, setAutomaticJournalDiscoveryDraft] =
    useState(true);
  const [manualJournalDirectoryDraft, setManualJournalDirectoryDraft] =
    useState<string | null>(null);
  const [lowFuelThresholdDraft, setLowFuelThresholdDraft] = useState("25");
  const [criticalFuelThresholdDraft, setCriticalFuelThresholdDraft] =
    useState("10");
  const [hullThresholdsDraft, setHullThresholdsDraft] =
    useState("75, 50, 25, 10");
  const [
    explorationTelemetryCooldownDraft,
    setExplorationTelemetryCooldownDraft,
  ] = useState("90000");
  const [announceDockingEventsDraft, setAnnounceDockingEventsDraft] =
    useState(true);
  const [announceJumpEventsDraft, setAnnounceJumpEventsDraft] = useState(true);
  const [announceMissionEventsDraft, setAnnounceMissionEventsDraft] =
    useState(true);
  const [announceDiscoveriesDraft, setAnnounceDiscoveriesDraft] =
    useState(true);
  const [announceMaterialCollectionDraft, setAnnounceMaterialCollectionDraft] =
    useState(false);
  const [newStepTypeDraft, setNewStepTypeDraft] =
    useState<AutomationAction["type"]>("wait");
  const [commandEditorOpen, setCommandEditorOpen] = useState(true);
  const [capturingField, setCapturingField] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [profileEditorDialogOpen, setProfileEditorDialogOpen] = useState(false);
  const [profileEditorContentReady, setProfileEditorContentReady] =
    useState(false);
  const [voiceAttackDialogOpen, setVoiceAttackDialogOpen] = useState(false);
  const [voiceAttackInspection, setVoiceAttackInspection] =
    useState<VoiceAttackInspectionResult | null>(null);
  const [voiceAttackPreview, setVoiceAttackPreview] =
    useState<VoiceAttackProfilePreview | null>(null);
  const [selectedVoiceAttackCandidateId, setSelectedVoiceAttackCandidateId] =
    useState<string | null>(null);
  const [selectedVoiceAttackCommandIds, setSelectedVoiceAttackCommandIds] =
    useState<string[]>([]);
  const [
    selectedVoiceAttackPreviewCommandId,
    setSelectedVoiceAttackPreviewCommandId,
  ] = useState<string | null>(null);
  const [voiceAttackSupportFilter, setVoiceAttackSupportFilter] =
    useState<VoiceAttackSupportFilter>("all");
  const [voiceAttackSearchDraft, setVoiceAttackSearchDraft] = useState("");
  const [voiceAttackBusyLabel, setVoiceAttackBusyLabel] = useState<
    string | null
  >(null);
  const [voiceAttackPreviewStatus, setVoiceAttackPreviewStatus] = useState<{
    type: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const [voiceCommandTestDraft, setVoiceCommandTestDraft] = useState("");
  const [editorCommandSearchDraft, setEditorCommandSearchDraft] = useState("");
  const [editorCommandSupportFilter, setEditorCommandSupportFilter] =
    useState<EditorCommandSupportFilter>("all");
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const deferredEditorCommandSearchDraft = useDeferredValue(
    editorCommandSearchDraft,
  );
  const draftProfileRef = useRef<AutomationProfile | null>(null);
  const pendingEditorProfileIdRef = useRef<string | null>(null);
  const profileWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const profileEditorRef = useRef<HTMLDivElement | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);

  const currentCommand = useMemo(
    () =>
      draftProfile?.commands.find(
        (command) => command.commandId === selectedCommandId,
      ) ?? null,
    [draftProfile, selectedCommandId],
  );

  const draftValidationError = useMemo(() => {
    if (!draftProfile) {
      return null;
    }
    try {
      validateAutomationProfile(draftProfile);
      return null;
    } catch (error) {
      return error instanceof AutomationValidationError
        ? error.message
        : "This profile has invalid values and cannot be saved yet.";
    }
  }, [draftProfile]);

  const voiceAttackReviewReport =
    useMemo<ImportedAutomationProfileReviewReport | null>(() => {
      if (!draftProfile?.importMetadata?.imported) {
        return null;
      }
      return buildImportedProfileReviewReport(draftProfile);
    }, [draftProfile]);

  const displayNameError = useMemo(() => {
    if (!draftProfile) {
      return null;
    }
    const trimmed = draftProfile.displayName.trim();
    if (!trimmed) {
      return "Display name is required.";
    }
    return null;
  }, [draftProfile]);

  const commandIdError = useMemo(() => {
    if (!draftProfile || !currentCommand) {
      return null;
    }
    const trimmed = currentCommand.commandId.trim();
    if (!trimmed) {
      return "Command ID is required.";
    }
    if (!COMMAND_ID_PATTERN.test(trimmed)) {
      return COMMAND_ID_RULE;
    }
    const matchingCommands = draftProfile.commands.filter(
      (command) => command.commandId === trimmed,
    );
    if (matchingCommands.length > 1) {
      return "Each command in a profile needs a unique Command ID.";
    }
    return null;
  }, [currentCommand, draftProfile]);

  const selectedStep = currentCommand?.steps[selectedStepIndex] ?? null;

  const profileOptions = useMemo<AutomationProfileSummary[]>(() => {
    const persistedProfiles = snapshot?.profiles ?? [];
    if (
      !draftProfile ||
      persistedProfiles.some(
        (profile) => profile.profileId === draftProfile.profileId,
      )
    ) {
      return persistedProfiles;
    }

    return [
      {
        profileId: draftProfile.profileId,
        displayName:
          draftProfile.displayName ||
          draftProfile.profileId ||
          "Unsaved profile",
        enabled: draftProfile.enabled,
        processNames: [...draftProfile.processNames],
        commands: draftProfile.commands.map((command) => ({
          commandId: command.commandId,
          label: command.label,
          enabled: command.enabled,
        })),
      },
      ...persistedProfiles,
    ];
  }, [draftProfile, snapshot?.profiles]);

  const draftProfileImported = Boolean(draftProfile?.importMetadata?.imported);
  const filteredDraftCommands = useMemo(() => {
    if (!draftProfile || !profileEditorDialogOpen) {
      return [];
    }
    const query = deferredEditorCommandSearchDraft.trim().toLowerCase();
    return draftProfile.commands.filter((command) => {
      const supportStatus = getDraftCommandSupportStatus(
        command,
        draftProfileImported,
      );
      if (
        editorCommandSupportFilter !== "all" &&
        supportStatus !== editorCommandSupportFilter
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return summarizeDraftCommandSearch(command).includes(query);
    });
  }, [
    deferredEditorCommandSearchDraft,
    draftProfile,
    draftProfileImported,
    editorCommandSupportFilter,
    profileEditorDialogOpen,
  ]);
  const filteredDraftCommandIds = useMemo(
    () => filteredDraftCommands.map((command) => command.commandId),
    [filteredDraftCommands],
  );
  const filteredDraftReviewableCommandIds = useMemo(
    () =>
      filteredDraftCommands
        .filter(
          (command) =>
            getDraftCommandSupportStatus(command, draftProfileImported) !==
            "unsupported",
        )
        .map((command) => command.commandId),
    [draftProfileImported, filteredDraftCommands],
  );
  const enabledFilteredDraftCommandCount = useMemo(
    () => filteredDraftCommands.filter((command) => command.enabled).length,
    [filteredDraftCommands],
  );
  const enabledDraftCommandCount = useMemo(
    () =>
      draftProfile?.commands.filter((command) => command.enabled).length ?? 0,
    [draftProfile],
  );

  useEffect(() => {
    draftProfileRef.current = draftProfile;
  }, [draftProfile]);

  useEffect(() => {
    if (!profileEditorDialogOpen) {
      setProfileEditorContentReady(false);
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setProfileEditorContentReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [profileEditorDialogOpen]);

  useEffect(() => {
    if (selectedCommandId) {
      setCommandEditorOpen(true);
    }
  }, [selectedCommandId]);

  useEffect(() => {
    if (!currentCommand) {
      setSelectedStepIndex(0);
      return;
    }
    setSelectedStepIndex((current) =>
      Math.min(current, Math.max(0, currentCommand.steps.length - 1)),
    );
  }, [currentCommand?.commandId, currentCommand?.steps.length]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    setDryRunDraft(snapshot.dryRun);
    setHotkeyDraft(snapshot.emergencyStopHotkey);
    setLlmAutomationEnabledDraft(snapshot.llmAutomationEnabled);
    setAllowAutonomousHarmlessDraft(snapshot.allowAutonomousHarmlessCommands);
    setAllowAutonomousLowRiskDraft(snapshot.allowAutonomousLowRiskCommands);
    setProfileSelectionModeDraft(snapshot.profileSelectionMode);
    setManualProfileIdDraft(snapshot.manualProfileId);
    setDefaultSpeechModeDraft(snapshot.defaultSpeechMode);
    setProactiveCommentaryDraft(snapshot.proactiveCommentaryEnabled);
    setMinimumCommentaryIntervalDraft(
      String(snapshot.minimumCommentaryIntervalMs),
    );
    setMaxQueuedConversationEventsDraft(
      String(snapshot.maxQueuedConversationEvents),
    );
    setAnnounceApplicationChangesDraft(snapshot.announceApplicationChanges);
    setAcknowledgeRoutineAutomationSuccessDraft(
      snapshot.acknowledgeRoutineAutomationSuccess,
    );
    setConfirmationTimeoutDraft(String(snapshot.confirmationTimeoutMs));
    setMaxPendingConfirmationsDraft(String(snapshot.maxPendingConfirmations));
    setAnnounceBlockedCommandRequestsDraft(
      snapshot.announceBlockedCommandRequests,
    );
    setIncludeCommandSuggestionsDraft(
      snapshot.includeCommandSuggestionsInSpeech,
    );
    setResultAcknowledgementsDraft(snapshot.resultAcknowledgementsEnabled);
    setConfirmationPhrasesDraft(phraseListToText(snapshot.confirmationPhrases));
    setCancellationPhrasesDraft(phraseListToText(snapshot.cancellationPhrases));
    setVoiceCommandActivationModeDraft(snapshot.voiceCommandActivationMode);
    setVoiceCommandWakePhrasesDraft(
      phraseListToText(snapshot.voiceCommandWakePhrases),
    );
    setVoiceCommandPushToCommandHotkeyDraft(
      snapshot.voiceCommandPushToCommandHotkey,
    );
    setVoiceCommandAmbiguityTimeoutDraft(
      String(snapshot.voiceCommandAmbiguityTimeoutMs),
    );
    setVoiceCommandAcknowledgementModeDraft(
      snapshot.voiceCommandAcknowledgementMode,
    );
    setTelemetryEnabledDraft(snapshot.telemetry.enabled);
    setAutomaticJournalDiscoveryDraft(
      snapshot.telemetry.automaticJournalDiscovery,
    );
    setManualJournalDirectoryDraft(snapshot.telemetry.manualJournalDirectory);
    setLowFuelThresholdDraft(
      String(Math.round(snapshot.telemetry.lowFuelThreshold * 100)),
    );
    setCriticalFuelThresholdDraft(
      String(Math.round(snapshot.telemetry.criticalFuelThreshold * 100)),
    );
    setHullThresholdsDraft(
      thresholdListToText(snapshot.telemetry.hullWarningThresholds),
    );
    setExplorationTelemetryCooldownDraft(
      String(snapshot.telemetry.explorationCommentaryCooldownMs),
    );
    setAnnounceDockingEventsDraft(
      snapshot.telemetry.commentary.announceDockingEvents,
    );
    setAnnounceJumpEventsDraft(
      snapshot.telemetry.commentary.announceJumpEvents,
    );
    setAnnounceMissionEventsDraft(
      snapshot.telemetry.commentary.announceMissionEvents,
    );
    setAnnounceDiscoveriesDraft(
      snapshot.telemetry.commentary.announceDiscoveries,
    );
    setAnnounceMaterialCollectionDraft(
      snapshot.telemetry.commentary.announceMaterialCollection,
    );
    if (!selectedProfileId) {
      setSelectedProfileId(
        snapshot.activeProfileId || snapshot.profiles[0]?.profileId || null,
      );
    }
  }, [snapshot, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId) {
      setDraftProfile(null);
      setSavedProfileSnapshot(null);
      return;
    }
    const currentDraftProfile = draftProfileRef.current;
    const persistedProfileExists =
      snapshot?.profiles.some(
        (profile) => profile.profileId === selectedProfileId,
      ) ?? false;
    if (
      !persistedProfileExists &&
      currentDraftProfile?.profileId === selectedProfileId
    ) {
      setSelectedCommandId((currentSelectedCommandId) =>
        currentDraftProfile.commands.some(
          (command) => command.commandId === currentSelectedCommandId,
        )
          ? currentSelectedCommandId
          : (currentDraftProfile.commands[0]?.commandId ?? null),
      );
      return;
    }
    let mounted = true;
    void getProfile(selectedProfileId).then((profile) => {
      if (!mounted) {
        return;
      }
      setDraftProfile(profile ? structuredClone(profile) : null);
      setSavedProfileSnapshot(profile ? structuredClone(profile) : null);
      setSelectedCommandId(profile?.commands[0]?.commandId ?? null);
    });
    return () => {
      mounted = false;
    };
  }, [getProfile, selectedProfileId, snapshot?.profiles]);

  useEffect(() => {
    if (!draftProfile) {
      return;
    }
    if (
      !selectedCommandId ||
      !draftProfile.commands.find(
        (command) => command.commandId === selectedCommandId,
      )
    ) {
      setSelectedCommandId(draftProfile.commands[0]?.commandId ?? null);
    }
  }, [draftProfile, selectedCommandId]);

  useEffect(() => {
    if (!draftProfile) {
      return;
    }
    if (pendingEditorProfileIdRef.current !== draftProfile.profileId) {
      return;
    }
    pendingEditorProfileIdRef.current = null;
    window.requestAnimationFrame(() => {
      scrollProfileEditorIntoView();
    });
  }, [draftProfile]);

  useEffect(() => {
    if (!assistantState?.pendingConfirmations.length) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [assistantState?.pendingConfirmations.length]);

  useEffect(() => {
    if (!capturingField) {
      return undefined;
    }
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      const key = eventToKeyIdentifier(event);
      if (!key) {
        return;
      }
      const keyCaptureIndex = extractCaptureStepIndex(
        capturingField,
        "step-key-",
      );
      const shortcutCaptureIndex = extractCaptureStepIndex(
        capturingField,
        "step-shortcut-",
      );

      if (shortcutCaptureIndex !== null && isModifierKeyIdentifier(key)) {
        return;
      }

      updateCurrentCommand((command) => ({
        ...command,
        steps: command.steps.map((step, index) => {
          if (keyCaptureIndex === index) {
            if (
              step.type === "key_press" ||
              step.type === "key_down" ||
              step.type === "key_up"
            ) {
              return { ...step, key };
            }
            if (step.type === "key_combination") {
              return { ...step, key };
            }
          }

          if (
            shortcutCaptureIndex === index &&
            step.type === "key_combination"
          ) {
            return {
              ...step,
              key,
              modifiers: captureModifierKeys(event),
            };
          }
          return step;
        }),
      }));
      setCapturingField(null);
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [capturingField, currentCommand]);

  useEffect(() => {
    if (!onSave || !onCancel) {
      return;
    }
    const cleanupSave = onSave(() => {
      void handleSave();
    });
    const cleanupCancel = onCancel(() => {
      handleCancel();
    });
    return () => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [
    onSave,
    onCancel,
    draftProfile,
    savedProfileSnapshot,
    dryRunDraft,
    hotkeyDraft,
    llmAutomationEnabledDraft,
    allowAutonomousHarmlessDraft,
    allowAutonomousLowRiskDraft,
    profileSelectionModeDraft,
    manualProfileIdDraft,
    defaultSpeechModeDraft,
    proactiveCommentaryDraft,
    minimumCommentaryIntervalDraft,
    maxQueuedConversationEventsDraft,
    announceApplicationChangesDraft,
    acknowledgeRoutineAutomationSuccessDraft,
    confirmationTimeoutDraft,
    maxPendingConfirmationsDraft,
    announceBlockedCommandRequestsDraft,
    includeCommandSuggestionsDraft,
    resultAcknowledgementsDraft,
    confirmationPhrasesDraft,
    cancellationPhrasesDraft,
    voiceCommandActivationModeDraft,
    voiceCommandWakePhrasesDraft,
    voiceCommandPushToCommandHotkeyDraft,
    voiceCommandAmbiguityTimeoutDraft,
    voiceCommandAcknowledgementModeDraft,
    telemetryEnabledDraft,
    automaticJournalDiscoveryDraft,
    manualJournalDirectoryDraft,
    lowFuelThresholdDraft,
    criticalFuelThresholdDraft,
    hullThresholdsDraft,
    explorationTelemetryCooldownDraft,
    announceDockingEventsDraft,
    announceJumpEventsDraft,
    announceMissionEventsDraft,
    announceDiscoveriesDraft,
    announceMaterialCollectionDraft,
  ]);

  const updateDraftProfile = (
    updater: (profile: AutomationProfile) => AutomationProfile,
  ) => {
    setDraftProfile((current) =>
      current ? updater(structuredClone(current)) : current,
    );
  };

  const updateCurrentCommand = (
    updater: (command: AutomationCommand) => AutomationCommand,
  ) => {
    let nextSelectedCommandId = selectedCommandId;
    updateDraftProfile((profile) => ({
      ...profile,
      commands: profile.commands.map((command) => {
        if (command.commandId !== selectedCommandId) {
          return command;
        }
        const updatedCommand = updater(command);
        nextSelectedCommandId = updatedCommand.commandId;
        return updatedCommand;
      }),
    }));
    if (nextSelectedCommandId !== selectedCommandId) {
      setSelectedCommandId(nextSelectedCommandId ?? null);
    }
  };

  const setDraftCommandsEnabled = (commandIds: string[], enabled: boolean) => {
    if (commandIds.length === 0) {
      return;
    }
    const commandIdSet = new Set(commandIds);
    updateDraftProfile((profile) => ({
      ...profile,
      commands: profile.commands.map((command) =>
        commandIdSet.has(command.commandId) ? { ...command, enabled } : command,
      ),
    }));
  };

  const updateProfileDisplayName = (nextDisplayName: string) => {
    if (!draftProfile) {
      return;
    }
    const previousProfileId = draftProfile.profileId;
    const nextProfileId = deriveUniqueProfileId(
      nextDisplayName,
      (snapshot?.profiles ?? []).map((profile) => profile.profileId),
      {
        currentProfileId: draftProfile.profileId,
        persistedProfileId: savedProfileSnapshot?.profileId ?? null,
      },
    );
    updateDraftProfile((profile) => ({
      ...profile,
      displayName: nextDisplayName,
      profileId: nextProfileId,
    }));
    if (!selectedProfileId || selectedProfileId === previousProfileId) {
      setSelectedProfileId(nextProfileId);
    }
    if (manualProfileIdDraft === previousProfileId) {
      setManualProfileIdDraft(nextProfileId);
    }
    if (pendingEditorProfileIdRef.current === previousProfileId) {
      pendingEditorProfileIdRef.current = nextProfileId;
    }
  };

  const persistDraftProfile = async (): Promise<AutomationProfile | null> => {
    if (!draftProfile) {
      return null;
    }
    const validatedDraft = validateAutomationProfile(draftProfile);
    const previousSavedProfileId = savedProfileSnapshot?.profileId ?? null;
    const previousSavedProfileExists = previousSavedProfileId
      ? (snapshot?.profiles.some(
          (profile) => profile.profileId === previousSavedProfileId,
        ) ?? false)
      : false;
    const saved = await saveProfile(validatedDraft);
    if (
      previousSavedProfileExists &&
      previousSavedProfileId &&
      previousSavedProfileId !== saved.profileId
    ) {
      await deleteProfile(previousSavedProfileId);
      if (manualProfileIdDraft === previousSavedProfileId) {
        setManualProfileIdDraft(saved.profileId);
      }
    }
    const nextCommandId = saved.commands.some(
      (command) => command.commandId === selectedCommandId,
    )
      ? selectedCommandId
      : (saved.commands[0]?.commandId ?? null);
    setDraftProfile(structuredClone(saved));
    setSavedProfileSnapshot(structuredClone(saved));
    setSelectedProfileId(saved.profileId);
    setSelectedCommandId(nextCommandId);
    return saved;
  };

  const handleSave = async () => {
    try {
      const previousSavedProfileId = savedProfileSnapshot?.profileId ?? null;
      const savedProfile = await persistDraftProfile();
      const nextManualProfileId =
        savedProfile &&
        previousSavedProfileId &&
        manualProfileIdDraft === previousSavedProfileId
          ? savedProfile.profileId
          : manualProfileIdDraft;
      await updateSettings({
        dryRun: dryRunDraft,
        emergencyStopHotkey: hotkeyDraft,
        llmAutomationEnabled: llmAutomationEnabledDraft,
        allowAutonomousHarmlessCommands: allowAutonomousHarmlessDraft,
        allowAutonomousLowRiskCommands: allowAutonomousLowRiskDraft,
        profileSelectionMode: profileSelectionModeDraft,
        manualProfileId: nextManualProfileId,
        defaultSpeechMode: defaultSpeechModeDraft,
        proactiveCommentaryEnabled: proactiveCommentaryDraft,
        minimumCommentaryIntervalMs:
          Number(minimumCommentaryIntervalDraft) || 15_000,
        maxQueuedConversationEvents:
          Number(maxQueuedConversationEventsDraft) || 5,
        announceApplicationChanges: announceApplicationChangesDraft,
        acknowledgeRoutineAutomationSuccess:
          acknowledgeRoutineAutomationSuccessDraft,
        confirmationTimeoutMs: Number(confirmationTimeoutDraft) || 10_000,
        maxPendingConfirmations: Number(maxPendingConfirmationsDraft) || 1,
        announceBlockedCommandRequests: announceBlockedCommandRequestsDraft,
        includeCommandSuggestionsInSpeech: includeCommandSuggestionsDraft,
        resultAcknowledgementsEnabled: resultAcknowledgementsDraft,
        confirmationPhrases: parsePhraseList(confirmationPhrasesDraft),
        cancellationPhrases: parsePhraseList(cancellationPhrasesDraft),
        voiceCommandActivationMode: voiceCommandActivationModeDraft,
        voiceCommandWakePhrases: parsePhraseList(voiceCommandWakePhrasesDraft),
        voiceCommandPushToCommandHotkey:
          voiceCommandPushToCommandHotkeyDraft.trim(),
        voiceCommandAmbiguityTimeoutMs:
          Number(voiceCommandAmbiguityTimeoutDraft) || 15_000,
        voiceCommandAcknowledgementMode: voiceCommandAcknowledgementModeDraft,
        telemetry: {
          enabled: telemetryEnabledDraft,
          automaticJournalDiscovery: automaticJournalDiscoveryDraft,
          manualJournalDirectory: automaticJournalDiscoveryDraft
            ? null
            : manualJournalDirectoryDraft,
          lowFuelThreshold: Math.max(
            0.01,
            Math.min(0.95, (Number(lowFuelThresholdDraft) || 25) / 100),
          ),
          criticalFuelThreshold: Math.max(
            0.01,
            Math.min(
              (Number(lowFuelThresholdDraft) || 25) / 100,
              (Number(criticalFuelThresholdDraft) || 10) / 100,
            ),
          ),
          hullWarningThresholds: parseThresholdList(hullThresholdsDraft),
          explorationCommentaryCooldownMs:
            Number(explorationTelemetryCooldownDraft) || 90_000,
          commentary: {
            announceDockingEvents: announceDockingEventsDraft,
            announceJumpEvents: announceJumpEventsDraft,
            announceMissionEvents: announceMissionEventsDraft,
            announceDiscoveries: announceDiscoveriesDraft,
            announceMaterialCollection: announceMaterialCollectionDraft,
          },
        },
      });
      toaster.create({
        title: t("assistant.saved"),
        type: "success",
        duration: 2000,
      });
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : t("assistant.errors.saveFailed"),
        type: "error",
        duration: 2500,
      });
    }
  };

  const handleTestCommand = async () => {
    if (!draftProfile || !currentCommand) {
      return;
    }
    try {
      const savedProfile = await persistDraftProfile();
      const targetProfile = savedProfile ?? draftProfile;
      const targetCommandId = targetProfile.commands.some(
        (command) => command.commandId === currentCommand.commandId,
      )
        ? currentCommand.commandId
        : (targetProfile.commands[0]?.commandId ?? null);
      if (!targetCommandId) {
        throw new Error("No automation command is available to test.");
      }
      await executeCommand(targetProfile.profileId, targetCommandId, {
        dryRun: dryRunDraft,
        source: "manual",
        allowDisabled: true,
      });
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : t("assistant.errors.saveFailed"),
        type: "error",
        duration: 3000,
      });
    }
  };

  const handleVoiceCommandResolveTest = () => {
    if (!voiceCommandTestDraft.trim()) {
      return;
    }
    resolveVoiceCommandTest(voiceCommandTestDraft);
  };

  const handleCancel = () => {
    setDraftProfile(
      savedProfileSnapshot ? structuredClone(savedProfileSnapshot) : null,
    );
    setDryRunDraft(snapshot?.dryRun ?? true);
    setHotkeyDraft(
      snapshot?.emergencyStopHotkey ?? "CommandOrControl+Alt+Shift+F12",
    );
    setLlmAutomationEnabledDraft(snapshot?.llmAutomationEnabled ?? false);
    setAllowAutonomousHarmlessDraft(
      snapshot?.allowAutonomousHarmlessCommands ?? false,
    );
    setAllowAutonomousLowRiskDraft(
      snapshot?.allowAutonomousLowRiskCommands ?? false,
    );
    setProfileSelectionModeDraft(snapshot?.profileSelectionMode ?? "manual");
    setManualProfileIdDraft(snapshot?.manualProfileId ?? null);
    setDefaultSpeechModeDraft(snapshot?.defaultSpeechMode ?? "action");
    setProactiveCommentaryDraft(snapshot?.proactiveCommentaryEnabled ?? false);
    setMinimumCommentaryIntervalDraft(
      String(snapshot?.minimumCommentaryIntervalMs ?? 15_000),
    );
    setMaxQueuedConversationEventsDraft(
      String(snapshot?.maxQueuedConversationEvents ?? 5),
    );
    setAnnounceApplicationChangesDraft(
      snapshot?.announceApplicationChanges ?? false,
    );
    setAcknowledgeRoutineAutomationSuccessDraft(
      snapshot?.acknowledgeRoutineAutomationSuccess ?? false,
    );
    setConfirmationTimeoutDraft(
      String(snapshot?.confirmationTimeoutMs ?? 10_000),
    );
    setMaxPendingConfirmationsDraft(
      String(snapshot?.maxPendingConfirmations ?? 1),
    );
    setAnnounceBlockedCommandRequestsDraft(
      snapshot?.announceBlockedCommandRequests ?? false,
    );
    setIncludeCommandSuggestionsDraft(
      snapshot?.includeCommandSuggestionsInSpeech ?? true,
    );
    setResultAcknowledgementsDraft(
      snapshot?.resultAcknowledgementsEnabled ?? false,
    );
    setConfirmationPhrasesDraft(
      phraseListToText(
        snapshot?.confirmationPhrases ?? ["confirm", "do it", "yes, run it"],
      ),
    );
    setCancellationPhrasesDraft(
      phraseListToText(
        snapshot?.cancellationPhrases ?? ["cancel", "never mind", "stop"],
      ),
    );
    setVoiceCommandActivationModeDraft(
      snapshot?.voiceCommandActivationMode ?? "wake_phrase",
    );
    setVoiceCommandWakePhrasesDraft(
      phraseListToText(
        snapshot?.voiceCommandWakePhrases ?? ["assistant", "computer"],
      ),
    );
    setVoiceCommandPushToCommandHotkeyDraft(
      snapshot?.voiceCommandPushToCommandHotkey ??
        "CommandOrControl+Alt+Shift+F11",
    );
    setVoiceCommandAmbiguityTimeoutDraft(
      String(snapshot?.voiceCommandAmbiguityTimeoutMs ?? 15_000),
    );
    setVoiceCommandAcknowledgementModeDraft(
      snapshot?.voiceCommandAcknowledgementMode ?? "none",
    );
    setTelemetryEnabledDraft(snapshot?.telemetry.enabled ?? true);
    setAutomaticJournalDiscoveryDraft(
      snapshot?.telemetry.automaticJournalDiscovery ?? true,
    );
    setManualJournalDirectoryDraft(
      snapshot?.telemetry.manualJournalDirectory ?? null,
    );
    setLowFuelThresholdDraft(
      String(Math.round((snapshot?.telemetry.lowFuelThreshold ?? 0.25) * 100)),
    );
    setCriticalFuelThresholdDraft(
      String(
        Math.round((snapshot?.telemetry.criticalFuelThreshold ?? 0.1) * 100),
      ),
    );
    setHullThresholdsDraft(
      thresholdListToText(
        snapshot?.telemetry.hullWarningThresholds ?? [75, 50, 25, 10],
      ),
    );
    setExplorationTelemetryCooldownDraft(
      String(snapshot?.telemetry.explorationCommentaryCooldownMs ?? 90_000),
    );
    setAnnounceDockingEventsDraft(
      snapshot?.telemetry.commentary.announceDockingEvents ?? true,
    );
    setAnnounceJumpEventsDraft(
      snapshot?.telemetry.commentary.announceJumpEvents ?? true,
    );
    setAnnounceMissionEventsDraft(
      snapshot?.telemetry.commentary.announceMissionEvents ?? true,
    );
    setAnnounceDiscoveriesDraft(
      snapshot?.telemetry.commentary.announceDiscoveries ?? true,
    );
    setAnnounceMaterialCollectionDraft(
      snapshot?.telemetry.commentary.announceMaterialCollection ?? false,
    );
    setCapturingField(null);
  };

  const addCommand = () => {
    updateDraftProfile((profile) => {
      const command = createBlankCommand();
      setSelectedCommandId(command.commandId);
      return {
        ...profile,
        commands: [...profile.commands, command],
      };
    });
  };

  const removeCommand = () => {
    if (!selectedCommandId) {
      return;
    }
    updateDraftProfile((profile) => {
      const nextCommands = profile.commands.filter(
        (command) => command.commandId !== selectedCommandId,
      );
      setSelectedCommandId(nextCommands[0]?.commandId ?? null);
      return {
        ...profile,
        commands: nextCommands,
      };
    });
  };

  const handleMakeVoiceReady = () => {
    if (!draftProfile || !currentCommand) {
      return;
    }

    setLlmAutomationEnabledDraft(true);
    setProfileSelectionModeDraft("manual");
    setManualProfileIdDraft(draftProfile.profileId);
    setVoiceCommandActivationModeDraft((current) =>
      current === "disabled" ? "wake_phrase" : current,
    );
    setVoiceCommandWakePhrasesDraft((current) =>
      current.trim() ? current : "assistant, computer",
    );
    updateDraftProfile((profile) => ({
      ...profile,
      enabled: true,
    }));
    updateCurrentCommand(applyVoiceReadyDefaultsToCommand);
    toaster.create({
      title: "Voice-ready defaults applied. Save to use them.",
      type: "info",
      duration: 2500,
    });
  };

  const handleMakeEnabledCommandsVoiceReady = () => {
    if (!draftProfile) {
      return;
    }

    const enabledCommandIds = draftProfile.commands
      .filter((command) => command.enabled)
      .map((command) => command.commandId);
    if (enabledCommandIds.length === 0) {
      toaster.create({
        title: "Enable at least one command first.",
        type: "info",
        duration: 2500,
      });
      return;
    }

    const enabledCommandIdSet = new Set(enabledCommandIds);
    setLlmAutomationEnabledDraft(true);
    setProfileSelectionModeDraft("manual");
    setManualProfileIdDraft(draftProfile.profileId);
    setVoiceCommandActivationModeDraft((current) =>
      current === "disabled" ? "wake_phrase" : current,
    );
    setVoiceCommandWakePhrasesDraft((current) =>
      current.trim() ? current : "assistant, computer",
    );
    updateDraftProfile((profile) => ({
      ...profile,
      enabled: true,
      commands: profile.commands.map((command) =>
        enabledCommandIdSet.has(command.commandId)
          ? applyVoiceReadyDefaultsToCommand(command)
          : command,
      ),
    }));
    toaster.create({
      title: `${enabledCommandIds.length} enabled command${enabledCommandIds.length === 1 ? "" : "s"} updated for voice. Save to use them.`,
      type: "info",
      duration: 3000,
    });
  };

  const addStep = (type: AutomationAction["type"]) => {
    const nextStepIndex = currentCommand?.steps.length ?? 0;
    updateCurrentCommand((command) => ({
      ...command,
      steps: [...command.steps, createBlankStep(type)],
    }));
    setSelectedStepIndex(nextStepIndex);
  };

  const updateStep = (
    index: number,
    updater: (step: AutomationAction) => AutomationAction,
  ) => {
    updateCurrentCommand((command) => ({
      ...command,
      steps: command.steps.map((step, stepIndex) =>
        stepIndex === index ? updater(step) : step,
      ),
    }));
  };

  const removeStep = (index: number) => {
    updateCurrentCommand((command) => ({
      ...command,
      steps: command.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
    setSelectedStepIndex((current) =>
      Math.max(0, current === index ? index - 1 : current),
    );
  };

  const duplicateStep = (index: number) => {
    updateCurrentCommand((command) => {
      const clone = structuredClone(command.steps[index]);
      const nextSteps = [...command.steps];
      nextSteps.splice(index + 1, 0, clone);
      return { ...command, steps: nextSteps };
    });
    setSelectedStepIndex(index + 1);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    updateCurrentCommand((command) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= command.steps.length) {
        return command;
      }
      const nextSteps = [...command.steps];
      [nextSteps[index], nextSteps[targetIndex]] = [
        nextSteps[targetIndex],
        nextSteps[index],
      ];
      return { ...command, steps: nextSteps };
    });
    setSelectedStepIndex((current) =>
      current === index ? index + direction : current,
    );
  };

  const handleNewProfile = () => {
    const profile = createBlankProfile(
      deriveUniqueProfileId(
        DEFAULT_PROFILE_DISPLAY_NAME,
        (snapshot?.profiles ?? []).map(
          (existingProfile) => existingProfile.profileId,
        ),
      ),
    );
    setDraftProfile(profile);
    setSavedProfileSnapshot(profile);
    setSelectedProfileId(profile.profileId);
    setSelectedCommandId(profile.commands[0].commandId);
    setSelectedStepIndex(0);
    setProfileEditorDialogOpen(true);
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId) {
      return;
    }
    const deleted = await deleteProfile(selectedProfileId);
    if (deleted) {
      setSelectedProfileId(
        snapshot?.profiles.find(
          (profile) => profile.profileId !== selectedProfileId,
        )?.profileId ?? null,
      );
    }
  };

  const handleSelectTelemetryDirectory = async () => {
    const selectedPath = await selectTelemetryDirectory();
    if (selectedPath) {
      setManualJournalDirectoryDraft(selectedPath);
      setAutomaticJournalDiscoveryDraft(false);
    }
  };

  const clearVoiceAttackPreview = () => {
    setVoiceAttackPreview(null);
    setSelectedVoiceAttackCommandIds([]);
    setSelectedVoiceAttackPreviewCommandId(null);
  };

  const selectVoiceAttackCandidate = (candidateId: string | null) => {
    setSelectedVoiceAttackCandidateId(candidateId);
    clearVoiceAttackPreview();
    setVoiceAttackPreviewStatus(null);
  };

  const loadVoiceAttackPreview = async (candidateId: string) => {
    if (!voiceAttackInspection) {
      return;
    }
    const candidate =
      voiceAttackInspection.candidates.find(
        (entry) => entry.candidateId === candidateId,
      ) ?? null;
    if (!candidate) {
      return;
    }
    if (!candidate.parseable) {
      selectVoiceAttackCandidate(candidateId);
      return;
    }
    setVoiceAttackBusyLabel("Previewing VoiceAttack profile...");
    setVoiceAttackPreviewStatus({
      type: "info",
      message: `Loading preview for "${candidate.profileName ?? candidate.sourceBasename}"...`,
    });
    console.info("[voiceattack:renderer-preview:start]", {
      importId: voiceAttackInspection.importId,
      candidateId,
      sourceBasename: candidate.sourceBasename,
      profileName: candidate.profileName,
      decoderStatus: candidate.decoderStatus,
      sourceFormat: candidate.sourceFormat,
      packageEntries: candidate.packageEntries.length,
    });
    try {
      clearVoiceAttackPreview();
      const preview = await previewVoiceAttackImport({
        importId: voiceAttackInspection.importId,
        candidateId,
      });
      if (!preview?.commands) {
        throw new Error("VoiceAttack preview returned an empty response.");
      }
      setSelectedVoiceAttackCandidateId(candidateId);
      setVoiceAttackPreview(preview);
      setSelectedVoiceAttackCommandIds(
        preview.commands
          .filter((command) => command.selectedByDefault)
          .map((command) => command.commandId),
      );
      setSelectedVoiceAttackPreviewCommandId(
        preview.commands.find((command) => command.selectedByDefault)
          ?.commandId ??
          preview.commands[0]?.commandId ??
          null,
      );
      setVoiceAttackPreviewStatus({
        type: "success",
        message: `Loaded "${preview.profileName}" with ${preview.commandCount} command(s).`,
      });
      console.info("[voiceattack:renderer-preview:success]", {
        importId: preview.importId,
        candidateId: preview.candidateId,
        profileName: preview.profileName,
        commandCount: preview.commandCount,
        supportedCommandCount: preview.supportedCommandCount,
        partiallySupportedCommandCount: preview.partiallySupportedCommandCount,
      });
      toaster.create({
        title: `Loaded preview for "${preview.profileName}".`,
        type: "success",
        duration: 2600,
      });
    } catch (error: any) {
      const message =
        error instanceof Error ? error.message : "VoiceAttack preview failed.";
      console.error("VoiceAttack preview failed.", error);
      console.error("[voiceattack:renderer-preview:error]", {
        importId: voiceAttackInspection.importId,
        candidateId,
        sourceBasename: candidate.sourceBasename,
        message,
      });
      setVoiceAttackPreviewStatus({
        type: "error",
        message,
      });
      toaster.create({
        title: message,
        type: "error",
        duration: 5000,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const handlePreviewSelectedVoiceAttackCandidate = async () => {
    if (!selectedVoiceAttackCandidateId) {
      return;
    }
    await loadVoiceAttackPreview(selectedVoiceAttackCandidateId);
  };

  const handleInspectVoiceAttack = async () => {
    setVoiceAttackDialogOpen(true);
    setVoiceAttackBusyLabel("Inspecting VoiceAttack source...");
    setVoiceAttackPreviewStatus(null);
    try {
      const inspection = await inspectVoiceAttackSource();
      setVoiceAttackInspection(inspection);
      clearVoiceAttackPreview();
      setSelectedVoiceAttackCandidateId(null);
      if (!inspection) {
        return;
      }
      const firstParseable = inspection.candidates.find(
        (candidate) => candidate.parseable,
      );
      if (firstParseable) {
        setSelectedVoiceAttackCandidateId(firstParseable.candidateId);
        toaster.create({
          title:
            inspection.candidateProfileCount === 1
              ? "Found 1 VoiceAttack profile."
              : `Found ${inspection.candidateProfileCount} VoiceAttack profiles.`,
          description:
            "The import workspace is open. Select a discovered profile and click Load preview to continue.",
          type: "info",
          duration: 4200,
        });
        return;
      }
      const firstCandidate = inspection.candidates[0] ?? null;
      if (firstCandidate) {
        setSelectedVoiceAttackCandidateId(firstCandidate.candidateId);
      }
      toaster.create({
        title:
          inspection.candidateProfileCount > 0
            ? "No parseable VoiceAttack profiles were found."
            : "No VoiceAttack profiles were found in that source.",
        description:
          inspection.candidateProfileCount > 0
            ? "The workspace is open and shows the blocked candidates so you can inspect the parse errors."
            : "Try a different `.vap`, `.vax`, or a folder that contains exported VoiceAttack profiles.",
        type: inspection.candidateProfileCount > 0 ? "warning" : "info",
        duration: 4600,
      });
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : "VoiceAttack inspection failed.",
        type: "error",
        duration: 3000,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const replaceVoiceAttackSelection = (commandIds: string[]) => {
    setSelectedVoiceAttackCommandIds(Array.from(new Set(commandIds)));
  };

  const removeVoiceAttackSelection = (commandIds: string[]) => {
    setSelectedVoiceAttackCommandIds((current) =>
      current.filter((commandId) => !commandIds.includes(commandId)),
    );
  };

  const handleImportVoiceAttackDraft = async () => {
    if (!voiceAttackInspection || !voiceAttackPreview) {
      return;
    }
    setVoiceAttackBusyLabel("Saving imported VoiceAttack draft...");
    try {
      const result = await importVoiceAttackProfile({
        importId: voiceAttackInspection.importId,
        candidateId: voiceAttackPreview.candidateId,
        selectedCommandIds: selectedVoiceAttackCommandIds,
      });
      const preferredImportedCommandId =
        selectedVoiceAttackCommandIds.find((commandId) =>
          voiceAttackPreview.commands.some(
            (command) => command.commandId === commandId,
          ),
        ) ?? null;
      const importedProfile = await getProfile(result.profileId);
      if (!importedProfile?.importMetadata?.imported) {
        throw new Error(
          `Saved profile "${result.displayName}" is not marked as an imported VoiceAttack draft.`,
        );
      }
      if (result.importedCommandCount <= 120) {
        await loadStoredProfileIntoEditor(
          result.profileId,
          preferredImportedCommandId,
        );
        setVoiceAttackDialogOpen(false);
      } else {
        toaster.create({
          title:
            `Imported draft "${result.displayName}" was saved. Open it manually from Profile list to avoid loading a very large editor view.`,
          type: "info",
          duration: 4200,
        });
      }
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error ? error.message : "VoiceAttack import failed.",
        type: "error",
        duration: 3200,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const handleExportVoiceAttackDiagnosticReport = async () => {
    if (!voiceAttackInspection || !selectedVoiceAttackCandidateId) {
      return;
    }
    setVoiceAttackBusyLabel("Exporting VoiceAttack diagnostic report...");
    try {
      const saved = await exportVoiceAttackDiagnosticReport({
        importId: voiceAttackInspection.importId,
        candidateId: selectedVoiceAttackCandidateId,
      });
      if (saved) {
        toaster.create({
          title: "VoiceAttack diagnostic report exported.",
          type: "success",
          duration: 2600,
        });
      }
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : "Unable to export the VoiceAttack diagnostic report.",
        type: "error",
        duration: 3200,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const scrollProfileEditorIntoView = () => {
    const target = profileEditorRef.current ?? profileWorkspaceRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      displayNameInputRef.current?.focus();
      displayNameInputRef.current?.select();
    }, 120);
  };

  const openProfileInEditor = (profileId: string) => {
    pendingEditorProfileIdRef.current = profileId;
    setCommandEditorOpen(true);
    setProfileEditorDialogOpen(true);
    setSelectedProfileId(profileId);

    if (draftProfileRef.current?.profileId === profileId) {
      if (!selectedCommandId) {
        setSelectedCommandId(
          draftProfileRef.current.commands[0]?.commandId ?? null,
        );
      }
      window.requestAnimationFrame(() => {
        scrollProfileEditorIntoView();
      });
    }
  };

  const loadStoredProfileIntoEditor = async (
    profileId: string,
    preferredCommandId?: string | null,
  ): Promise<AutomationProfile> => {
    const profile = await getProfile(profileId);
    if (!profile) {
      throw new Error(
        `Automation profile "${profileId}" could not be loaded after save.`,
      );
    }
    const nextCommandId =
      preferredCommandId &&
      profile.commands.some((command) => command.commandId === preferredCommandId)
        ? preferredCommandId
        : (profile.commands[0]?.commandId ?? null);
    pendingEditorProfileIdRef.current = profile.profileId;
    setCommandEditorOpen(true);
    setProfileEditorDialogOpen(true);
    setDraftProfile(structuredClone(profile));
    setSavedProfileSnapshot(structuredClone(profile));
    setSelectedProfileId(profile.profileId);
    setSelectedCommandId(nextCommandId);
    return profile;
  };

  const handleValidateImportedDraft = async () => {
    if (!voiceAttackReviewReport) {
      return;
    }
    setVoiceAttackBusyLabel("Validating imported draft...");
    try {
      toaster.create({
        title: voiceAttackReviewReport.readyToMarkReviewed
          ? "Imported draft is ready to mark reviewed."
          : `${voiceAttackReviewReport.findings.length} review item(s) still need attention.`,
        type: voiceAttackReviewReport.readyToMarkReviewed ? "success" : "info",
        duration: 2800,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const handleMarkImportedDraftReviewed = async () => {
    if (!draftProfile?.importMetadata?.imported) {
      return;
    }
    setVoiceAttackBusyLabel("Marking imported draft reviewed...");
    try {
      const profileToReview = draftDirty
        ? await persistDraftProfile()
        : (savedProfileSnapshot ?? draftProfile);
      if (!profileToReview) {
        throw new Error("No imported draft is available to review.");
      }
      const saved = await markImportedProfileReviewed(
        profileToReview.profileId,
      );
      setDraftProfile(structuredClone(saved));
      setSavedProfileSnapshot(structuredClone(saved));
      toaster.create({
        title: "Imported draft marked reviewed.",
        type: "success",
        duration: 2500,
      });
    } catch (error: any) {
      toaster.create({
        title:
          error instanceof Error
            ? error.message
            : "Unable to mark the imported draft reviewed.",
        type: "error",
        duration: 3200,
      });
    } finally {
      setVoiceAttackBusyLabel(null);
    }
  };

  const runningRequestId = snapshot?.runningRequestIds[0];
  const status =
    snapshot?.status || ("disconnected" as AutomationRuntimeStatus);
  const pendingConfirmations = assistantState?.pendingConfirmations ?? [];
  const recentDecisions = assistantState?.recentDecisions ?? [];
  const capabilityEntries = assistantState?.capabilities ?? [];
  const assistantActivity = assistantState?.activity ?? [];
  const runtimeDetectedApplication =
    assistantState?.detectedApplication ??
    snapshot?.detectedApplication ??
    null;
  const runtimeMatchedProfileId =
    assistantState?.matchedProfileId ?? snapshot?.matchedProfileId ?? null;
  const runtimeEffectiveProfileId =
    assistantState?.effectiveProfileId ?? snapshot?.effectiveProfileId ?? null;
  const runtimeSelectionSource =
    assistantState?.profileSelectionSource ??
    snapshot?.profileSelectionSource ??
    "none";
  const runtimeSpeechMode =
    assistantState?.speechMode ?? snapshot?.speechMode ?? "action";
  const runtimeProfileMatchConfidence =
    assistantState?.profileMatchConfidence ??
    snapshot?.profileMatchConfidence ??
    null;
  const telemetryState = assistantState?.telemetry ?? null;
  const telemetrySnapshot = telemetryState?.snapshot ?? null;
  const detectedApplicationLabel = runtimeDetectedApplication
    ? `${runtimeDetectedApplication.windowTitle} (${runtimeDetectedApplication.processName})`
    : t("assistant.runtime.noActiveApplication");
  const profileMatchStatusLabel = useMemo(() => {
    if (!runtimeMatchedProfileId) {
      return t("assistant.runtime.noMatch");
    }
    const confidence = runtimeProfileMatchConfidence;
    if (confidence === null) {
      return t("assistant.runtime.noMatch");
    }
    const percent = Math.round(confidence * 100);
    return confidence < 1
      ? t("assistant.runtime.matchAmbiguous", { percent })
      : t("assistant.runtime.matchConfirmed", { percent });
  }, [runtimeMatchedProfileId, runtimeProfileMatchConfidence, t]);
  const queueSummaryLabel = assistantState
    ? t("assistant.runtime.queueSummaryValue", {
        total: assistantState.queueSummary.total,
        high: assistantState.queueSummary.highPriority,
      })
    : t("assistant.runtime.noQueueData");
  const playerSpeakingLabel =
    assistantState?.playerSpeaking === null
      ? t("assistant.runtime.unknown")
      : assistantState?.playerSpeaking
        ? t("assistant.runtime.yes")
        : t("assistant.runtime.no");
  const vtuberSpeakingLabel = assistantState?.vtuberSpeaking
    ? t("assistant.runtime.yes")
    : t("assistant.runtime.no");
  const autonomyWarningActive =
    llmAutomationEnabledDraft &&
    (allowAutonomousHarmlessDraft || allowAutonomousLowRiskDraft);
  const telemetryDirectoryLabel =
    telemetryState?.sourceDirectoryLabel ||
    telemetryState?.journalDirectoryLabel ||
    formatTelemetryDirectory(manualJournalDirectoryDraft) ||
    t("assistant.telemetry.notConfigured");
  const telemetryCurrentSourceLabel =
    telemetryState?.currentSource ||
    telemetryState?.currentJournalFile ||
    t("assistant.runtime.none");
  const telemetryGameLabel =
    telemetryState?.gameDisplayName ||
    telemetryState?.gameId ||
    t("assistant.runtime.none");
  const telemetrySourceKindLabel =
    telemetryState?.sourceKind ?? "log";
  const telemetryHighlights = telemetrySnapshot?.highlights ?? [];
  const telemetryHasEliteDetails = Boolean(
    telemetrySnapshot?.session.starSystem ||
      telemetrySnapshot?.session.shipName ||
      telemetrySnapshot?.session.shipType ||
      telemetrySnapshot?.ship.hullPercent !== undefined ||
      telemetrySnapshot?.combat.inDanger !== undefined,
  );
  const lookupProfileDisplayName = (
    profileId: string | null | undefined,
  ): string | null => {
    if (!profileId) {
      return null;
    }
    return (
      profileOptions.find((profile) => profile.profileId === profileId)
        ?.displayName ?? profileId
    );
  };
  const runtimeMatchedProfileLabel =
    lookupProfileDisplayName(runtimeMatchedProfileId) ??
    t("assistant.runtime.none");
  const runtimeEffectiveProfileLabel =
    lookupProfileDisplayName(runtimeEffectiveProfileId) ??
    t("assistant.runtime.none");
  const draftDirty = Boolean(
    draftProfile &&
      savedProfileSnapshot &&
      JSON.stringify(draftProfile) !== JSON.stringify(savedProfileSnapshot),
  );
  const activeCapabilityCount = capabilityEntries.filter(
    (capability) => capability.enabled && capability.available,
  ).length;
  const runtimeSummaryLabel =
    assistantActivity.length > 0
      ? `${assistantActivity.length} recent updates`
      : t("assistant.runtime.noActivity");
  const telemetrySummaryLabel =
    telemetryState?.status ?? t("assistant.runtime.none");
  const telemetrySettingsSummaryLabel = telemetryEnabledDraft
    ? `${t("assistant.enabled")} · ${automaticJournalDiscoveryDraft ? t("assistant.telemetry.automaticDiscovery") : "Manual folder"}`
    : t("assistant.disabled");
  const assistantSignalsSummaryLabel = `${pendingConfirmations.length} pending · ${activeCapabilityCount} active capabilities`;

  const voiceReadyIssues = useMemo(() => {
    if (!draftProfile || !currentCommand) {
      return [] as string[];
    }

    const issues: string[] = [];
    if (!draftProfile.enabled) {
      issues.push("profile disabled");
    }
    if (!currentCommand.enabled) {
      issues.push("command disabled");
    }
    if (!commandAllowsPlayerVoiceExecution(currentCommand)) {
      issues.push("no voice trigger");
    }
    if (
      currentCommand.autonomyPolicy === "disabled" ||
      currentCommand.autonomyPolicy === "suggest_only"
    ) {
      issues.push("won't run by voice");
    }
    if (profileSelectionModeDraft === "disabled") {
      issues.push("profile selection disabled");
    }
    if (
      profileSelectionModeDraft === "manual" &&
      manualProfileIdDraft !== draftProfile.profileId
    ) {
      issues.push("different active profile selected");
    }
    return issues;
  }, [
    currentCommand,
    draftProfile,
    manualProfileIdDraft,
    profileSelectionModeDraft,
  ]);
  const voiceReady = Boolean(currentCommand) && voiceReadyIssues.length === 0;
  const voiceCommandActivationLabel = t(
    `assistant.voice.activationModes.${voiceCommandActivationModeDraft}`,
  );
  const voiceCommandAcknowledgementLabel = t(
    `assistant.voice.ackModes.${voiceCommandAcknowledgementModeDraft}`,
  );
  const voiceCommandListeningLabel = snapshot?.voiceCommandListeningActive
    ? t("assistant.voice.listeningActive")
    : t("assistant.voice.listeningInactive");
  const voiceCommandHotkeyStatusLabel =
    snapshot?.voiceCommandHotkeyError ??
    (snapshot?.voiceCommandHotkeyRegistered
      ? t("assistant.voice.hotkeyRegistered")
      : t("assistant.voice.hotkeyNotRegistered"));
  const pendingVoiceAmbiguity = assistantState?.pendingAmbiguity ?? null;
  const recentResolverActivity = assistantState?.resolverActivity ?? [];
  const alwaysListeningWarning =
    voiceCommandActivationModeDraft === "always_listening";
  const selectedVoiceAttackCandidate = useMemo(
    () =>
      voiceAttackInspection?.candidates.find(
        (candidate) => candidate.candidateId === selectedVoiceAttackCandidateId,
      ) ?? null,
    [selectedVoiceAttackCandidateId, voiceAttackInspection],
  );
  const filteredVoiceAttackCommands = useMemo(() => {
    if (!voiceAttackPreview) {
      return [];
    }
    const searchQuery = voiceAttackSearchDraft.trim().toLowerCase();
    return voiceAttackPreview.commands.filter((command) => {
      if (
        voiceAttackSupportFilter !== "all" &&
        command.supportStatus !== voiceAttackSupportFilter
      ) {
        return false;
      }
      if (!searchQuery) {
        return true;
      }
      return summarizeVoiceAttackCommandSearch(command).includes(searchQuery);
    });
  }, [voiceAttackPreview, voiceAttackSearchDraft, voiceAttackSupportFilter]);
  const filteredVoiceAttackCommandIds = useMemo(
    () => filteredVoiceAttackCommands.map((command) => command.commandId),
    [filteredVoiceAttackCommands],
  );
  const selectedVoiceAttackPreviewCommand = useMemo(
    () =>
      voiceAttackPreview?.commands.find(
        (command) => command.commandId === selectedVoiceAttackPreviewCommandId,
      ) ?? null,
    [selectedVoiceAttackPreviewCommandId, voiceAttackPreview],
  );
  const selectedVoiceAttackSupportReasons = useMemo(
    () =>
      selectedVoiceAttackPreviewCommand
        ? buildVoiceAttackSupportReasonSummaries(
            selectedVoiceAttackPreviewCommand,
          )
        : [],
    [selectedVoiceAttackPreviewCommand],
  );
  const selectedVoiceAttackNonSupportedActionCount = useMemo(
    () =>
      selectedVoiceAttackPreviewCommand
        ? selectedVoiceAttackPreviewCommand.actions.filter(
            (action) => action.supportStatus !== "supported",
          ).length
        : 0,
    [selectedVoiceAttackPreviewCommand],
  );

  useEffect(() => {
    if (!voiceAttackPreview) {
      if (selectedVoiceAttackPreviewCommandId !== null) {
        setSelectedVoiceAttackPreviewCommandId(null);
      }
      return;
    }
    if (filteredVoiceAttackCommands.length === 0) {
      return;
    }
    if (
      !filteredVoiceAttackCommands.some(
        (command) => command.commandId === selectedVoiceAttackPreviewCommandId,
      )
    ) {
      setSelectedVoiceAttackPreviewCommandId(
        filteredVoiceAttackCommands[0]?.commandId ??
          voiceAttackPreview.commands[0]?.commandId ??
          null,
      );
    }
  }, [
    filteredVoiceAttackCommands,
    selectedVoiceAttackPreviewCommandId,
    voiceAttackPreview,
  ]);
  const importedDraftSummaryLabel = draftProfile?.importMetadata?.imported
    ? `${draftProfile.importMetadata.importSource} • ${draftProfile.importMetadata.reviewStatus}`
    : "not imported";
  const voiceAttackWorkspaceStatusLabel = voiceAttackInspection
    ? `${voiceAttackInspection.parseableFileCount}/${voiceAttackInspection.candidateProfileCount} parseable`
    : "No source selected";
  const voiceAttackWorkspaceSelectionLabel = voiceAttackPreview
    ? `${selectedVoiceAttackCommandIds.length}/${voiceAttackPreview.commandCount} commands selected`
    : "No preview loaded";
  const voiceAttackWorkspaceSourceLabel =
    voiceAttackPreview?.profileName ??
    selectedVoiceAttackCandidate?.sourceBasename ??
    voiceAttackInspection?.sourceBasename ??
    "No source selected";
  const voiceAttackSaveDraftDisabledReason = !voiceAttackInspection
    ? "Inspect a VoiceAttack export first."
    : !selectedVoiceAttackCandidate
      ? "Select a discovered profile first."
      : !selectedVoiceAttackCandidate.parseable
        ? "The selected profile is not parseable."
        : !voiceAttackPreview
          ? "Click Load preview before saving an imported draft."
          : selectedVoiceAttackCommandIds.length === 0
            ? "Select at least one supported command to import."
            : null;
  const voiceAttackSaveDraftButtonLabel = !voiceAttackPreview
    ? "Load preview to save"
    : selectedVoiceAttackCommandIds.length === 0
      ? "Select commands to save"
      : "Save disabled draft";
  const voiceAttackPreviewStatusColor =
    voiceAttackPreviewStatus?.type === "error"
      ? "orange.200"
      : voiceAttackPreviewStatus?.type === "success"
        ? "green.200"
        : "blue.200";
  const voiceAttackImportWorkspace = (
    <Flex direction="column" gap={4}>
      <Box {...insetCardProps}>
        <Flex justify="space-between" align="start" gap={4} wrap="wrap">
          <Box maxW="760px">
            <Text color="white" fontWeight="semibold">
              VoiceAttack Import
            </Text>
            <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
              Local-only inspection and import. Choose an exported `.vap` or
              `.vax` file, or scan a folder recursively. Source paths stay in
              the Electron main process, imported drafts stay disabled, and
              proprietary response text is never shown here.
            </Text>
          </Box>
          <Flex gap={2} wrap="wrap">
            <Button
              onClick={() => void handleInspectVoiceAttack()}
              colorPalette="blue"
            >
              Inspect VoiceAttack Source
            </Button>
            <Button
              {...outlineButtonStyle}
              disabled={!voiceAttackInspection}
              onClick={() =>
                voiceAttackInspection &&
                void cancelVoiceAttackImport(voiceAttackInspection.importId)
              }
            >
              Cancel session
            </Button>
            <Button
              onClick={() => {
                if (!voiceAttackPreview) {
                  return;
                }
                replaceVoiceAttackSelection(
                  voiceAttackPreview.commands
                    .filter((command) => command.supportStatus === "supported")
                    .map((command) => command.commandId),
                );
              }}
              disabled={!voiceAttackPreview}
            >
              Select all supported
            </Button>
            <Button
              {...outlineButtonStyle}
              disabled={!voiceAttackPreview}
              onClick={() => setSelectedVoiceAttackCommandIds([])}
            >
              Select none
            </Button>
            <Button
              colorPalette="green"
              disabled={
                !voiceAttackPreview ||
                selectedVoiceAttackCommandIds.length === 0
              }
              onClick={() => void handleImportVoiceAttackDraft()}
            >
              {voiceAttackSaveDraftButtonLabel}
            </Button>
            <Button
              {...outlineButtonStyle}
              disabled={
                !voiceAttackInspection || !selectedVoiceAttackCandidateId
              }
              onClick={() => void handleExportVoiceAttackDiagnosticReport()}
            >
              Export diagnostic report
            </Button>
            <Button
              disabled={!draftProfile?.importMetadata?.imported}
              onClick={() => void handleValidateImportedDraft()}
            >
              Validate draft
            </Button>
            <Button
              disabled={!draftProfile?.importMetadata?.imported}
              onClick={() => void handleMarkImportedDraftReviewed()}
            >
              Mark reviewed
            </Button>
            <Button
              {...outlineButtonStyle}
              disabled={!draftProfile}
              onClick={() =>
                draftProfile && openProfileInEditor(draftProfile.profileId)
              }
            >
              Open in editor
            </Button>
          </Flex>
        </Flex>

        {voiceAttackSaveDraftDisabledReason && (
          <Text color="orange.200" fontSize="sm" mt={3}>
            {voiceAttackSaveDraftDisabledReason}
          </Text>
        )}
        {voiceAttackPreviewStatus && (
          <Text color={voiceAttackPreviewStatusColor} fontSize="sm" mt={2}>
            {voiceAttackPreviewStatus.message}
          </Text>
        )}
        {voiceAttackBusyLabel && (
          <Text color="blue.200" fontSize="sm" mt={3}>
            {voiceAttackBusyLabel}
          </Text>
        )}
      </Box>

      <Flex gap={3} wrap="wrap">
        <Box {...insetCardProps} minW="220px" flex="1">
          <Text color="whiteAlpha.600" fontSize="sm">
            Workspace status
          </Text>
          <Text color="white" fontWeight="medium">
            {voiceAttackWorkspaceStatusLabel}
          </Text>
        </Box>
        <Box {...insetCardProps} minW="220px" flex="1">
          <Text color="whiteAlpha.600" fontSize="sm">
            Current source
          </Text>
          <Text color="white" fontWeight="medium">
            {voiceAttackWorkspaceSourceLabel}
          </Text>
        </Box>
        <Box {...insetCardProps} minW="220px" flex="1">
          <Text color="whiteAlpha.600" fontSize="sm">
            Selection
          </Text>
          <Text color="white" fontWeight="medium">
            {voiceAttackWorkspaceSelectionLabel}
          </Text>
        </Box>
        <Box {...insetCardProps} minW="220px" flex="1">
          <Text color="whiteAlpha.600" fontSize="sm">
            Imported draft
          </Text>
          <Text color="white" fontWeight="medium">
            {importedDraftSummaryLabel}
          </Text>
        </Box>
      </Flex>

      {voiceAttackInspection ? (
        <Flex gap={3} wrap="wrap">
          <Box {...insetCardProps} minW="220px" flex="1">
            <Text color="whiteAlpha.600" fontSize="sm">
              Source
            </Text>
            <Text color="white">{voiceAttackInspection.sourceBasename}</Text>
          </Box>
          <Box {...insetCardProps} minW="180px">
            <Text color="whiteAlpha.600" fontSize="sm">
              Formats
            </Text>
            <Text color="white">
              {voiceAttackInspection.formatsDiscovered
                .map(formatVoiceAttackSourceFormat)
                .join(", ") || "None"}
            </Text>
          </Box>
          <Box {...insetCardProps} minW="180px">
            <Text color="whiteAlpha.600" fontSize="sm">
              Profiles
            </Text>
            <Text color="white">
              {voiceAttackInspection.parseableFileCount} parseable /{" "}
              {voiceAttackInspection.unparseableFileCount} blocked
            </Text>
          </Box>
          <Box {...insetCardProps} minW="220px" flex="1">
            <Text color="whiteAlpha.600" fontSize="sm">
              Supported categories
            </Text>
            <Text color="white">
              {voiceAttackInspection.supportedImportCategories.join(", ") ||
                "None"}
            </Text>
          </Box>
          <Box {...insetCardProps} minW="220px" flex="1">
            <Text color="whiteAlpha.600" fontSize="sm">
              Partial categories
            </Text>
            <Text color="white">
              {voiceAttackInspection.partiallySupportedCategories.join(", ") ||
                "None"}
            </Text>
          </Box>
          <Box {...insetCardProps} minW="220px" flex="1">
            <Text color="whiteAlpha.600" fontSize="sm">
              Unsupported categories
            </Text>
            <Text color="white">
              {voiceAttackInspection.unsupportedCategories.join(", ") || "None"}
            </Text>
          </Box>
        </Flex>
      ) : (
        <Box {...insetCardProps}>
          <Text color="whiteAlpha.700" fontSize="sm">
            No VoiceAttack source selected yet. Open an exported `.vap`, `.vax`,
            or a folder containing those files to begin reviewing commands.
          </Text>
        </Box>
      )}

      {voiceAttackInspection && (
        <Box {...insetCardProps}>
          <Flex justify="space-between" align="end" gap={4} wrap="wrap">
            <Box minW="280px" flex="1">
              <Text color="whiteAlpha.700" mb={1}>
                Discovered profiles
              </Text>
              <Flex gap={3} wrap="wrap" align="flex-end">
                <Box flex="1" minW="260px">
                  <select
                    style={selectStyles}
                    value={selectedVoiceAttackCandidateId ?? ""}
                    onChange={(event) => {
                      selectVoiceAttackCandidate(event.target.value || null);
                    }}
                  >
                    <option value="" style={optionStyles}>
                      Select a discovered profile
                    </option>
                    {voiceAttackInspection.candidates.map((candidate) => (
                      <option
                        key={candidate.candidateId}
                        value={candidate.candidateId}
                        style={optionStyles}
                      >
                        {candidate.sourceBasename} -{" "}
                        {candidate.parseable ? "parseable" : "unparseable"}
                      </option>
                    ))}
                  </select>
                </Box>
                <Button
                  {...outlineButtonStyle}
                  disabled={
                    !selectedVoiceAttackCandidate?.parseable ||
                    voiceAttackBusyLabel ===
                      "Previewing VoiceAttack profile..."
                  }
                  onClick={() => void handlePreviewSelectedVoiceAttackCandidate()}
                >
                  {voiceAttackBusyLabel === "Previewing VoiceAttack profile..."
                    ? "Loading preview..."
                    : "Load preview"}
                </Button>
              </Flex>
              <Text color="whiteAlpha.600" fontSize="sm" mt={2}>
                Preview loads on demand so large VoiceAttack profiles do not stall the settings UI.
              </Text>
            </Box>
            {selectedVoiceAttackCandidate && (
              <Flex gap={3} wrap="wrap" flex="1" justify="flex-end">
                <Box {...insetCardProps} minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Decoder
                  </Text>
                  <Text color="white">
                    {formatVoiceAttackDecoderStatus(
                      selectedVoiceAttackCandidate.decoderStatus,
                    )}
                  </Text>
                </Box>
                <Box {...insetCardProps} minW="220px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Envelope
                  </Text>
                  <Text color="white">
                    {selectedVoiceAttackCandidate.envelopeFormat ?? "Unknown"}
                  </Text>
                </Box>
                <Box {...insetCardProps} minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Package entries
                  </Text>
                  <Text color="white">
                    {selectedVoiceAttackCandidate.packageEntries.length}
                  </Text>
                </Box>
              </Flex>
            )}
          </Flex>
          {selectedVoiceAttackCandidate?.parseError && (
            <Text color="orange.300" fontSize="sm" mt={3}>
              {selectedVoiceAttackCandidate.parseError}
            </Text>
          )}
        </Box>
      )}

      {voiceAttackPreview && (
        <>
          <Flex gap={3} wrap="wrap">
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Profile
              </Text>
              <Text color="white">{voiceAttackPreview.profileName}</Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Format / version
              </Text>
              <Text color="white">
                {formatVoiceAttackSourceFormat(voiceAttackPreview.sourceFormat)}{" "}
                / {voiceAttackPreview.originalProfileVersion ?? "unknown"}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Commands
              </Text>
              <Text color="white">
                {voiceAttackPreview.commandCount} total /{" "}
                {voiceAttackPreview.supportedCommandCount} supported /{" "}
                {voiceAttackPreview.partiallySupportedCommandCount} partial /{" "}
                {voiceAttackPreview.unsupportedCommandCount} unsupported
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Warnings
              </Text>
              <Text color="white">
                {voiceAttackPreview.responsePlaceholderCount} placeholders /{" "}
                {voiceAttackPreview.unresolvedNestedReferenceCount} nested refs
                / {voiceAttackPreview.recursionWarningCount} recursion warnings
              </Text>
            </Box>
          </Flex>

          <Flex gap={4} align="start" flexWrap="wrap">
            <Box
              flex="0 0 520px"
              minW={{ base: "100%", xl: "520px" }}
              {...insetCardProps}
            >
              <Flex
                justify="space-between"
                align="start"
                gap={3}
                wrap="wrap"
                mb={3}
              >
                <Box>
                  <Text color="white" fontWeight="semibold">
                    Command roster
                  </Text>
                  <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                    Search, filter, and bulk-select imported commands before
                    saving the draft.
                  </Text>
                </Box>
                <Box {...insetCardProps} minW="170px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Visible / selected
                  </Text>
                  <Text color="white">
                    {filteredVoiceAttackCommands.length} /{" "}
                    {selectedVoiceAttackCommandIds.length}
                  </Text>
                </Box>
              </Flex>

              <Flex gap={3} wrap="wrap" align="end">
                <Box minW="220px" flex="1 1 260px">
                  <Text color="whiteAlpha.700" mb={1}>
                    Search commands
                  </Text>
                  <input
                    style={fieldStyle}
                    placeholder="Name, alias, category, or action type"
                    value={voiceAttackSearchDraft}
                    onChange={(event) =>
                      setVoiceAttackSearchDraft(event.target.value)
                    }
                  />
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.700" mb={1}>
                    Filter commands
                  </Text>
                  <select
                    style={selectStyles}
                    value={voiceAttackSupportFilter}
                    onChange={(event) =>
                      setVoiceAttackSupportFilter(
                        event.target.value as VoiceAttackSupportFilter,
                      )
                    }
                  >
                    <option value="all" style={optionStyles}>
                      all
                    </option>
                    <option value="supported" style={optionStyles}>
                      supported
                    </option>
                    <option value="partially_supported" style={optionStyles}>
                      partially supported
                    </option>
                    <option value="unsupported" style={optionStyles}>
                      unsupported
                    </option>
                  </select>
                </Box>
              </Flex>

              <Flex gap={2} wrap="wrap" mt={3}>
                <Button
                  {...smallButtonStyle}
                  disabled={filteredVoiceAttackCommandIds.length === 0}
                  onClick={() =>
                    replaceVoiceAttackSelection(filteredVoiceAttackCommandIds)
                  }
                >
                  Select visible
                </Button>
                <Button
                  {...smallButtonStyle}
                  disabled={filteredVoiceAttackCommandIds.length === 0}
                  onClick={() =>
                    replaceVoiceAttackSelection(
                      filteredVoiceAttackCommands
                        .filter(
                          (command) => command.supportStatus !== "unsupported",
                        )
                        .map((command) => command.commandId),
                    )
                  }
                >
                  Select visible reviewable
                </Button>
                <Button
                  {...smallButtonStyle}
                  disabled={filteredVoiceAttackCommandIds.length === 0}
                  onClick={() =>
                    removeVoiceAttackSelection(filteredVoiceAttackCommandIds)
                  }
                >
                  Clear visible
                </Button>
              </Flex>

              <Box overflowX="auto" mt={3}>
                <Box minW="860px">
                  <Box
                    display="grid"
                    gridTemplateColumns="56px 1.7fr 0.9fr 0.9fr 1fr 1fr"
                    gap={2}
                    px={3}
                    py={2}
                    borderRadius="md"
                    bg="whiteAlpha.100"
                    color="whiteAlpha.700"
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.08em"
                  >
                    <Text>On</Text>
                    <Text>Command</Text>
                    <Text>Support</Text>
                    <Text>Trigger</Text>
                    <Text>Aliases</Text>
                    <Text>Actions</Text>
                  </Box>
                  <Box maxH="480px" overflowY="auto" pr={1}>
                    {filteredVoiceAttackCommands.map((command) => {
                      const isSelected =
                        command.commandId ===
                        selectedVoiceAttackPreviewCommandId;
                      return (
                        <Box
                          key={command.commandId}
                          display="grid"
                          gridTemplateColumns="56px 1.7fr 0.9fr 0.9fr 1fr 1fr"
                          gap={2}
                          px={3}
                          py={2}
                          mt={2}
                          borderRadius="md"
                          border="1px solid rgba(255,255,255,0.08)"
                          bg={
                            isSelected
                              ? "rgba(59,130,246,0.16)"
                              : "rgba(15,23,42,0.55)"
                          }
                          cursor="pointer"
                          onClick={() =>
                            setSelectedVoiceAttackPreviewCommandId(
                              command.commandId,
                            )
                          }
                        >
                          <label
                            style={{
                              ...checkboxLabelStyle,
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedVoiceAttackCommandIds.includes(
                                command.commandId,
                              )}
                              onChange={(event) => {
                                event.stopPropagation();
                                setSelectedVoiceAttackCommandIds((current) =>
                                  event.target.checked
                                    ? Array.from(
                                        new Set([
                                          ...current,
                                          command.commandId,
                                        ]),
                                      )
                                    : current.filter(
                                        (item) => item !== command.commandId,
                                      ),
                                );
                              }}
                            />
                          </label>
                          <Box>
                            <Text color="white" fontWeight="medium">
                              {command.label}
                            </Text>
                            <Text color="whiteAlpha.600" fontSize="xs">
                              {command.commandId} /{" "}
                              {command.category || "uncategorized"}
                            </Text>
                          </Box>
                          <Text
                            color={formatSupportTone(command.supportStatus)}
                            fontSize="sm"
                          >
                            {command.supportStatus}
                          </Text>
                          <Text color="whiteAlpha.700" fontSize="sm">
                            {formatVoiceAttackTriggerMode(command.triggerMode)}
                          </Text>
                          <Text color="whiteAlpha.700" fontSize="sm">
                            {command.aliases.length
                              ? command.aliases.join(", ")
                              : "None"}
                          </Text>
                          <Text color="whiteAlpha.700" fontSize="sm">
                            {command.actions.length} step
                            {command.actions.length === 1 ? "" : "s"}
                            {command.unsupportedActionCount > 0
                              ? ` / ${command.unsupportedActionCount} unsupported`
                              : ""}
                          </Text>
                        </Box>
                      );
                    })}
                    {filteredVoiceAttackCommands.length === 0 && (
                      <Text color="whiteAlpha.600" fontSize="sm" mt={3}>
                        No commands match the current filter.
                      </Text>
                    )}
                  </Box>
                </Box>
              </Box>
            </Box>

            <Box
              flex="1 1 520px"
              minW={{ base: "100%", xl: "480px" }}
              {...insetCardProps}
            >
              {selectedVoiceAttackPreviewCommand ? (
                <Flex direction="column" gap={3}>
                  <Box>
                    <Text color="white" fontWeight="semibold">
                      {selectedVoiceAttackPreviewCommand.label}
                    </Text>
                    <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                      {selectedVoiceAttackPreviewCommand.commandId} /{" "}
                      {selectedVoiceAttackPreviewCommand.category ||
                        "uncategorized"}
                    </Text>
                  </Box>

                  <Flex gap={3} wrap="wrap">
                    <Box {...insetCardProps} minW="160px" flex="1">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Support
                      </Text>
                      <Text
                        color={formatSupportTone(
                          selectedVoiceAttackPreviewCommand.supportStatus,
                        )}
                      >
                        {formatImportSupportStatus(
                          selectedVoiceAttackPreviewCommand.supportStatus,
                        )}
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="160px" flex="1">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Trigger
                      </Text>
                      <Text color="white">
                        {formatVoiceAttackTriggerMode(
                          selectedVoiceAttackPreviewCommand.triggerMode,
                        )}
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="160px" flex="1">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Key inputs
                      </Text>
                      <Text color="white">
                        {selectedVoiceAttackPreviewCommand.keyInputCount}
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="180px" flex="1">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Placeholders
                      </Text>
                      <Text color="white">
                        {
                          selectedVoiceAttackPreviewCommand.responsePlaceholderCount
                        }
                      </Text>
                    </Box>
                  </Flex>

                  {selectedVoiceAttackPreviewCommand.supportStatus !==
                    "supported" && (
                    <Box
                      {...insetCardProps}
                      border="1px solid"
                      borderColor={
                        selectedVoiceAttackPreviewCommand.supportStatus ===
                        "partially_supported"
                          ? "rgba(252,211,77,0.34)"
                          : "rgba(248,113,113,0.38)"
                      }
                      bg={
                        selectedVoiceAttackPreviewCommand.supportStatus ===
                        "partially_supported"
                          ? "rgba(120,53,15,0.22)"
                          : "rgba(127,29,29,0.22)"
                      }
                    >
                      <Text
                        color={
                          selectedVoiceAttackPreviewCommand.supportStatus ===
                          "partially_supported"
                            ? "yellow.200"
                            : "red.200"
                        }
                        fontWeight="semibold"
                      >
                        {selectedVoiceAttackPreviewCommand.supportStatus ===
                        "partially_supported"
                          ? "Why this is partially supported"
                          : "Why this is unsupported"}
                      </Text>
                      <Text color="whiteAlpha.900" fontSize="sm" mt={1}>
                        {selectedVoiceAttackPreviewCommand.supportStatus ===
                        "partially_supported"
                          ? `This command still has ${selectedVoiceAttackNonSupportedActionCount} imported action${selectedVoiceAttackNonSupportedActionCount === 1 ? "" : "s"} that need manual replacement or review, even though ${selectedVoiceAttackPreviewCommand.executableActionCount} action${selectedVoiceAttackPreviewCommand.executableActionCount === 1 ? "" : "s"} can already be carried over.`
                          : `This command is made up of imported actions that still need manual replacement or review before it can be trusted to run as-is.`}
                      </Text>

                      {selectedVoiceAttackPreviewCommand.responsePlaceholderCount >
                        0 && (
                        <Text color="whiteAlpha.800" fontSize="sm" mt={2}>
                          {
                            selectedVoiceAttackPreviewCommand.responsePlaceholderCount
                          }{" "}
                          response placeholder
                          {selectedVoiceAttackPreviewCommand.responsePlaceholderCount ===
                          1
                            ? ""
                            : "s"}{" "}
                          were inserted because VoiceAttack speech/audio content
                          is intentionally not imported verbatim.
                        </Text>
                      )}

                      {selectedVoiceAttackPreviewCommand
                        .unresolvedNestedReferences.length > 0 && (
                        <Text color="whiteAlpha.800" fontSize="sm" mt={2}>
                          Unresolved nested command references:{" "}
                          {selectedVoiceAttackPreviewCommand.unresolvedNestedReferences.join(
                            ", ",
                          )}
                        </Text>
                      )}

                      <Flex direction="column" gap={2} mt={3}>
                        {selectedVoiceAttackSupportReasons.map((reason) => (
                          <Box
                            key={`${reason.supportStatus}-${reason.summary}`}
                            p={2}
                            borderRadius="md"
                            bg="rgba(15,23,42,0.48)"
                          >
                            <Text
                              color="white"
                              fontSize="sm"
                              fontWeight="medium"
                            >
                              {reason.count}x {reason.actionTypes.join(", ")}
                            </Text>
                            <Text color="whiteAlpha.700" fontSize="xs" mt={1}>
                              {formatImportSupportStatus(reason.supportStatus)}{" "}
                              / {reason.summary}
                            </Text>
                          </Box>
                        ))}
                      </Flex>
                    </Box>
                  )}

                  {selectedVoiceAttackPreviewCommand.description && (
                    <Box {...insetCardProps}>
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Description
                      </Text>
                      <Text color="whiteAlpha.900" fontSize="sm" mt={1}>
                        {selectedVoiceAttackPreviewCommand.description}
                      </Text>
                    </Box>
                  )}

                  <Box {...insetCardProps}>
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Aliases
                    </Text>
                    <Text color="whiteAlpha.900" fontSize="sm" mt={1}>
                      {selectedVoiceAttackPreviewCommand.aliases.length
                        ? selectedVoiceAttackPreviewCommand.aliases.join(", ")
                        : "None"}
                    </Text>
                  </Box>

                  <Box {...insetCardProps}>
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Action types
                    </Text>
                    <Text color="whiteAlpha.900" fontSize="sm" mt={1}>
                      {selectedVoiceAttackPreviewCommand.actionTypes.join(
                        ", ",
                      ) || "None"}
                    </Text>
                    <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                      {selectedVoiceAttackPreviewCommand.actionSummaries.join(
                        " / ",
                      )}
                    </Text>
                  </Box>

                  <Box {...insetCardProps}>
                    <Flex
                      justify="space-between"
                      align="center"
                      gap={3}
                      wrap="wrap"
                      mb={2}
                    >
                      <Text color="white" fontWeight="semibold">
                        Imported actions
                      </Text>
                      <Button
                        {...smallButtonStyle}
                        onClick={() =>
                          setSelectedVoiceAttackCommandIds((current) =>
                            current.includes(
                              selectedVoiceAttackPreviewCommand.commandId,
                            )
                              ? current.filter(
                                  (item) =>
                                    item !==
                                    selectedVoiceAttackPreviewCommand.commandId,
                                )
                              : Array.from(
                                  new Set([
                                    ...current,
                                    selectedVoiceAttackPreviewCommand.commandId,
                                  ]),
                                ),
                          )
                        }
                      >
                        {selectedVoiceAttackCommandIds.includes(
                          selectedVoiceAttackPreviewCommand.commandId,
                        )
                          ? "Remove from draft"
                          : "Add to draft"}
                      </Button>
                    </Flex>
                    <Flex
                      direction="column"
                      gap={2}
                      maxH="320px"
                      overflowY="auto"
                      pr={1}
                    >
                      {selectedVoiceAttackPreviewCommand.actions.map(
                        (action, index) => (
                          <Box
                            key={`${selectedVoiceAttackPreviewCommand.commandId}-${action.actionType}-${index}`}
                            p={2}
                            borderRadius="md"
                            bg="whiteAlpha.50"
                          >
                            <Text color="white" fontSize="sm">
                              {action.actionType}
                            </Text>
                            <Text color="whiteAlpha.700" fontSize="xs">
                              {formatImportSupportStatus(action.supportStatus)}{" "}
                              / {action.summary}
                            </Text>
                          </Box>
                        ),
                      )}
                    </Flex>
                  </Box>

                  {selectedVoiceAttackPreviewCommand.warnings.length > 0 && (
                    <Box {...insetCardProps}>
                      <Text color="orange.200" fontWeight="semibold">
                        Command warnings
                      </Text>
                      {selectedVoiceAttackPreviewCommand.warnings.map(
                        (warning) => (
                          <Text key={warning} color="orange.300" fontSize="sm">
                            {warning}
                          </Text>
                        ),
                      )}
                    </Box>
                  )}
                </Flex>
              ) : (
                <Text color="whiteAlpha.700">
                  Select a command from the roster to review the imported
                  actions.
                </Text>
              )}
            </Box>
          </Flex>

          {(voiceAttackPreview.packageEntries.length > 0 ||
            voiceAttackPreview.embeddedProfiles.length > 0 ||
            Object.keys(voiceAttackPreview.actionTypeCounts).length > 0 ||
            voiceAttackPreview.diagnostics) && (
            <details>
              <summary style={detailsSummaryStyle}>
                <span>Advanced diagnostics</span>
                <span style={detailsMetaStyle}>
                  decoder, package, and action inventory
                </span>
              </summary>
              <Flex direction="column" gap={3} mt={3}>
                <Flex gap={3} wrap="wrap">
                  <Box {...insetCardProps} minW="220px" flex="1">
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Decoder
                    </Text>
                    <Text color="white">
                      {formatVoiceAttackDecoderStatus(
                        voiceAttackPreview.decoderStatus,
                      )}
                    </Text>
                  </Box>
                  <Box {...insetCardProps} minW="220px" flex="1">
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Envelope
                    </Text>
                    <Text color="white">
                      {voiceAttackPreview.envelopeFormat ?? "Unknown"}
                    </Text>
                  </Box>
                  <Box {...insetCardProps} minW="220px" flex="1">
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Variables / plugins
                    </Text>
                    <Text color="white">
                      {voiceAttackPreview.unresolvedVariableCount} variable refs
                      / {voiceAttackPreview.unresolvedPluginCount} plugin calls
                    </Text>
                  </Box>
                </Flex>

                {voiceAttackPreview.diagnostics && (
                  <Flex gap={3} wrap="wrap">
                    <Box {...insetCardProps} minW="220px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Compressed size
                      </Text>
                      <Text color="white">
                        {voiceAttackPreview.diagnostics.compressedSize.toLocaleString()}{" "}
                        bytes
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="220px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Inflated size
                      </Text>
                      <Text color="white">
                        {voiceAttackPreview.diagnostics.inflatedSize?.toLocaleString() ??
                          "Unknown"}{" "}
                        bytes
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Header index
                      </Text>
                      <Text color="white">
                        {voiceAttackPreview.diagnostics.lastPropertyIndex ??
                          "Unknown"}
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Offset count
                      </Text>
                      <Text color="white">
                        {voiceAttackPreview.diagnostics.propertyOffsets.length}
                      </Text>
                    </Box>
                  </Flex>
                )}

                {Object.keys(voiceAttackPreview.actionTypeCounts).length >
                  0 && (
                  <Box {...insetCardProps}>
                    <Text color="white" fontWeight="semibold" mb={2}>
                      Action counts by type
                    </Text>
                    <Flex
                      gap={2}
                      wrap="wrap"
                      maxH="180px"
                      overflowY="auto"
                      pr={1}
                    >
                      {Object.entries(voiceAttackPreview.actionTypeCounts)
                        .sort((left, right) => right[1] - left[1])
                        .map(([actionType, count]) => (
                          <Box
                            key={actionType}
                            px={2}
                            py={1}
                            borderRadius="md"
                            bg="whiteAlpha.50"
                          >
                            <Text color="white" fontSize="sm">
                              {actionType}
                            </Text>
                            <Text color="whiteAlpha.700" fontSize="xs">
                              {count}
                            </Text>
                          </Box>
                        ))}
                    </Flex>
                  </Box>
                )}

                {(voiceAttackPreview.packageEntries.length > 0 ||
                  voiceAttackPreview.embeddedProfiles.length > 0) && (
                  <Flex gap={3} wrap="wrap" align="start">
                    {voiceAttackPreview.packageEntries.length > 0 && (
                      <Box {...insetCardProps} flex="1 1 360px">
                        <Text color="white" fontWeight="semibold" mb={2}>
                          Package inventory
                        </Text>
                        <Flex
                          direction="column"
                          gap={2}
                          maxH="180px"
                          overflowY="auto"
                          pr={1}
                        >
                          {voiceAttackPreview.packageEntries.map((entry) => (
                            <Box
                              key={entry.entryName}
                              p={2}
                              borderRadius="md"
                              bg="whiteAlpha.50"
                            >
                              <Text color="white" fontSize="sm">
                                {entry.entryName}
                              </Text>
                              <Text color="whiteAlpha.700" fontSize="xs">
                                {entry.kind} /{" "}
                                {entry.uncompressedSize.toLocaleString()} bytes
                                {entry.blockedReason
                                  ? ` / ${entry.blockedReason}`
                                  : ""}
                              </Text>
                            </Box>
                          ))}
                        </Flex>
                      </Box>
                    )}
                    {voiceAttackPreview.embeddedProfiles.length > 0 && (
                      <Box {...insetCardProps} flex="1 1 320px">
                        <Text color="white" fontWeight="semibold" mb={2}>
                          Embedded profiles
                        </Text>
                        <Flex direction="column" gap={2}>
                          {voiceAttackPreview.embeddedProfiles.map((entry) => (
                            <Box
                              key={entry.entryName}
                              p={2}
                              borderRadius="md"
                              bg="whiteAlpha.50"
                            >
                              <Text color="white" fontSize="sm">
                                {entry.entryName}
                              </Text>
                              <Text color="whiteAlpha.700" fontSize="xs">
                                {formatVoiceAttackSourceFormat(
                                  entry.sourceFormat,
                                )}{" "}
                                /{" "}
                                {formatVoiceAttackDecoderStatus(
                                  entry.decoderStatus,
                                )}{" "}
                                / {entry.parseable ? "parseable" : "blocked"}
                              </Text>
                            </Box>
                          ))}
                        </Flex>
                      </Box>
                    )}
                  </Flex>
                )}
              </Flex>
            </details>
          )}

          {voiceAttackPreview.warnings.length > 0 && (
            <Box {...insetCardProps}>
              <Text color="orange.200" fontWeight="semibold">
                Import warnings
              </Text>
              {voiceAttackPreview.warnings.map((warning) => (
                <Text key={warning} color="orange.100" fontSize="sm">
                  {warning}
                </Text>
              ))}
            </Box>
          )}
        </>
      )}

      {draftProfile?.importMetadata?.imported && (
        <Box {...insetCardProps}>
          <Text color="white" fontWeight="semibold">
            Imported draft review
          </Text>
          <Text color="whiteAlpha.600" fontSize="sm">
            {draftProfile.importMetadata.sourceBasename} -{" "}
            {importedDraftSummaryLabel}
          </Text>
          {voiceAttackReviewReport && (
            <Box mt={2}>
              <Text
                color={
                  voiceAttackReviewReport.readyToMarkReviewed
                    ? "green.300"
                    : "orange.300"
                }
                fontSize="sm"
              >
                {voiceAttackReviewReport.readyToMarkReviewed
                  ? "Ready to mark reviewed."
                  : `${voiceAttackReviewReport.findings.length} review item(s) remain.`}
              </Text>
              <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
                {voiceAttackReviewReport.executableCommandCount} executable /{" "}
                {voiceAttackReviewReport.keyInputCommandCount} key-input /{" "}
                {voiceAttackReviewReport.confirmationRequiredCommandCount}{" "}
                confirmation-required
              </Text>
              <Text color="whiteAlpha.700" fontSize="sm">
                {voiceAttackReviewReport.responsePlaceholderCount} response
                placeholders / {voiceAttackReviewReport.unsupportedActionCount}{" "}
                unsupported actions
              </Text>
              {voiceAttackReviewReport.findings.length > 0 && (
                <Box mt={2}>
                  {voiceAttackReviewReport.findings.map((finding) => (
                    <Text key={finding} color="orange.300" fontSize="sm">
                      {finding}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Flex>
  );

  if (!available) {
    return (
      <Box p={4}>
        <Text color="whiteAlpha.800">{t("assistant.unavailable")}</Text>
      </Box>
    );
  }

  return (
    <Box {...settingStyles.settingUI.container}>
      <Flex direction="column" gap={4}>
        <Box {...sectionCardProps} ref={profileWorkspaceRef}>
          <Flex justify="space-between" align="start" gap={4} wrap="wrap">
            <Box>
              <Text color="white" fontWeight="semibold" mb={2}>
                {t("assistant.title")}
              </Text>
              <Text color="whiteAlpha.800">
                {t(`assistant.status.${status}`)}
              </Text>
              <Text
                color={backendConnected ? "green.300" : "orange.300"}
                fontSize="sm"
              >
                {backendConnected
                  ? t("assistant.backendConnected")
                  : t("assistant.backendDisconnected")}
              </Text>
            </Box>
            <Box textAlign={{ base: "left", md: "right" }}>
              <Text
                color={draftDirty ? "orange.300" : "whiteAlpha.700"}
                fontSize="sm"
              >
                {draftDirty ? "Unsaved draft changes" : "Workspace ready"}
              </Text>
              <Text color="whiteAlpha.600" fontSize="sm">
                {runtimeEffectiveProfileLabel}
              </Text>
            </Box>
          </Flex>

          <Flex gap={3} wrap="wrap" mt={4}>
            <Box {...insetCardProps} minW="180px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Current profile
              </Text>
              <Text color="white" fontWeight="medium">
                {runtimeEffectiveProfileLabel}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="180px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.runtime.detectedApplication")}
              </Text>
              <Text color="white" fontWeight="medium">
                {runtimeDetectedApplication?.windowTitle ??
                  t("assistant.runtime.noActiveApplication")}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="140px">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.runtime.queueSummary")}
              </Text>
              <Text color="white" fontWeight="medium">
                {assistantState?.queueSummary.total ?? 0}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="140px">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.pendingConfirmations")}
              </Text>
              <Text color="white" fontWeight="medium">
                {pendingConfirmations.length}
              </Text>
            </Box>
          </Flex>

          <Flex gap={3} flexWrap="wrap" mt={4}>
            <Button onClick={() => void importProfiles()}>
              {t("assistant.import")}
            </Button>
            <Button
              onClick={() =>
                selectedProfileId &&
                void exportProfile({
                  profileId: selectedProfileId,
                  format: "json",
                })
              }
            >
              {t("assistant.exportJson")}
            </Button>
            <Button
              onClick={() =>
                selectedProfileId &&
                void exportProfile({
                  profileId: selectedProfileId,
                  format: "yaml",
                })
              }
            >
              {t("assistant.exportYaml")}
            </Button>
            <Button onClick={() => void handleSave()} colorPalette="blue">
              {t("assistant.saveProfile")}
            </Button>
            <Button onClick={handleCancel} {...outlineButtonStyle}>
              {t("assistant.revertDraft")}
            </Button>
          </Flex>
        </Box>

        <Box p={3} borderRadius="lg" bg="orange.100" color="gray.900">
          <Text fontWeight="semibold">{t("assistant.warnings.title")}</Text>
          <Text fontSize="sm">{t("assistant.warnings.input")}</Text>
          <Text fontSize="sm">{t("assistant.warnings.syntheticInput")}</Text>
          <Text fontSize="sm">{t("assistant.warnings.imports")}</Text>
          <Text fontSize="sm">{t("assistant.warnings.highRisk")}</Text>
        </Box>

        <Box {...sectionCardProps}>
          <Flex justify="space-between" align="start" gap={4} wrap="wrap">
            <Box maxW="760px">
              <Text color="white" fontWeight="semibold">
                VoiceAttack import workspace
              </Text>
              <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
                Review exported VoiceAttack profiles in a dedicated pop-out
                workspace, then save a disabled draft and finish cleanup in the
                assistant profile editor.
              </Text>
            </Box>
            <Flex gap={2} wrap="wrap">
              <Button
                colorPalette="blue"
                onClick={() => {
                  setVoiceAttackDialogOpen(true);
                }}
              >
                Open import workspace
              </Button>
              <Button
                {...outlineButtonStyle}
                onClick={() => {
                  setVoiceAttackDialogOpen(true);
                  void handleInspectVoiceAttack();
                }}
              >
                Inspect source
              </Button>
              <Button
                {...outlineButtonStyle}
                disabled={!draftProfile}
                onClick={() =>
                  draftProfile && openProfileInEditor(draftProfile.profileId)
                }
              >
                Open profile editor
              </Button>
            </Flex>
          </Flex>

          <Flex gap={3} wrap="wrap" mt={4}>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Workspace status
              </Text>
              <Text color="white" fontWeight="medium">
                {voiceAttackWorkspaceStatusLabel}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Current source
              </Text>
              <Text color="white" fontWeight="medium">
                {voiceAttackWorkspaceSourceLabel}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Selection
              </Text>
              <Text color="white" fontWeight="medium">
                {voiceAttackWorkspaceSelectionLabel}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                Imported draft
              </Text>
              <Text color="white" fontWeight="medium">
                {importedDraftSummaryLabel}
              </Text>
            </Box>
          </Flex>

          {voiceAttackReviewReport && (
            <Text
              color={
                voiceAttackReviewReport.readyToMarkReviewed
                  ? "green.300"
                  : "orange.300"
              }
              fontSize="sm"
              mt={3}
            >
              {voiceAttackReviewReport.readyToMarkReviewed
                ? "Imported draft is ready to mark reviewed."
                : `${voiceAttackReviewReport.findings.length} review item(s) remain before review can be marked complete.`}
            </Text>
          )}
        </Box>

        <DialogRoot
          open={voiceAttackDialogOpen}
          onOpenChange={(event) => setVoiceAttackDialogOpen(event.open)}
          scrollBehavior="inside"
        >
          <DialogContent
            style={{
              width: "min(94vw, 1600px)",
              maxWidth: "94vw",
              maxHeight: "92vh",
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#f8fafc",
            }}
          >
            <DialogHeader>
              <DialogTitle>VoiceAttack import workspace</DialogTitle>
              <DialogCloseTrigger />
            </DialogHeader>

            <DialogBody pb={4}>{voiceAttackImportWorkspace}</DialogBody>

            <DialogFooter>
              <Flex
                width="100%"
                direction="column"
                align="stretch"
                gap={3}
                wrap="wrap"
              >
                <Flex justify="space-between" align="center" gap={3} wrap="wrap">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {voiceAttackPreview
                      ? `${voiceAttackPreview.profileName} - ${selectedVoiceAttackCommandIds.length}/${voiceAttackPreview.commandCount} selected`
                      : voiceAttackInspection
                        ? `${voiceAttackInspection.sourceBasename} loaded`
                        : "No VoiceAttack source selected"}
                  </Text>
                  <Flex gap={2} wrap="wrap">
                    <Button
                      {...outlineButtonStyle}
                      onClick={() => setVoiceAttackDialogOpen(false)}
                    >
                      Close
                    </Button>
                    <Button
                      colorPalette="green"
                      disabled={
                        !voiceAttackPreview ||
                        selectedVoiceAttackCommandIds.length === 0
                      }
                      onClick={() => void handleImportVoiceAttackDraft()}
                    >
                      {voiceAttackSaveDraftButtonLabel}
                    </Button>
                  </Flex>
                </Flex>
                {(voiceAttackSaveDraftDisabledReason ||
                  voiceAttackPreviewStatus) && (
                  <Text
                    color={
                      voiceAttackPreviewStatus
                        ? voiceAttackPreviewStatusColor
                        : "orange.200"
                    }
                    fontSize="sm"
                  >
                    {voiceAttackPreviewStatus?.message ??
                      voiceAttackSaveDraftDisabledReason}
                  </Text>
                )}
              </Flex>
            </DialogFooter>
          </DialogContent>
        </DialogRoot>

        {/*
        <Box {...sectionCardProps}>
          <details open>
            <summary style={detailsSummaryStyle}>
              <span>VoiceAttack Import</span>
              <span style={detailsMetaStyle}>
                {voiceAttackInspection
                  ? `${voiceAttackInspection.parseableFileCount}/${voiceAttackInspection.candidateProfileCount} parseable`
                  : 'No source selected'}
              </span>
            </summary>
            <Box mt={3}>
              <Text color="whiteAlpha.700" fontSize="sm">
                Local-only inspection and import. Choose an exported `.vap` or `.vax` file, or pick a folder to scan recursively. Source paths stay in the Electron main process, imported drafts stay disabled, and proprietary response text is never shown here.
              </Text>

              <Flex gap={3} wrap="wrap" mt={3}>
                <Button onClick={() => void handleInspectVoiceAttack()} colorPalette="blue">
                  Inspect VoiceAttack Source
                </Button>
                <Button
                  {...outlineButtonStyle}
                  disabled={!voiceAttackInspection}
                  onClick={() => voiceAttackInspection && void cancelVoiceAttackImport(voiceAttackInspection.importId)}
                >
                  Cancel session
                </Button>
                <Button
                  onClick={() => {
                    if (!voiceAttackPreview) {
                      return;
                    }
                    setSelectedVoiceAttackCommandIds(
                      voiceAttackPreview.commands
                        .filter((command) => command.supportStatus === 'supported')
                        .map((command) => command.commandId),
                    );
                  }}
                  disabled={!voiceAttackPreview}
                >
                  Select all supported
                </Button>
                <Button
                  {...outlineButtonStyle}
                  disabled={!voiceAttackPreview}
                  onClick={() => setSelectedVoiceAttackCommandIds([])}
                >
                  Select none
                </Button>
                <Button
                  colorPalette="green"
                  disabled={!voiceAttackPreview || selectedVoiceAttackCommandIds.length === 0}
                  onClick={() => void handleImportVoiceAttackDraft()}
                >
                  Save disabled draft
                </Button>
                <Button
                  {...outlineButtonStyle}
                  disabled={!voiceAttackInspection || !selectedVoiceAttackCandidateId}
                  onClick={() => void handleExportVoiceAttackDiagnosticReport()}
                >
                  Export diagnostic report
                </Button>
                <Button
                  disabled={!draftProfile?.importMetadata?.imported}
                  onClick={() => void handleValidateImportedDraft()}
                >
                  Validate draft
                </Button>
                <Button
                  disabled={!draftProfile?.importMetadata?.imported}
                  onClick={() => void handleMarkImportedDraftReviewed()}
                >
                  Mark reviewed
                </Button>
                <Button
                  {...outlineButtonStyle}
                  disabled={!draftProfile}
                  onClick={() => draftProfile && openProfileInEditor(draftProfile.profileId)}
                >
                  Open in editor
                </Button>
              </Flex>

              {voiceAttackBusyLabel && (
                <Text color="blue.200" fontSize="sm" mt={3}>{voiceAttackBusyLabel}</Text>
              )}

              {voiceAttackInspection && (
                <Flex gap={3} wrap="wrap" mt={3}>
                  <Box {...insetCardProps} minW="200px">
                    <Text color="whiteAlpha.600" fontSize="sm">Source</Text>
                    <Text color="white">{voiceAttackInspection.sourceBasename}</Text>
                  </Box>
                  <Box {...insetCardProps} minW="160px">
                    <Text color="whiteAlpha.600" fontSize="sm">Formats</Text>
                    <Text color="white">
                      {voiceAttackInspection.formatsDiscovered.map(formatVoiceAttackSourceFormat).join(', ') || 'None'}
                    </Text>
                  </Box>
                  <Box {...insetCardProps} minW="160px">
                    <Text color="whiteAlpha.600" fontSize="sm">Supported categories</Text>
                    <Text color="white">{voiceAttackInspection.supportedImportCategories.join(', ') || 'None'}</Text>
                  </Box>
                  <Box {...insetCardProps} minW="160px">
                    <Text color="whiteAlpha.600" fontSize="sm">Partial categories</Text>
                    <Text color="white">{voiceAttackInspection.partiallySupportedCategories.join(', ') || 'None'}</Text>
                  </Box>
                  <Box {...insetCardProps} minW="160px">
                    <Text color="whiteAlpha.600" fontSize="sm">Unsupported categories</Text>
                    <Text color="white">{voiceAttackInspection.unsupportedCategories.join(', ') || 'None'}</Text>
                  </Box>
                  <Box {...insetCardProps} minW="160px">
                    <Text color="whiteAlpha.600" fontSize="sm">Profiles</Text>
                    <Text color="white">
                      {voiceAttackInspection.parseableFileCount} parseable / {voiceAttackInspection.unparseableFileCount} blocked
                    </Text>
                  </Box>
                </Flex>
              )}

              {voiceAttackInspection && (
                <Box mt={3}>
                  <Text color="whiteAlpha.700" mb={1}>Discovered profiles</Text>
                  <select
                    style={selectStyles}
                    value={selectedVoiceAttackCandidateId ?? ''}
                    onChange={(event) => {
                      selectVoiceAttackCandidate(event.target.value || null);
                    }}
                  >
                    <option value="" style={optionStyles}>Select a discovered profile</option>
                    {voiceAttackInspection.candidates.map((candidate) => (
                      <option key={candidate.candidateId} value={candidate.candidateId} style={optionStyles}>
                        {candidate.sourceBasename} • {candidate.parseable ? 'parseable' : 'unparseable'}
                      </option>
                    ))}
                  </select>
                  <Flex gap={3} wrap="wrap" align="center" mt={3}>
                    <Button
                      {...outlineButtonStyle}
                      disabled={!selectedVoiceAttackCandidate?.parseable}
                      onClick={() => void handlePreviewSelectedVoiceAttackCandidate()}
                    >
                      Load preview
                    </Button>
                    <Text color="whiteAlpha.600" fontSize="sm">
                      Preview loads on demand so large VoiceAttack profiles do not stall the settings UI.
                    </Text>
                  </Flex>
                  {selectedVoiceAttackCandidate && (
                    <Flex gap={3} wrap="wrap" mt={3}>
                      <Box {...insetCardProps} minW="180px">
                        <Text color="whiteAlpha.600" fontSize="sm">Decoder</Text>
                        <Text color="white">{formatVoiceAttackDecoderStatus(selectedVoiceAttackCandidate.decoderStatus)}</Text>
                      </Box>
                      <Box {...insetCardProps} minW="240px">
                        <Text color="whiteAlpha.600" fontSize="sm">Envelope</Text>
                        <Text color="white">{selectedVoiceAttackCandidate.envelopeFormat ?? 'Unknown'}</Text>
                      </Box>
                      <Box {...insetCardProps} minW="180px">
                        <Text color="whiteAlpha.600" fontSize="sm">Package entries</Text>
                        <Text color="white">{selectedVoiceAttackCandidate.packageEntries.length}</Text>
                      </Box>
                    </Flex>
                  )}
                  {selectedVoiceAttackCandidate && selectedVoiceAttackCandidate.parseError && (
                    <Text color="orange.300" fontSize="sm" mt={2}>{selectedVoiceAttackCandidate.parseError}</Text>
                  )}
                </Box>
              )}

              {voiceAttackPreview && (
                <Box mt={4}>
                  <Flex gap={3} wrap="wrap">
                    <Box {...insetCardProps} minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">Profile</Text>
                      <Text color="white">{voiceAttackPreview.profileName}</Text>
                    </Box>
                    <Box {...insetCardProps} minW="160px">
                      <Text color="whiteAlpha.600" fontSize="sm">Format/version</Text>
                      <Text color="white">
                        {formatVoiceAttackSourceFormat(voiceAttackPreview.sourceFormat)} / {voiceAttackPreview.originalProfileVersion ?? 'unknown'}
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="160px">
                      <Text color="whiteAlpha.600" fontSize="sm">Commands</Text>
                      <Text color="white">
                        {voiceAttackPreview.commandCount} total • {voiceAttackPreview.supportedCommandCount} supported • {voiceAttackPreview.partiallySupportedCommandCount} partial • {voiceAttackPreview.unsupportedCommandCount} unsupported
                      </Text>
                    </Box>
                    <Box {...insetCardProps} minW="160px">
                      <Text color="whiteAlpha.600" fontSize="sm">Warnings</Text>
                      <Text color="white">
                        {voiceAttackPreview.responsePlaceholderCount} response placeholders • {voiceAttackPreview.unresolvedNestedReferenceCount} unresolved nested refs • {voiceAttackPreview.recursionWarningCount} recursion warnings
                      </Text>
                    </Box>
                  </Flex>

                  <Flex gap={3} wrap="wrap" mt={3}>
                    <Box {...insetCardProps} minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">Decoder</Text>
                      <Text color="white">{formatVoiceAttackDecoderStatus(voiceAttackPreview.decoderStatus)}</Text>
                    </Box>
                    <Box {...insetCardProps} minW="240px">
                      <Text color="whiteAlpha.600" fontSize="sm">Envelope</Text>
                      <Text color="white">{voiceAttackPreview.envelopeFormat ?? 'Unknown'}</Text>
                    </Box>
                    <Box {...insetCardProps} minW="220px">
                      <Text color="whiteAlpha.600" fontSize="sm">Variables/plugins</Text>
                      <Text color="white">
                        {voiceAttackPreview.unresolvedVariableCount} variable refs / {voiceAttackPreview.unresolvedPluginCount} plugin calls
                      </Text>
                    </Box>
                    {voiceAttackPreview.containerBasename && (
                      <Box {...insetCardProps} minW="240px">
                        <Text color="whiteAlpha.600" fontSize="sm">Package</Text>
                        <Text color="white">{voiceAttackPreview.containerBasename}</Text>
                        <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
                          {voiceAttackPreview.embeddedEntryName ?? 'Embedded profile'}
                        </Text>
                      </Box>
                    )}
                    {voiceAttackPreview.diagnostics && (
                      <>
                        <Box {...insetCardProps} minW="180px">
                          <Text color="whiteAlpha.600" fontSize="sm">Compressed size</Text>
                          <Text color="white">{voiceAttackPreview.diagnostics.compressedSize.toLocaleString()} bytes</Text>
                        </Box>
                        <Box {...insetCardProps} minW="180px">
                          <Text color="whiteAlpha.600" fontSize="sm">Inflated size</Text>
                          <Text color="white">{voiceAttackPreview.diagnostics.inflatedSize?.toLocaleString() ?? 'Unknown'} bytes</Text>
                        </Box>
                        <Box {...insetCardProps} minW="160px">
                          <Text color="whiteAlpha.600" fontSize="sm">Header index</Text>
                          <Text color="white">{voiceAttackPreview.diagnostics.lastPropertyIndex ?? 'Unknown'}</Text>
                        </Box>
                        <Box {...insetCardProps} minW="160px">
                          <Text color="whiteAlpha.600" fontSize="sm">Offset count</Text>
                          <Text color="white">{voiceAttackPreview.diagnostics.propertyOffsets.length}</Text>
                        </Box>
                      </>
                    )}
                  </Flex>

                  {(voiceAttackPreview.packageEntries.length > 0 || voiceAttackPreview.embeddedProfiles.length > 0) && (
                    <Flex gap={3} wrap="wrap" mt={3} align="start">
                      {voiceAttackPreview.packageEntries.length > 0 && (
                        <Box {...insetCardProps} flex="1 1 340px">
                          <Text color="white" fontWeight="semibold" mb={2}>Package inventory</Text>
                          <Flex direction="column" gap={2} maxH="180px" overflowY="auto" pr={1}>
                            {voiceAttackPreview.packageEntries.map((entry) => (
                              <Box key={entry.entryName} p={2} borderRadius="md" bg="whiteAlpha.50">
                                <Text color="white" fontSize="sm">{entry.entryName}</Text>
                                <Text color="whiteAlpha.700" fontSize="xs">
                                  {entry.kind} / {entry.uncompressedSize.toLocaleString()} bytes
                                  {entry.blockedReason ? ` / ${entry.blockedReason}` : ''}
                                </Text>
                              </Box>
                            ))}
                          </Flex>
                        </Box>
                      )}
                      {voiceAttackPreview.embeddedProfiles.length > 0 && (
                        <Box {...insetCardProps} flex="1 1 280px">
                          <Text color="white" fontWeight="semibold" mb={2}>Embedded profiles</Text>
                          <Flex direction="column" gap={2}>
                            {voiceAttackPreview.embeddedProfiles.map((entry) => (
                              <Box key={entry.entryName} p={2} borderRadius="md" bg="whiteAlpha.50">
                                <Text color="white" fontSize="sm">{entry.entryName}</Text>
                                <Text color="whiteAlpha.700" fontSize="xs">
                                  {formatVoiceAttackSourceFormat(entry.sourceFormat)} / {formatVoiceAttackDecoderStatus(entry.decoderStatus)} / {entry.parseable ? 'parseable' : 'blocked'}
                                </Text>
                              </Box>
                            ))}
                          </Flex>
                        </Box>
                      )}
                    </Flex>
                  )}

                  {Object.keys(voiceAttackPreview.actionTypeCounts).length > 0 && (
                    <Box mt={3} {...insetCardProps}>
                      <Text color="white" fontWeight="semibold" mb={2}>Action counts by type</Text>
                      <Flex gap={2} wrap="wrap" maxH="180px" overflowY="auto" pr={1}>
                        {Object.entries(voiceAttackPreview.actionTypeCounts)
                          .sort((left, right) => right[1] - left[1])
                          .map(([actionType, count]) => (
                            <Box key={actionType} px={2} py={1} borderRadius="md" bg="whiteAlpha.50">
                              <Text color="white" fontSize="sm">{actionType}</Text>
                              <Text color="whiteAlpha.700" fontSize="xs">{count}</Text>
                            </Box>
                          ))}
                      </Flex>
                    </Box>
                  )}

                  {voiceAttackPreview.warnings.length > 0 && (
                    <Box mt={3} {...insetCardProps}>
                      <Text color="orange.200" fontWeight="semibold">Import warnings</Text>
                      {voiceAttackPreview.warnings.map((warning) => (
                        <Text key={warning} color="orange.100" fontSize="sm">{warning}</Text>
                      ))}
                    </Box>
                  )}

                  <Flex gap={3} wrap="wrap" mt={3} align="end">
                    <Box minW="220px" flex="1 1 260px">
                      <Text color="whiteAlpha.700" mb={1}>Search commands</Text>
                      <input
                        style={fieldStyle}
                        placeholder="Name, alias, category, action type"
                        value={voiceAttackSearchDraft}
                        onChange={(event) => setVoiceAttackSearchDraft(event.target.value)}
                      />
                    </Box>
                    <Box minW="180px">
                      <Text color="whiteAlpha.700" mb={1}>Filter commands</Text>
                      <select
                        style={selectStyles}
                        value={voiceAttackSupportFilter}
                        onChange={(event) => setVoiceAttackSupportFilter(event.target.value as VoiceAttackSupportFilter)}
                      >
                        <option value="all" style={optionStyles}>all</option>
                        <option value="supported" style={optionStyles}>supported</option>
                        <option value="partially_supported" style={optionStyles}>partially supported</option>
                        <option value="unsupported" style={optionStyles}>unsupported</option>
                      </select>
                    </Box>
                    <Box minW="180px">
                      <Text color="whiteAlpha.700" mb={1}>Visible / selected</Text>
                      <Text color="white">{filteredVoiceAttackCommands.length} / {selectedVoiceAttackCommandIds.length}</Text>
                    </Box>
                  </Flex>
                  <Flex gap={2} wrap="wrap" mt={3}>
                    <Button
                      {...smallButtonStyle}
                      disabled={filteredVoiceAttackCommandIds.length === 0}
                      onClick={() => replaceVoiceAttackSelection(filteredVoiceAttackCommandIds)}
                    >
                      Select visible
                    </Button>
                    <Button
                      {...smallButtonStyle}
                      disabled={filteredVoiceAttackCommandIds.length === 0}
                      onClick={() => replaceVoiceAttackSelection(
                        filteredVoiceAttackCommands
                          .filter((command) => command.supportStatus !== 'unsupported')
                          .map((command) => command.commandId),
                      )}
                    >
                      Select visible reviewable
                    </Button>
                    <Button
                      {...smallButtonStyle}
                      disabled={filteredVoiceAttackCommandIds.length === 0}
                      onClick={() => removeVoiceAttackSelection(filteredVoiceAttackCommandIds)}
                    >
                      Clear visible
                    </Button>
                  </Flex>

                  <Flex direction="column" gap={2} mt={3} maxH="360px" overflowY="auto" pr={1}>
                    {filteredVoiceAttackCommands.map((command) => (
                      <Box key={command.commandId} {...insetCardProps}>
                        <Flex justify="space-between" gap={3} align="start" wrap="wrap">
                          <label style={{ ...checkboxLabelStyle, alignItems: 'flex-start' }}>
                            <input
                              type="checkbox"
                              checked={selectedVoiceAttackCommandIds.includes(command.commandId)}
                              onChange={(event) => setSelectedVoiceAttackCommandIds((current) => (
                                event.target.checked
                                  ? [...current, command.commandId]
                                  : current.filter((item) => item !== command.commandId)
                              ))}
                            />
                            <Box>
                              <Text color="white" fontWeight="semibold">{command.label}</Text>
                              <Text color="whiteAlpha.600" fontSize="sm">
                                {command.supportStatus} • {command.aliases.length} aliases • {command.keyInputCount} key actions
                              </Text>
                            </Box>
                          </label>
                          <Text color="whiteAlpha.700" fontSize="sm">
                            {command.responsePlaceholderCount} response placeholders • {command.unsupportedActionCount} unsupported actions
                          </Text>
                        </Flex>
                        {command.aliases.length > 0 && (
                          <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                            Aliases: {command.aliases.join(', ')}
                          </Text>
                        )}
                        {command.description && (
                          <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                            {command.description}
                          </Text>
                        )}
                        <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                          Trigger: {formatVoiceAttackTriggerMode(command.triggerMode)} / Action types: {command.actionTypes.join(', ') || 'None'}
                        </Text>
                        <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                          {command.actionSummaries.join(' • ')}
                        </Text>
                        <Flex direction="column" gap={2} mt={2}>
                          {command.actions.map((action, index) => (
                            <Box key={`${command.commandId}-${action.actionType}-${index}`} p={2} borderRadius="md" bg="whiteAlpha.50">
                              <Text color="white" fontSize="sm">{action.actionType}</Text>
                              <Text color="whiteAlpha.700" fontSize="xs">{action.supportStatus} / {action.summary}</Text>
                            </Box>
                          ))}
                        </Flex>
                        {command.warnings.length > 0 && (
                          <Box mt={2}>
                            {command.warnings.map((warning) => (
                              <Text key={warning} color="orange.300" fontSize="sm">{warning}</Text>
                            ))}
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Flex>
                </Box>
              )}

              {draftProfile?.importMetadata?.imported && (
                <Box mt={4} {...insetCardProps}>
                  <Text color="white" fontWeight="semibold">Imported draft review</Text>
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {draftProfile.importMetadata.sourceBasename} • {importedDraftSummaryLabel}
                  </Text>
                  {voiceAttackReviewReport && (
                    <Box mt={2}>
                      <Text color={voiceAttackReviewReport.readyToMarkReviewed ? 'green.300' : 'orange.300'} fontSize="sm">
                        {voiceAttackReviewReport.readyToMarkReviewed
                          ? 'Ready to mark reviewed.'
                          : `${voiceAttackReviewReport.findings.length} review item(s) remain.`}
                      </Text>
                      <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
                        {voiceAttackReviewReport.executableCommandCount} executable • {voiceAttackReviewReport.keyInputCommandCount} key-input • {voiceAttackReviewReport.confirmationRequiredCommandCount} confirmation-required
                      </Text>
                      <Text color="whiteAlpha.700" fontSize="sm">
                        {voiceAttackReviewReport.responsePlaceholderCount} response placeholders • {voiceAttackReviewReport.unsupportedActionCount} unsupported actions
                      </Text>
                      {voiceAttackReviewReport.findings.length > 0 && (
                        <Box mt={2}>
                          {voiceAttackReviewReport.findings.map((finding) => (
                            <Text key={finding} color="orange.300" fontSize="sm">{finding}</Text>
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          </details>
        </Box>
        */}

        <Box {...sectionCardProps}>
          <Text color="white" fontWeight="semibold" mb={1}>
            {t("assistant.voice.title")}
          </Text>
          <Text color="whiteAlpha.600" fontSize="sm" mb={3}>
            {t("assistant.voice.description")}
          </Text>
          {alwaysListeningWarning && (
            <Text color="orange.300" fontSize="sm" mb={3}>
              {t("assistant.voice.alwaysListeningWarning")}
            </Text>
          )}

          <Flex gap={3} wrap="wrap">
            <Box minW="200px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.voice.activationMode")}
              </Text>
              <select
                style={selectStyles}
                value={voiceCommandActivationModeDraft}
                onChange={(event) =>
                  setVoiceCommandActivationModeDraft(
                    event.target.value as VoiceCommandActivationMode,
                  )
                }
              >
                {VOICE_COMMAND_ACTIVATION_MODES.map((mode) => (
                  <option key={mode} value={mode} style={optionStyles}>
                    {t(`assistant.voice.activationModes.${mode}`)}
                  </option>
                ))}
              </select>
            </Box>
            <Box flex="1" minW="260px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.voice.wakePhrases")}
              </Text>
              <textarea
                style={{
                  ...fieldStyle,
                  minHeight: 64,
                  opacity:
                    voiceCommandActivationModeDraft === "wake_phrase"
                      ? 1
                      : 0.72,
                }}
                value={voiceCommandWakePhrasesDraft}
                disabled={voiceCommandActivationModeDraft !== "wake_phrase"}
                onChange={(event) =>
                  setVoiceCommandWakePhrasesDraft(event.target.value)
                }
              />
            </Box>
            <Box flex="1" minW="260px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.voice.pushHotkey")}
              </Text>
              <input
                style={{
                  ...fieldStyle,
                  opacity:
                    voiceCommandActivationModeDraft === "push_to_command"
                      ? 1
                      : 0.72,
                }}
                value={voiceCommandPushToCommandHotkeyDraft}
                disabled={voiceCommandActivationModeDraft !== "push_to_command"}
                onChange={(event) =>
                  setVoiceCommandPushToCommandHotkeyDraft(event.target.value)
                }
              />
            </Box>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.voice.ambiguityTimeout")}
              </Text>
              <input
                type="number"
                min={2000}
                max={120000}
                style={fieldStyle}
                value={voiceCommandAmbiguityTimeoutDraft}
                onChange={(event) =>
                  setVoiceCommandAmbiguityTimeoutDraft(event.target.value)
                }
              />
            </Box>
            <Box minW="200px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.voice.ackMode")}
              </Text>
              <select
                style={selectStyles}
                value={voiceCommandAcknowledgementModeDraft}
                onChange={(event) =>
                  setVoiceCommandAcknowledgementModeDraft(
                    event.target.value as VoiceCommandAcknowledgementMode,
                  )
                }
              >
                {VOICE_COMMAND_ACKNOWLEDGEMENT_MODES.map((mode) => (
                  <option key={mode} value={mode} style={optionStyles}>
                    {t(`assistant.voice.ackModes.${mode}`)}
                  </option>
                ))}
              </select>
            </Box>
          </Flex>

          <Flex gap={3} wrap="wrap" mt={3}>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.voice.currentMode")}
              </Text>
              <Text color="white">{voiceCommandActivationLabel}</Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.voice.listeningState")}
              </Text>
              <Text
                color={
                  snapshot?.voiceCommandListeningActive ? "green.300" : "white"
                }
              >
                {voiceCommandListeningLabel}
              </Text>
              <Text
                color={
                  snapshot?.voiceCommandHotkeyError
                    ? "orange.300"
                    : "whiteAlpha.600"
                }
                fontSize="sm"
                mt={1}
              >
                {voiceCommandHotkeyStatusLabel}
              </Text>
            </Box>
            <Box {...insetCardProps} minW="220px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.voice.acknowledgements")}
              </Text>
              <Text color="white">{voiceCommandAcknowledgementLabel}</Text>
            </Box>
            <Box {...insetCardProps} minW="240px" flex="1">
              <Text color="whiteAlpha.600" fontSize="sm">
                {t("assistant.voice.matchingStatus")}
              </Text>
              <Text color="white">
                {t("assistant.voice.matchingStatusValue")}
              </Text>
            </Box>
          </Flex>

          {voiceCommandActivationModeDraft === "push_to_command" && (
            <Flex gap={3} wrap="wrap" mt={3}>
              <Button
                colorPalette={
                  snapshot?.voiceCommandListeningActive ? "green" : "blue"
                }
                onMouseDown={() => void setVoiceCommandListeningActive(true)}
                onMouseUp={() => void setVoiceCommandListeningActive(false)}
                onMouseLeave={() => void setVoiceCommandListeningActive(false)}
                onTouchStart={() => void setVoiceCommandListeningActive(true)}
                onTouchEnd={() => void setVoiceCommandListeningActive(false)}
              >
                {t("assistant.voice.holdToListen")}
              </Button>
              <Button
                {...outlineButtonStyle}
                onClick={() =>
                  void setVoiceCommandListeningActive(
                    !snapshot?.voiceCommandListeningActive,
                  )
                }
              >
                {snapshot?.voiceCommandListeningActive
                  ? t("assistant.voice.stopListening")
                  : t("assistant.voice.startListening")}
              </Button>
            </Flex>
          )}

          {pendingVoiceAmbiguity && (
            <Box {...insetCardProps} mt={3}>
              <Text color="white" fontWeight="medium">
                {t("assistant.voice.pendingAmbiguity")}
              </Text>
              <Text color="whiteAlpha.700" fontSize="sm" mt={1}>
                {pendingVoiceAmbiguity.transcript}
              </Text>
              <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                {t("assistant.countdown")}:{" "}
                {formatCountdown(pendingVoiceAmbiguity.expiresAt, nowMs)}
              </Text>
              <Flex direction="column" gap={2} mt={3}>
                {pendingVoiceAmbiguity.candidates.map((candidate) => (
                  <Flex
                    key={candidate.commandId}
                    justify="space-between"
                    align="center"
                    gap={3}
                    wrap="wrap"
                  >
                    <Text color="white">{candidate.label}</Text>
                    <Button
                      size="xs"
                      colorPalette="blue"
                      onClick={() =>
                        respondToVoiceCommandAmbiguity(
                          pendingVoiceAmbiguity.ambiguityId,
                          "select",
                          candidate.commandId,
                        )
                      }
                    >
                      {t("assistant.voice.selectCandidate")}
                    </Button>
                  </Flex>
                ))}
              </Flex>
              <Button
                {...outlineButtonStyle}
                mt={3}
                onClick={() =>
                  respondToVoiceCommandAmbiguity(
                    pendingVoiceAmbiguity.ambiguityId,
                    "cancel",
                  )
                }
              >
                {t("assistant.voice.cancelAmbiguity")}
              </Button>
            </Box>
          )}

          <Box {...insetCardProps} mt={3}>
            <Text color="white" fontWeight="medium">
              {t("assistant.voice.testPanel")}
            </Text>
            <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
              {t("assistant.voice.testPanelDescription")}
            </Text>
            <Flex gap={3} wrap="wrap" mt={3}>
              <input
                style={{ ...fieldStyle, flex: 1, minWidth: 260 }}
                value={voiceCommandTestDraft}
                onChange={(event) =>
                  setVoiceCommandTestDraft(event.target.value)
                }
                placeholder={t("assistant.voice.testInputPlaceholder")}
              />
              <Button
                colorPalette="blue"
                disabled={!backendConnected || !voiceCommandTestDraft.trim()}
                onClick={handleVoiceCommandResolveTest}
              >
                {t("assistant.voice.testResolution")}
              </Button>
            </Flex>

            {voiceCommandResolveResult && (
              <Flex direction="column" gap={2} mt={3}>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.selectedProfile")}:{" "}
                  {runtimeEffectiveProfileId ?? t("assistant.runtime.none")}
                </Text>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.normalizedPhrase")}:{" "}
                  {voiceCommandResolveResult.normalized_phrase ||
                    t("assistant.runtime.none")}
                </Text>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.matchResult")}:{" "}
                  {t(
                    `assistant.voice.results.${voiceCommandResolveResult.result}`,
                  )}
                </Text>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.activationState")}:{" "}
                  {voiceCommandResolveResult.activation_met
                    ? t("assistant.voice.activationMet")
                    : t("assistant.voice.activationNotMet")}
                </Text>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.selectedCommand")}:{" "}
                  {voiceCommandResolveResult.matched_command_label ??
                    t("assistant.runtime.none")}
                </Text>
                <Text color="whiteAlpha.700" fontSize="sm">
                  {t("assistant.voice.candidateCommands")}:{" "}
                  {voiceCommandResolveResult.candidate_command_labels.join(
                    ", ",
                  ) || t("assistant.runtime.none")}
                </Text>
                {voiceCommandResolveResult.blocked_reason && (
                  <Text color="orange.300" fontSize="sm">
                    {t("assistant.voice.blockedReason")}:{" "}
                    {voiceCommandResolveResult.blocked_reason}
                  </Text>
                )}
              </Flex>
            )}
          </Box>

          <Box mt={3}>
            <Text color="white" fontWeight="medium">
              {t("assistant.voice.recentActivity")}
            </Text>
            <Flex direction="column" gap={2} mt={2}>
              {recentResolverActivity.length > 0 ? (
                recentResolverActivity.slice(0, 8).map((entry) => (
                  <Box key={entry.activityId} {...insetCardProps}>
                    <Text color="white">{entry.transcript}</Text>
                    <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                      {t(`assistant.voice.results.${entry.result}`)} ·{" "}
                      {entry.activationMet
                        ? t("assistant.voice.activationMet")
                        : t("assistant.voice.activationNotMet")}
                      {entry.matchedCommandLabel
                        ? ` · ${entry.matchedCommandLabel}`
                        : ""}
                      {entry.requestId ? ` · ${entry.requestId}` : ""}
                    </Text>
                    {entry.candidateCommandLabels.length > 0 && (
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.voice.candidateCommands")}:{" "}
                        {entry.candidateCommandLabels.join(", ")}
                      </Text>
                    )}
                    {entry.blockedReason && (
                      <Text color="orange.300" fontSize="sm">
                        {entry.blockedReason}
                      </Text>
                    )}
                    {entry.fellBackToConversation && (
                      <Text color="blue.200" fontSize="sm">
                        {t("assistant.voice.fellBackToConversation")}
                      </Text>
                    )}
                  </Box>
                ))
              ) : (
                <Text color="whiteAlpha.600">
                  {t("assistant.voice.noRecentActivity")}
                </Text>
              )}
            </Flex>
          </Box>
        </Box>

        <Box {...sectionCardProps}>
          <details>
            <summary style={detailsSummaryStyle}>
              <span>{t("assistant.runtime.title")}</span>
              <span style={detailsMetaStyle}>{runtimeSummaryLabel}</span>
            </summary>
            <Box mt={3}>
              <Flex gap={4} wrap="wrap">
                <Box minW="220px" flex="1">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.detectedApplication")}
                  </Text>
                  <Text color="whiteAlpha.900">{detectedApplicationLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.matchedProfile")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {runtimeMatchedProfileLabel}
                  </Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.profileMatchStatus")}
                  </Text>
                  <Text color="whiteAlpha.900">{profileMatchStatusLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.effectiveProfile")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {runtimeEffectiveProfileLabel}
                  </Text>
                </Box>
                <Box minW="160px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.selectionSource")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {t(`assistant.selectionSources.${runtimeSelectionSource}`)}
                  </Text>
                </Box>
                <Box minW="140px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.speechMode")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {t(`assistant.speechModes.${runtimeSpeechMode}`)}
                  </Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.queueSummary")}
                  </Text>
                  <Text color="whiteAlpha.900">{queueSummaryLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.suppressedEvents")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {assistantState?.suppressedEventCount ?? 0}
                  </Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.playerSpeaking")}
                  </Text>
                  <Text color="whiteAlpha.900">{playerSpeakingLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.runtime.vtuberSpeaking")}
                  </Text>
                  <Text color="whiteAlpha.900">{vtuberSpeakingLabel}</Text>
                </Box>
              </Flex>
              <Box mt={3}>
                <Text color="whiteAlpha.600" fontSize="sm">
                  {t("assistant.runtime.currentEvent")}
                </Text>
                <Text color="whiteAlpha.900">
                  {assistantState?.currentEvent?.summary ??
                    t("assistant.runtime.noQueuedEvent")}
                </Text>
              </Box>
              <Box mt={3}>
                <Text color="whiteAlpha.600" fontSize="sm">
                  {t("assistant.runtime.recentActivity")}
                </Text>
                <Flex direction="column" gap={2} mt={2}>
                  {assistantActivity.length > 0 ? (
                    assistantActivity.slice(0, 6).map((entry) => (
                      <Box
                        key={entry.activityId}
                        p={2}
                        borderRadius="md"
                        bg="gray.800"
                      >
                        <Text color="whiteAlpha.900">
                          {t(`assistant.activityStatus.${entry.status}`)}:{" "}
                          {entry.summary}
                        </Text>
                        {entry.policyReason && (
                          <Text color="whiteAlpha.600" fontSize="sm">
                            {entry.policyReason}
                          </Text>
                        )}
                      </Box>
                    ))
                  ) : (
                    <Text color="whiteAlpha.600">
                      {t("assistant.runtime.noActivity")}
                    </Text>
                  )}
                </Flex>
              </Box>
            </Box>
          </details>
        </Box>

        <Box {...sectionCardProps}>
          <details>
            <summary style={detailsSummaryStyle}>
              <span>{t("assistant.telemetry.title")}</span>
              <span style={detailsMetaStyle}>{telemetrySummaryLabel}</span>
            </summary>
            <Box mt={3}>
              <Flex gap={4} wrap="wrap">
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Game
                  </Text>
                  <Text color="whiteAlpha.900">{telemetryGameLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.telemetry.adapter")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {telemetryState?.adapterId ?? t("assistant.runtime.none")}
                  </Text>
                </Box>
                <Box minW="160px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.telemetry.status")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {telemetryState?.status ?? t("assistant.runtime.none")}
                  </Text>
                </Box>
                <Box minW="160px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Source type
                  </Text>
                  <Text color="whiteAlpha.900">{telemetrySourceKindLabel}</Text>
                </Box>
                <Box minW="220px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Source location
                  </Text>
                  <Text color="whiteAlpha.900">{telemetryDirectoryLabel}</Text>
                </Box>
                <Box minW="220px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    Current source
                  </Text>
                  <Text color="whiteAlpha.900">{telemetryCurrentSourceLabel}</Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.telemetry.lastEvent")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {telemetryState?.lastEventAt ?? t("assistant.runtime.none")}
                  </Text>
                </Box>
                <Box minW="180px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.telemetry.stale")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {telemetrySnapshot?.stale
                      ? t("assistant.runtime.yes")
                      : t("assistant.runtime.no")}
                  </Text>
                </Box>
                <Box minW="140px">
                  <Text color="whiteAlpha.600" fontSize="sm">
                    {t("assistant.telemetry.confidence")}
                  </Text>
                  <Text color="whiteAlpha.900">
                    {formatTelemetryPercent(telemetrySnapshot?.confidence)}
                  </Text>
                </Box>
                {telemetryHighlights.map((highlight) => (
                  <Box key={`${highlight.key}-${highlight.label}`} minW="180px">
                    <Text color="whiteAlpha.600" fontSize="sm">
                      {highlight.label}
                    </Text>
                    <Text
                      color={
                        highlight.level === "danger"
                          ? "red.200"
                          : highlight.level === "warning"
                            ? "orange.200"
                            : highlight.level === "good"
                              ? "green.200"
                              : "whiteAlpha.900"
                      }
                    >
                      {highlight.value}
                    </Text>
                  </Box>
                ))}
                {telemetryHasEliteDetails && (
                  <>
                    <Box minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.starSystem")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.session.starSystem ??
                          t("assistant.runtime.unknown")}
                      </Text>
                    </Box>
                    <Box minW="180px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.ship")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.session.shipName ||
                          telemetrySnapshot?.session.shipType ||
                          t("assistant.runtime.unknown")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.docked")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.session.docked === null ||
                        telemetrySnapshot?.session.docked === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.session.docked
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.landed")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.session.landed === null ||
                        telemetrySnapshot?.session.landed === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.session.landed
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.danger")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.combat.inDanger === null ||
                        telemetrySnapshot?.combat.inDanger === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.combat.inDanger
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.hull")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.hullPercent ??
                          t("assistant.runtime.unknown")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.shields")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.shieldsUp === null ||
                        telemetrySnapshot?.ship.shieldsUp === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.ship.shieldsUp
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.fuel")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {formatTelemetryPercent(
                          telemetrySnapshot?.ship.fuelLevel !== null &&
                            telemetrySnapshot?.ship.fuelLevel !== undefined &&
                            telemetrySnapshot?.ship.fuelCapacity
                            ? telemetrySnapshot.ship.fuelLevel /
                                telemetrySnapshot.ship.fuelCapacity
                            : null,
                        )}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.heatWarning")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.heatWarning === null ||
                        telemetrySnapshot?.ship.heatWarning === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.ship.heatWarning
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.landingGear")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.landingGearDeployed === null ||
                        telemetrySnapshot?.ship.landingGearDeployed === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.ship.landingGearDeployed
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.hardpoints")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.hardpointsDeployed === null ||
                        telemetrySnapshot?.ship.hardpointsDeployed === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.ship.hardpointsDeployed
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                    <Box minW="140px">
                      <Text color="whiteAlpha.600" fontSize="sm">
                        {t("assistant.telemetry.supercruise")}
                      </Text>
                      <Text color="whiteAlpha.900">
                        {telemetrySnapshot?.ship.supercruise === null ||
                        telemetrySnapshot?.ship.supercruise === undefined
                          ? t("assistant.runtime.unknown")
                          : telemetrySnapshot.ship.supercruise
                            ? t("assistant.runtime.yes")
                            : t("assistant.runtime.no")}
                      </Text>
                    </Box>
                  </>
                )}
              </Flex>
              {telemetryState?.error && (
                <Text color="orange.300" fontSize="sm" mt={3}>
                  {telemetryState.error}
                </Text>
              )}
            </Box>
          </details>
        </Box>

        <Flex gap={3} align="end" flexWrap="wrap">
          <Box flex="1" minW="220px">
            <Text color="whiteAlpha.700" mb={1}>
              {t("assistant.manualProfileOverride")}
            </Text>
            <select
              style={selectStyles}
              value={manualProfileIdDraft ?? ""}
              disabled={profileSelectionModeDraft !== "manual"}
              onChange={(event) =>
                setManualProfileIdDraft(event.target.value || null)
              }
            >
              <option value="" style={optionStyles}>
                {t("assistant.noManualOverride")}
              </option>
              {snapshot?.profiles.map((profile) => (
                <option
                  key={profile.profileId}
                  value={profile.profileId}
                  style={optionStyles}
                >
                  {profile.displayName}
                </option>
              ))}
            </select>
          </Box>
          <Box minW="160px">
            <Text color="whiteAlpha.700" mb={1}>
              {t("assistant.dryRun")}
            </Text>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={dryRunDraft}
                onChange={(event) => setDryRunDraft(event.target.checked)}
              />
              {dryRunDraft ? t("assistant.enabled") : t("assistant.disabled")}
            </label>
          </Box>
          <Box flex="1" minW="220px">
            <Text color="whiteAlpha.700" mb={1}>
              {t("assistant.emergencyHotkey")}
            </Text>
            <input
              style={fieldStyle}
              value={hotkeyDraft}
              onChange={(event) => setHotkeyDraft(event.target.value)}
            />
          </Box>
        </Flex>

        <Box {...sectionCardProps}>
          <Text color="white" fontWeight="semibold" mb={1}>
            {t("assistant.llmSettings")}
          </Text>
          <Text color="whiteAlpha.600" fontSize="sm" mb={3}>
            Behavior, safety, and player-facing assistant settings.
          </Text>
          {autonomyWarningActive && (
            <Text color="orange.300" fontSize="sm" mb={3}>
              {t("assistant.autonomyWarning")}
            </Text>
          )}

          <Flex gap={4} wrap="wrap">
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={llmAutomationEnabledDraft}
                onChange={(event) =>
                  setLlmAutomationEnabledDraft(event.target.checked)
                }
              />
              {t("assistant.llmAutomationEnabled")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={allowAutonomousHarmlessDraft}
                onChange={(event) =>
                  setAllowAutonomousHarmlessDraft(event.target.checked)
                }
              />
              {t("assistant.autonomousHarmless")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={allowAutonomousLowRiskDraft}
                onChange={(event) =>
                  setAllowAutonomousLowRiskDraft(event.target.checked)
                }
              />
              {t("assistant.autonomousLowRisk")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={announceBlockedCommandRequestsDraft}
                onChange={(event) =>
                  setAnnounceBlockedCommandRequestsDraft(event.target.checked)
                }
              />
              {t("assistant.blockedAnnouncements")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={includeCommandSuggestionsDraft}
                onChange={(event) =>
                  setIncludeCommandSuggestionsDraft(event.target.checked)
                }
              />
              {t("assistant.includeSuggestions")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={resultAcknowledgementsDraft}
                onChange={(event) =>
                  setResultAcknowledgementsDraft(event.target.checked)
                }
              />
              {t("assistant.resultAcknowledgements")}
            </label>
          </Flex>

          <Flex gap={3} wrap="wrap" mt={3}>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.profileSelectionMode")}
              </Text>
              <select
                style={selectStyles}
                value={profileSelectionModeDraft}
                onChange={(event) =>
                  setProfileSelectionModeDraft(
                    event.target.value as AutomationProfileSelectionMode,
                  )
                }
              >
                {AUTOMATION_PROFILE_SELECTION_MODES.map((mode) => (
                  <option key={mode} value={mode} style={optionStyles}>
                    {t(`assistant.selectionModes.${mode}`)}
                  </option>
                ))}
              </select>
            </Box>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.runtime.speechMode")}
              </Text>
              <select
                style={selectStyles}
                value={defaultSpeechModeDraft}
                onChange={(event) =>
                  setDefaultSpeechModeDraft(
                    event.target.value as AssistantSpeechMode,
                  )
                }
              >
                {ASSISTANT_SPEECH_MODES.map((mode) => (
                  <option key={mode} value={mode} style={optionStyles}>
                    {t(`assistant.speechModes.${mode}`)}
                  </option>
                ))}
              </select>
            </Box>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.commentaryCooldownMs")}
              </Text>
              <input
                type="number"
                min={1000}
                max={120000}
                style={fieldStyle}
                value={minimumCommentaryIntervalDraft}
                onChange={(event) =>
                  setMinimumCommentaryIntervalDraft(event.target.value)
                }
              />
            </Box>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.maxQueuedConversationalEvents")}
              </Text>
              <input
                type="number"
                min={1}
                max={20}
                style={fieldStyle}
                value={maxQueuedConversationEventsDraft}
                onChange={(event) =>
                  setMaxQueuedConversationEventsDraft(event.target.value)
                }
              />
            </Box>
          </Flex>

          <Flex gap={4} wrap="wrap" mt={3}>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={proactiveCommentaryDraft}
                onChange={(event) =>
                  setProactiveCommentaryDraft(event.target.checked)
                }
              />
              {t("assistant.proactiveCommentaryEnabled")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={announceApplicationChangesDraft}
                onChange={(event) =>
                  setAnnounceApplicationChangesDraft(event.target.checked)
                }
              />
              {t("assistant.announceApplicationChanges")}
            </label>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={acknowledgeRoutineAutomationSuccessDraft}
                onChange={(event) =>
                  setAcknowledgeRoutineAutomationSuccessDraft(
                    event.target.checked,
                  )
                }
              />
              {t("assistant.acknowledgeRoutineAutomationSuccess")}
            </label>
          </Flex>

          <Flex gap={3} wrap="wrap" mt={3}>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.confirmationTimeoutMs")}
              </Text>
              <input
                type="number"
                min={1000}
                max={120000}
                style={fieldStyle}
                value={confirmationTimeoutDraft}
                onChange={(event) =>
                  setConfirmationTimeoutDraft(event.target.value)
                }
              />
            </Box>
            <Box minW="180px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.maxPendingConfirmations")}
              </Text>
              <input
                type="number"
                min={1}
                max={5}
                style={fieldStyle}
                value={maxPendingConfirmationsDraft}
                onChange={(event) =>
                  setMaxPendingConfirmationsDraft(event.target.value)
                }
              />
            </Box>
            <Box flex="1" minW="240px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.confirmationPhrases")}
              </Text>
              <textarea
                style={{ ...fieldStyle, minHeight: 64 }}
                value={confirmationPhrasesDraft}
                onChange={(event) =>
                  setConfirmationPhrasesDraft(event.target.value)
                }
              />
            </Box>
            <Box flex="1" minW="240px">
              <Text color="whiteAlpha.700" mb={1}>
                {t("assistant.cancellationPhrases")}
              </Text>
              <textarea
                style={{ ...fieldStyle, minHeight: 64 }}
                value={cancellationPhrasesDraft}
                onChange={(event) =>
                  setCancellationPhrasesDraft(event.target.value)
                }
              />
            </Box>
          </Flex>
        </Box>

        <Box {...sectionCardProps}>
          <details>
            <summary style={detailsSummaryStyle}>
              <span>{t("assistant.telemetry.settingsTitle")}</span>
              <span style={detailsMetaStyle}>
                {telemetrySettingsSummaryLabel}
              </span>
            </summary>
            <Box mt={3}>
              <Flex gap={4} wrap="wrap">
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={telemetryEnabledDraft}
                    onChange={(event) =>
                      setTelemetryEnabledDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.enabled")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={automaticJournalDiscoveryDraft}
                    onChange={(event) =>
                      setAutomaticJournalDiscoveryDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.automaticDiscovery")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={announceDockingEventsDraft}
                    onChange={(event) =>
                      setAnnounceDockingEventsDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.announceDockingEvents")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={announceJumpEventsDraft}
                    onChange={(event) =>
                      setAnnounceJumpEventsDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.announceJumpEvents")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={announceMissionEventsDraft}
                    onChange={(event) =>
                      setAnnounceMissionEventsDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.announceMissionEvents")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={announceDiscoveriesDraft}
                    onChange={(event) =>
                      setAnnounceDiscoveriesDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.announceDiscoveries")}
                </label>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={announceMaterialCollectionDraft}
                    onChange={(event) =>
                      setAnnounceMaterialCollectionDraft(event.target.checked)
                    }
                  />
                  {t("assistant.telemetry.announceMaterialCollection")}
                </label>
              </Flex>
              <Flex gap={3} wrap="wrap" mt={3}>
                <Box flex="1" minW="240px">
                  <Text color="whiteAlpha.700" mb={1}>
                    {t("assistant.telemetry.manualDirectory")}
                  </Text>
                  <input
                    style={fieldStyle}
                    value={manualJournalDirectoryDraft ?? ""}
                    disabled={automaticJournalDiscoveryDraft}
                    onChange={(event) =>
                      setManualJournalDirectoryDraft(event.target.value || null)
                    }
                  />
                </Box>
                <Button onClick={() => void handleSelectTelemetryDirectory()}>
                  {t("assistant.telemetry.chooseFolder")}
                </Button>
              </Flex>
              <Flex gap={3} wrap="wrap" mt={3}>
                <Box minW="160px">
                  <Text color="whiteAlpha.700" mb={1}>
                    {t("assistant.telemetry.lowFuelThreshold")}
                  </Text>
                  <input
                    type="number"
                    min={1}
                    max={95}
                    style={fieldStyle}
                    value={lowFuelThresholdDraft}
                    onChange={(event) =>
                      setLowFuelThresholdDraft(event.target.value)
                    }
                  />
                </Box>
                <Box minW="160px">
                  <Text color="whiteAlpha.700" mb={1}>
                    {t("assistant.telemetry.criticalFuelThreshold")}
                  </Text>
                  <input
                    type="number"
                    min={1}
                    max={95}
                    style={fieldStyle}
                    value={criticalFuelThresholdDraft}
                    onChange={(event) =>
                      setCriticalFuelThresholdDraft(event.target.value)
                    }
                  />
                </Box>
                <Box flex="1" minW="220px">
                  <Text color="whiteAlpha.700" mb={1}>
                    {t("assistant.telemetry.hullThresholds")}
                  </Text>
                  <input
                    style={fieldStyle}
                    value={hullThresholdsDraft}
                    onChange={(event) =>
                      setHullThresholdsDraft(event.target.value)
                    }
                  />
                </Box>
                <Box minW="220px">
                  <Text color="whiteAlpha.700" mb={1}>
                    {t("assistant.telemetry.explorationCooldown")}
                  </Text>
                  <input
                    type="number"
                    min={5000}
                    max={600000}
                    style={fieldStyle}
                    value={explorationTelemetryCooldownDraft}
                    onChange={(event) =>
                      setExplorationTelemetryCooldownDraft(event.target.value)
                    }
                  />
                </Box>
              </Flex>
            </Box>
          </details>
        </Box>

        <Box {...sectionCardProps}>
          <details open={pendingConfirmations.length > 0}>
            <summary style={detailsSummaryStyle}>
              <span>{t("assistant.pendingConfirmations")}</span>
              <span style={detailsMetaStyle}>
                {pendingConfirmations.length}
              </span>
            </summary>
            <Flex direction="column" gap={3} mt={3}>
              {pendingConfirmations.length > 0 ? (
                pendingConfirmations.map((pending) => (
                  <Box key={pending.requestId} {...insetCardProps}>
                    <Text color="white" fontWeight="medium">
                      {pending.commandLabel}
                    </Text>
                    <Text color="whiteAlpha.700" fontSize="sm">
                      {t("assistant.reason")}: {pending.conciseReason}
                    </Text>
                    <Text color="whiteAlpha.700" fontSize="sm">
                      {t("assistant.riskLabel")}: {pending.risk} ·{" "}
                      {t("assistant.countdown")}:{" "}
                      {formatCountdown(pending.expiresAt, nowMs)}
                    </Text>
                    <Flex gap={2} mt={3} wrap="wrap">
                      <Button
                        size="sm"
                        colorPalette="green"
                        onClick={() =>
                          respondToAssistantConfirmation(
                            pending.requestId,
                            "confirm",
                          )
                        }
                      >
                        {t("assistant.confirm")}
                      </Button>
                      <Button
                        size="sm"
                        {...outlineButtonStyle}
                        onClick={() =>
                          respondToAssistantConfirmation(
                            pending.requestId,
                            "reject",
                          )
                        }
                      >
                        {t("assistant.reject")}
                      </Button>
                    </Flex>
                  </Box>
                ))
              ) : (
                <Text color="whiteAlpha.600">
                  {t("assistant.noPendingConfirmations")}
                </Text>
              )}
            </Flex>
          </details>
        </Box>

        <Box {...sectionCardProps}>
          <details>
            <summary style={detailsSummaryStyle}>
              <span>Capabilities and reasoning</span>
              <span style={detailsMetaStyle}>
                {assistantSignalsSummaryLabel}
              </span>
            </summary>
            <Flex gap={4} align="start" flexWrap="wrap" mt={3}>
              <Box flex="1 1 320px">
                <Text color="white" fontWeight="semibold" mb={2}>
                  {t("assistant.capabilityCatalogue")}
                </Text>
                <Flex direction="column" gap={2}>
                  {capabilityEntries.length > 0 ? (
                    capabilityEntries.map((capability) => (
                      <Box key={capability.commandId} {...insetCardProps}>
                        <Flex justify="space-between" gap={3} wrap="wrap">
                          <Text color="white" fontWeight="medium">
                            {capability.label}
                          </Text>
                          <Text
                            color={
                              llmAccessColorMap[capability.llmAccess] ??
                              "whiteAlpha.700"
                            }
                            fontSize="sm"
                          >
                            {t(
                              `assistant.capabilityStatus.${capability.llmAccess}`,
                            )}
                          </Text>
                        </Flex>
                        <Text color="whiteAlpha.600" fontSize="sm">
                          {capability.description}
                        </Text>
                        <Text color="whiteAlpha.700" fontSize="sm">
                          {capability.category} · {t("assistant.riskLabel")}:{" "}
                          {capability.risk} · {t("assistant.cooldown")}:{" "}
                          {Math.ceil(capability.cooldownRemainingMs / 1000)}s
                        </Text>
                        {capability.recommended && (
                          <Text color="green.300" fontSize="sm">
                            {t("assistant.telemetry.recommended")}
                          </Text>
                        )}
                        {capability.avoidReason && (
                          <Text color="yellow.300" fontSize="sm">
                            {capability.avoidReason}
                          </Text>
                        )}
                        {capability.blockedReason && (
                          <Text color="orange.300" fontSize="sm">
                            {capability.blockedReason}
                          </Text>
                        )}
                      </Box>
                    ))
                  ) : (
                    <Text color="whiteAlpha.600">
                      {t("assistant.noCapabilities")}
                    </Text>
                  )}
                </Flex>
              </Box>

              <Box flex="1 1 280px">
                <Text color="white" fontWeight="semibold" mb={2}>
                  {t("assistant.lastBlockedReason")}
                </Text>
                <Box {...insetCardProps}>
                  <Text
                    color={
                      assistantState?.lastBlockedReason
                        ? "orange.300"
                        : "whiteAlpha.600"
                    }
                  >
                    {assistantState?.lastBlockedReason ||
                      t("assistant.noBlockedReason")}
                  </Text>
                </Box>
              </Box>
            </Flex>
          </details>
        </Box>

        <Box {...sectionCardProps}>
          <details>
            <summary style={detailsSummaryStyle}>
              <span>{t("assistant.recentDecisions")}</span>
              <span style={detailsMetaStyle}>{recentDecisions.length}</span>
            </summary>
            <Flex direction="column" gap={2} mt={3}>
              {recentDecisions.length > 0 ? (
                recentDecisions.slice(0, 10).map((decision) => (
                  <Box key={decision.decisionId} {...insetCardProps}>
                    <Text color="whiteAlpha.900">
                      {decision.commandLabel ||
                        decision.commandId ||
                        t("assistant.title")}{" "}
                      · {decision.decisionType}
                    </Text>
                    <Text color="whiteAlpha.600" fontSize="sm">
                      {decision.reason || t("assistant.noReason")}
                    </Text>
                    {decision.blockedReason && (
                      <Text color="orange.300" fontSize="sm">
                        {decision.blockedReason}
                      </Text>
                    )}
                  </Box>
                ))
              ) : (
                <Text color="whiteAlpha.600">
                  {t("assistant.noRecentDecisions")}
                </Text>
              )}
            </Flex>
          </details>
        </Box>

        <Box {...sectionCardProps} ref={profileWorkspaceRef}>
          <Flex justify="space-between" align="start" gap={4} wrap="wrap">
            <Box>
              <Text color="white" fontWeight="semibold">
                Profile workspace
              </Text>
              <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                Profiles stay in the shortlist here. Open the wide editor for a
                denser command grid and step table when you need to review or
                clean up a large import.
              </Text>
              {draftValidationError && (
                <Text color="orange.300" fontSize="sm" mt={2}>
                  Validation: {draftValidationError}
                </Text>
              )}
            </Box>
            <Flex gap={2} wrap="wrap" align="center">
              <Text
                color={draftDirty ? "orange.300" : "whiteAlpha.600"}
                fontSize="sm"
              >
                {draftDirty ? "Editing unsaved changes" : "Workspace ready"}
              </Text>
              <Button
                colorPalette="blue"
                onClick={() =>
                  draftProfile
                    ? openProfileInEditor(draftProfile.profileId)
                    : handleNewProfile()
                }
              >
                {draftProfile
                  ? "Open profile editor"
                  : t("assistant.newProfile")}
              </Button>
            </Flex>
          </Flex>

          <Flex gap={4} align="start" flexWrap="wrap" mt={4}>
            <Box
              minW={{ base: "100%", md: "260px" }}
              flex={{ base: "1 1 100%", md: "0 0 260px" }}
              p={3}
              borderRadius="lg"
              bg="whiteAlpha.100"
              border="1px solid"
              borderColor="whiteAlpha.200"
            >
              <Flex justify="space-between" mb={2} gap={2} wrap="wrap">
                <Text color="white" fontWeight="semibold">
                  {t("assistant.profileList")}
                </Text>
                <Button {...smallButtonStyle} onClick={handleNewProfile}>
                  {t("assistant.newProfile")}
                </Button>
              </Flex>
              <select
                style={{ ...selectStyles, minHeight: 220 }}
                size={10}
                value={selectedProfileId ?? ""}
                onChange={(event) =>
                  setSelectedProfileId(event.target.value || null)
                }
              >
                {profileOptions.map((profile) => (
                  <option
                    key={profile.profileId}
                    value={profile.profileId}
                    style={optionStyles}
                  >
                    {profile.displayName}
                  </option>
                ))}
              </select>
              <Flex gap={2} mt={2} wrap="wrap">
                <Button
                  {...smallButtonStyle}
                  disabled={!draftProfile}
                  onClick={() =>
                    draftProfile && openProfileInEditor(draftProfile.profileId)
                  }
                >
                  Open editor
                </Button>
                <Button
                  {...smallDangerButtonStyle}
                  onClick={() => void handleDeleteProfile()}
                >
                  {t("assistant.deleteProfile")}
                </Button>
              </Flex>
            </Box>

            <Box
              flex="1 1 420px"
              minW={{ base: "100%", xl: "420px" }}
              p={3}
              borderRadius="lg"
              bg="whiteAlpha.100"
              border="1px solid"
              borderColor="whiteAlpha.200"
            >
              {draftProfile ? (
                <Flex direction="column" gap={3}>
                  <Box {...insetCardProps}>
                    <Text color="white" fontWeight="semibold">
                      {draftProfile.displayName || "Untitled profile"}
                    </Text>
                    <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                      Saved as `{draftProfile.profileId}` •{" "}
                      {draftProfile.commands.length} commands •{" "}
                      {draftProfile.processNames.length} process match
                      {draftProfile.processNames.length === 1 ? "" : "es"}
                    </Text>
                    {draftProfile.description && (
                      <Text color="whiteAlpha.700" fontSize="sm" mt={2}>
                        {draftProfile.description}
                      </Text>
                    )}
                    {draftProfile.importMetadata?.imported &&
                      voiceAttackReviewReport && (
                        <Text
                          color={
                            voiceAttackReviewReport.readyToMarkReviewed
                              ? "green.300"
                              : "orange.300"
                          }
                          fontSize="sm"
                          mt={2}
                        >
                          {voiceAttackReviewReport.readyToMarkReviewed
                            ? "Imported draft is ready to mark reviewed."
                            : `${voiceAttackReviewReport.findings.length} review item(s) remain.`}
                        </Text>
                      )}
                  </Box>
                  <Flex gap={2} wrap="wrap">
                    <Button
                      {...outlineButtonStyle}
                      disabled={enabledDraftCommandCount === 0}
                      onClick={handleMakeEnabledCommandsVoiceReady}
                    >
                      Voice-ready enabled commands
                    </Button>
                    <Button
                      colorPalette="blue"
                      onClick={() =>
                        openProfileInEditor(draftProfile.profileId)
                      }
                    >
                      Open profile editor
                    </Button>
                    <Button {...outlineButtonStyle} onClick={handleCancel}>
                      {t("assistant.revertDraft")}
                    </Button>
                  </Flex>
                </Flex>
              ) : (
                <Text color="whiteAlpha.700">
                  {t("assistant.noProfileSelected")}
                </Text>
              )}
            </Box>
          </Flex>
        </Box>

        <DialogRoot
          open={profileEditorDialogOpen}
          onOpenChange={(event) => setProfileEditorDialogOpen(event.open)}
          scrollBehavior="inside"
        >
          <DialogContent
            style={{
              width: "min(94vw, 1500px)",
              maxWidth: "94vw",
              maxHeight: "92vh",
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#f8fafc",
            }}
          >
            <DialogHeader>
              <DialogTitle>Assistant profile editor</DialogTitle>
              <DialogCloseTrigger />
            </DialogHeader>

            <DialogBody pb={4}>
              {draftProfile ? (
                <Flex direction="column" gap={4}>
                  <Box ref={profileEditorRef} {...insetCardProps}>
                    <Flex gap={4} wrap="wrap" align="end">
                      <Box flex="2 1 320px" minW="280px">
                        <Text color="whiteAlpha.700" mb={1}>
                          Display Name
                        </Text>
                        <input
                          ref={displayNameInputRef}
                          style={getValidatedFieldStyle(
                            Boolean(displayNameError),
                          )}
                          value={draftProfile.displayName}
                          aria-invalid={Boolean(displayNameError)}
                          onChange={(event) =>
                            updateProfileDisplayName(event.target.value)
                          }
                        />
                        {displayNameError && (
                          <div style={validationMessageStyle}>
                            {displayNameError}
                          </div>
                        )}
                      </Box>
                      <Box flex="1 1 260px" minW="220px">
                        <Text color="whiteAlpha.700" mb={1}>
                          Profile slug
                        </Text>
                        <input
                          readOnly
                          style={readOnlyFieldStyle}
                          value={draftProfile.profileId}
                        />
                        <Text color="whiteAlpha.500" fontSize="xs" mt={1}>
                          Auto-generated from the display name.
                        </Text>
                      </Box>
                      <label style={{ ...checkboxLabelStyle, marginBottom: 6 }}>
                        <input
                          type="checkbox"
                          checked={draftProfile.enabled}
                          onChange={(event) =>
                            updateDraftProfile((profile) => ({
                              ...profile,
                              enabled: event.target.checked,
                            }))
                          }
                        />
                        {t("assistant.profileEnabled")}
                      </label>
                    </Flex>

                    <Flex gap={4} wrap="wrap" mt={3}>
                      <Box flex="2 1 360px" minW="320px">
                        <Text color="whiteAlpha.700" mb={1}>
                          Description
                        </Text>
                        <textarea
                          style={{ ...fieldStyle, minHeight: 96 }}
                          value={draftProfile.description}
                          onChange={(event) =>
                            updateDraftProfile((profile) => ({
                              ...profile,
                              description: event.target.value,
                            }))
                          }
                        />
                      </Box>
                      <Box flex="1 1 280px" minW="260px">
                        <Text color="whiteAlpha.700" mb={1}>
                          Process Names
                        </Text>
                        <input
                          style={fieldStyle}
                          value={draftProfile.processNames.join(", ")}
                          onChange={(event) =>
                            updateDraftProfile((profile) => ({
                              ...profile,
                              processNames: event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                        <Text color="whiteAlpha.500" fontSize="xs" mt={1}>
                          Comma-separated executable or window process names.
                        </Text>
                      </Box>
                    </Flex>

                    <Flex gap={2} wrap="wrap" mt={3} align="center">
                      <Button
                        {...outlineButtonStyle}
                        disabled={enabledDraftCommandCount === 0}
                        onClick={handleMakeEnabledCommandsVoiceReady}
                      >
                        Voice-ready enabled commands
                      </Button>
                      <Text color="whiteAlpha.600" fontSize="sm">
                        Applies safe voice defaults to{" "}
                        {enabledDraftCommandCount} enabled command
                        {enabledDraftCommandCount === 1 ? "" : "s"}.
                      </Text>
                    </Flex>
                  </Box>

                  {!profileEditorContentReady ? (
                    <Box {...insetCardProps}>
                      <Text color="white" fontWeight="semibold">
                        Loading command workspace...
                      </Text>
                      <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                        The editor shell opens first, then the command roster
                        and step details load in.
                      </Text>
                    </Box>
                  ) : (
                    <Flex gap={4} align="start" flexWrap="wrap">
                      <Box
                        flex="0 0 460px"
                        minW={{ base: "100%", xl: "460px" }}
                        {...insetCardProps}
                      >
                        <Flex
                          justify="space-between"
                          align="start"
                          gap={3}
                          wrap="wrap"
                          mb={3}
                        >
                          <Box>
                            <Text color="white" fontWeight="semibold">
                              {t("assistant.commandList")}
                            </Text>
                            <Text color="whiteAlpha.600" fontSize="sm" mt={1}>
                              Spreadsheet view for imported or
                              high-command-count profiles.
                            </Text>
                          </Box>
                          <Flex gap={3} wrap="wrap" align="start">
                            <Box {...insetCardProps} minW="170px">
                              <Text color="whiteAlpha.600" fontSize="sm">
                                Visible / enabled
                              </Text>
                              <Text color="white">
                                {filteredDraftCommands.length} /{" "}
                                {enabledFilteredDraftCommandCount}
                              </Text>
                            </Box>
                            <Flex gap={2} wrap="wrap">
                              <Button
                                {...smallButtonStyle}
                                onClick={addCommand}
                              >
                                {t("assistant.addCommand")}
                              </Button>
                              <Button
                                {...smallDangerButtonStyle}
                                onClick={removeCommand}
                              >
                                {t("assistant.removeCommand")}
                              </Button>
                            </Flex>
                          </Flex>
                        </Flex>

                        <Flex gap={3} wrap="wrap" align="end">
                          <Box minW="220px" flex="1 1 260px">
                            <Text color="whiteAlpha.700" mb={1}>
                              Search commands
                            </Text>
                            <input
                              style={fieldStyle}
                              placeholder="Name, alias, category, or step type"
                              value={editorCommandSearchDraft}
                              onChange={(event) =>
                                setEditorCommandSearchDraft(event.target.value)
                              }
                            />
                          </Box>
                          <Box minW="180px">
                            <Text color="whiteAlpha.700" mb={1}>
                              Filter commands
                            </Text>
                            <select
                              style={selectStyles}
                              value={editorCommandSupportFilter}
                              onChange={(event) =>
                                setEditorCommandSupportFilter(
                                  event.target
                                    .value as EditorCommandSupportFilter,
                                )
                              }
                            >
                              <option value="all" style={optionStyles}>
                                all
                              </option>
                              <option value="manual" style={optionStyles}>
                                manual
                              </option>
                              <option value="supported" style={optionStyles}>
                                supported
                              </option>
                              <option
                                value="partially_supported"
                                style={optionStyles}
                              >
                                partially supported
                              </option>
                              <option value="unsupported" style={optionStyles}>
                                unsupported
                              </option>
                            </select>
                          </Box>
                        </Flex>

                        <Flex gap={2} wrap="wrap" mt={3}>
                          <Button
                            {...smallButtonStyle}
                            disabled={filteredDraftCommandIds.length === 0}
                            onClick={() =>
                              setDraftCommandsEnabled(
                                filteredDraftCommandIds,
                                true,
                              )
                            }
                          >
                            Enable visible
                          </Button>
                          <Button
                            {...smallButtonStyle}
                            disabled={
                              filteredDraftReviewableCommandIds.length === 0
                            }
                            onClick={() =>
                              setDraftCommandsEnabled(
                                filteredDraftReviewableCommandIds,
                                true,
                              )
                            }
                          >
                            Enable visible reviewable
                          </Button>
                          <Button
                            {...smallButtonStyle}
                            disabled={filteredDraftCommandIds.length === 0}
                            onClick={() =>
                              setDraftCommandsEnabled(
                                filteredDraftCommandIds,
                                false,
                              )
                            }
                          >
                            Disable visible
                          </Button>
                        </Flex>

                        <Box overflowX="auto" mt={3}>
                          <Box minW="760px">
                            <Box
                              display="grid"
                              gridTemplateColumns="56px 1.5fr 1.1fr 0.9fr 1fr 1fr"
                              gap={2}
                              px={3}
                              py={2}
                              borderRadius="md"
                              bg="whiteAlpha.100"
                              color="whiteAlpha.700"
                              fontSize="xs"
                              textTransform="uppercase"
                              letterSpacing="0.08em"
                            >
                              <Text>On</Text>
                              <Text>Command</Text>
                              <Text>ID</Text>
                              <Text>Support</Text>
                              <Text>Triggers</Text>
                              <Text>Steps</Text>
                            </Box>
                            {filteredDraftCommands.map((command) => {
                              const commandSupportStatus =
                                getDraftCommandSupportStatus(
                                  command,
                                  draftProfileImported,
                                );
                              const placeholderCount = command.steps.filter(
                                (step) =>
                                  step.type === "unsupported_import_action" ||
                                  step.type === "response_placeholder",
                              ).length;
                              const isSelected =
                                command.commandId === selectedCommandId;
                              return (
                                <Box
                                  key={command.commandId}
                                  display="grid"
                                  gridTemplateColumns="56px 1.5fr 1.1fr 0.9fr 1fr 1fr"
                                  gap={2}
                                  px={3}
                                  py={2}
                                  mt={2}
                                  borderRadius="md"
                                  border="1px solid rgba(255,255,255,0.08)"
                                  bg={
                                    isSelected
                                      ? "rgba(59,130,246,0.16)"
                                      : "rgba(15,23,42,0.55)"
                                  }
                                  cursor="pointer"
                                  style={{
                                    contentVisibility: "auto",
                                    containIntrinsicSize: "76px",
                                  }}
                                  onClick={() =>
                                    setSelectedCommandId(command.commandId)
                                  }
                                >
                                  <label
                                    style={{
                                      ...checkboxLabelStyle,
                                      gap: 6,
                                      marginTop: 2,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={command.enabled}
                                      onChange={(event) => {
                                        event.stopPropagation();
                                        updateDraftProfile((profile) => ({
                                          ...profile,
                                          commands: profile.commands.map(
                                            (candidate) =>
                                              candidate.commandId ===
                                              command.commandId
                                                ? {
                                                    ...candidate,
                                                    enabled:
                                                      event.target.checked,
                                                  }
                                                : candidate,
                                          ),
                                        }));
                                      }}
                                    />
                                  </label>
                                  <Box>
                                    <Text color="white" fontWeight="medium">
                                      {command.label || command.commandId}
                                    </Text>
                                    <Text color="whiteAlpha.600" fontSize="xs">
                                      {command.category || "uncategorized"} •{" "}
                                      {command.aliases.length} alias
                                      {command.aliases.length === 1 ? "" : "es"}
                                    </Text>
                                  </Box>
                                  <Text color="whiteAlpha.800" fontSize="sm">
                                    {command.commandId}
                                  </Text>
                                  <Text
                                    color={
                                      commandSupportStatus === "manual"
                                        ? "whiteAlpha.800"
                                        : formatSupportTone(
                                            commandSupportStatus,
                                          )
                                    }
                                    fontSize="sm"
                                  >
                                    {formatEditorCommandSupportStatus(
                                      commandSupportStatus,
                                    )}
                                  </Text>
                                  <Text color="whiteAlpha.700" fontSize="sm">
                                    {command.allowedTriggerSources.join(", ")}
                                  </Text>
                                  <Text color="whiteAlpha.700" fontSize="sm">
                                    {command.steps.length} step
                                    {command.steps.length === 1 ? "" : "s"}
                                    {placeholderCount > 0
                                      ? ` • ${placeholderCount} placeholders`
                                      : ""}
                                  </Text>
                                </Box>
                              );
                            })}
                            {filteredDraftCommands.length === 0 && (
                              <Text color="whiteAlpha.600" fontSize="sm" mt={3}>
                                No commands match the current filter.
                              </Text>
                            )}
                          </Box>
                        </Box>
                      </Box>

                      <Box
                        flex="1 1 720px"
                        minW={{ base: "100%", xl: "640px" }}
                        style={{
                          contentVisibility: "auto",
                          containIntrinsicSize: "960px",
                        }}
                      >
                        {currentCommand ? (
                          <Flex direction="column" gap={4}>
                            <Box>
                              <details
                                open={commandEditorOpen}
                                onToggle={(event) =>
                                  setCommandEditorOpen(event.currentTarget.open)
                                }
                              >
                                <summary style={detailsSummaryStyle}>
                                  <span>{t("assistant.commandEditor")}</span>
                                  <span style={detailsMetaStyle}>
                                    {currentCommand.label ||
                                      currentCommand.commandId}
                                  </span>
                                </summary>
                                <Box mt={3}>
                                  <Box {...insetCardProps} mb={3}>
                                    <Flex
                                      justify="space-between"
                                      align="start"
                                      gap={3}
                                      wrap="wrap"
                                    >
                                      <Box flex="1">
                                        <Text color="white" fontWeight="medium">
                                          Voice trigger
                                        </Text>
                                        <Text
                                          color={
                                            voiceReady
                                              ? "green.300"
                                              : "orange.300"
                                          }
                                          fontSize="sm"
                                          mt={1}
                                        >
                                          {voiceReady
                                            ? "Ready for exact label or alias requests."
                                            : `Needs setup: ${voiceReadyIssues.join(", ")}`}
                                        </Text>
                                        <Text
                                          color="whiteAlpha.600"
                                          fontSize="sm"
                                          mt={1}
                                        >
                                          One click can enable the safe defaults
                                          for direct requests: enable the
                                          profile, enable the command, turn on
                                          player_voice, switch to confirmation,
                                          and point manual selection at this
                                          profile.
                                        </Text>
                                      </Box>
                                      <Button
                                        size="sm"
                                        colorPalette="blue"
                                        onClick={handleMakeVoiceReady}
                                      >
                                        Make voice ready
                                      </Button>
                                    </Flex>
                                  </Box>
                                  <Flex gap={3} flexWrap="wrap">
                                    <Box flex="1" minW="220px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Command ID
                                      </Text>
                                      <input
                                        style={getValidatedFieldStyle(
                                          Boolean(commandIdError),
                                        )}
                                        value={currentCommand.commandId}
                                        aria-invalid={Boolean(commandIdError)}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            commandId: event.target.value,
                                          }))
                                        }
                                      />
                                      {commandIdError && (
                                        <div style={validationMessageStyle}>
                                          {commandIdError}
                                        </div>
                                      )}
                                    </Box>
                                    <Box flex="1" minW="220px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Label
                                      </Text>
                                      <input
                                        style={fieldStyle}
                                        value={currentCommand.label}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            label: event.target.value,
                                          }))
                                        }
                                      />
                                    </Box>
                                  </Flex>
                                  <Box mt={2}>
                                    <Text color="whiteAlpha.700" mb={1}>
                                      Description
                                    </Text>
                                    <textarea
                                      style={{ ...fieldStyle, minHeight: 72 }}
                                      value={currentCommand.description}
                                      onChange={(event) =>
                                        updateCurrentCommand((command) => ({
                                          ...command,
                                          description: event.target.value,
                                        }))
                                      }
                                    />
                                  </Box>
                                  <Flex gap={3} flexWrap="wrap" mt={2}>
                                    <Box flex="1" minW="200px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Aliases
                                      </Text>
                                      <input
                                        style={fieldStyle}
                                        value={currentCommand.aliases.join(
                                          ", ",
                                        )}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            aliases: event.target.value
                                              .split(",")
                                              .map((item) => item.trim())
                                              .filter(Boolean),
                                          }))
                                        }
                                      />
                                    </Box>
                                    <Box minW="150px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Category
                                      </Text>
                                      <input
                                        style={fieldStyle}
                                        value={currentCommand.category}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            category: event.target.value,
                                          }))
                                        }
                                      />
                                    </Box>
                                    <Box minW="150px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Cooldown ms
                                      </Text>
                                      <input
                                        type="number"
                                        style={fieldStyle}
                                        value={currentCommand.cooldownMs}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            cooldownMs:
                                              Number(event.target.value) || 0,
                                          }))
                                        }
                                      />
                                    </Box>
                                    <Box minW="150px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Max duration ms
                                      </Text>
                                      <input
                                        type="number"
                                        style={fieldStyle}
                                        value={currentCommand.maxDurationMs}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            maxDurationMs:
                                              Number(event.target.value) ||
                                              1000,
                                          }))
                                        }
                                      />
                                    </Box>
                                  </Flex>
                                  <Flex gap={3} flexWrap="wrap" mt={2}>
                                    <Box minW="180px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Risk Level
                                      </Text>
                                      <select
                                        style={selectStyles}
                                        value={currentCommand.riskLevel}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            riskLevel: event.target
                                              .value as AutomationCommand["riskLevel"],
                                          }))
                                        }
                                      >
                                        {AUTOMATION_RISK_LEVELS.map(
                                          (riskLevel) => (
                                            <option
                                              key={riskLevel}
                                              value={riskLevel}
                                              style={optionStyles}
                                            >
                                              {riskLevel}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </Box>
                                    <Box minW="180px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Autonomy
                                      </Text>
                                      <select
                                        style={selectStyles}
                                        value={currentCommand.autonomyPolicy}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            autonomyPolicy: event.target
                                              .value as AutomationCommand["autonomyPolicy"],
                                          }))
                                        }
                                      >
                                        {AUTOMATION_AUTONOMY_POLICIES.map(
                                          (policy) => (
                                            <option
                                              key={policy}
                                              value={policy}
                                              style={optionStyles}
                                            >
                                              {policy}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </Box>
                                    <Box minW="180px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Confirmation
                                      </Text>
                                      <select
                                        style={selectStyles}
                                        value={
                                          currentCommand.confirmationPolicy
                                        }
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            confirmationPolicy: event.target
                                              .value as AutomationCommand["confirmationPolicy"],
                                          }))
                                        }
                                      >
                                        {AUTOMATION_CONFIRMATION_POLICIES.map(
                                          (policy) => (
                                            <option
                                              key={policy}
                                              value={policy}
                                              style={optionStyles}
                                            >
                                              {policy}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </Box>
                                    <Box minW="180px">
                                      <Text color="whiteAlpha.700" mb={1}>
                                        Concurrency
                                      </Text>
                                      <select
                                        style={selectStyles}
                                        value={currentCommand.concurrencyPolicy}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            concurrencyPolicy: event.target
                                              .value as AutomationCommand["concurrencyPolicy"],
                                          }))
                                        }
                                      >
                                        {AUTOMATION_CONCURRENCY_POLICIES.map(
                                          (policy) => (
                                            <option
                                              key={policy}
                                              value={policy}
                                              style={optionStyles}
                                            >
                                              {policy}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </Box>
                                  </Flex>
                                  <Box mt={2}>
                                    <Text color="whiteAlpha.700" mb={1}>
                                      Allowed Trigger Sources
                                    </Text>
                                    <Flex gap={2} wrap="wrap">
                                      {AUTOMATION_TRIGGER_SOURCES.map(
                                        (source) => (
                                          <label
                                            key={source}
                                            style={{
                                              ...checkboxLabelStyle,
                                              gap: 6,
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={currentCommand.allowedTriggerSources.includes(
                                                source,
                                              )}
                                              onChange={(event) =>
                                                updateCurrentCommand(
                                                  (command) => ({
                                                    ...command,
                                                    allowedTriggerSources: event
                                                      .target.checked
                                                      ? [
                                                          ...command.allowedTriggerSources,
                                                          source,
                                                        ]
                                                      : command.allowedTriggerSources.filter(
                                                          (item) =>
                                                            item !== source,
                                                        ),
                                                  }),
                                                )
                                              }
                                            />
                                            {source}
                                          </label>
                                        ),
                                      )}
                                    </Flex>
                                    <Text
                                      color="whiteAlpha.600"
                                      fontSize="sm"
                                      mt={2}
                                    >
                                      Exact label or alias phrases now trigger
                                      directly before the LLM. Say or type the
                                      command label or one of its aliases, like
                                      "Type Hello" or "test hello". Other
                                      phrasing still falls back to normal
                                      assistant interpretation. Use "Make voice
                                      ready" if you just want the safe defaults
                                      applied for you.
                                    </Text>
                                  </Box>
                                  <Flex gap={4} wrap="wrap" mt={2}>
                                    <label style={checkboxLabelStyle}>
                                      <input
                                        type="checkbox"
                                        checked={currentCommand.enabled}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            enabled: event.target.checked,
                                          }))
                                        }
                                      />
                                      {t("assistant.commandEnabled")}
                                    </label>
                                    <label style={checkboxLabelStyle}>
                                      <input
                                        type="checkbox"
                                        checked={currentCommand.defaultDryRun}
                                        onChange={(event) =>
                                          updateCurrentCommand((command) => ({
                                            ...command,
                                            defaultDryRun: event.target.checked,
                                          }))
                                        }
                                      />
                                      {t("assistant.commandDefaultDryRun")}
                                    </label>
                                  </Flex>
                                </Box>
                              </details>
                            </Box>

                            <Box {...insetCardProps}>
                              <Flex
                                justify="space-between"
                                align="center"
                                mb={2}
                                wrap="wrap"
                                gap={3}
                              >
                                <Box>
                                  <Text color="white" fontWeight="semibold">
                                    {t("assistant.stepEditor")}
                                  </Text>
                                  <Text
                                    color="whiteAlpha.600"
                                    fontSize="sm"
                                    mt={1}
                                  >
                                    Select a row to edit its details below.
                                  </Text>
                                </Box>
                                <Flex gap={2} wrap="wrap" align="center">
                                  <select
                                    style={{ ...selectStyles, minWidth: 190 }}
                                    value={newStepTypeDraft}
                                    onChange={(event) =>
                                      setNewStepTypeDraft(
                                        event.target
                                          .value as AutomationAction["type"],
                                      )
                                    }
                                  >
                                    {STEP_TYPE_OPTIONS.map((type) => (
                                      <option
                                        key={type}
                                        value={type}
                                        style={optionStyles}
                                      >
                                        {type}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    {...smallButtonStyle}
                                    onClick={() => addStep(newStepTypeDraft)}
                                  >
                                    Add step
                                  </Button>
                                </Flex>
                              </Flex>

                              <Box overflowX="auto" mt={3}>
                                <Box minW="920px">
                                  <Box
                                    display="grid"
                                    gridTemplateColumns="72px 220px 1.6fr 1fr 220px"
                                    gap={2}
                                    px={3}
                                    py={2}
                                    borderRadius="md"
                                    bg="whiteAlpha.100"
                                    color="whiteAlpha.700"
                                    fontSize="xs"
                                    textTransform="uppercase"
                                    letterSpacing="0.08em"
                                  >
                                    <Text>Step</Text>
                                    <Text>Type</Text>
                                    <Text>Summary</Text>
                                    <Text>Status</Text>
                                    <Text>Actions</Text>
                                  </Box>
                                  {currentCommand.steps.map((step, index) => {
                                    const importedPlaceholderStep =
                                      step.type ===
                                        "unsupported_import_action" ||
                                      step.type === "response_placeholder";
                                    const isSelected =
                                      index === selectedStepIndex;
                                    return (
                                      <Box
                                        key={`${step.type}-${index}`}
                                        display="grid"
                                        gridTemplateColumns="72px 220px 1.6fr 1fr 220px"
                                        gap={2}
                                        px={3}
                                        py={2}
                                        mt={2}
                                        borderRadius="md"
                                        border="1px solid rgba(255,255,255,0.08)"
                                        bg={
                                          isSelected
                                            ? "rgba(59,130,246,0.16)"
                                            : "rgba(15,23,42,0.55)"
                                        }
                                        cursor="pointer"
                                        style={{
                                          contentVisibility: "auto",
                                          containIntrinsicSize: "72px",
                                        }}
                                        onClick={() =>
                                          setSelectedStepIndex(index)
                                        }
                                      >
                                        <Text color="whiteAlpha.900">
                                          Step {index + 1}
                                        </Text>
                                        <Box
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          {importedPlaceholderStep ? (
                                            <Box
                                              {...insetCardProps}
                                              py={1}
                                              px={2}
                                            >
                                              <Text
                                                color="whiteAlpha.800"
                                                fontSize="sm"
                                              >
                                                {step.type}
                                              </Text>
                                            </Box>
                                          ) : (
                                            <select
                                              style={selectStyles}
                                              value={step.type}
                                              onChange={(event) => {
                                                updateStep(index, () =>
                                                  createBlankStep(
                                                    event.target
                                                      .value as AutomationAction["type"],
                                                  ),
                                                );
                                                setSelectedStepIndex(index);
                                              }}
                                            >
                                              {STEP_TYPE_OPTIONS.map((type) => (
                                                <option
                                                  key={type}
                                                  value={type}
                                                  style={optionStyles}
                                                >
                                                  {type}
                                                </option>
                                              ))}
                                            </select>
                                          )}
                                        </Box>
                                        <Text
                                          color="whiteAlpha.800"
                                          fontSize="sm"
                                        >
                                          {summarizeAutomationStep(step)}
                                        </Text>
                                        <Text
                                          color={
                                            importedPlaceholderStep
                                              ? "orange.300"
                                              : "whiteAlpha.700"
                                          }
                                          fontSize="sm"
                                        >
                                          {step.type ===
                                          "unsupported_import_action"
                                            ? step.sourceType
                                            : step.type ===
                                                "response_placeholder"
                                              ? step.replacementMode
                                              : "editable"}
                                        </Text>
                                        <Flex
                                          gap={2}
                                          wrap="wrap"
                                          justify="flex-end"
                                        >
                                          <Button
                                            {...smallButtonStyle}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              moveStep(index, -1);
                                            }}
                                          >
                                            Up
                                          </Button>
                                          <Button
                                            {...smallButtonStyle}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              moveStep(index, 1);
                                            }}
                                          >
                                            Down
                                          </Button>
                                          <Button
                                            {...smallButtonStyle}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              duplicateStep(index);
                                            }}
                                          >
                                            {t("assistant.duplicateStep")}
                                          </Button>
                                          <Button
                                            {...smallDangerButtonStyle}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              removeStep(index);
                                            }}
                                          >
                                            {t("assistant.removeStep")}
                                          </Button>
                                        </Flex>
                                      </Box>
                                    );
                                  })}
                                </Box>
                              </Box>

                              {selectedStep && (
                                <Box mt={3}>
                                  <Text color="white" fontWeight="semibold">
                                    Step {selectedStepIndex + 1} details
                                  </Text>
                                  <Text
                                    color="whiteAlpha.600"
                                    fontSize="sm"
                                    mt={1}
                                    mb={3}
                                  >
                                    {summarizeAutomationStep(selectedStep)}
                                  </Text>

                                  {selectedStep.type === "wait" && (
                                    <input
                                      type="number"
                                      style={fieldStyle}
                                      value={selectedStep.milliseconds}
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          milliseconds:
                                            Number(event.target.value) || 0,
                                        }))
                                      }
                                    />
                                  )}

                                  {selectedStep.type === "play_sound" && (
                                    <Flex gap={3} wrap="wrap">
                                      <input
                                        style={fieldStyle}
                                        value={selectedStep.assetId ?? ""}
                                        placeholder="assetId"
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            assetId:
                                              event.target.value || undefined,
                                          }))
                                        }
                                      />
                                      <input
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        style={fieldStyle}
                                        value={selectedStep.volume ?? 1}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            volume:
                                              Number(event.target.value) || 0,
                                          }))
                                        }
                                      />
                                    </Flex>
                                  )}

                                  {selectedStep.type === "write_log" && (
                                    <textarea
                                      style={{ ...fieldStyle, minHeight: 72 }}
                                      value={selectedStep.message}
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          message: event.target.value,
                                        }))
                                      }
                                    />
                                  )}

                                  {selectedStep.type === "speak_fixed" && (
                                    <Flex direction="column" gap={2}>
                                      <textarea
                                        style={{ ...fieldStyle, minHeight: 72 }}
                                        value={selectedStep.text}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            text: event.target.value,
                                          }))
                                        }
                                      />
                                      <select
                                        style={selectStyles}
                                        value={
                                          selectedStep.interruptPolicy ??
                                          "queue"
                                        }
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            interruptPolicy: event.target
                                              .value as typeof selectedStep.interruptPolicy,
                                          }))
                                        }
                                      >
                                        <option
                                          value="queue"
                                          style={optionStyles}
                                        >
                                          queue
                                        </option>
                                        <option
                                          value="interrupt"
                                          style={optionStyles}
                                        >
                                          interrupt
                                        </option>
                                      </select>
                                    </Flex>
                                  )}

                                  {selectedStep.type === "set_mic_state" && (
                                    <select
                                      style={selectStyles}
                                      value={
                                        selectedStep.enabled ? "on" : "off"
                                      }
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          enabled: event.target.value === "on",
                                        }))
                                      }
                                    >
                                      <option value="on" style={optionStyles}>
                                        unmute mic
                                      </option>
                                      <option value="off" style={optionStyles}>
                                        mute mic
                                      </option>
                                    </select>
                                  )}

                                  {selectedStep.type === "set_background" && (
                                    <input
                                      style={fieldStyle}
                                      value={selectedStep.backgroundId}
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          backgroundId: event.target.value,
                                        }))
                                      }
                                    />
                                  )}

                                  {selectedStep.type ===
                                    "restore_background" && (
                                    <Box {...insetCardProps}>
                                      <Text
                                        color="whiteAlpha.800"
                                        fontSize="sm"
                                      >
                                        This step restores the previous
                                        background and does not need additional
                                        fields.
                                      </Text>
                                    </Box>
                                  )}

                                  {selectedStep.type === "show_overlay" && (
                                    <Flex gap={3} wrap="wrap">
                                      <input
                                        style={fieldStyle}
                                        value={selectedStep.overlayId}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            overlayId: event.target.value,
                                          }))
                                        }
                                      />
                                      <input
                                        type="number"
                                        style={fieldStyle}
                                        value={selectedStep.durationMs}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            durationMs:
                                              Number(event.target.value) || 0,
                                          }))
                                        }
                                      />
                                      <select
                                        style={selectStyles}
                                        value={selectedStep.placement}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            placement: event.target
                                              .value as typeof selectedStep.placement,
                                          }))
                                        }
                                      >
                                        {OVERLAY_PLACEMENTS.map((placement) => (
                                          <option
                                            key={placement}
                                            value={placement}
                                            style={optionStyles}
                                          >
                                            {placement}
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        style={selectStyles}
                                        value={
                                          selectedStep.animationName ?? "fade"
                                        }
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            animationName: event.target
                                              .value as typeof selectedStep.animationName,
                                          }))
                                        }
                                      >
                                        {OVERLAY_ANIMATIONS.map((animation) => (
                                          <option
                                            key={animation}
                                            value={animation}
                                            style={optionStyles}
                                          >
                                            {animation}
                                          </option>
                                        ))}
                                      </select>
                                    </Flex>
                                  )}

                                  {selectedStep.type === "remove_overlay" && (
                                    <input
                                      style={fieldStyle}
                                      value={selectedStep.overlayId}
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          overlayId: event.target.value,
                                        }))
                                      }
                                    />
                                  )}

                                  {selectedStep.type === "screen_shake" && (
                                    <Flex gap={3} wrap="wrap">
                                      <input
                                        type="number"
                                        style={fieldStyle}
                                        value={selectedStep.durationMs}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            durationMs:
                                              Number(event.target.value) || 0,
                                          }))
                                        }
                                      />
                                      <input
                                        type="number"
                                        style={fieldStyle}
                                        value={selectedStep.intensity}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            intensity:
                                              Number(event.target.value) || 0,
                                          }))
                                        }
                                      />
                                    </Flex>
                                  )}

                                  {(selectedStep.type === "key_press" ||
                                    selectedStep.type === "key_down" ||
                                    selectedStep.type === "key_up") && (
                                    <Flex gap={3} wrap="wrap">
                                      <input
                                        style={fieldStyle}
                                        value={selectedStep.key}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            key: event.target
                                              .value as ValidKeyIdentifier,
                                          }))
                                        }
                                      />
                                      <Button
                                        {...smallButtonStyle}
                                        onClick={() =>
                                          setCapturingField((current) =>
                                            current ===
                                            buildStepKeyCaptureId(
                                              selectedStepIndex,
                                            )
                                              ? null
                                              : buildStepKeyCaptureId(
                                                  selectedStepIndex,
                                                ),
                                          )
                                        }
                                      >
                                        {capturingField ===
                                        buildStepKeyCaptureId(selectedStepIndex)
                                          ? t("assistant.capturingKey")
                                          : t("assistant.captureKey")}
                                      </Button>
                                      {selectedStep.type === "key_press" && (
                                        <input
                                          type="number"
                                          style={fieldStyle}
                                          value={selectedStep.durationMs ?? 120}
                                          onChange={(event) =>
                                            updateStep(
                                              selectedStepIndex,
                                              () => ({
                                                ...selectedStep,
                                                durationMs:
                                                  Number(event.target.value) ||
                                                  0,
                                              }),
                                            )
                                          }
                                        />
                                      )}
                                    </Flex>
                                  )}

                                  {selectedStep.type === "key_combination" && (
                                    <Flex direction="column" gap={2}>
                                      <Flex gap={2} wrap="wrap">
                                        {(
                                          [
                                            "ctrl",
                                            "alt",
                                            "shift",
                                            "meta",
                                          ] as const
                                        ).map((modifier) => (
                                          <label
                                            key={modifier}
                                            style={{
                                              ...checkboxLabelStyle,
                                              gap: 6,
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={selectedStep.modifiers.includes(
                                                modifier,
                                              )}
                                              onChange={(event) =>
                                                updateStep(
                                                  selectedStepIndex,
                                                  () => ({
                                                    ...selectedStep,
                                                    modifiers: event.target
                                                      .checked
                                                      ? [
                                                          ...selectedStep.modifiers,
                                                          modifier,
                                                        ]
                                                      : selectedStep.modifiers.filter(
                                                          (item) =>
                                                            item !== modifier,
                                                        ),
                                                  }),
                                                )
                                              }
                                            />
                                            {modifier}
                                          </label>
                                        ))}
                                      </Flex>
                                      <Flex gap={3}>
                                        <input
                                          style={fieldStyle}
                                          value={selectedStep.key}
                                          onChange={(event) =>
                                            updateStep(
                                              selectedStepIndex,
                                              () => ({
                                                ...selectedStep,
                                                key: event.target
                                                  .value as ValidKeyIdentifier,
                                              }),
                                            )
                                          }
                                        />
                                        <Button
                                          {...smallButtonStyle}
                                          onClick={() =>
                                            setCapturingField((current) =>
                                              current ===
                                              buildStepKeyCaptureId(
                                                selectedStepIndex,
                                              )
                                                ? null
                                                : buildStepKeyCaptureId(
                                                    selectedStepIndex,
                                                  ),
                                            )
                                          }
                                        >
                                          {capturingField ===
                                          buildStepKeyCaptureId(
                                            selectedStepIndex,
                                          )
                                            ? t("assistant.capturingKey")
                                            : t("assistant.captureKey")}
                                        </Button>
                                        <Button
                                          {...smallButtonStyle}
                                          onClick={() =>
                                            setCapturingField((current) =>
                                              current ===
                                              buildStepShortcutCaptureId(
                                                selectedStepIndex,
                                              )
                                                ? null
                                                : buildStepShortcutCaptureId(
                                                    selectedStepIndex,
                                                  ),
                                            )
                                          }
                                        >
                                          {capturingField ===
                                          buildStepShortcutCaptureId(
                                            selectedStepIndex,
                                          )
                                            ? t("assistant.capturingKey")
                                            : t("assistant.captureShortcut")}
                                        </Button>
                                      </Flex>
                                    </Flex>
                                  )}

                                  {selectedStep.type === "run_macro" && (
                                    <input
                                      style={fieldStyle}
                                      value={selectedStep.commandId}
                                      onChange={(event) =>
                                        updateStep(selectedStepIndex, () => ({
                                          ...selectedStep,
                                          commandId: event.target.value,
                                        }))
                                      }
                                    />
                                  )}

                                  {selectedStep.type === "script" && (
                                    <Flex direction="column" gap={3}>
                                      <textarea
                                        style={{
                                          ...fieldStyle,
                                          minHeight: 240,
                                          fontFamily:
                                            "Consolas, 'Courier New', monospace",
                                          whiteSpace: "pre",
                                        }}
                                        spellCheck={false}
                                        value={selectedStep.script}
                                        onChange={(event) =>
                                          updateStep(selectedStepIndex, () => ({
                                            ...selectedStep,
                                            script: event.target.value,
                                          }))
                                        }
                                      />
                                      <Box {...insetCardProps}>
                                        <Text
                                          color="whiteAlpha.900"
                                          fontWeight="medium"
                                          mb={2}
                                        >
                                          Script quick reference
                                        </Text>
                                        <Text
                                          color="whiteAlpha.700"
                                          fontSize="sm"
                                          lineHeight="1.6"
                                          whiteSpace="pre-wrap"
                                        >
                                          {[
                                            "let name = expression",
                                            "set name = expression",
                                            "if condition / else / endif",
                                            "log expression",
                                            "speak expression",
                                            "wait expression",
                                            "mic on | mic off",
                                            "press key for milliseconds",
                                            "keydown key / keyup key",
                                            "combo ctrl+shift+a",
                                            "call command_id",
                                            "background background_id",
                                            "restore_background",
                                            "return",
                                          ].join("\n")}
                                        </Text>
                                      </Box>
                                    </Flex>
                                  )}

                                  {selectedStep.type ===
                                    "unsupported_import_action" && (
                                    <Box {...insetCardProps}>
                                      <Text
                                        color="orange.200"
                                        fontWeight="medium"
                                      >
                                        Unsupported imported action
                                      </Text>
                                      <Text
                                        color="whiteAlpha.700"
                                        fontSize="sm"
                                        mt={1}
                                      >
                                        Source type: {selectedStep.sourceType}
                                      </Text>
                                      <Text
                                        color="whiteAlpha.700"
                                        fontSize="sm"
                                      >
                                        {selectedStep.summary}
                                      </Text>
                                    </Box>
                                  )}

                                  {selectedStep.type ===
                                    "response_placeholder" && (
                                    <Box {...insetCardProps}>
                                      <Text
                                        color="orange.200"
                                        fontWeight="medium"
                                      >
                                        Response placeholder
                                      </Text>
                                      <Text
                                        color="whiteAlpha.700"
                                        fontSize="sm"
                                        mt={1}
                                      >
                                        Imported speech/audio content was
                                        intentionally omitted and needs a
                                        replacement before review.
                                      </Text>
                                      <Text
                                        color="whiteAlpha.700"
                                        fontSize="sm"
                                      >
                                        Replacement mode:{" "}
                                        {selectedStep.replacementMode}
                                      </Text>
                                    </Box>
                                  )}
                                </Box>
                              )}
                            </Box>

                            <Flex gap={3} wrap="wrap">
                              <Button
                                colorPalette="blue"
                                onClick={() => void handleTestCommand()}
                              >
                                {t("assistant.testCommand")}
                              </Button>
                              <Button
                                {...outlineButtonStyle}
                                onClick={() =>
                                  runningRequestId &&
                                  void cancel(runningRequestId)
                                }
                              >
                                {t("assistant.cancelCurrent")}
                              </Button>
                              <Button
                                colorPalette="red"
                                onClick={() => void emergencyStop()}
                              >
                                {t("assistant.emergencyStop")}
                              </Button>
                              <Button onClick={() => void resetEmergencyStop()}>
                                {t("assistant.resetEmergencyStop")}
                              </Button>
                            </Flex>

                            <Box>
                              <details>
                                <summary style={detailsSummaryStyle}>
                                  <span>{t("assistant.executionHistory")}</span>
                                  <span style={detailsMetaStyle}>
                                    {snapshot?.history.length ?? 0}
                                  </span>
                                </summary>
                                <Flex direction="column" gap={2} mt={3}>
                                  {snapshot?.history.length ? (
                                    snapshot.history.map((entry) => (
                                      <Box
                                        key={`${entry.requestId}-${entry.status}`}
                                        {...insetCardProps}
                                      >
                                        <Text color="whiteAlpha.900">
                                          {entry.commandId} - {entry.status}{" "}
                                          {entry.dryRun
                                            ? `(${t("assistant.dryRun")})`
                                            : ""}
                                        </Text>
                                        <Text
                                          color="whiteAlpha.600"
                                          fontSize="sm"
                                        >
                                          {entry.source}{" "}
                                          {entry.durationMs
                                            ? `- ${entry.durationMs}ms`
                                            : ""}
                                        </Text>
                                        {entry.error && (
                                          <Text
                                            color="orange.300"
                                            fontSize="sm"
                                          >
                                            {entry.error}
                                          </Text>
                                        )}
                                      </Box>
                                    ))
                                  ) : (
                                    <Text color="whiteAlpha.600">
                                      {t("assistant.noHistory")}
                                    </Text>
                                  )}
                                </Flex>
                              </details>
                            </Box>
                          </Flex>
                        ) : (
                          <Box {...insetCardProps}>
                            <Text color="whiteAlpha.700">
                              Select a command row from the roster to start
                              editing.
                            </Text>
                          </Box>
                        )}
                      </Box>
                    </Flex>
                  )}
                </Flex>
              ) : (
                <Text color="whiteAlpha.700">
                  {t("assistant.noProfileSelected")}
                </Text>
              )}
            </DialogBody>

            <DialogFooter>
              <Flex
                width="100%"
                justify="space-between"
                align="center"
                gap={3}
                wrap="wrap"
              >
                <Text color="whiteAlpha.600" fontSize="sm">
                  {draftProfile
                    ? `Current profile slug: ${draftProfile.profileId}`
                    : "No profile selected"}
                </Text>
                <Flex gap={2} wrap="wrap">
                  <Button {...outlineButtonStyle} onClick={handleCancel}>
                    {t("assistant.revertDraft")}
                  </Button>
                  <Button
                    {...outlineButtonStyle}
                    onClick={() => setProfileEditorDialogOpen(false)}
                  >
                    Close
                  </Button>
                  <Button colorPalette="blue" onClick={() => void handleSave()}>
                    {t("assistant.saveProfile")}
                  </Button>
                </Flex>
              </Flex>
            </DialogFooter>
          </DialogContent>
        </DialogRoot>
      </Flex>
    </Box>
  );
}

export default Assistant;
