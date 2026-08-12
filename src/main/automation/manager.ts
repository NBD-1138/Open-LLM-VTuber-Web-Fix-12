import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  ActiveApplicationAdapter,
  ActiveApplicationSnapshot,
  createActiveApplicationAdapter,
  getActiveApplicationSignature,
} from "./active-application";
import {
  chooseMatchedProfile,
  getMatchingProfiles,
  getProfileMatchConfidence,
} from "./profile-selection";
import {
  APPROVED_OVERLAY_ASSETS,
  APPROVED_SOUND_ASSETS,
} from "../../shared/automation/assets";
import {
  AutomationAction,
  AutomationDetectedApplication,
  AutomationCommand,
  AutomationExecutionRecord,
  AutomationExecutionStatus,
  MAX_KEY_HOLD_DURATION_MS,
  MAX_MACRO_DEPTH,
  type AutomationScriptValue,
} from "../../shared/automation/schema";
import type {
  AssistantSpeechMode,
  AutomationProfile,
  AutomationAssistantStateSnapshot,
  AutomationProfileSelectionSource,
  AutomationRuntimeStatus,
  AutomationSettings,
  AutomationStatusSnapshot,
  AutomationTriggerSource,
  KeyCombinationAction,
  KeyDownAction,
  KeyPressAction,
  KeyUpAction,
  PlaySoundAction,
  ScreenShakeAction,
  ScriptAction,
  SetMicStateAction,
  ShowOverlayAction,
  SpeakFixedAction,
  ValidKeyIdentifier,
  ValidModifierKey,
  WriteLogAction,
} from "../../shared/automation/schema";
import {
  getDefaultAutomationSettings,
  normalizeAutomationSettings,
} from "../../shared/automation/schema";
import type {
  AutomationExecuteOptions,
  AutomationExportOptions,
  AutomationImportResult,
  AutomationManagerEvent,
  AutomationSceneActionRequest,
  AutomationSceneActionResult,
  AutomationStatusWsMessage,
} from "../../shared/automation/ipc";
import { buildImportedProfileReviewReport } from "../../shared/automation/voiceattack";
import type {
  ImportedAutomationProfileReviewReport,
  VoiceAttackImportRequest,
  VoiceAttackInspectionResult,
  VoiceAttackProfilePreview,
} from "../../shared/automation/voiceattack";
import {
  evaluateAutomationStatePredicate,
  type AutomationSemanticContract,
  type AutomationStatePredicate,
  type AutomationVoiceAttackExecutionOutcome,
  type AutomationVoiceAttackExecutionTraceEntry,
  type VoiceAttackConditionExpression,
  type VoiceAttackExecutionResultType,
  type VoiceAttackNode,
  type VoiceAttackOperand,
  type VoiceAttackVariableScope,
} from "../../shared/automation/voiceattack-script";
import { KeyboardInputAdapter } from "./input-adapter";
import { AutomationProfileStore } from "./profile-store";
import {
  buildVoiceAttackDiagnosticReport,
  buildVoiceAttackImportedProfile,
  getVoiceAttackPreview,
  inspectVoiceAttackSourcePath,
} from "./voiceattack-importer";
import type { VoiceAttackImportSessionData } from "./voiceattack-importer";
import {
  deleteVoiceAttackSessionFile,
  executeVoiceAttackHelperRequest,
  runVoiceAttackHelperCommand,
} from "./voiceattack-helper";
import { executeAutomationScript } from "./script-runtime";

type HotkeyApi = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

type DialogApi = {
  openImportFile(): Promise<string | null>;
  openExportFile(options: {
    profileId: string;
    format: "json" | "yaml";
  }): Promise<string | null>;
  openVoiceAttackDiagnosticFile(options: {
    sourceBasename: string;
  }): Promise<string | null>;
  openTelemetryDirectory(): Promise<string | null>;
  openVoiceAttackSource(): Promise<string | null>;
};

type LoggerApi = Pick<Console, "info" | "warn" | "error">;

interface AutomationManagerOptions {
  store: AutomationProfileStore;
  keyboardAdapter: KeyboardInputAdapter;
  hotkeyApi: HotkeyApi;
  dialogApi: DialogApi;
  emitEvent: (event: AutomationManagerEvent) => void;
  activeApplicationAdapter?: ActiveApplicationAdapter;
  logger?: LoggerApi;
}

interface RunningExecution {
  requestId: string;
  profileId: string;
  commandId: string;
  source: AutomationTriggerSource;
  dryRun: boolean;
  allowDisabled: boolean;
  startedAtMs: number;
  startedAt: string;
  controller: AbortController;
  heldKeys: Set<ValidKeyIdentifier>;
  keyReleaseTimers: Map<ValidKeyIdentifier, NodeJS.Timeout>;
  scriptVariables: Map<string, AutomationScriptValue>;
  readOnlyScriptVariables: Set<string>;
}

class AutomationCancellationError extends Error {
  constructor(message = "Execution cancelled.") {
    super(message);
    this.name = "AutomationCancellationError";
  }
}

class AutomationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationBlockedError";
  }
}

type PendingSceneAction = {
  requestId: string;
  resolve: (result: AutomationSceneActionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const SCENE_ACTION_TIMEOUT_MS = 15_000;
const HISTORY_LIMIT = 50;
const VOICE_COMMAND_ARM_TIMEOUT_MS = 10_000;
const VOICEATTACK_MAX_TOTAL_ACTIONS = 2048;
const VOICEATTACK_MAX_LOOP_ITERATIONS = 64;
const VOICEATTACK_MAX_WAIT_UNTIL_TIMEOUT_MS = 15_000;

interface VoiceAttackExecutionContext {
  commandLookup: Map<string, AutomationCommand>;
  localVariableFrames: Array<Map<string, AutomationScriptValue>>;
  profileVariables: Map<string, AutomationScriptValue>;
  globalVariables: Map<string, AutomationScriptValue>;
  trace: AutomationVoiceAttackExecutionTraceEntry[];
  skippedActions: Set<string>;
  blockingActions: Set<string>;
  unsupportedActions: Set<string>;
  nestedCommandTrace: string[];
  physicalInputSent: boolean;
  telemetryConfirmed: boolean;
  partialExecution: boolean;
  executedActionCount: number;
  baselineState: Record<string, unknown> | null;
}

type StoredVoiceAttackSession = {
  controller: AbortController;
  inspection: VoiceAttackInspectionResult;
  session: VoiceAttackImportSessionData | null;
  sessionFilePath: string | null;
};

class VoiceAttackReturnSignal extends Error {
  constructor() {
    super("VoiceAttack command returned.");
    this.name = "VoiceAttackReturnSignal";
  }
}

class VoiceAttackStopSignal extends Error {
  constructor() {
    super("VoiceAttack command stopped.");
    this.name = "VoiceAttackStopSignal";
  }
}

class VoiceAttackOutcomeSignal extends Error {
  readonly resultType: VoiceAttackExecutionResultType;

  readonly reason: string;

  constructor(resultType: VoiceAttackExecutionResultType, reason: string) {
    super(reason);
    this.name = "VoiceAttackOutcomeSignal";
    this.resultType = resultType;
    this.reason = reason;
  }
}

const toVoiceAttackTraceSummary = (
  commandLabel: string,
  node: VoiceAttackNode,
): string => {
  switch (node.kind) {
    case "key_press":
      return `${commandLabel}: press ${node.key}`;
    case "key_down":
      return `${commandLabel}: hold ${node.key}`;
    case "key_up":
      return `${commandLabel}: release ${node.key}`;
    case "key_combination":
      return `${commandLabel}: ${node.modifiers.join("+")}+${node.key}`;
    case "wait":
      return `${commandLabel}: wait ${node.milliseconds}ms`;
    case "execute_command":
      return `${commandLabel}: run ${node.targetCommandId ?? node.targetReference}`;
    case "set_variable":
      return `${commandLabel}: set ${node.variableName}`;
    case "clear_variable":
      return `${commandLabel}: clear ${node.variableName}`;
    case "if":
      return `${commandLabel}: if ${node.condition.operator}`;
    case "repeat":
      return `${commandLabel}: repeat ${node.iterations}`;
    case "while":
      return `${commandLabel}: while ${node.condition.operator}`;
    case "wait_until":
      return `${commandLabel}: wait until ${node.condition.operator}`;
    case "stop_command":
      return `${commandLabel}: stop command`;
    case "return":
      return `${commandLabel}: return`;
    case "play_sound":
      return `${commandLabel}: play sound`;
    case "speech_placeholder":
      return `${commandLabel}: speech placeholder`;
    case "log":
      return `${commandLabel}: log`;
    case "note":
      return `${commandLabel}: note`;
    case "unsupported":
      return `${commandLabel}: unsupported ${node.actionTypeName}`;
    default:
      return `${commandLabel}: ${node.kind}`;
  }
};

const readStatePathValue = (
  source: Record<string, unknown> | null | undefined,
  pathValue: string,
): unknown => {
  if (!source) {
    return undefined;
  }
  return pathValue
    .split(".")
    .filter((segment) => segment.length > 0)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, source);
};

const buildAssistantStateRecord = (
  snapshot: AutomationAssistantStateSnapshot | null,
): Record<string, unknown> | null => {
  const telemetry = snapshot?.telemetry?.snapshot;
  if (!telemetry) {
    return null;
  }
  return {
    session:
      telemetry.session && typeof telemetry.session === "object"
        ? { ...telemetry.session }
        : {},
    ship:
      telemetry.ship && typeof telemetry.ship === "object"
        ? { ...telemetry.ship }
        : {},
    navigation:
      telemetry.navigation && typeof telemetry.navigation === "object"
        ? { ...telemetry.navigation }
        : {},
    combat:
      telemetry.combat && typeof telemetry.combat === "object"
        ? { ...telemetry.combat }
        : {},
    missions:
      telemetry.missions && typeof telemetry.missions === "object"
        ? { ...telemetry.missions }
        : {},
    world:
      telemetry.world && typeof telemetry.world === "object"
        ? { ...telemetry.world }
        : {},
    automation:
      telemetry.automation && typeof telemetry.automation === "object"
        ? { ...telemetry.automation }
        : {},
    events: {
      latest: {
        type: snapshot?.currentEvent?.eventType ?? null,
        summary: snapshot?.currentEvent?.summary ?? null,
        timestamp: snapshot?.currentEvent?.timestamp ?? null,
      },
    },
  };
};

const getPredicateAvailability = (
  source: Record<string, unknown> | null,
  predicate: AutomationStatePredicate,
): { available: boolean; value: unknown; result: boolean | null } => {
  const value = readStatePathValue(source, predicate.path);
  const result = evaluateAutomationStatePredicate(source, predicate);
  if (predicate.operator === "exists" || predicate.operator === "not_exists") {
    return { available: true, value, result };
  }
  return {
    available: value !== undefined && result !== null,
    value,
    result,
  };
};

const mapVoiceAttackResultTypeToExecutionStatus = (
  resultType: VoiceAttackExecutionResultType,
): AutomationExecutionStatus => {
  switch (resultType) {
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "blocked_by_precondition":
    case "blocked_by_policy":
    case "unsupported":
    case "timed_out":
    case "invalid_dependency_graph":
    case "unresolved_dependency":
      return "blocked";
    case "completed":
    case "already_satisfied":
    case "command_sent_unconfirmed":
    case "partially_executed":
    default:
      return "completed";
  }
};

export class AutomationManager {
  private readonly store: AutomationProfileStore;

  private readonly keyboardAdapter: KeyboardInputAdapter;

  private readonly hotkeyApi: HotkeyApi;

  private readonly dialogApi: DialogApi;

  private readonly emitEvent: (event: AutomationManagerEvent) => void;

  private readonly logger: LoggerApi;

  private readonly activeApplicationAdapter: ActiveApplicationAdapter;

  private readonly runningExecutions = new Map<string, RunningExecution>();

  private readonly pendingSceneActions = new Map<string, PendingSceneAction>();

  private readonly lastRunByCommand = new Map<string, number>();

  private readonly history: AutomationExecutionRecord[] = [];

  private status: AutomationRuntimeStatus = "ready";

  private emergencyStopped = false;

  private lastError: string | undefined;

  private syncedAssistantState: AutomationAssistantStateSnapshot | null = null;

  private readonly voiceAttackGlobalVariables = new Map<
    string,
    AutomationScriptValue
  >();

  private readonly voiceAttackProfileVariables = new Map<
    string,
    Map<string, AutomationScriptValue>
  >();

  private settings: AutomationSettings = getDefaultAutomationSettings();

  private detectedApplication: AutomationDetectedApplication | null = null;

  private matchedProfileId: string | null = null;

  private profileSelectionSource: AutomationProfileSelectionSource = "none";

  private profileMatchConfidence: number | null = null;

  private lastProfileTransitionAt: string | null = null;

  private pendingTransitionSignature: string | null = null;

  private pendingTransitionProfileId: string | null = null;

  private pendingTransitionSource: AutomationProfileSelectionSource = "none";

  private pendingTransitionObservedAtMs: number | null = null;

  private pendingTransitionConfidence: number | null = null;

  private detectionFailureStartedAtMs: number | null = null;

  private activeApplicationPollTimer: NodeJS.Timeout | null = null;

  private registeredHotkey: string | null = null;

  private registeredVoiceCommandHotkey: string | null = null;

  private voiceCommandHotkeyRegistered = false;

  private voiceCommandHotkeyError: string | null = null;

  private voiceCommandListeningActive = false;

  private voiceCommandListeningTimer: NodeJS.Timeout | null = null;

  private initializationPromise: Promise<void> | null = null;

  private readonly voiceAttackSessions = new Map<string, StoredVoiceAttackSession>();

  private disposed = false;

  constructor(options: AutomationManagerOptions) {
    this.store = options.store;
    this.keyboardAdapter = options.keyboardAdapter;
    this.hotkeyApi = options.hotkeyApi;
    this.dialogApi = options.dialogApi;
    this.emitEvent = options.emitEvent;
    this.logger = options.logger ?? console;
    this.activeApplicationAdapter =
      options.activeApplicationAdapter ?? createActiveApplicationAdapter();
  }

  initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeInternal();
    }
    return this.initializationPromise;
  }

  async dispose(): Promise<void> {
    await this.initialize();
    this.disposed = true;
    this.stopActiveApplicationPolling();
    this.clearVoiceCommandListeningTimer();
    this.voiceCommandListeningActive = false;
    await Promise.all(
      Array.from(this.voiceAttackSessions.values()).map(async (session) => {
        session.controller.abort();
        if (session.sessionFilePath) {
          await deleteVoiceAttackSessionFile(session.sessionFilePath);
        }
      }),
    );
    this.voiceAttackSessions.clear();
    await this.cancelAll();
    await this.releaseAllHeldKeys();
    if (this.registeredHotkey) {
      this.hotkeyApi.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }
    if (this.registeredVoiceCommandHotkey) {
      this.hotkeyApi.unregister(this.registeredVoiceCommandHotkey);
      this.registeredVoiceCommandHotkey = null;
    }
  }

  async listProfiles() {
    await this.initialize();
    return this.store.listProfileSummaries();
  }

  async getProfile(profileId: string) {
    await this.initialize();
    return this.store.getProfile(profileId);
  }

  async saveProfile(profile: AutomationProfile) {
    await this.initialize();
    const savedProfile = await this.store.saveProfile(profile);
    if (!this.settings.activeProfileId) {
      this.settings.activeProfileId = savedProfile.profileId;
      this.settings.manualProfileId = savedProfile.profileId;
      await this.store.saveSettings(this.settings);
    }
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    return savedProfile;
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    await this.initialize();
    const deleted = await this.store.deleteProfile(profileId);
    if (deleted && this.settings.activeProfileId === profileId) {
      this.settings.activeProfileId = null;
    }
    if (deleted && this.settings.manualProfileId === profileId) {
      this.settings.manualProfileId = null;
      await this.store.saveSettings(this.settings);
    }
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    return deleted;
  }

  async importProfiles(): Promise<AutomationImportResult> {
    await this.initialize();
    const filePath = await this.dialogApi.openImportFile();
    if (!filePath) {
      return { importedProfileIds: [] };
    }
    const importedProfileIds =
      await this.store.importProfilesFromFile(filePath);
    if (!this.settings.activeProfileId && importedProfileIds[0]) {
      this.settings.activeProfileId = importedProfileIds[0];
      this.settings.manualProfileId = importedProfileIds[0];
      await this.store.saveSettings(this.settings);
    }
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    return { importedProfileIds };
  }

  async inspectVoiceAttackSource(): Promise<VoiceAttackInspectionResult | null> {
    await this.initialize();
    const selectedPath = await this.dialogApi.openVoiceAttackSource();
    if (!selectedPath) {
      this.logger.info("[voiceattack:inspect:cancelled]");
      return null;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    this.logger.info("[voiceattack:inspect:start]", { selectedPath });
    try {
      const helperResponse = await runVoiceAttackHelperCommand({
        type: "inspect_source",
        selectedPath,
      });
      if (helperResponse.type !== "inspect_source") {
        throw new Error("VoiceAttack helper returned an unexpected response.");
      }
      this.voiceAttackSessions.set(helperResponse.inspection.importId, {
        controller,
        inspection: helperResponse.inspection,
        session: null,
        sessionFilePath: helperResponse.sessionFilePath,
      });
      this.logger.info("[voiceattack:inspect:success]", {
        elapsedMs: Date.now() - startedAt,
        importId: helperResponse.inspection.importId,
        candidateProfileCount: helperResponse.inspection.candidateProfileCount,
        parseableFileCount: helperResponse.inspection.parseableFileCount,
        sessionFilePath: helperResponse.sessionFilePath,
      });
      return helperResponse.inspection;
    } catch (error) {
      this.logger.warn(
        "VoiceAttack helper inspection failed; falling back to the in-process importer.",
        error,
      );
      const session = await inspectVoiceAttackSourcePath(
        selectedPath,
        controller.signal,
      );
      this.voiceAttackSessions.set(session.importId, {
        controller,
        inspection: session.inspection,
        session,
        sessionFilePath: null,
      });
      this.logger.info("[voiceattack:inspect:fallback-success]", {
        elapsedMs: Date.now() - startedAt,
        importId: session.importId,
        candidateProfileCount: session.inspection.candidateProfileCount,
        parseableFileCount: session.inspection.parseableFileCount,
      });
      return session.inspection;
    }
  }

  async previewVoiceAttackImport(options: {
    importId: string;
    candidateId: string;
  }): Promise<VoiceAttackProfilePreview> {
    await this.initialize();
    const session = this.requireVoiceAttackSession(options.importId);
    const candidate =
      session.inspection.candidates.find(
        (entry) => entry.candidateId === options.candidateId,
      ) ?? null;
    const startedAt = Date.now();
    this.logger.info("[voiceattack:preview:start]", {
      importId: options.importId,
      candidateId: options.candidateId,
      sessionFilePath: session.sessionFilePath,
      sourceBasename: candidate?.sourceBasename,
      profileName: candidate?.profileName,
      decoderStatus: candidate?.decoderStatus,
      sourceFormat: candidate?.sourceFormat,
      packageEntryCount: candidate?.packageEntries.length,
    });
    if (session.sessionFilePath) {
      try {
        const helperResponse = await runVoiceAttackHelperCommand({
          type: "load_preview",
          sessionFilePath: session.sessionFilePath,
          candidateId: options.candidateId,
        });
        if (helperResponse.type !== "load_preview") {
          throw new Error(
            "VoiceAttack helper returned an unexpected preview response.",
          );
        }
        this.logger.info("[voiceattack:preview:success]", {
          elapsedMs: Date.now() - startedAt,
          importId: helperResponse.preview.importId,
          candidateId: helperResponse.preview.candidateId,
          profileName: helperResponse.preview.profileName,
          commandCount: helperResponse.preview.commandCount,
          supportedCommandCount: helperResponse.preview.supportedCommandCount,
          partiallySupportedCommandCount:
            helperResponse.preview.partiallySupportedCommandCount,
        });
        return helperResponse.preview;
      } catch (error) {
        this.logger.warn(
          "VoiceAttack helper preview failed.",
          error,
        );
        this.logger.warn("[voiceattack:preview:error]", {
          elapsedMs: Date.now() - startedAt,
          importId: options.importId,
          candidateId: options.candidateId,
          sourceBasename: candidate?.sourceBasename,
          message: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          error instanceof Error
            ? `VoiceAttack preview failed: ${error.message}`
            : "VoiceAttack preview failed.",
        );
      }
    }
    const preview = getVoiceAttackPreview(
      this.requireResolvedVoiceAttackSession(session),
      options.candidateId,
    );
    this.logger.info("[voiceattack:preview:inline-success]", {
      elapsedMs: Date.now() - startedAt,
      importId: preview.importId,
      candidateId: preview.candidateId,
      profileName: preview.profileName,
      commandCount: preview.commandCount,
    });
    return preview;
  }

  async exportVoiceAttackDiagnosticReport(options: {
    importId: string;
    candidateId: string;
  }): Promise<boolean> {
    await this.initialize();
    const session = this.requireVoiceAttackSession(options.importId);
    const preview = await this.previewVoiceAttackImport(options);
    const outputPath = await this.dialogApi.openVoiceAttackDiagnosticFile({
      sourceBasename:
        preview.containerBasename && preview.embeddedEntryName
          ? `${preview.containerBasename} ${path.basename(preview.embeddedEntryName, path.extname(preview.embeddedEntryName))}`
          : preview.sourceBasename,
    });
    if (!outputPath) {
      return false;
    }
    let report: Record<string, unknown>;
    if (session.sessionFilePath) {
      try {
        const helperResponse = await runVoiceAttackHelperCommand({
          type: "build_diagnostic_report",
          sessionFilePath: session.sessionFilePath,
          candidateId: options.candidateId,
        });
        if (helperResponse.type !== "build_diagnostic_report") {
          throw new Error(
            "VoiceAttack helper returned an unexpected report response.",
          );
        }
        report = helperResponse.report;
      } catch (error) {
        this.logger.warn(
          "VoiceAttack helper report generation failed.",
          error,
        );
        throw new Error(
          error instanceof Error
            ? `VoiceAttack diagnostic report failed: ${error.message}`
            : "VoiceAttack diagnostic report failed.",
        );
      }
    } else {
      report = buildVoiceAttackDiagnosticReport(
        this.requireResolvedVoiceAttackSession(session),
        options.candidateId,
      );
    }
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    return true;
  }

  async importVoiceAttackProfile(
    options: VoiceAttackImportRequest,
  ): Promise<ReturnType<typeof buildVoiceAttackImportedProfile>["result"]> {
    await this.initialize();
    const session = this.requireVoiceAttackSession(options.importId);
    const existingProfileIds = (await this.store.listProfiles()).map(
      (profile) => profile.profileId,
    );
    let profile: AutomationProfile;
    let result: ReturnType<typeof buildVoiceAttackImportedProfile>["result"];
    if (session.sessionFilePath) {
      try {
        const helperResponse = await runVoiceAttackHelperCommand({
          type: "build_import",
          sessionFilePath: session.sessionFilePath,
          request: options,
          existingProfileIds,
        });
        if (helperResponse.type !== "build_import") {
          throw new Error(
            "VoiceAttack helper returned an unexpected import response.",
          );
        }
        profile = helperResponse.profile;
        result = helperResponse.result;
      } catch (error) {
        this.logger.warn(
          "VoiceAttack helper import failed.",
          error,
        );
        throw new Error(
          error instanceof Error
            ? `VoiceAttack import failed: ${error.message}`
            : "VoiceAttack import failed.",
        );
      }
    } else {
      ({ profile, result } = buildVoiceAttackImportedProfile(
        this.requireResolvedVoiceAttackSession(session),
        options,
        existingProfileIds,
      ));
    }
    await this.store.saveProfile(profile);
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    return result;
  }

  async cancelVoiceAttackImport(importId: string): Promise<boolean> {
    await this.initialize();
    const session = this.voiceAttackSessions.get(importId);
    if (!session) {
      return false;
    }
    session.controller.abort();
    if (session.sessionFilePath) {
      await deleteVoiceAttackSessionFile(session.sessionFilePath);
    }
    this.voiceAttackSessions.delete(importId);
    return true;
  }

  async validateImportedProfile(
    profileId: string,
  ): Promise<ImportedAutomationProfileReviewReport> {
    await this.initialize();
    const profile = await this.requireStoredProfile(profileId);
    return buildImportedProfileReviewReport(profile);
  }

  async markImportedProfileReviewed(
    profileId: string,
  ): Promise<AutomationProfile> {
    await this.initialize();
    const profile = await this.requireStoredProfile(profileId);
    if (!profile.importMetadata?.imported) {
      throw new Error(
        `Profile "${profileId}" is not an imported automation draft.`,
      );
    }
    const report = buildImportedProfileReviewReport(profile);
    if (!report.readyToMarkReviewed) {
      throw new Error(
        report.findings[0] ?? "The imported profile still requires review.",
      );
    }
    const saved = await this.store.saveProfile({
      ...profile,
      commands: profile.commands.map((command) => ({
        ...command,
        aliases: [...command.aliases],
        steps: command.steps.map((step) => ({ ...step })),
        voiceAttack: command.voiceAttack
          ? structuredClone(command.voiceAttack)
          : undefined,
      })),
      importMetadata: {
        ...profile.importMetadata,
        importWarnings: [...profile.importMetadata.importWarnings],
        reviewStatus: "reviewed",
      },
    });
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    return saved;
  }

  async exportProfile(options: AutomationExportOptions): Promise<boolean> {
    await this.initialize();
    const outputPath = await this.dialogApi.openExportFile(options);
    if (!outputPath) {
      return false;
    }
    const content = await this.store.exportProfile(
      options.profileId,
      options.format,
    );
    await fs.writeFile(outputPath, content, "utf8");
    return true;
  }

  async selectTelemetryDirectory(): Promise<string | null> {
    await this.initialize();
    return this.dialogApi.openTelemetryDirectory();
  }

  async getStatus(): Promise<AutomationStatusSnapshot> {
    await this.initialize();
    return this.buildSnapshot();
  }

  async setActiveProfile(
    profileId: string | null,
  ): Promise<AutomationStatusSnapshot> {
    await this.initialize();
    if (profileId) {
      const profile = await this.store.getProfile(profileId);
      if (!profile) {
        throw new Error(`Profile "${profileId}" does not exist.`);
      }
    }
    this.settings.manualProfileId = profileId;
    this.settings.profileSelectionMode = "manual";
    this.settings.activeProfileId = profileId;
    await this.store.saveSettings(this.settings);
    await this.emitProfilesChanged();
    return this.reconcileProfileSelection(true);
  }

  async updateSettings(
    settingsPatch: Partial<AutomationSettings>,
  ): Promise<AutomationStatusSnapshot> {
    await this.initialize();
    const previousPollIntervalMs =
      this.settings.activeApplicationPollIntervalMs;
    const nextSettings = normalizeAutomationSettings({
      ...this.settings,
      ...settingsPatch,
      activeProfileId:
        settingsPatch.activeProfileId === undefined
          ? this.settings.activeProfileId
          : settingsPatch.activeProfileId,
      emergencyStopHotkey:
        settingsPatch.emergencyStopHotkey?.trim() ||
        this.settings.emergencyStopHotkey,
    });

    this.settings = await this.store.saveSettings(nextSettings);
    this.registerEmergencyHotkey(this.settings.emergencyStopHotkey);
    this.registerVoiceCommandHotkey(
      this.settings.voiceCommandPushToCommandHotkey,
      this.settings.voiceCommandActivationMode === "push_to_command",
    );
    if (
      this.settings.activeApplicationPollIntervalMs !== previousPollIntervalMs
    ) {
      this.startActiveApplicationPolling();
    }
    return this.reconcileProfileSelection(true);
  }

  async setVoiceCommandListeningActive(
    active: boolean,
  ): Promise<AutomationStatusSnapshot> {
    await this.initialize();
    const changed = this.updateVoiceCommandListeningState(active, {
      releaseAfterMs: active ? VOICE_COMMAND_ARM_TIMEOUT_MS : null,
    });
    if (changed) {
      return this.emitStatus();
    }
    return this.buildSnapshot();
  }

  async syncAssistantState(
    snapshot: AutomationAssistantStateSnapshot | null,
  ): Promise<boolean> {
    await this.initialize();
    this.syncedAssistantState = snapshot
      ? structuredClone(snapshot)
      : null;
    return true;
  }

  async executeCommand(
    profileId: string,
    commandId: string,
    options?: AutomationExecuteOptions,
  ): Promise<{ requestId: string; status: AutomationExecutionStatus }> {
    await this.initialize();
    const requestId = options?.requestId?.trim() || randomUUID();
    const source = options?.source ?? "manual";
    const allowDisabled = options?.allowDisabled === true;
    if (allowDisabled && source !== "manual") {
      throw new AutomationBlockedError(
        "Disabled automation previews are only available for manual tests.",
      );
    }
    const profile = await this.requireProfile(profileId, allowDisabled);
    const command = this.requireCommand(profile, commandId, allowDisabled);
    const dryRun =
      options?.dryRun ?? command.defaultDryRun ?? this.settings.dryRun;

    if (this.emergencyStopped) {
      const blockedRecord = this.createRecord({
        requestId,
        profileId,
        commandId,
        source,
        status: "blocked",
        dryRun,
        error: "Automation is emergency stopped.",
      });
      this.pushHistory(blockedRecord);
      this.emitEvent({ type: "execution", record: blockedRecord });
      await this.emitStatus();
      return { requestId, status: "blocked" };
    }

    this.enforceCooldown(profileId, command);
    this.enforceConcurrency(profileId, command);

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const execution: RunningExecution = {
      requestId,
      profileId,
      commandId,
      source,
      dryRun,
      allowDisabled,
      startedAtMs,
      startedAt,
      controller: new AbortController(),
      heldKeys: new Set(),
      keyReleaseTimers: new Map(),
      scriptVariables: new Map<string, AutomationScriptValue>([
        ["request_id", requestId],
        ["profile_id", profileId],
        ["command_id", commandId],
        ["source", source],
        ["dry_run", dryRun],
        ["started_at", startedAt],
        ["started_at_ms", startedAtMs],
        ...Object.entries(options?.variables ?? {}).map(([key, value]) => [
          key,
          value,
        ]),
      ]),
      readOnlyScriptVariables: new Set([
        "request_id",
        "profile_id",
        "command_id",
        "source",
        "dry_run",
        "started_at",
        "started_at_ms",
      ]),
    };
    this.runningExecutions.set(requestId, execution);
    this.status = "executing";
    this.lastError = undefined;
    this.lastRunByCommand.set(
      `${profileId}:${command.commandId}`,
      execution.startedAtMs,
    );

    this.emitEvent({
      type: "execution",
      record: this.createRecord({
        requestId,
        profileId,
        commandId,
        source,
        status: "started",
        dryRun,
        startedAt: execution.startedAt,
      }),
    });
    await this.emitStatus();

    void this.runExecution(execution, profile, command, command.maxDurationMs);
    return { requestId, status: "started" };
  }

  async cancel(requestId: string): Promise<boolean> {
    await this.initialize();
    const execution = this.runningExecutions.get(requestId);
    if (!execution) {
      return false;
    }
    execution.controller.abort();
    return true;
  }

  async cancelAll(): Promise<number> {
    await this.initialize();
    const running = Array.from(this.runningExecutions.values());
    running.forEach((execution) => execution.controller.abort());
    return running.length;
  }

  async emergencyStop(reason = "manual stop"): Promise<void> {
    await this.initialize();
    this.emergencyStopped = true;
    this.status = "emergency_stopped";
    this.lastError = reason;
    await this.cancelAll();
    await this.releaseAllHeldKeys();
    await this.emitStatus();
  }

  async resetEmergencyStop(): Promise<AutomationStatusSnapshot> {
    await this.initialize();
    this.emergencyStopped = false;
    this.lastError = undefined;
    if (this.runningExecutions.size === 0) {
      this.status = "ready";
    }
    return this.emitStatus();
  }

  async respondToSceneAction(
    result: AutomationSceneActionResult,
  ): Promise<boolean> {
    await this.initialize();
    const pending = this.pendingSceneActions.get(result.actionId);
    if (!pending || pending.requestId !== result.requestId) {
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingSceneActions.delete(result.actionId);
    pending.resolve(result);
    return true;
  }

  async buildBackendStatusMessage(): Promise<AutomationStatusWsMessage> {
    const snapshot = await this.getStatus();
    return {
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
    };
  }

  private async initializeInternal(): Promise<void> {
    await this.store.ensureInitialized();
    this.settings = await this.store.loadSettings();
    this.registerEmergencyHotkey(this.settings.emergencyStopHotkey);
    this.registerVoiceCommandHotkey(
      this.settings.voiceCommandPushToCommandHotkey,
      this.settings.voiceCommandActivationMode === "push_to_command",
    );
    await this.emitProfilesChanged();
    await this.reconcileProfileSelection(true);
    this.startActiveApplicationPolling();
  }

  private registerEmergencyHotkey(hotkey: string): void {
    if (this.registeredHotkey) {
      this.hotkeyApi.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }
    if (!hotkey) {
      return;
    }
    const registered = this.hotkeyApi.register(hotkey, () => {
      void this.emergencyStop("Emergency stop triggered from global hotkey.");
    });
    if (registered) {
      this.registeredHotkey = hotkey;
    } else {
      this.lastError = "Unable to register the emergency-stop hotkey.";
      this.logger.warn(this.lastError);
    }
  }

  private registerVoiceCommandHotkey(hotkey: string, enabled: boolean): void {
    if (this.registeredVoiceCommandHotkey) {
      this.hotkeyApi.unregister(this.registeredVoiceCommandHotkey);
      this.registeredVoiceCommandHotkey = null;
    }
    this.voiceCommandHotkeyRegistered = false;
    this.voiceCommandHotkeyError = null;
    if (!enabled || !hotkey) {
      this.updateVoiceCommandListeningState(false, { releaseAfterMs: null });
      return;
    }
    const registered = this.hotkeyApi.register(hotkey, () => {
      void this.setVoiceCommandListeningActive(true);
    });
    if (registered) {
      this.registeredVoiceCommandHotkey = hotkey;
      this.voiceCommandHotkeyRegistered = true;
      return;
    }
    this.voiceCommandHotkeyError =
      "Unable to register the push-to-command hotkey.";
    this.logger.warn(this.voiceCommandHotkeyError);
    this.updateVoiceCommandListeningState(false, { releaseAfterMs: null });
  }

  private clearVoiceCommandListeningTimer(): void {
    if (this.voiceCommandListeningTimer) {
      clearTimeout(this.voiceCommandListeningTimer);
      this.voiceCommandListeningTimer = null;
    }
  }

  private updateVoiceCommandListeningState(
    active: boolean,
    options?: { releaseAfterMs?: number | null },
  ): boolean {
    this.clearVoiceCommandListeningTimer();
    if (
      active &&
      this.settings.voiceCommandActivationMode === "push_to_command" &&
      options?.releaseAfterMs &&
      options.releaseAfterMs > 0
    ) {
      this.voiceCommandListeningTimer = setTimeout(() => {
        if (
          this.updateVoiceCommandListeningState(false, { releaseAfterMs: null })
        ) {
          void this.emitStatus();
        }
      }, options.releaseAfterMs);
    }
    if (this.voiceCommandListeningActive === active) {
      return false;
    }
    this.voiceCommandListeningActive = active;
    return true;
  }

  private startActiveApplicationPolling(): void {
    this.stopActiveApplicationPolling();
    const intervalMs = this.settings.activeApplicationPollIntervalMs;
    if (intervalMs <= 0) {
      return;
    }
    this.activeApplicationPollTimer = setInterval(() => {
      void this.refreshActiveApplicationState();
    }, intervalMs);
    void this.refreshActiveApplicationState();
  }

  private stopActiveApplicationPolling(): void {
    if (this.activeApplicationPollTimer) {
      clearInterval(this.activeApplicationPollTimer);
      this.activeApplicationPollTimer = null;
    }
  }

  private async refreshActiveApplicationState(): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      const snapshot =
        await this.activeApplicationAdapter.pollActiveApplication();
      if (this.disposed) {
        return;
      }
      if (!snapshot) {
        await this.handleDetectionFailure();
        return;
      }
      this.detectionFailureStartedAtMs = null;
      await this.handleDetectedApplication(snapshot);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.logger.warn(
        "[automation] Active application detection failed:",
        error,
      );
      await this.handleDetectionFailure();
    }
  }

  private async handleDetectedApplication(
    snapshot: ActiveApplicationSnapshot,
  ): Promise<void> {
    const nextDetectedApplication: AutomationDetectedApplication = {
      processName: snapshot.processName,
      windowTitle: snapshot.windowTitle,
      detectedAt: snapshot.detectedAt,
      confidence: snapshot.confidence,
    };
    const currentSignature = getActiveApplicationSignature(
      this.detectedApplication,
    );
    const nextSignature = getActiveApplicationSignature(
      nextDetectedApplication,
    );
    const applicationChanged = currentSignature !== nextSignature;

    if (applicationChanged) {
      this.detectedApplication = nextDetectedApplication;
    }

    const statusChanged = await this.syncProfileSelection(applicationChanged);
    if (applicationChanged || statusChanged) {
      await this.emitStatus();
    }
  }

  private async handleDetectionFailure(): Promise<void> {
    const nowMs = Date.now();
    if (this.detectionFailureStartedAtMs === null) {
      this.detectionFailureStartedAtMs = nowMs;
      return;
    }
    if (
      nowMs - this.detectionFailureStartedAtMs <
      this.settings.detectionFailureGracePeriodMs
    ) {
      return;
    }
    if (!this.detectedApplication && this.matchedProfileId === null) {
      return;
    }
    this.detectedApplication = null;
    this.pendingTransitionSignature = null;
    this.pendingTransitionProfileId = null;
    this.pendingTransitionSource = "none";
    this.pendingTransitionObservedAtMs = null;
    this.pendingTransitionConfidence = null;
    const changed = await this.syncProfileSelection(true);
    if (changed) {
      await this.emitStatus();
    }
  }

  private async syncProfileSelection(force = false): Promise<boolean> {
    const profiles = await this.store.listProfiles();
    let changed = false;

    const manualProfileId =
      this.settings.manualProfileId &&
      profiles.some(
        (profile) =>
          profile.profileId === this.settings.manualProfileId &&
          profile.enabled,
      )
        ? this.settings.manualProfileId
        : null;

    if (manualProfileId !== this.settings.manualProfileId) {
      this.settings.manualProfileId = manualProfileId;
      changed = true;
    }

    const matches = getMatchingProfiles(
      profiles,
      this.detectedApplication?.processName ?? null,
    );
    const matchedProfile = chooseMatchedProfile(
      matches,
      this.settings.activeProfileId,
    );
    const matchedProfileId = matchedProfile?.profileId ?? null;
    const matchConfidence = getProfileMatchConfidence(matches);

    if (matchedProfileId !== this.matchedProfileId) {
      this.matchedProfileId = matchedProfileId;
      changed = true;
    }
    if (matchConfidence !== this.profileMatchConfidence) {
      this.profileMatchConfidence = matchConfidence;
      changed = true;
    }

    if (this.settings.profileSelectionMode === "manual") {
      this.clearPendingTransition();
      return (
        this.applyEffectiveProfile(
          manualProfileId,
          manualProfileId ? "manual" : "none",
          matchConfidence,
        ) || changed
      );
    }

    if (this.settings.profileSelectionMode === "disabled") {
      this.clearPendingTransition();
      return (
        this.applyEffectiveProfile(null, "none", matchConfidence) || changed
      );
    }

    const desiredEffectiveProfileId = matchedProfileId;
    const desiredSource: AutomationProfileSelectionSource =
      desiredEffectiveProfileId ? "automatic" : "none";
    const activeSignature = getActiveApplicationSignature(
      this.detectedApplication,
    );

    if (force || desiredEffectiveProfileId === this.settings.activeProfileId) {
      this.clearPendingTransition();
      return (
        this.applyEffectiveProfile(
          desiredEffectiveProfileId,
          desiredSource,
          matchConfidence,
        ) || changed
      );
    }

    if (
      this.pendingTransitionSignature !== activeSignature ||
      this.pendingTransitionProfileId !== desiredEffectiveProfileId ||
      this.pendingTransitionSource !== desiredSource
    ) {
      this.pendingTransitionSignature = activeSignature;
      this.pendingTransitionProfileId = desiredEffectiveProfileId;
      this.pendingTransitionSource = desiredSource;
      this.pendingTransitionObservedAtMs = Date.now();
      this.pendingTransitionConfidence = matchConfidence;
      return changed;
    }

    if (
      this.pendingTransitionObservedAtMs !== null &&
      Date.now() - this.pendingTransitionObservedAtMs >=
        this.settings.profileSwitchDebounceMs &&
      this.pendingTransitionSignature === activeSignature
    ) {
      const applied = this.applyEffectiveProfile(
        this.pendingTransitionProfileId,
        this.pendingTransitionSource,
        this.pendingTransitionConfidence,
      );
      this.clearPendingTransition();
      return applied || changed;
    }

    return changed;
  }

  private async reconcileProfileSelection(
    force = false,
  ): Promise<AutomationStatusSnapshot> {
    const changed = await this.syncProfileSelection(force);
    if (changed) {
      return this.emitStatus();
    }
    return this.buildSnapshot();
  }

  private clearPendingTransition(): void {
    this.pendingTransitionSignature = null;
    this.pendingTransitionProfileId = null;
    this.pendingTransitionSource = "none";
    this.pendingTransitionObservedAtMs = null;
    this.pendingTransitionConfidence = null;
  }

  private applyEffectiveProfile(
    profileId: string | null,
    source: AutomationProfileSelectionSource,
    confidence: number | null,
  ): boolean {
    const previousProfileId = this.settings.activeProfileId;
    const previousSource = this.profileSelectionSource;
    let changed = false;

    if (this.settings.activeProfileId !== profileId) {
      this.settings.activeProfileId = profileId;
      changed = true;
    }
    if (this.profileSelectionSource !== source) {
      this.profileSelectionSource = source;
      changed = true;
    }
    if (confidence !== this.profileMatchConfidence) {
      this.profileMatchConfidence = confidence;
      changed = true;
    }
    if (
      changed &&
      (previousProfileId !== profileId || previousSource !== source)
    ) {
      this.lastProfileTransitionAt = new Date().toISOString();
    }
    return changed;
  }

  private async runExecution(
    execution: RunningExecution,
    profile: AutomationProfile,
    command: AutomationCommand,
    maxDurationMs: number,
  ): Promise<void> {
    const deadlineMs = execution.startedAtMs + maxDurationMs;
    let status: AutomationExecutionStatus = "completed";
    let errorMessage: string | undefined;
    let outcome: AutomationVoiceAttackExecutionOutcome | undefined;

    try {
      if (command.voiceAttack?.actionTree.length) {
        outcome = await this.executeVoiceAttackCommand(
          execution,
          profile,
          command,
          deadlineMs,
        );
        status = mapVoiceAttackResultTypeToExecutionStatus(outcome.resultType);
        if (status === "blocked" || status === "failed") {
          errorMessage = outcome.reason;
        }
      } else {
        await this.executeSteps(execution, profile, command, deadlineMs, 0);
      }
    } catch (error: any) {
      if (error instanceof AutomationCancellationError) {
        status = "cancelled";
      } else if (error instanceof AutomationBlockedError) {
        status = "blocked";
        errorMessage = error.message;
      } else {
        status = "failed";
        errorMessage =
          error instanceof Error
            ? error.message
            : "Automation execution failed.";
      }
    } finally {
      await this.cleanupExecution(execution);
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - execution.startedAtMs;
    if (status === "failed" || status === "blocked") {
      this.lastError = errorMessage;
    } else if (status !== "cancelled") {
      this.lastError = undefined;
    }

    if (this.runningExecutions.size === 0 && !this.emergencyStopped) {
      this.status =
        status === "cancelled"
          ? "cancelled"
          : status === "failed"
            ? "error"
            : "ready";
    }

    const record = this.createRecord({
      requestId: execution.requestId,
      profileId: execution.profileId,
      commandId: execution.commandId,
      source: execution.source,
      status,
      dryRun: execution.dryRun,
      startedAt: execution.startedAt,
      finishedAt,
      durationMs,
      error: errorMessage,
      outcome,
    });
    this.pushHistory(record);
    this.emitEvent({ type: "execution", record });
    await this.emitStatus();
  }

  private async cleanupExecution(execution: RunningExecution): Promise<void> {
    execution.keyReleaseTimers.forEach((timer) => clearTimeout(timer));
    execution.keyReleaseTimers.clear();
    await this.keyboardAdapter.releaseAll(execution.heldKeys);
    this.runningExecutions.delete(execution.requestId);
  }

  private getOrCreateProfileVoiceAttackVariables(
    profileId: string,
  ): Map<string, AutomationScriptValue> {
    const existing = this.voiceAttackProfileVariables.get(profileId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, AutomationScriptValue>();
    this.voiceAttackProfileVariables.set(profileId, created);
    return created;
  }

  private getCurrentAssistantStateRecord(): Record<string, unknown> | null {
    return buildAssistantStateRecord(this.syncedAssistantState);
  }

  private buildVoiceAttackOutcome(
    command: AutomationCommand,
    context: VoiceAttackExecutionContext,
    startedAtMs: number,
    resultType: VoiceAttackExecutionResultType,
    reason: string,
    contract: AutomationSemanticContract | null,
  ): AutomationVoiceAttackExecutionOutcome {
    return {
      commandId: command.commandId,
      resultType,
      reason,
      physicalInputSent: context.physicalInputSent,
      telemetryConfirmed: context.telemetryConfirmed,
      skippedActions: [...context.skippedActions],
      blockingActions: [...context.blockingActions],
      unsupportedActions: [...context.unsupportedActions],
      nestedCommandTrace: [...context.nestedCommandTrace],
      durationMs: Date.now() - startedAtMs,
      finalObservedState: this.buildVoiceAttackFinalObservedState(contract),
      trace: [...context.trace],
      semanticCapabilityId: contract?.capabilityId ?? null,
    };
  }

  private buildVoiceAttackFinalObservedState(
    contract: AutomationSemanticContract | null,
  ): Record<string, unknown> | null {
    if (!contract) {
      return null;
    }
    const stateRecord = this.getCurrentAssistantStateRecord();
    if (!stateRecord) {
      return null;
    }
    const paths = new Set<string>(Object.keys(contract.desiredState));
    contract.preconditions.forEach((predicate) => paths.add(predicate.path));
    if (contract.alreadySatisfiedWhen) {
      paths.add(contract.alreadySatisfiedWhen.path);
    }
    if (contract.successWhen) {
      paths.add(contract.successWhen.path);
    }
    if (contract.failureWhen) {
      paths.add(contract.failureWhen.path);
    }
    return Object.fromEntries(
      [...paths].map((pathValue) => [
        pathValue,
        readStatePathValue(stateRecord, pathValue) ?? null,
      ]),
    );
  }

  private buildVoiceAttackResultReason(
    command: AutomationCommand,
    resultType: VoiceAttackExecutionResultType,
    detail?: string,
  ): string {
    if (detail?.trim()) {
      return detail.trim();
    }
    switch (resultType) {
      case "completed":
        return `${command.label} completed.`;
      case "already_satisfied":
        return `${command.label} is already satisfied.`;
      case "command_sent_unconfirmed":
        return `Sent ${command.label}, but the game did not confirm the change.`;
      case "blocked_by_precondition":
        return `${command.label} is not available in the current state.`;
      case "blocked_by_policy":
        return `${command.label} is blocked by policy.`;
      case "unsupported":
        return `${command.label} still depends on unsupported VoiceAttack actions.`;
      case "partially_executed":
        return `${command.label} ran partially because some VoiceAttack actions were skipped.`;
      case "timed_out":
        return `${command.label} did not confirm before timing out.`;
      case "cancelled":
        return `${command.label} was cancelled.`;
      case "failed":
        return `${command.label} failed.`;
      case "invalid_dependency_graph":
        return `${command.label} has an invalid nested command graph.`;
      case "unresolved_dependency":
        return `${command.label} references nested commands that could not be resolved.`;
      default:
        return `${command.label} completed.`;
    }
  }

  private getVoiceAttackVariableValue(
    context: VoiceAttackExecutionContext,
    operand: VoiceAttackOperand,
  ): AutomationScriptValue | undefined {
    if (operand.kind === "literal") {
      return operand.value;
    }
    if (operand.kind === "state_path") {
      const stateRecord = this.getCurrentAssistantStateRecord();
      const value = readStatePathValue(stateRecord, operand.path);
      return value === undefined ? undefined : (value as AutomationScriptValue);
    }

    if (operand.scope === "local") {
      for (let index = context.localVariableFrames.length - 1; index >= 0; index -= 1) {
        const value = context.localVariableFrames[index].get(operand.variableName);
        if (value !== undefined) {
          return value;
        }
      }
      return undefined;
    }
    if (operand.scope === "profile") {
      return context.profileVariables.get(operand.variableName);
    }
    return context.globalVariables.get(operand.variableName);
  }

  private assignVoiceAttackVariable(
    context: VoiceAttackExecutionContext,
    scope: VoiceAttackVariableScope,
    variableName: string,
    value: AutomationScriptValue,
  ): void {
    if (scope === "local") {
      context.localVariableFrames[context.localVariableFrames.length - 1].set(
        variableName,
        value,
      );
      return;
    }
    if (scope === "profile") {
      context.profileVariables.set(variableName, value);
      return;
    }
    context.globalVariables.set(variableName, value);
  }

  private clearVoiceAttackVariable(
    context: VoiceAttackExecutionContext,
    scope: "local" | "profile" | "global",
    variableName: string,
  ): void {
    if (scope === "local") {
      context.localVariableFrames[context.localVariableFrames.length - 1].delete(
        variableName,
      );
      return;
    }
    if (scope === "profile") {
      context.profileVariables.delete(variableName);
      return;
    }
    context.globalVariables.delete(variableName);
  }

  private coerceVoiceAttackVariableValue(
    value: AutomationScriptValue | undefined,
    valueType: "string" | "boolean" | "integer" | "decimal",
  ): AutomationScriptValue {
    switch (valueType) {
      case "string":
        return value == null ? "" : String(value);
      case "boolean":
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "string") {
          return value.trim().toLowerCase() === "true";
        }
        if (typeof value === "number") {
          return value !== 0;
        }
        return false;
      case "integer": {
        const numeric =
          typeof value === "number" ? value : Number.parseInt(String(value ?? 0), 10);
        return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
      }
      case "decimal": {
        const numeric =
          typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
        return Number.isFinite(numeric) ? numeric : 0;
      }
      default:
        return value ?? null;
    }
  }

  private evaluateVoiceAttackCondition(
    context: VoiceAttackExecutionContext,
    condition: VoiceAttackConditionExpression,
  ): boolean | null {
    const leftValue = this.getVoiceAttackVariableValue(context, condition.left);
    const rightValue =
      condition.right === undefined
        ? undefined
        : this.getVoiceAttackVariableValue(context, condition.right);

    switch (condition.operator) {
      case "exists":
        return leftValue !== undefined;
      case "not_exists":
        return leftValue === undefined;
      case "equals":
        return leftValue === rightValue;
      case "not_equals":
        return leftValue !== rightValue;
      case "greater_than":
        return typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue > rightValue
          : null;
      case "greater_than_or_equal":
        return typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue >= rightValue
          : null;
      case "less_than":
        return typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue < rightValue
          : null;
      case "less_than_or_equal":
        return typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue <= rightValue
          : null;
      case "contains":
        if (typeof leftValue === "string" && typeof rightValue === "string") {
          return leftValue.includes(rightValue);
        }
        if (Array.isArray(leftValue)) {
          return leftValue.includes(rightValue);
        }
        return null;
      case "changed_to":
        if (condition.left.kind !== "state_path") {
          return null;
        }
        return (
          readStatePathValue(context.baselineState, condition.left.path) !== leftValue &&
          leftValue === rightValue
        );
      case "event_received":
        return typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue === rightValue
          : null;
      default:
        return null;
    }
  }

  private recordVoiceAttackTrace(
    context: VoiceAttackExecutionContext,
    commandId: string,
    node: VoiceAttackNode,
    status: AutomationVoiceAttackExecutionTraceEntry["status"],
    summary: string,
  ): void {
    context.trace.push({
      commandId,
      nodeId: node.nodeId,
      kind: node.kind,
      status,
      summary,
    });
  }

  private evaluateSemanticContractPreflight(
    command: AutomationCommand,
    contract: AutomationSemanticContract | null,
    context: VoiceAttackExecutionContext,
    startedAtMs: number,
  ): AutomationVoiceAttackExecutionOutcome | null {
    if (!contract) {
      return null;
    }
    const stateRecord = this.getCurrentAssistantStateRecord();
    if (!stateRecord && contract.fallbackWhenUnavailable === "block") {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "blocked_by_precondition",
        this.buildVoiceAttackResultReason(
          command,
          "blocked_by_precondition",
          `Current game state is unavailable for ${command.label}.`,
        ),
        contract,
      );
    }

    for (const predicate of contract.preconditions) {
      const evaluation = getPredicateAvailability(stateRecord, predicate);
      if (!evaluation.available) {
        if (contract.fallbackWhenUnavailable === "block") {
          return this.buildVoiceAttackOutcome(
            command,
            context,
            startedAtMs,
            "blocked_by_precondition",
            this.buildVoiceAttackResultReason(
              command,
              "blocked_by_precondition",
              `Current game state is unavailable for ${command.label}.`,
            ),
            contract,
          );
        }
        continue;
      }
      if (evaluation.result === false) {
        context.telemetryConfirmed = true;
        return this.buildVoiceAttackOutcome(
          command,
          context,
          startedAtMs,
          "blocked_by_precondition",
          this.buildVoiceAttackResultReason(command, "blocked_by_precondition"),
          contract,
        );
      }
    }

    if (contract.alreadySatisfiedWhen) {
      const evaluation = getPredicateAvailability(
        stateRecord,
        contract.alreadySatisfiedWhen,
      );
      if (evaluation.available && evaluation.result === true) {
        context.telemetryConfirmed = true;
        return this.buildVoiceAttackOutcome(
          command,
          context,
          startedAtMs,
          "already_satisfied",
          this.buildVoiceAttackResultReason(command, "already_satisfied"),
          contract,
        );
      }
    }

    return null;
  }

  private async confirmSemanticContractOutcome(
    execution: RunningExecution,
    command: AutomationCommand,
    contract: AutomationSemanticContract | null,
    context: VoiceAttackExecutionContext,
    startedAtMs: number,
    deadlineMs: number,
  ): Promise<AutomationVoiceAttackExecutionOutcome | null> {
    if (!contract) {
      return null;
    }
    const initialState = this.getCurrentAssistantStateRecord();
    if (!contract.successWhen) {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        context.physicalInputSent ? "command_sent_unconfirmed" : "completed",
        this.buildVoiceAttackResultReason(
          command,
          context.physicalInputSent ? "command_sent_unconfirmed" : "completed",
        ),
        contract,
      );
    }

    const successNow = getPredicateAvailability(initialState, contract.successWhen);
    if (successNow.available && successNow.result === true) {
      context.telemetryConfirmed = true;
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "completed",
        this.buildVoiceAttackResultReason(
          command,
          "completed",
          `${command.label} was confirmed by game telemetry.`,
        ),
        contract,
      );
    }

    if (contract.failureWhen) {
      const failureNow = getPredicateAvailability(initialState, contract.failureWhen);
      if (failureNow.available && failureNow.result === true) {
        context.telemetryConfirmed = true;
        return this.buildVoiceAttackOutcome(
          command,
          context,
          startedAtMs,
          "blocked_by_precondition",
          this.buildVoiceAttackResultReason(command, "blocked_by_precondition"),
          contract,
        );
      }
    }

    if (!successNow.available) {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        contract.fallbackWhenUnavailable === "execute_unconfirmed"
          ? "command_sent_unconfirmed"
          : "blocked_by_precondition",
        this.buildVoiceAttackResultReason(
          command,
          contract.fallbackWhenUnavailable === "execute_unconfirmed"
            ? "command_sent_unconfirmed"
            : "blocked_by_precondition",
        ),
        contract,
      );
    }

    const timeoutMs = Math.max(
      100,
      Math.min(
        contract.timeoutMs,
        VOICEATTACK_MAX_WAIT_UNTIL_TIMEOUT_MS,
        Math.max(100, deadlineMs - Date.now()),
      ),
    );
    const pollIntervalMs = Math.max(100, contract.pollIntervalMs ?? 250);
    const pollDeadlineMs = Date.now() + timeoutMs;
    while (Date.now() < pollDeadlineMs) {
      this.assertExecutionCanContinue(execution, deadlineMs);
      await this.sleep(
        Math.min(pollIntervalMs, Math.max(10, pollDeadlineMs - Date.now())),
        execution.controller.signal,
      );
      const nextState = this.getCurrentAssistantStateRecord();
      if (contract.failureWhen) {
        const failure = getPredicateAvailability(nextState, contract.failureWhen);
        if (failure.available && failure.result === true) {
          context.telemetryConfirmed = true;
          return this.buildVoiceAttackOutcome(
            command,
            context,
            startedAtMs,
            "blocked_by_precondition",
            this.buildVoiceAttackResultReason(command, "blocked_by_precondition"),
            contract,
          );
        }
      }
      const success = getPredicateAvailability(nextState, contract.successWhen);
      if (success.available && success.result === true) {
        context.telemetryConfirmed = true;
        return this.buildVoiceAttackOutcome(
          command,
          context,
          startedAtMs,
          "completed",
          this.buildVoiceAttackResultReason(
            command,
            "completed",
            `${command.label} was confirmed by game telemetry.`,
          ),
          contract,
        );
      }
    }

    return this.buildVoiceAttackOutcome(
      command,
      context,
      startedAtMs,
      "timed_out",
      this.buildVoiceAttackResultReason(command, "timed_out"),
      contract,
    );
  }

  private async executeVoiceAttackCommand(
    execution: RunningExecution,
    profile: AutomationProfile,
    command: AutomationCommand,
    deadlineMs: number,
  ): Promise<AutomationVoiceAttackExecutionOutcome> {
    const startedAtMs = Date.now();
    const contract = command.voiceAttack?.semanticContract ?? null;
    const context: VoiceAttackExecutionContext = {
      commandLookup: new Map(
        profile.commands.map((entry) => [entry.commandId, entry]),
      ),
      localVariableFrames: [new Map<string, AutomationScriptValue>()],
      profileVariables: this.getOrCreateProfileVoiceAttackVariables(
        profile.profileId,
      ),
      globalVariables: this.voiceAttackGlobalVariables,
      trace: [],
      skippedActions: new Set<string>(),
      blockingActions: new Set<string>(),
      unsupportedActions: new Set<string>(),
      nestedCommandTrace: [command.commandId],
      physicalInputSent: false,
      telemetryConfirmed: false,
      partialExecution: false,
      executedActionCount: 0,
      baselineState: this.getCurrentAssistantStateRecord(),
    };

    if (!command.voiceAttack?.actionTree.length) {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "unsupported",
        this.buildVoiceAttackResultReason(command, "unsupported"),
        contract,
      );
    }

    if (command.voiceAttack.dependencyGraph.dependencyCycles.length > 0) {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "invalid_dependency_graph",
        this.buildVoiceAttackResultReason(command, "invalid_dependency_graph"),
        contract,
      );
    }
    if (command.voiceAttack.dependencyGraph.unresolvedDependencyReferences.length > 0) {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "unresolved_dependency",
        this.buildVoiceAttackResultReason(command, "unresolved_dependency"),
        contract,
      );
    }
    if (command.voiceAttack.executability === "metadata_only") {
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        "unsupported",
        this.buildVoiceAttackResultReason(command, "unsupported"),
        contract,
      );
    }

    const preflight = this.evaluateSemanticContractPreflight(
      command,
      contract,
      context,
      startedAtMs,
    );
    if (preflight) {
      return preflight;
    }

    try {
      await this.executeVoiceAttackNodes(
        execution,
        profile,
        command,
        command.voiceAttack.actionTree,
        deadlineMs,
        0,
        [command.commandId],
        context,
      );
    } catch (error) {
      if (error instanceof VoiceAttackOutcomeSignal) {
        return this.buildVoiceAttackOutcome(
          command,
          context,
          startedAtMs,
          error.resultType,
          this.buildVoiceAttackResultReason(
            command,
            error.resultType,
            error.reason,
          ),
          contract,
        );
      }
      if (
        error instanceof VoiceAttackReturnSignal ||
        error instanceof VoiceAttackStopSignal
      ) {
        // Top-level stop/return ends the current command cleanly.
      } else {
        throw error;
      }
    }

    if (execution.dryRun) {
      const dryRunResultType = context.partialExecution
        ? "partially_executed"
        : "completed";
      return this.buildVoiceAttackOutcome(
        command,
        context,
        startedAtMs,
        dryRunResultType,
        `${command.label} dry run completed.`,
        contract,
      );
    }

    const confirmed = await this.confirmSemanticContractOutcome(
      execution,
      command,
      contract,
      context,
      startedAtMs,
      deadlineMs,
    );
    if (confirmed) {
      return confirmed;
    }

    const resultType =
      !context.physicalInputSent && context.unsupportedActions.size > 0
        ? "unsupported"
        : context.partialExecution
          ? "partially_executed"
          : "completed";
    return this.buildVoiceAttackOutcome(
      command,
      context,
      startedAtMs,
      resultType,
      this.buildVoiceAttackResultReason(command, resultType),
      contract,
    );
  }

  private async executeVoiceAttackNodes(
    execution: RunningExecution,
    profile: AutomationProfile,
    command: AutomationCommand,
    nodes: VoiceAttackNode[],
    deadlineMs: number,
    depth: number,
    callStack: string[],
    context: VoiceAttackExecutionContext,
  ): Promise<void> {
    if (depth > MAX_MACRO_DEPTH) {
      throw new VoiceAttackOutcomeSignal(
        "invalid_dependency_graph",
        `Macro nesting depth exceeded the limit of ${MAX_MACRO_DEPTH}.`,
      );
    }

    for (const node of nodes) {
      this.assertExecutionCanContinue(execution, deadlineMs);
      context.executedActionCount += 1;
      if (context.executedActionCount > VOICEATTACK_MAX_TOTAL_ACTIONS) {
        throw new VoiceAttackOutcomeSignal(
          "blocked_by_policy",
          `VoiceAttack action count exceeded the limit of ${VOICEATTACK_MAX_TOTAL_ACTIONS}.`,
        );
      }
      if (node.disabled) {
        const summary = `${toVoiceAttackTraceSummary(command.label, node)} (disabled)`;
        context.skippedActions.add(summary);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "skipped",
          summary,
        );
        continue;
      }
      if (node.delayMs > 0) {
        await this.sleep(node.delayMs, execution.controller.signal);
      }
      await this.executeVoiceAttackNode(
        execution,
        profile,
        command,
        node,
        deadlineMs,
        depth,
        callStack,
        context,
      );
    }
  }

  private async executeVoiceAttackNode(
    execution: RunningExecution,
    profile: AutomationProfile,
    command: AutomationCommand,
    node: VoiceAttackNode,
    deadlineMs: number,
    depth: number,
    callStack: string[],
    context: VoiceAttackExecutionContext,
  ): Promise<void> {
    const summary = toVoiceAttackTraceSummary(command.label, node);
    switch (node.kind) {
      case "wait":
        await this.sleep(node.milliseconds, execution.controller.signal);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        return;
      case "key_press":
        await this.executeKeyPress(execution, {
          type: "key_press",
          key: node.key,
          durationMs: node.durationMs,
        });
        if (!execution.dryRun) {
          context.physicalInputSent = true;
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          execution.dryRun ? "dry_run" : "executed",
          summary,
        );
        return;
      case "key_down":
        await this.executeKeyDown(execution, {
          type: "key_down",
          key: node.key,
        });
        if (!execution.dryRun) {
          context.physicalInputSent = true;
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          execution.dryRun ? "dry_run" : "executed",
          summary,
        );
        return;
      case "key_up":
        await this.executeKeyUp(execution, {
          type: "key_up",
          key: node.key,
        });
        if (!execution.dryRun) {
          context.physicalInputSent = true;
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          execution.dryRun ? "dry_run" : "executed",
          summary,
        );
        return;
      case "key_combination":
        await this.executeKeyCombination(execution, {
          type: "key_combination",
          modifiers: node.modifiers,
          key: node.key,
        });
        if (!execution.dryRun) {
          context.physicalInputSent = true;
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          execution.dryRun ? "dry_run" : "executed",
          summary,
        );
        return;
      case "set_variable": {
        const incoming = this.getVoiceAttackVariableValue(context, node.value);
        const coerced = this.coerceVoiceAttackVariableValue(incoming, node.valueType);
        const current = this.getVoiceAttackVariableValue(context, {
          kind: "variable",
          variableName: node.variableName,
          scope: node.scope,
        });
        let nextValue = coerced;
        if (node.operation === "increment") {
          nextValue =
            (typeof current === "number" ? current : 0) +
            (typeof coerced === "number" ? coerced : 0);
        } else if (node.operation === "decrement") {
          nextValue =
            (typeof current === "number" ? current : 0) -
            (typeof coerced === "number" ? coerced : 0);
        }
        this.assignVoiceAttackVariable(
          context,
          node.scope,
          node.variableName,
          nextValue,
        );
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        return;
      }
      case "clear_variable":
        this.clearVoiceAttackVariable(context, node.scope, node.variableName);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        return;
      case "if": {
        const result = this.evaluateVoiceAttackCondition(context, node.condition);
        if (result === null) {
          throw new VoiceAttackOutcomeSignal(
            "blocked_by_policy",
            `Condition evaluation failed for ${command.label}.`,
          );
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          `${summary} -> ${result ? "then" : "else"}`,
        );
        await this.executeVoiceAttackNodes(
          execution,
          profile,
          command,
          result ? node.thenNodes : node.elseNodes,
          deadlineMs,
          depth + 1,
          callStack,
          context,
        );
        return;
      }
      case "repeat": {
        if (node.iterations > VOICEATTACK_MAX_LOOP_ITERATIONS) {
          throw new VoiceAttackOutcomeSignal(
            "blocked_by_policy",
            `Repeat loop exceeded the limit of ${VOICEATTACK_MAX_LOOP_ITERATIONS} iterations.`,
          );
        }
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        for (let iteration = 0; iteration < node.iterations; iteration += 1) {
          await this.executeVoiceAttackNodes(
            execution,
            profile,
            command,
            node.body,
            deadlineMs,
            depth + 1,
            callStack,
            context,
          );
        }
        return;
      }
      case "while": {
        let iterations = 0;
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        while (true) {
          const result = this.evaluateVoiceAttackCondition(context, node.condition);
          if (result === null) {
            throw new VoiceAttackOutcomeSignal(
              "blocked_by_policy",
              `While-loop condition evaluation failed for ${command.label}.`,
            );
          }
          if (!result) {
            return;
          }
          iterations += 1;
          if (iterations > VOICEATTACK_MAX_LOOP_ITERATIONS) {
            throw new VoiceAttackOutcomeSignal(
              "blocked_by_policy",
              `While loop exceeded the limit of ${VOICEATTACK_MAX_LOOP_ITERATIONS} iterations.`,
            );
          }
          await this.executeVoiceAttackNodes(
            execution,
            profile,
            command,
            node.body,
            deadlineMs,
            depth + 1,
            callStack,
            context,
          );
        }
      }
      case "wait_until": {
        const timeoutMs = Math.max(
          100,
          Math.min(node.timeoutMs, VOICEATTACK_MAX_WAIT_UNTIL_TIMEOUT_MS),
        );
        const pollIntervalMs = Math.max(100, node.pollIntervalMs);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        const waitDeadlineMs = Date.now() + timeoutMs;
        while (Date.now() < waitDeadlineMs) {
          const result = this.evaluateVoiceAttackCondition(context, node.condition);
          if (result === null) {
            throw new VoiceAttackOutcomeSignal(
              "blocked_by_policy",
              `Wait-until condition evaluation failed for ${command.label}.`,
            );
          }
          if (result) {
            return;
          }
          await this.sleep(
            Math.min(pollIntervalMs, Math.max(10, waitDeadlineMs - Date.now())),
            execution.controller.signal,
          );
        }
        throw new VoiceAttackOutcomeSignal(
          "timed_out",
          `Wait-until timed out for ${command.label}.`,
        );
      }
      case "execute_command": {
        if (node.unresolved || !node.targetCommandId) {
          throw new VoiceAttackOutcomeSignal(
            "unresolved_dependency",
            `Nested command reference "${node.targetReference}" could not be resolved for ${command.label}.`,
          );
        }
        if (node.cyclic || callStack.includes(node.targetCommandId)) {
          throw new VoiceAttackOutcomeSignal(
            "invalid_dependency_graph",
            `Nested command recursion was detected for ${command.label}.`,
          );
        }
        const nestedCommand = this.requireCommand(
          profile,
          node.targetCommandId,
          execution.allowDisabled,
        );
        context.nestedCommandTrace.push(nestedCommand.commandId);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          execution.dryRun ? "dry_run" : "executed",
          summary,
        );
        context.localVariableFrames.push(new Map<string, AutomationScriptValue>());
        try {
          if (nestedCommand.voiceAttack?.actionTree.length) {
            await this.executeVoiceAttackNodes(
              execution,
              profile,
              nestedCommand,
              nestedCommand.voiceAttack.actionTree,
              Math.min(deadlineMs, Date.now() + nestedCommand.maxDurationMs),
              depth + 1,
              [...callStack, nestedCommand.commandId],
              context,
            );
          } else {
            await this.executeSteps(
              execution,
              profile,
              nestedCommand,
              Math.min(deadlineMs, Date.now() + nestedCommand.maxDurationMs),
              depth + 1,
            );
          }
        } catch (error) {
          if (
            !(error instanceof VoiceAttackReturnSignal) &&
            !(error instanceof VoiceAttackStopSignal)
          ) {
            throw error;
          }
        } finally {
          context.localVariableFrames.pop();
        }
        return;
      }
      case "stop_command":
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        throw new VoiceAttackStopSignal();
      case "return":
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        throw new VoiceAttackReturnSignal();
      case "play_sound":
      case "speech_placeholder": {
        context.partialExecution = true;
        context.unsupportedActions.add(summary);
        context.skippedActions.add(summary);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "unsupported",
          `${summary} (skipped)`,
        );
        return;
      }
      case "log":
        await this.executeWriteLog({
          type: "write_log",
          message: node.message,
        });
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "executed",
          summary,
        );
        return;
      case "note":
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "skipped",
          summary,
        );
        return;
      case "unsupported": {
        if (node.unsupportedPolicy === "informational") {
          context.unsupportedActions.add(summary);
          this.recordVoiceAttackTrace(
            context,
            command.commandId,
            node,
            "unsupported",
            `${summary}: ${node.reason}`,
          );
          return;
        }
        if (node.unsupportedPolicy === "skippable") {
          context.partialExecution = true;
          context.unsupportedActions.add(summary);
          context.skippedActions.add(summary);
          this.recordVoiceAttackTrace(
            context,
            command.commandId,
            node,
            "unsupported",
            `${summary}: ${node.reason}`,
          );
          return;
        }
        context.blockingActions.add(summary);
        this.recordVoiceAttackTrace(
          context,
          command.commandId,
          node,
          "blocked",
          `${summary}: ${node.reason}`,
        );
        throw new VoiceAttackOutcomeSignal(
          node.unsupportedPolicy === "prohibited"
            ? "blocked_by_policy"
            : context.physicalInputSent
              ? "partially_executed"
              : "unsupported",
          node.reason,
        );
      }
      default:
        throw new VoiceAttackOutcomeSignal(
          "unsupported",
          `Unsupported VoiceAttack action "${(node as VoiceAttackNode).kind}".`,
        );
    }
  }

  private async executeSteps(
    execution: RunningExecution,
    profile: AutomationProfile,
    command: AutomationCommand,
    deadlineMs: number,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_MACRO_DEPTH) {
      throw new AutomationBlockedError(
        `Macro nesting depth exceeded the limit of ${MAX_MACRO_DEPTH}.`,
      );
    }

    for (const step of command.steps) {
      this.assertExecutionCanContinue(execution, deadlineMs);
      if (step.type === "run_macro") {
        const nestedCommand = this.requireCommand(
          profile,
          step.commandId,
          execution.allowDisabled,
        );
        const nestedDeadlineMs = Math.min(
          deadlineMs,
          Date.now() + nestedCommand.maxDurationMs,
        );
        await this.executeSteps(
          execution,
          profile,
          nestedCommand,
          nestedDeadlineMs,
          depth + 1,
        );
        this.assertExecutionCanContinue(execution, deadlineMs);
        continue;
      }
      await this.executeStep(execution, profile, step, deadlineMs, depth);
      this.assertExecutionCanContinue(execution, deadlineMs);
    }
  }

  private async executeStep(
    execution: RunningExecution,
    profile: AutomationProfile,
    step: AutomationAction,
    deadlineMs: number,
    depth: number,
  ): Promise<void> {
    switch (step.type) {
      case "wait":
        await this.sleep(step.milliseconds, execution.controller.signal);
        break;
      case "play_sound":
        await this.executePlaySound(execution, step);
        break;
      case "write_log":
        await this.executeWriteLog(step);
        break;
      case "speak_fixed":
        await this.executeSpeakFixed(execution, step);
        break;
      case "set_mic_state":
        await this.executeSetMicState(execution, step);
        break;
      case "set_background":
        await this.dispatchSceneAction(execution, {
          actionType: "set_background",
          backgroundId: step.backgroundId,
        });
        break;
      case "restore_background":
        await this.dispatchSceneAction(execution, {
          actionType: "restore_background",
        });
        break;
      case "show_overlay":
        await this.executeShowOverlay(execution, step);
        break;
      case "remove_overlay":
        await this.dispatchSceneAction(execution, {
          actionType: "remove_overlay",
          overlayId: step.overlayId,
        });
        break;
      case "screen_shake":
        await this.executeScreenShake(execution, step);
        break;
      case "key_press":
        await this.executeKeyPress(execution, step);
        break;
      case "key_down":
        await this.executeKeyDown(execution, step);
        break;
      case "key_up":
        await this.executeKeyUp(execution, step);
        break;
      case "key_combination":
        await this.executeKeyCombination(execution, step);
        break;
      case "script":
        await this.executeScript(execution, profile, step, deadlineMs, depth);
        break;
      case "run_macro":
        break;
      case "unsupported_import_action":
      case "response_placeholder":
        throw new AutomationBlockedError(
          "Imported placeholder actions require manual replacement before execution.",
        );
      default:
        throw new AutomationBlockedError(
          `Unsupported automation action "${(step as any).type}".`,
        );
    }
  }

  private async executePlaySound(
    execution: RunningExecution,
    step: PlaySoundAction,
  ): Promise<void> {
    const playbackUrl = await this.resolveSoundPlaybackUrl(step);
    await this.dispatchSceneAction(execution, {
      actionType: "play_sound",
      assetId: step.assetId,
      localAssetPath: step.localAssetPath,
      playbackUrl: playbackUrl ?? undefined,
      volume: step.volume,
    });
  }

  private async executeSpeakFixed(
    execution: RunningExecution,
    step: SpeakFixedAction,
  ): Promise<void> {
    await this.dispatchSceneAction(execution, {
      actionType: "speak_fixed",
      text: step.text,
      interruptPolicy: step.interruptPolicy,
    });
  }

  private async executeWriteLog(step: WriteLogAction): Promise<void> {
    const message = step.message.trim();
    this.logger.info(
      `[automation][voiceattack-log] ${message || "(empty message)"}`,
    );
  }

  private async executeSetMicState(
    execution: RunningExecution,
    step: SetMicStateAction,
  ): Promise<void> {
    await this.dispatchSceneAction(execution, {
      actionType: "set_mic_state",
      enabled: step.enabled,
    });
  }

  private async executeShowOverlay(
    execution: RunningExecution,
    step: ShowOverlayAction,
  ): Promise<void> {
    if (!APPROVED_OVERLAY_ASSETS[step.overlayId]) {
      throw new AutomationBlockedError(
        `Overlay asset "${step.overlayId}" is not approved.`,
      );
    }
    await this.dispatchSceneAction(execution, {
      actionType: "show_overlay",
      overlayId: step.overlayId,
      durationMs: step.durationMs,
      placement: step.placement,
      animationName: step.animationName,
    });
  }

  private async executeScreenShake(
    execution: RunningExecution,
    step: ScreenShakeAction,
  ): Promise<void> {
    await this.dispatchSceneAction(execution, {
      actionType: "screen_shake",
      durationMs: step.durationMs,
      intensity: step.intensity,
    });
  }

  private async executeKeyPress(
    execution: RunningExecution,
    step: KeyPressAction,
  ): Promise<void> {
    if (execution.dryRun) {
      this.logger.info(`[automation][dry-run] key_press ${step.key}`);
      if (step.durationMs) {
        await this.sleep(step.durationMs, execution.controller.signal);
      }
      return;
    }
    await this.keyboardAdapter.keyDown(step.key);
    if (step.durationMs && step.durationMs > 0) {
      await this.sleep(step.durationMs, execution.controller.signal);
    }
    await this.keyboardAdapter.keyUp(step.key);
  }

  private async executeKeyDown(
    execution: RunningExecution,
    step: KeyDownAction,
  ): Promise<void> {
    if (execution.dryRun) {
      this.logger.info(`[automation][dry-run] key_down ${step.key}`);
      return;
    }
    await this.keyboardAdapter.keyDown(step.key);
    execution.heldKeys.add(step.key);
    this.scheduleKeyRelease(execution, step.key);
  }

  private async executeKeyUp(
    execution: RunningExecution,
    step: KeyUpAction,
  ): Promise<void> {
    if (execution.dryRun) {
      this.logger.info(`[automation][dry-run] key_up ${step.key}`);
      return;
    }
    await this.releaseHeldKey(execution, step.key);
  }

  private async executeKeyCombination(
    execution: RunningExecution,
    step: KeyCombinationAction,
  ): Promise<void> {
    if (execution.dryRun) {
      this.logger.info(
        `[automation][dry-run] key_combination ${step.modifiers.join("+")}+${step.key}`,
      );
      return;
    }
    await this.keyboardAdapter.keyCombination(
      step.modifiers as ValidModifierKey[],
      step.key,
    );
  }

  private async executeScript(
    execution: RunningExecution,
    profile: AutomationProfile,
    step: ScriptAction,
    deadlineMs: number,
    depth: number,
  ): Promise<void> {
    try {
      await executeAutomationScript({
        script: step.script,
        label: `automation script (${execution.profileId}/${execution.commandId})`,
        variables: execution.scriptVariables,
        readOnlyVariableNames: execution.readOnlyScriptVariables,
        assertCanContinue: () =>
          this.assertExecutionCanContinue(execution, deadlineMs),
        log: async (message) =>
          this.executeWriteLog({ type: "write_log", message }),
        speak: async (text) =>
          this.executeSpeakFixed(execution, {
            type: "speak_fixed",
            text,
          }),
        setMicState: async (enabled) =>
          this.executeSetMicState(execution, {
            type: "set_mic_state",
            enabled,
          }),
        wait: async (milliseconds) =>
          this.sleep(milliseconds, execution.controller.signal),
        pressKey: async (key, durationMs) =>
          this.executeKeyPress(execution, {
            type: "key_press",
            key,
            durationMs,
          }),
        keyDown: async (key) =>
          this.executeKeyDown(execution, {
            type: "key_down",
            key,
          }),
        keyUp: async (key) =>
          this.executeKeyUp(execution, {
            type: "key_up",
            key,
          }),
        keyCombination: async (modifiers, key) =>
          this.executeKeyCombination(execution, {
            type: "key_combination",
            modifiers,
            key,
          }),
        callCommand: async (commandId) => {
          const nestedCommand = this.requireCommand(
            profile,
            commandId,
            execution.allowDisabled,
          );
          const nestedDeadlineMs = Math.min(
            deadlineMs,
            Date.now() + nestedCommand.maxDurationMs,
          );
          await this.executeSteps(
            execution,
            profile,
            nestedCommand,
            nestedDeadlineMs,
            depth + 1,
          );
        },
        setBackground: async (backgroundId) =>
          this.dispatchSceneAction(execution, {
            actionType: "set_background",
            backgroundId,
          }).then(() => undefined),
        restoreBackground: async () =>
          this.dispatchSceneAction(execution, {
            actionType: "restore_background",
          }).then(() => undefined),
      });
    } catch (error) {
      if (error instanceof AutomationCancellationError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Automation script failed.";
      throw new AutomationBlockedError(message);
    }
  }

  private async dispatchSceneAction(
    execution: RunningExecution,
    action: Omit<AutomationSceneActionRequest, "requestId" | "actionId">,
  ): Promise<AutomationSceneActionResult> {
    const actionId = randomUUID();
    const eventPayload: AutomationSceneActionRequest = {
      requestId: execution.requestId,
      actionId,
      ...action,
    };

    const result = await new Promise<AutomationSceneActionResult>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingSceneActions.delete(actionId);
          reject(
            new Error(`Renderer scene action timed out: ${action.actionType}.`),
          );
        }, SCENE_ACTION_TIMEOUT_MS);

        this.pendingSceneActions.set(actionId, {
          requestId: execution.requestId,
          resolve,
          reject,
          timeout,
        });
        this.emitEvent({
          type: "scene-action",
          action: eventPayload,
        });
      },
    );

    if (!result.ok && !result.skipped) {
      throw new Error(
        result.error || `Scene action "${action.actionType}" failed.`,
      );
    }
    return result;
  }

  private async resolveSoundPlaybackUrl(
    step: PlaySoundAction,
  ): Promise<string | null> {
    if (step.assetId) {
      const asset = APPROVED_SOUND_ASSETS[step.assetId];
      if (!asset) {
        throw new AutomationBlockedError(
          `Sound asset "${step.assetId}" is not approved.`,
        );
      }
      return asset.url;
    }
    if (!step.localAssetPath) {
      return null;
    }
    const assetPath = this.store.resolveAssetPath(step.localAssetPath);
    try {
      await fs.access(assetPath);
    } catch {
      this.logger.warn(`Automation sound asset was not found: ${assetPath}`);
      return null;
    }
    return `file://${assetPath.replace(/\\/g, "/")}`;
  }

  private scheduleKeyRelease(
    execution: RunningExecution,
    key: ValidKeyIdentifier,
  ): void {
    const existing = execution.keyReleaseTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      void this.releaseHeldKey(execution, key);
    }, MAX_KEY_HOLD_DURATION_MS);
    execution.keyReleaseTimers.set(key, timer);
  }

  private async releaseHeldKey(
    execution: RunningExecution,
    key: ValidKeyIdentifier,
  ): Promise<void> {
    const timer = execution.keyReleaseTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      execution.keyReleaseTimers.delete(key);
    }
    if (execution.heldKeys.has(key)) {
      execution.heldKeys.delete(key);
      await this.keyboardAdapter.keyUp(key);
    }
  }

  private async releaseAllHeldKeys(): Promise<void> {
    const allHeldKeys = new Set<ValidKeyIdentifier>();
    for (const execution of this.runningExecutions.values()) {
      execution.heldKeys.forEach((key) => allHeldKeys.add(key));
      execution.keyReleaseTimers.forEach((timer) => clearTimeout(timer));
      execution.keyReleaseTimers.clear();
      execution.heldKeys.clear();
    }
    if (allHeldKeys.size > 0) {
      await this.keyboardAdapter.releaseAll(allHeldKeys);
    }
  }

  private assertExecutionCanContinue(
    execution: RunningExecution,
    deadlineMs: number,
  ): void {
    if (execution.controller.signal.aborted) {
      throw new AutomationCancellationError();
    }
    if (Date.now() > deadlineMs) {
      throw new AutomationBlockedError(
        "Command exceeded its maximum duration.",
      );
    }
  }

  private sleep(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new AutomationCancellationError());
        return;
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, durationMs);
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        reject(new AutomationCancellationError());
      };
      signal.addEventListener("abort", onAbort);
    });
  }

  private createRecord(params: {
    requestId: string;
    profileId: string;
    commandId: string;
    source: AutomationTriggerSource;
    status: AutomationExecutionStatus;
    dryRun: boolean;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    error?: string;
    outcome?: AutomationVoiceAttackExecutionOutcome;
  }): AutomationExecutionRecord {
    return {
      requestId: params.requestId,
      profileId: params.profileId,
      commandId: params.commandId,
      source: params.source,
      status: params.status,
      dryRun: params.dryRun,
      startedAt: params.startedAt ?? new Date().toISOString(),
      finishedAt: params.finishedAt,
      durationMs: params.durationMs,
      error: params.error,
      outcome: params.outcome,
    };
  }

  private pushHistory(record: AutomationExecutionRecord): void {
    this.history.unshift(record);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.length = HISTORY_LIMIT;
    }
  }

  private async buildSnapshot(): Promise<AutomationStatusSnapshot> {
    const profiles = await this.store.listProfileSummaries();
    return {
      status: this.emergencyStopped ? "emergency_stopped" : this.status,
      emergencyStopped: this.emergencyStopped,
      activeProfileId: this.settings.activeProfileId,
      effectiveProfileId: this.settings.activeProfileId,
      manualProfileId: this.settings.manualProfileId,
      profileSelectionMode: this.settings.profileSelectionMode,
      profileSelectionSource: this.profileSelectionSource,
      detectedApplication: this.detectedApplication,
      matchedProfileId: this.matchedProfileId,
      profileMatchConfidence: this.profileMatchConfidence,
      lastProfileTransitionAt: this.lastProfileTransitionAt,
      defaultSpeechMode: this.settings.defaultSpeechMode,
      speechMode: this.settings.defaultSpeechMode,
      dryRun: this.settings.dryRun,
      emergencyStopHotkey: this.settings.emergencyStopHotkey,
      llmAutomationEnabled: this.settings.llmAutomationEnabled,
      allowAutonomousHarmlessCommands:
        this.settings.allowAutonomousHarmlessCommands,
      allowAutonomousLowRiskCommands:
        this.settings.allowAutonomousLowRiskCommands,
      confirmationTimeoutMs: this.settings.confirmationTimeoutMs,
      maxPendingConfirmations: this.settings.maxPendingConfirmations,
      announceBlockedCommandRequests:
        this.settings.announceBlockedCommandRequests,
      includeCommandSuggestionsInSpeech:
        this.settings.includeCommandSuggestionsInSpeech,
      resultAcknowledgementsEnabled:
        this.settings.resultAcknowledgementsEnabled,
      confirmationPhrases: [...this.settings.confirmationPhrases],
      cancellationPhrases: [...this.settings.cancellationPhrases],
      activeApplicationPollIntervalMs:
        this.settings.activeApplicationPollIntervalMs,
      profileSwitchDebounceMs: this.settings.profileSwitchDebounceMs,
      detectionFailureGracePeriodMs:
        this.settings.detectionFailureGracePeriodMs,
      proactiveCommentaryEnabled: this.settings.proactiveCommentaryEnabled,
      minimumCommentaryIntervalMs: this.settings.minimumCommentaryIntervalMs,
      maxQueuedConversationEvents: this.settings.maxQueuedConversationEvents,
      announceApplicationChanges: this.settings.announceApplicationChanges,
      acknowledgeRoutineAutomationSuccess:
        this.settings.acknowledgeRoutineAutomationSuccess,
      voiceCommandActivationMode: this.settings.voiceCommandActivationMode,
      voiceCommandWakePhrases: [...this.settings.voiceCommandWakePhrases],
      voiceCommandPushToCommandHotkey:
        this.settings.voiceCommandPushToCommandHotkey,
      voiceCommandAmbiguityTimeoutMs:
        this.settings.voiceCommandAmbiguityTimeoutMs,
      voiceCommandAcknowledgementMode:
        this.settings.voiceCommandAcknowledgementMode,
      voiceCommandListeningActive: this.voiceCommandListeningActive,
      voiceCommandHotkeyRegistered: this.voiceCommandHotkeyRegistered,
      voiceCommandHotkeyError: this.voiceCommandHotkeyError,
      telemetry: {
        ...this.settings.telemetry,
        hullWarningThresholds: [
          ...this.settings.telemetry.hullWarningThresholds,
        ],
        commentary: {
          ...this.settings.telemetry.commentary,
        },
      },
      runningRequestIds: Array.from(this.runningExecutions.keys()),
      profiles,
      history: [...this.history],
      lastError: this.lastError,
    };
  }

  private async emitProfilesChanged(): Promise<void> {
    const profiles = await this.store.listProfileSummaries();
    this.emitEvent({
      type: "profiles",
      profiles,
      activeProfileId: this.settings.activeProfileId,
    });
  }

  private async emitStatus(): Promise<AutomationStatusSnapshot> {
    const snapshot = await this.buildSnapshot();
    this.emitEvent({
      type: "status",
      snapshot,
    });
    return snapshot;
  }

  private requireVoiceAttackSession(importId: string): StoredVoiceAttackSession {
    const session = this.voiceAttackSessions.get(importId);
    if (!session) {
      throw new Error(
        "The VoiceAttack import session has expired or was cancelled.",
      );
    }
    return session;
  }

  private requireResolvedVoiceAttackSession(
    storedSession: StoredVoiceAttackSession,
  ): VoiceAttackImportSessionData {
    if (!storedSession.session) {
      throw new Error(
        "The VoiceAttack import session is only available through the helper process.",
      );
    }
    return storedSession.session;
  }

  private async requireStoredProfile(
    profileId: string,
  ): Promise<AutomationProfile> {
    const profile = await this.store.getProfile(profileId);
    if (!profile) {
      throw new Error(`Automation profile "${profileId}" does not exist.`);
    }
    return profile;
  }

  private async requireProfile(
    profileId: string,
    allowDisabled = false,
  ): Promise<AutomationProfile> {
    const profile = await this.requireStoredProfile(profileId);
    if (!allowDisabled && !profile.enabled) {
      throw new AutomationBlockedError(
        `Automation profile "${profile.displayName}" is disabled.`,
      );
    }
    return profile;
  }

  private requireCommand(
    profile: AutomationProfile,
    commandId: string,
    allowDisabled = false,
  ): AutomationCommand {
    const command = profile.commands.find(
      (entry) => entry.commandId === commandId,
    );
    if (!command) {
      throw new Error(`Automation command "${commandId}" does not exist.`);
    }
    if (!allowDisabled && !command.enabled) {
      throw new AutomationBlockedError(
        `Automation command "${command.label}" is disabled.`,
      );
    }
    return command;
  }

  private enforceCooldown(profileId: string, command: AutomationCommand): void {
    const key = `${profileId}:${command.commandId}`;
    const previousRunAt = this.lastRunByCommand.get(key);
    if (!previousRunAt || command.cooldownMs === 0) {
      return;
    }
    if (Date.now() - previousRunAt < command.cooldownMs) {
      throw new AutomationBlockedError(
        `Command "${command.label}" is still on cooldown.`,
      );
    }
  }

  private enforceConcurrency(
    profileId: string,
    command: AutomationCommand,
  ): void {
    const runningExecutions = Array.from(this.runningExecutions.values());
    if (command.concurrencyPolicy === "allow_parallel") {
      return;
    }
    if (command.concurrencyPolicy === "reject_duplicates") {
      const duplicate = runningExecutions.find(
        (execution) =>
          execution.profileId === profileId &&
          execution.commandId === command.commandId,
      );
      if (duplicate) {
        throw new AutomationBlockedError(
          `Command "${command.label}" is already running.`,
        );
      }
      return;
    }
    const siblingExecution = runningExecutions.find(
      (execution) => execution.profileId === profileId,
    );
    if (siblingExecution) {
      throw new AutomationBlockedError(
        `Profile "${profileId}" already has a running command.`,
      );
    }
  }
}
