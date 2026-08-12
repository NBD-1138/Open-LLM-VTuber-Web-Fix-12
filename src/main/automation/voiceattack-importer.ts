import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import {
  AUTOMATION_SCHEMA_VERSION,
  COMMAND_ID_PATTERN,
  MAX_WAIT_MS,
  PROFILE_ID_PATTERN,
} from "../../shared/automation/schema";
import type {
  AutomationAction,
  AutomationCommand,
  AutomationImportedProfileMetadata,
  AutomationProfile,
  ResponsePlaceholderAction,
  UnsupportedImportAction,
  ValidKeyIdentifier,
  ValidModifierKey,
} from "../../shared/automation/schema";
import {
  AUTOMATION_STATE_PREDICATE_OPERATORS,
  isInternalVoiceAttackCommandString,
  splitVoiceAttackCommandPhrases,
} from "../../shared/automation/voiceattack-script";
import type {
  AutomationImportedVoiceAttackCommand,
  AutomationSemanticContract,
  AutomationSemanticContractConfidence,
  AutomationStatePredicate,
  VoiceAttackConditionExpression,
  VoiceAttackDependencyGraphSummary,
  VoiceAttackExecuteCommandNode,
  VoiceAttackNode,
  VoiceAttackOperand,
  VoiceAttackPreservedField,
  VoiceAttackUnsupportedNode,
  VoiceAttackUnsupportedPolicy,
  VoiceAttackVariableScope,
} from "../../shared/automation/voiceattack-script";
import { buildImportedProfileReviewReport } from "../../shared/automation/voiceattack";
import type {
  VoiceAttackEmbeddedProfileSummary,
  VoiceAttackImportCandidateSummary,
  VoiceAttackImportProfileResult,
  VoiceAttackImportRequest,
  VoiceAttackImportSupportStatus,
  VoiceAttackInspectionResult,
  VoiceAttackPackageEntrySummary,
  VoiceAttackProfilePreview,
  VoiceAttackSourceFormat,
} from "../../shared/automation/voiceattack";
import {
  inspectBinaryVoiceAttackBuffer,
  inspectVoiceAttackBufferFormat,
  inspectVoiceAttackPackageFile,
} from "./voiceattack-binary";
import type {
  VoiceAttackBinaryInspectionResult,
  VoiceAttackNeutralAction,
  VoiceAttackNeutralCommand,
  VoiceAttackNeutralProfile,
} from "./voiceattack-binary";

const CANDIDATE_EXTENSIONS = new Set([".vap", ".vax"]);
const PREVIEW_CATEGORY = "voiceattack_import";
const MAX_IMPORT_REPEAT_COUNT = 24;

const SUPPORTED_IMPORT_CATEGORIES = new Set([
  "press_key",
  "pause",
  "execute_command",
  "key_down",
  "key_up",
  "write_log",
  "set_mic_state",
]);

const PARTIALLY_SUPPORTED_IMPORT_CATEGORIES = new Set(["sound_file", "say"]);

const WINDOWS_VK_TO_KEY = new Map<number, ValidKeyIdentifier>([
  [8, "backspace"],
  [9, "tab"],
  [13, "enter"],
  [16, "shift"],
  [17, "ctrl"],
  [18, "alt"],
  [27, "escape"],
  [32, "space"],
  [35, "end"],
  [36, "home"],
  [33, "page_up"],
  [34, "page_down"],
  [37, "arrow_left"],
  [38, "arrow_up"],
  [39, "arrow_right"],
  [40, "arrow_down"],
  [45, "insert"],
  [46, "delete"],
  [91, "meta"],
  [92, "meta"],
  [112, "f1"],
  [113, "f2"],
  [114, "f3"],
  [115, "f4"],
  [116, "f5"],
  [117, "f6"],
  [118, "f7"],
  [119, "f8"],
  [120, "f9"],
  [121, "f10"],
  [122, "f11"],
  [123, "f12"],
]);

for (let code = 48; code <= 57; code += 1) {
  WINDOWS_VK_TO_KEY.set(code, String.fromCharCode(code) as ValidKeyIdentifier);
}

for (let code = 65; code <= 90; code += 1) {
  WINDOWS_VK_TO_KEY.set(
    code,
    String.fromCharCode(code + 32) as ValidKeyIdentifier,
  );
}

const KEY_TO_MODIFIER = new Map<ValidKeyIdentifier, ValidModifierKey>([
  ["ctrl", "ctrl"],
  ["alt", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
]);

type ImportCandidateRecord = {
  sourcePath: string;
  sourceBasename: string;
  extension: string;
  sourceHash: string;
  sourceFormat: VoiceAttackSourceFormat;
  encrypted: boolean;
  containerBasename: string | null;
  embeddedEntryName: string | null;
  packageEntries: VoiceAttackPackageEntrySummary[];
  embeddedProfiles: VoiceAttackEmbeddedProfileSummary[];
  decoderStatus: string;
  envelopeFormat: string | null;
  profileName: string | null;
  originalProfileVersion: string | null;
  preview: VoiceAttackProfilePreview | null;
  summary: VoiceAttackImportCandidateSummary;
};

export interface VoiceAttackImportSessionData {
  importId: string;
  sourceBasename: string;
  sourceKind: "file" | "directory";
  inspection: VoiceAttackInspectionResult;
  candidates: Map<string, ImportCandidateRecord>;
}

type ParsedDraftCommand = {
  sourceCommandId: string | null;
  sourceCommandString: string;
  triggerMode: VoiceAttackProfilePreview["commands"][number]["triggerMode"];
  command: AutomationCommand;
  warnings: string[];
  actionTypeCategories: string[];
  actionTypeCounts: Map<string, number>;
  actionDetails: VoiceAttackActionPreviewRecord[];
  supportStatus: VoiceAttackImportSupportStatus;
  actionSummaries: string[];
  responsePlaceholderCount: number;
  unsupportedActionCount: number;
  unresolvedNestedReferences: string[];
  recursiveReference: boolean;
  executableActionCount: number;
  keyInputCount: number;
  variableOrPluginWarning: boolean;
  unresolvedPluginCount: number;
  unresolvedVariableCount: number;
  selectedByDefault: boolean;
  internalCommand: boolean;
};

type PendingRunMacroRecord = {
  insertIndex: number;
  targetPhrase: string;
  targetSourceCommandId: string | null;
  summary: string;
  nodeId: string | null;
};

type VoiceAttackActionPreviewRecord = {
  actionType: string;
  summary: string;
  supportStatus: VoiceAttackImportSupportStatus;
};

type RawCommandRecord = {
  sourceCommandId: string | null;
  sourceCommandString: string;
  sourceLabel: string | null;
  originalLabel: string;
  description: string;
  category: string;
  phrases: string[];
  triggerMode: "spoken" | "internal" | "hotkey" | "mixed" | "unknown";
  warnings: Set<string>;
  actionTypeCategories: Set<string>;
  actionTypeCounts: Map<string, number>;
  actionDetails: VoiceAttackActionPreviewRecord[];
  actionSummaries: string[];
  responsePlaceholderCount: number;
  unsupportedActionCount: number;
  unresolvedNestedReferences: string[];
  recursiveReference: boolean;
  executableActionCount: number;
  keyInputCount: number;
  variableOrPluginWarning: boolean;
  unresolvedPluginCount: number;
  unresolvedVariableCount: number;
  repeatNumber: number;
  repeatType: string | null;
  internalCommand: boolean;
  command: AutomationCommand;
  pendingRunMacros: PendingRunMacroRecord[];
  actionTree: VoiceAttackNode[];
  directDependencyReferences: string[];
  directPluginDependencies: string[];
};

type ParsedActionRecord = {
  actionTypeLabel: string;
  category: string;
  supportStatus: VoiceAttackImportSupportStatus;
  steps: AutomationAction[];
  summary: string;
  pendingRunMacroTarget?: string;
  variableOrPluginWarning?: boolean;
  unresolvedPluginCount?: number;
  unresolvedVariableCount?: number;
  unresolvedNestedReference?: string;
  responsePlaceholderCount?: number;
  unsupportedActionCount?: number;
  executableActionCount?: number;
  keyInputCount?: number;
  nodes?: VoiceAttackNode[];
  directDependencyReferences?: string[];
  directPluginDependencies?: string[];
};

const hashBuffer = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const normalizeActionCategory = (actionType: string): string =>
  actionType
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "unknown";

const redactSourceLabel = (inputPath: string): string =>
  path.basename(inputPath);

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new Error("VoiceAttack import cancelled.");
  }
};

const decodeXmlBuffer = (buffer: Buffer): string | null => {
  const attempts: string[] = [];
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    attempts.push(new TextDecoder("utf-8").decode(buffer.subarray(3)));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    attempts.push(new TextDecoder("utf-16le").decode(buffer.subarray(2)));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    attempts.push(new TextDecoder("utf-16be").decode(buffer.subarray(2)));
  }
  attempts.push(
    new TextDecoder("utf-8", { fatal: false }).decode(buffer),
    new TextDecoder("utf-16le", { fatal: false }).decode(buffer),
    new TextDecoder("utf-16be", { fatal: false }).decode(buffer),
  );

  for (const text of attempts) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<?xml") || trimmed.startsWith("<Profile")) {
      return text;
    }
  }
  return null;
};

const inflateRawVoiceAttackBuffer = (buffer: Buffer): Buffer | null => {
  try {
    return inflateRawSync(buffer);
  } catch {
    return null;
  }
};

const resolveVoiceAttackPayload = (
  buffer: Buffer,
  plainXmlFormat: VoiceAttackSourceFormat,
  wrappedBinaryFormat: VoiceAttackSourceFormat,
): {
  sourceFormat: VoiceAttackSourceFormat;
  decodedXml: string | null;
} => {
  const decodedXml = decodeXmlBuffer(buffer);
  if (decodedXml) {
    return { sourceFormat: plainXmlFormat, decodedXml };
  }

  const inflated = inflateRawVoiceAttackBuffer(buffer);
  if (!inflated) {
    return { sourceFormat: plainXmlFormat, decodedXml: null };
  }

  const inflatedDecodedXml = decodeXmlBuffer(inflated);
  if (inflatedDecodedXml) {
    return {
      sourceFormat: wrappedBinaryFormat,
      decodedXml: inflatedDecodedXml,
    };
  }

  return { sourceFormat: wrappedBinaryFormat, decodedXml: null };
};

const buildWrappedBinaryUnsupportedMessage = (
  sourceBasename: string,
  wrappedBinaryFormat: VoiceAttackSourceFormat,
): string => {
  const formatLabel =
    wrappedBinaryFormat === "vap_wrapped_binary"
      ? "wrapped-binary VAP"
      : "wrapped-binary VAX";
  return `The VoiceAttack profile "${sourceBasename}" uses the newer ${formatLabel} format rather than the older XML export format. The current importer cannot inspect this format yet.`;
};

const parseXmlDocument = (text: string, sourceBasename: string): Document => {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === "warning") {
        return;
      }
      errors.push(String(message));
    },
  } as ConstructorParameters<typeof DOMParser>[0]);
  const document = parser.parseFromString(text, "application/xml");
  const rootTag = document.documentElement?.tagName;
  if (errors.length > 0 || rootTag !== "Profile") {
    throw new Error(
      `The VoiceAttack XML in "${sourceBasename}" could not be parsed safely.`,
    );
  }
  return document;
};

const childElements = (element: Element, tagName?: string): Element[] => {
  const elements: Element[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType !== 1) {
      continue;
    }
    const typedChild = child as Element;
    if (!tagName || typedChild.tagName === tagName) {
      elements.push(typedChild);
    }
  }
  return elements;
};

const firstChildElement = (element: Element, tagName: string): Element | null =>
  childElements(element, tagName)[0] ?? null;

const childText = (element: Element, tagName: string): string | null => {
  const child = firstChildElement(element, tagName);
  const text = child?.textContent?.trim();
  return text && text.length > 0 ? text : null;
};

const childNumber = (element: Element, tagName: string): number | null => {
  const value = childText(element, tagName);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const childBoolean = (element: Element, tagName: string): boolean | null => {
  const value = childText(element, tagName);
  if (!value) {
    return null;
  }
  if (value === "true" || value === "True" || value === "1") {
    return true;
  }
  if (value === "false" || value === "False" || value === "0") {
    return false;
  }
  return null;
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const normalized = item.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(item.trim());
  });
  return result;
};

const determineTriggerMode = (options: {
  useSpokenPhrase: boolean | null;
  useShortcut: boolean;
  phrases: string[];
}): VoiceAttackProfilePreview["commands"][number]["triggerMode"] => {
  const spokenEnabled =
    options.useSpokenPhrase !== false && options.phrases.length > 0;
  if (spokenEnabled && options.useShortcut) {
    return "mixed";
  }
  if (spokenEnabled) {
    return "spoken";
  }
  if (options.useShortcut) {
    return "hotkey";
  }
  return options.phrases.length > 0 ? "unknown" : "internal";
};

const buildEnvelopeFormatLabel = (
  sourceFormat: VoiceAttackSourceFormat,
  diagnostics: VoiceAttackImportCandidateSummary["diagnostics"],
): string | null => {
  if (!diagnostics) {
    return sourceFormat === "vap_xml" || sourceFormat === "vax_container"
      ? "Plain XML"
      : null;
  }
  if (diagnostics.sourceFormat === "xml") {
    return "Plain XML";
  }
  if (diagnostics.sourceFormat === "binary_deflate_profile2") {
    return `Raw DEFLATE + indexed Profile2 envelope (${diagnostics.lastPropertyIndex ?? "unknown"} max index)`;
  }
  return diagnostics.sourceFormat;
};

const getCandidateImportSourceLabel = (
  candidate: ImportCandidateRecord,
): string =>
  candidate.containerBasename && candidate.embeddedEntryName
    ? `${candidate.containerBasename} :: ${candidate.embeddedEntryName}`
    : candidate.sourceBasename;

const normalizeCommandPhraseList = (commandString: string | null): string[] => {
  if (!commandString) {
    return [];
  }
  return uniqueStrings(
    commandString
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
};

const sanitizeAliasPhrase = (value: string): string | null => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-_ ]+|[-_ ]+$/g, "")
    .trim()
    .slice(0, 63)
    .replace(/^[-_ ]+|[-_ ]+$/g, "")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeSlug = (value: string, separator: "-" | "_"): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${separator}+`, "g"), separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "");
  return normalized || "voiceattack";
};

const buildUniqueCommandId = (label: string, existing: Set<string>): string => {
  const base = normalizeSlug(label, "_").slice(0, 48) || "voiceattack_command";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate) || !COMMAND_ID_PATTERN.test(candidate)) {
    candidate = `${base.slice(0, 44)}_${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
};

const buildUniqueProfileId = (
  requested: string | undefined,
  displayName: string,
  existing: Set<string>,
): string => {
  const preferred = requested?.trim()
    ? normalizeSlug(requested.trim(), "-")
    : `voiceattack-${normalizeSlug(displayName, "-")}`;
  let candidate = preferred.slice(0, 60) || "voiceattack-import";
  let suffix = 2;
  while (existing.has(candidate) || !PROFILE_ID_PATTERN.test(candidate)) {
    candidate = `${preferred.slice(0, 56)}-${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
};

const buildWaitStep = (durationMs: number): AutomationAction[] => {
  if (durationMs <= 0) {
    return [];
  }

  const steps: AutomationAction[] = [];
  let remainingMs = durationMs;
  while (remainingMs > 0) {
    const chunkMs = Math.min(remainingMs, MAX_WAIT_MS);
    steps.push({ type: "wait", milliseconds: chunkMs });
    remainingMs -= chunkMs;
  }
  return steps;
};

const buildUnsupportedAction = (
  sourceType: string,
  summary: string,
): UnsupportedImportAction => ({
  type: "unsupported_import_action",
  sourceType,
  summary,
});

const buildResponsePlaceholder = (): ResponsePlaceholderAction => ({
  type: "response_placeholder",
  originalResponsePresent: true,
  replacementRequired: true,
  replacementMode: "none",
});

const isModifier = (key: ValidKeyIdentifier): key is ValidModifierKey =>
  KEY_TO_MODIFIER.has(key);

const parseKeyCodes = (actionElement: Element): number[] => {
  const keyCodesElement = firstChildElement(actionElement, "KeyCodes");
  if (!keyCodesElement) {
    return [];
  }
  return childElements(keyCodesElement)
    .map((node) => Number(node.textContent?.trim()))
    .filter((code) => Number.isFinite(code));
};

const secondsToMilliseconds = (value: number | null): number => {
  if (value === null || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(value * 1000));
};

const summarizeKeyPress = (keyCodes: number[]): string => {
  if (keyCodes.length === 0) {
    return "unsupported key action";
  }
  const mapped = keyCodes
    .map((code) => WINDOWS_VK_TO_KEY.get(code))
    .filter((code): code is ValidKeyIdentifier => Boolean(code));
  if (mapped.length !== keyCodes.length) {
    return "unsupported key action";
  }
  return mapped.length === 1
    ? `key press ${mapped[0]}`
    : `key combination ${mapped.join("+")}`;
};

const hasVariableReference = (
  ...values: Array<string | null | undefined>
): boolean =>
  values.some((value) => typeof value === "string" && /\{[^}]+\}/.test(value));

const parsePressKeyActionData = (
  actionTypeLabel: string,
  keyCodes: number[],
  delayMs: number,
  durationMs: number,
): ParsedActionRecord => {
  const prefix = buildWaitStep(delayMs);
  const mappedKeys = keyCodes
    .map((code) => WINDOWS_VK_TO_KEY.get(code))
    .filter((key): key is ValidKeyIdentifier => Boolean(key));

  if (keyCodes.length === 0 || mappedKeys.length !== keyCodes.length) {
    return {
      actionTypeLabel,
      category: "press_key",
      supportStatus: "unsupported",
      steps: [
        ...prefix,
        buildUnsupportedAction(
          "press_key",
          "Unsupported keycode sequence requires manual replacement.",
        ),
      ],
      summary: "unsupported key action",
      unsupportedActionCount: 1,
    };
  }

  const modifiers = mappedKeys
    .filter((key) => isModifier(key))
    .map((key) => KEY_TO_MODIFIER.get(key) as ValidModifierKey);
  const nonModifiers = mappedKeys.filter((key) => !isModifier(key));
  if (
    nonModifiers.length === 1 &&
    modifiers.length === mappedKeys.length - 1 &&
    modifiers.length > 0
  ) {
    return {
      actionTypeLabel,
      category: "press_key",
      supportStatus: "supported",
      steps: [
        ...prefix,
        { type: "key_combination", modifiers, key: nonModifiers[0] },
      ],
      summary: summarizeKeyPress(keyCodes),
      executableActionCount: 1,
      keyInputCount: 1,
    };
  }

  if (mappedKeys.length === 1) {
    const step: AutomationAction = {
      type: "key_press",
      key: mappedKeys[0],
      ...(durationMs > 0 ? { durationMs: Math.min(durationMs, 1000) } : {}),
    };
    return {
      actionTypeLabel,
      category: "press_key",
      supportStatus: "supported",
      steps: [...prefix, step],
      summary: summarizeKeyPress(keyCodes),
      executableActionCount: 1,
      keyInputCount: 1,
    };
  }

  return {
    actionTypeLabel,
    category: "press_key",
    supportStatus: "unsupported",
    steps: [
      ...prefix,
      buildUnsupportedAction(
        "press_key",
        "Complex multi-key VoiceAttack actions require manual replacement.",
      ),
    ],
    summary: "unsupported key action",
    unsupportedActionCount: 1,
  };
};

const parseKeyTransitionActionData = (
  actionTypeLabel: string,
  keyCodes: number[],
  delayMs: number,
  transitionType: "key_down" | "key_up",
): ParsedActionRecord => {
  const prefix = buildWaitStep(delayMs);
  if (keyCodes.length !== 1) {
    return {
      actionTypeLabel,
      category: transitionType,
      supportStatus: "unsupported",
      steps: [
        ...prefix,
        buildUnsupportedAction(
          transitionType,
          "Unsupported VoiceAttack key transition requires manual replacement.",
        ),
      ],
      summary: `unsupported ${transitionType}`,
      unsupportedActionCount: 1,
    };
  }
  const key = WINDOWS_VK_TO_KEY.get(keyCodes[0]);
  if (!key) {
    return {
      actionTypeLabel,
      category: transitionType,
      supportStatus: "unsupported",
      steps: [
        ...prefix,
        buildUnsupportedAction(
          transitionType,
          "Unsupported VoiceAttack key transition requires manual replacement.",
        ),
      ],
      summary: `unsupported ${transitionType}`,
      unsupportedActionCount: 1,
    };
  }
  return {
    actionTypeLabel,
    category: transitionType,
    supportStatus: "supported",
    steps: [...prefix, { type: transitionType, key }],
    summary: `${transitionType.replace("_", " ")} ${key}`,
    executableActionCount: 1,
    keyInputCount: 1,
  };
};

const parsePauseActionData = (
  actionTypeLabel: string,
  delayMs: number,
  durationMs: number,
): ParsedActionRecord => {
  const waitMs = delayMs + durationMs;
  return {
    actionTypeLabel,
    category: "pause",
    supportStatus: "supported",
    steps: buildWaitStep(waitMs),
    summary: `wait ${waitMs} ms`,
  };
};

const summarizeLogMessage = (message: string | null): string => {
  const trimmed = message?.trim() ?? "";
  if (!trimmed) {
    return "write log";
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.length > 72
    ? `write log: ${normalized.slice(0, 69)}...`
    : `write log: ${normalized}`;
};

const parseWriteLogActionData = (
  actionTypeLabel: string,
  delayMs: number,
  message: string | null,
  hasVariables: boolean,
): ParsedActionRecord => ({
  actionTypeLabel,
  category: "write_log",
  supportStatus: hasVariables ? "partially_supported" : "supported",
  steps: [
    ...buildWaitStep(delayMs),
    { type: "write_log", message: message ?? "" },
  ],
  summary: summarizeLogMessage(message),
  executableActionCount: 1,
  variableOrPluginWarning: hasVariables,
  unresolvedVariableCount: hasVariables ? 1 : 0,
});

const parseSetMicStateActionData = (
  actionTypeLabel: string,
  delayMs: number,
  enabled: boolean,
): ParsedActionRecord => ({
  actionTypeLabel,
  category: "set_mic_state",
  supportStatus: "supported",
  steps: [...buildWaitStep(delayMs), { type: "set_mic_state", enabled }],
  summary: enabled ? "unmute mic" : "mute mic",
  executableActionCount: 1,
});

const parseSoundPlaceholderActionData = (
  actionTypeLabel: string,
  delayMs: number,
  hasVariables: boolean,
  category: "sound_file" | "say",
): ParsedActionRecord => {
  return {
    actionTypeLabel,
    category,
    supportStatus: "partially_supported",
    steps: [...buildWaitStep(delayMs), buildResponsePlaceholder()],
    summary: "response placeholder",
    responsePlaceholderCount: 1,
    variableOrPluginWarning: hasVariables,
    unresolvedVariableCount: hasVariables ? 1 : 0,
  };
};

const parseExecuteCommandActionData = (
  actionTypeLabel: string,
  delayMs: number,
  targetPhrase: string | null,
): ParsedActionRecord => {
  if (!targetPhrase) {
    return {
      actionTypeLabel,
      category: "execute_command",
      supportStatus: "unsupported",
      steps: [
        ...buildWaitStep(delayMs),
        buildUnsupportedAction(
          "execute_command",
          "Nested VoiceAttack command could not be resolved and requires manual replacement.",
        ),
      ],
      summary: "nested command placeholder",
      unsupportedActionCount: 1,
      unresolvedNestedReference: "missing nested command target",
    };
  }
  return {
    actionTypeLabel,
    category: "execute_command",
    supportStatus: "supported",
    steps: buildWaitStep(delayMs),
    summary: "run nested command",
    pendingRunMacroTarget: targetPhrase,
  };
};

const parseUnsupportedActionData = (
  actionTypeLabel: string,
  delayMs: number,
  sourceType: string,
  summary: string,
  supportStatus: VoiceAttackImportSupportStatus = "unsupported",
  options?: {
    variableOrPluginWarning?: boolean;
    unresolvedPluginCount?: number;
    unresolvedVariableCount?: number;
  },
): ParsedActionRecord => {
  return {
    actionTypeLabel,
    category: normalizeActionCategory(sourceType),
    supportStatus,
    steps: [
      ...buildWaitStep(delayMs),
      buildUnsupportedAction(sourceType, summary),
    ],
    summary,
    unsupportedActionCount: 1,
    variableOrPluginWarning: options?.variableOrPluginWarning,
    unresolvedPluginCount: options?.unresolvedPluginCount,
    unresolvedVariableCount: options?.unresolvedVariableCount,
  };
};

const IMPORT_DECODER_VERSION = "voiceattack-phase5d-v1";
const DEFAULT_WAIT_UNTIL_TIMEOUT_MS = 12_000;
const DEFAULT_WAIT_UNTIL_POLL_INTERVAL_MS = 250;

type VoiceAttackFlowToken =
  | {
      kind: "if_start";
      nodeId: string;
      actionTypeName: string;
      sourceActionId: string;
      sourceActionIndex: number;
      delayMs: number;
      disabled: boolean;
      condition: VoiceAttackConditionExpression | null;
      rawFields: VoiceAttackPreservedField[];
    }
  | {
      kind: "else";
      sourceActionIndex: number;
    }
  | {
      kind: "else_if";
      nodeId: string;
      actionTypeName: string;
      sourceActionId: string;
      sourceActionIndex: number;
      delayMs: number;
      disabled: boolean;
      condition: VoiceAttackConditionExpression | null;
      rawFields: VoiceAttackPreservedField[];
    }
  | {
      kind: "if_end";
      sourceActionIndex: number;
    }
  | {
      kind: "while_start";
      nodeId: string;
      actionTypeName: string;
      sourceActionId: string;
      sourceActionIndex: number;
      delayMs: number;
      disabled: boolean;
      condition: VoiceAttackConditionExpression | null;
      rawFields: VoiceAttackPreservedField[];
    }
  | {
      kind: "while_end";
      sourceActionIndex: number;
    };

const buildVoiceAttackNodeId = (
  actionTypeName: string,
  sourceActionId: string | null,
  sourceActionIndex: number,
  suffix = "0",
): string =>
  `${normalizeSlug(actionTypeName, "-") || "node"}-${sourceActionIndex}-${sourceActionId ?? "unknown"}-${suffix}`;

const buildPreservedFields = (
  fields: VoiceAttackNeutralAction["unknownFields"] | undefined,
): VoiceAttackPreservedField[] =>
  (fields ?? []).map((field) => ({
    index: field.index,
    name: field.name,
    valueType: field.valueType,
    valueText: field.valueText,
  }));

const normalizeVoiceAttackVariableName = (value: string): string =>
  value.trim();

const getVoiceAttackVariableScope = (
  variableName: string,
): VoiceAttackVariableScope => {
  if (variableName.startsWith("~~")) {
    return "profile";
  }
  if (variableName.startsWith("~")) {
    return "local";
  }
  return "global";
};

const buildLiteralOperand = (
  value: string | number | boolean | null,
): VoiceAttackOperand => ({
  kind: "literal",
  value,
});

const buildVariableOperand = (variableName: string): VoiceAttackOperand => ({
  kind: "variable",
  variableName: normalizeVoiceAttackVariableName(variableName),
  scope: getVoiceAttackVariableScope(variableName),
});

const normalizeVoiceAttackStateVariableKey = (value: string): string =>
  value
    .replace(/[{}[\]()%~:_./\\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const mapVoiceAttackVariableToTelemetryPath = (
  variableName: string,
): string | null => {
  const key = normalizeVoiceAttackStateVariableKey(variableName);
  if (!key) {
    return null;
  }

  if (/\bhard ?points?\b/.test(key)) {
    return "ship.hardpointsDeployed";
  }
  if (/\b(?:landing )?gear\b/.test(key)) {
    return "ship.landingGearDeployed";
  }
  if (/\bcargo ?scoop\b/.test(key)) {
    return "ship.cargoScoopDeployed";
  }
  if (/\b(?:ship )?lights?\b/.test(key)) {
    return "ship.lightsOn";
  }
  if (/\bsilent ?running\b/.test(key)) {
    return "ship.silentRunning";
  }
  if (/\bflight ?assist\b/.test(key)) {
    return "ship.flightAssistOff";
  }
  if (/\bsuper ?cruise\b/.test(key)) {
    return "ship.supercruise";
  }
  if (/\bfsd\b|\bframe ?shift\b/.test(key)) {
    return "ship.fsdStatus";
  }
  if (/\bdocking ?granted\b|\bdocking ?approved\b/.test(key)) {
    return "navigation.dockingGranted";
  }
  if (/\bdocking ?denied\b|\bdocking ?refused\b/.test(key)) {
    return "navigation.dockingDenied";
  }
  if (/\bdocking ?requested\b|\bdocking ?request\b/.test(key)) {
    return "navigation.dockingRequested";
  }
  if (/\bdocked\b/.test(key)) {
    return "session.docked";
  }
  if (/\blanded\b/.test(key)) {
    return "session.landed";
  }
  if (/\bshields?\b/.test(key)) {
    return "ship.shieldsUp";
  }
  if (/\bheat ?warning\b|\boverheating\b/.test(key)) {
    return "ship.heatWarning";
  }
  if (/\blow ?fuel\b/.test(key)) {
    return "ship.lowFuelWarning";
  }

  return null;
};

const buildConditionLeftOperand = (variableName: string): VoiceAttackOperand => {
  const statePath = mapVoiceAttackVariableToTelemetryPath(variableName);
  return statePath
    ? { kind: "state_path", path: statePath }
    : buildVariableOperand(variableName);
};

const parseBooleanLiteral = (
  action: Pick<
    VoiceAttackNeutralAction,
    | "context2"
    | "context3"
    | "x"
    | "y"
    | "z"
    | "inputMode"
    | "integerContext1"
    | "integerContext2"
  >,
): boolean => {
  const textCandidates = [action.context2, action.context3]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (textCandidates.includes("true")) {
    return true;
  }
  if (textCandidates.includes("false")) {
    return false;
  }
  return [
    action.inputMode,
    action.x,
    action.y,
    action.z,
    action.integerContext1,
    action.integerContext2,
  ].some((value) => Number(value) === 1);
};

const parseNumericLiteral = (
  action: Pick<
    VoiceAttackNeutralAction,
    | "context2"
    | "decimalContext1"
    | "x"
    | "y"
    | "integerContext1"
    | "integerContext2"
  >,
): number => {
  const textCandidates = [
    action.context2,
    action.decimalContext1?.split(",")[0] ?? null,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (textCandidates[0] !== undefined) {
    return textCandidates[0];
  }
  const numericCandidates = [
    action.x,
    action.y,
    action.integerContext1,
    action.integerContext2,
  ].filter((value) => Number.isFinite(value));
  return numericCandidates[0] ?? 0;
};

const mapRawConditionOperator = (
  rawOperator: number,
  kind: "string" | "number" | "boolean",
): VoiceAttackConditionExpression["operator"] => {
  switch (rawOperator) {
    case 2:
      return "not_equals";
    case 3:
      return "greater_than";
    case 4:
      return "less_than";
    case 5:
      return "greater_than_or_equal";
    case 6:
      return kind === "string" ? "contains" : "less_than_or_equal";
    case 0:
    case 1:
    default:
      return "equals";
  }
};

const buildConditionExpressionFromAction = (
  action: VoiceAttackNeutralAction,
): VoiceAttackConditionExpression | null => {
  const variableName = action.conditionStartNameFrom?.trim();
  if (!variableName) {
    return null;
  }
  if (action.conditionStartType === 1) {
    const compareText = (action.context2 ?? "").trim();
    return {
      left: buildConditionLeftOperand(variableName),
      operator: mapRawConditionOperator(action.conditionStartOperator, "string"),
      right: buildLiteralOperand(compareText),
      sourceConditionType: action.conditionStartType,
      sourceOperator: action.conditionStartOperator,
      sourceValueType: action.conditionStartValueType,
      sourceCompareText: compareText,
    };
  }
  if (action.conditionStartType === 2) {
    return {
      left: buildConditionLeftOperand(variableName),
      operator: mapRawConditionOperator(
        action.conditionStartOperator,
        "boolean",
      ),
      right: buildLiteralOperand(action.conditionStartValue !== 0),
      sourceConditionType: action.conditionStartType,
      sourceOperator: action.conditionStartOperator,
      sourceValueType: action.conditionStartValueType,
      sourceCompareText: action.conditionStartCompareToCondition,
    };
  }
  return {
    left: buildConditionLeftOperand(variableName),
    operator: mapRawConditionOperator(action.conditionStartOperator, "number"),
    right: buildLiteralOperand(action.conditionStartValue),
    sourceConditionType: action.conditionStartType,
    sourceOperator: action.conditionStartOperator,
    sourceValueType: action.conditionStartValueType,
    sourceCompareText: action.conditionStartCompareToCondition,
  };
};

const inferUnsupportedPolicy = (
  actionTypeName: string,
  reason: string,
): VoiceAttackUnsupportedPolicy => {
  if (
    [
      "ExternalInvoke",
      "InlineFunctionCS",
      "InlineFunctionVB",
      "InlineFunctionPrecompiled",
      "Launch",
      "Kill",
      "SetClipboard",
    ].includes(actionTypeName)
  ) {
    return "prohibited";
  }
  if (
    [
      "ConditionElse",
      "ConditionElseIf",
      "ConditionEnd",
      "WhileEnd",
      "LoopBreak",
      "LoopContinue",
      "Jump",
      "Marker",
    ].includes(actionTypeName)
  ) {
    return "blocking";
  }
  if (
    ["SoundFile", "RandomSound", "Say", "Comment", "InternalProcess_Ignore"].includes(
      actionTypeName,
    )
  ) {
    return "skippable";
  }
  if (reason.toLowerCase().includes("manual review")) {
    return "informational";
  }
  return "blocking";
};

const stepToVoiceAttackNodes = (
  steps: AutomationAction[],
  actionTypeName: string,
  sourceActionId: string | null,
  sourceActionIndex: number,
): VoiceAttackNode[] =>
  steps.map((step, stepIndex) => {
    const nodeId = buildVoiceAttackNodeId(
      actionTypeName,
      sourceActionId,
      sourceActionIndex,
      String(stepIndex),
    );
    switch (step.type) {
      case "wait":
        return {
          nodeId,
          kind: "wait",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          milliseconds: step.milliseconds,
        };
      case "key_press":
        return {
          nodeId,
          kind: "key_press",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          key: step.key,
          durationMs: step.durationMs,
        };
      case "key_down":
        return {
          nodeId,
          kind: "key_down",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          key: step.key,
        };
      case "key_up":
        return {
          nodeId,
          kind: "key_up",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          key: step.key,
        };
      case "key_combination":
        return {
          nodeId,
          kind: "key_combination",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          modifiers: [...step.modifiers],
          key: step.key,
        };
      case "write_log":
        return {
          nodeId,
          kind: "log",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          message: step.message,
        };
      case "response_placeholder":
        return {
          nodeId,
          kind: "speech_placeholder",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          placeholderType: actionTypeName === "Say" ? "say" : "sound_file",
          originalResponsePresent: step.originalResponsePresent,
          replacementRequired: step.replacementRequired,
        };
      case "unsupported_import_action":
      default:
        return {
          nodeId,
          kind: "unsupported",
          actionTypeName,
          sourceActionId,
          sourceActionIndex,
          delayMs: 0,
          disabled: false,
          unsupportedPolicy: inferUnsupportedPolicy(
            actionTypeName,
            step.type === "unsupported_import_action"
              ? step.summary
              : `Unsupported step ${step.type}`,
          ),
          reason:
            step.type === "unsupported_import_action"
              ? step.summary
              : `Unsupported step ${step.type}`,
          rawFields: [],
        } satisfies VoiceAttackUnsupportedNode;
    }
  });

const createXmlActionTreeRecord = (
  actionTypeName: string,
  actionIndex: number,
  parsedAction: ParsedActionRecord,
): VoiceAttackNode[] => {
  if (parsedAction.pendingRunMacroTarget) {
    return [
      ...stepToVoiceAttackNodes(
        parsedAction.steps,
        actionTypeName,
        null,
        actionIndex,
      ),
      {
        nodeId: buildVoiceAttackNodeId(actionTypeName, null, actionIndex, "run"),
        kind: "execute_command",
        actionTypeName,
        sourceActionId: null,
        sourceActionIndex: actionIndex,
        delayMs: 0,
        disabled: false,
        targetReference: parsedAction.pendingRunMacroTarget,
        targetCommandId: null,
        targetSourceCommandId: null,
        unresolved: false,
        cyclic: false,
      },
    ];
  }
  return stepToVoiceAttackNodes(parsedAction.steps, actionTypeName, null, actionIndex);
};

const parseXmlVoiceAttackAction = (
  actionElement: Element,
): ParsedActionRecord => {
  const actionType = childText(actionElement, "ActionType") ?? "Unknown";
  const delayMs = secondsToMilliseconds(childNumber(actionElement, "Delay"));
  const durationMs = secondsToMilliseconds(
    childNumber(actionElement, "Duration"),
  );
  const keyCodes = parseKeyCodes(actionElement);
  const context = childText(actionElement, "Context");
  const context2 = childText(actionElement, "Context2");
  const hasVariables = hasVariableReference(context, context2);

  switch (actionType) {
    case "PressKey":
      return parsePressKeyActionData(actionType, keyCodes, delayMs, durationMs);
    case "Pause":
      return parsePauseActionData(actionType, delayMs, durationMs);
    case "ExecuteCommand":
      return parseExecuteCommandActionData(actionType, delayMs, context2);
    case "SoundFile":
      return parseSoundPlaceholderActionData(
        actionType,
        delayMs,
        hasVariables,
        "sound_file",
      );
    case "Say":
      return parseSoundPlaceholderActionData(
        actionType,
        delayMs,
        hasVariables,
        "say",
      );
    case "KeyDown":
    case "HoldKey":
      return parseKeyTransitionActionData(
        actionType,
        keyCodes,
        delayMs,
        "key_down",
      );
    case "KeyUp":
    case "ReleaseKey":
      return parseKeyTransitionActionData(
        actionType,
        keyCodes,
        delayMs,
        "key_up",
      );
    case "ExternalInvoke":
      return parseUnsupportedActionData(
        actionType,
        delayMs,
        "ExternalInvoke",
        "VoiceAttack plugin actions are not imported automatically.",
        "unsupported",
        {
          variableOrPluginWarning: true,
          unresolvedPluginCount: 1,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
    case "ConditionSet":
      return parseUnsupportedActionData(
        actionType,
        delayMs,
        "ConditionSet",
        "VoiceAttack conditional actions require manual replacement.",
        "unsupported",
        {
          variableOrPluginWarning: hasVariables,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
    case "InternalProcess_Ignore":
      return parseUnsupportedActionData(
        actionType,
        delayMs,
        "InternalProcess_Ignore",
        "VoiceAttack internal process actions require manual review.",
      );
    case "InternalProcess_StartListening":
      return parseSetMicStateActionData(actionType, delayMs, true);
    case "InternalProcess_StopListening":
      return parseSetMicStateActionData(actionType, delayMs, false);
    case "WriteToLog":
      return parseWriteLogActionData(
        actionType,
        delayMs,
        context,
        hasVariables,
      );
    default:
      return parseUnsupportedActionData(
        actionType,
        delayMs,
        actionType,
        `VoiceAttack action "${actionType}" is not imported automatically.`,
        "unsupported",
        {
          variableOrPluginWarning: hasVariables,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
  }
};

const parseNeutralVoiceAttackAction = (
  action: VoiceAttackNeutralAction,
): ParsedActionRecord => {
  const delayMs = secondsToMilliseconds(action.delaySeconds);
  const durationMs = secondsToMilliseconds(action.durationSeconds);
  const hasVariables = hasVariableReference(
    action.context,
    action.context2,
    action.context3,
    action.context4,
    action.context5,
    action.conditionSetName,
    action.conditionSetCondition,
    action.conditionStartNameFrom,
    action.conditionStartCompareToCondition,
  );

  switch (action.actionTypeName) {
    case "PressKey":
      return parsePressKeyActionData(
        action.actionTypeName,
        action.keyCodes,
        delayMs,
        durationMs,
      );
    case "Pause":
      return parsePauseActionData(action.actionTypeName, delayMs, durationMs);
    case "ExecuteCommand":
      return parseExecuteCommandActionData(
        action.actionTypeName,
        delayMs,
        action.context2,
      );
    case "SoundFile":
    case "RandomSound":
      return parseSoundPlaceholderActionData(
        action.actionTypeName,
        delayMs,
        hasVariables,
        "sound_file",
      );
    case "Say":
      return parseSoundPlaceholderActionData(
        action.actionTypeName,
        delayMs,
        hasVariables,
        "say",
      );
    case "KeyDown":
      return parseKeyTransitionActionData(
        action.actionTypeName,
        action.keyCodes,
        delayMs,
        "key_down",
      );
    case "KeyUp":
      return parseKeyTransitionActionData(
        action.actionTypeName,
        action.keyCodes,
        delayMs,
        "key_up",
      );
    case "ExternalInvoke":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack plugin actions are not imported automatically.",
        "unsupported",
        {
          variableOrPluginWarning: true,
          unresolvedPluginCount: 1,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
    case "InlineFunctionCS":
    case "InlineFunctionVB":
    case "InlineFunctionPrecompiled":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "Inline code actions are not imported automatically.",
        "unsupported",
        {
          variableOrPluginWarning: true,
          unresolvedPluginCount: 1,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
    case "ConditionSet":
    case "ConditionStart":
    case "ConditionElse":
    case "ConditionElseIf":
    case "ConditionEnd":
    case "WhileStart":
    case "WhileEnd":
    case "LoopBreak":
    case "LoopContinue":
    case "Jump":
    case "Marker":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack flow-control actions require manual replacement.",
        "unsupported",
        {
          variableOrPluginWarning: hasVariables,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
    case "TextSet":
    case "BooleanSet":
    case "IntSet":
    case "DecimalSet":
    case "DateSet":
    case "Convert":
    case "PauseVariable":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack variable actions require manual replacement.",
        "unsupported",
        {
          variableOrPluginWarning: true,
          unresolvedVariableCount: 1,
        },
      );
    case "Launch":
    case "Kill":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack process actions are never imported automatically.",
      );
    case "MouseAction":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "Mouse automation is intentionally excluded from this import phase.",
      );
    case "Comment":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack comment actions are kept as unsupported notes for manual review.",
      );
    case "WriteToLog":
      return parseWriteLogActionData(
        action.actionTypeName,
        delayMs,
        action.context,
        hasVariables,
      );
    case "InternalProcess_Ignore":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack internal process actions require manual review.",
      );
    case "InternalProcess_StartListening":
      return parseSetMicStateActionData(action.actionTypeName, delayMs, true);
    case "InternalProcess_StopListening":
      return parseSetMicStateActionData(action.actionTypeName, delayMs, false);
    case "InternalProcess_StartHotkeys":
    case "InternalProcess_StopHotkeys":
    case "InternalProcess_StartMouse":
    case "InternalProcess_StopMouse":
    case "InternalProcess_StartJoysticks":
    case "InternalProcess_StopJoysticks":
    case "InternalProcess_StartProcessing":
    case "InternalProcess_StopProcessing":
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        "VoiceAttack internal process actions require manual review.",
      );
    default:
      return parseUnsupportedActionData(
        action.actionTypeName,
        delayMs,
        action.actionTypeName,
        `VoiceAttack action "${action.actionTypeName}" is not imported automatically.`,
        "unsupported",
        {
          variableOrPluginWarning: hasVariables,
          unresolvedVariableCount: hasVariables ? 1 : 0,
        },
      );
  }
};

const ALL_ZERO_GUID = "00000000-0000-0000-0000-000000000000";

const isFlowToken = (
  token: VoiceAttackNode | VoiceAttackFlowToken,
): token is VoiceAttackFlowToken =>
  [
    "if_start",
    "else",
    "else_if",
    "if_end",
    "while_start",
    "while_end",
  ].includes((token as VoiceAttackFlowToken).kind);

const buildUnsupportedTreeNode = (
  action: VoiceAttackNeutralAction,
  sourceActionIndex: number,
  reason: string,
  unsupportedPolicy?: VoiceAttackUnsupportedPolicy,
): VoiceAttackUnsupportedNode => ({
  nodeId: buildVoiceAttackNodeId(
    action.actionTypeName,
    action.actionId,
    sourceActionIndex,
    "unsupported",
  ),
  kind: "unsupported",
  actionTypeName: action.actionTypeName,
  sourceActionId: action.actionId,
  sourceActionIndex,
  delayMs: secondsToMilliseconds(action.delaySeconds),
  disabled: action.disabled,
  unsupportedPolicy:
    unsupportedPolicy ?? inferUnsupportedPolicy(action.actionTypeName, reason),
  reason,
  rawFields: buildPreservedFields(action.unknownFields),
});

const buildExecuteNodeFromNeutralAction = (
  action: VoiceAttackNeutralAction,
  sourceActionIndex: number,
): VoiceAttackExecuteCommandNode => {
  const targetSourceCommandId =
    action.context && action.context !== ALL_ZERO_GUID ? action.context : null;
  const targetReference =
    action.context2?.trim() || action.context?.trim() || "unresolved command";
  return {
    nodeId: buildVoiceAttackNodeId(
      action.actionTypeName,
      action.actionId,
      sourceActionIndex,
      "call",
    ),
    kind: "execute_command",
    actionTypeName: action.actionTypeName,
    sourceActionId: action.actionId,
    sourceActionIndex,
    delayMs: secondsToMilliseconds(action.delaySeconds),
    disabled: action.disabled,
    targetReference,
    targetCommandId: null,
    targetSourceCommandId,
    unresolved: targetReference.length === 0,
    cyclic: false,
  };
};

const translateNeutralActionToTreeTokens = (
  action: VoiceAttackNeutralAction,
  sourceActionIndex: number,
): Array<VoiceAttackNode | VoiceAttackFlowToken> => {
  switch (action.actionTypeName) {
    case "ConditionStart":
      return [
        {
          kind: "if_start",
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "if",
          ),
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          condition: buildConditionExpressionFromAction(action),
          rawFields: buildPreservedFields(action.unknownFields),
        },
      ];
    case "ConditionElse":
      return [{ kind: "else", sourceActionIndex }];
    case "ConditionElseIf":
      return [
        {
          kind: "else_if",
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "elseif",
          ),
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          condition: buildConditionExpressionFromAction(action),
          rawFields: buildPreservedFields(action.unknownFields),
        },
      ];
    case "ConditionEnd":
      return [{ kind: "if_end", sourceActionIndex }];
    case "WhileStart":
      return [
        {
          kind: "while_start",
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "while",
          ),
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          condition: buildConditionExpressionFromAction(action),
          rawFields: buildPreservedFields(action.unknownFields),
        },
      ];
    case "WhileEnd":
      return [{ kind: "while_end", sourceActionIndex }];
    case "ExecuteCommand":
      return [buildExecuteNodeFromNeutralAction(action, sourceActionIndex)];
    case "TextSet": {
      const variableName = normalizeVoiceAttackVariableName(
        action.context?.trim() || action.conditionSetName?.trim() || "",
      );
      if (!variableName) {
        return [
          buildUnsupportedTreeNode(
            action,
            sourceActionIndex,
            "Text variable action is missing a variable name.",
          ),
        ];
      }
      const nextValue = action.context2 ?? "";
      if (nextValue.length === 0) {
        return [
          {
            nodeId: buildVoiceAttackNodeId(
              action.actionTypeName,
              action.actionId,
              sourceActionIndex,
              "clear",
            ),
            kind: "clear_variable",
            actionTypeName: action.actionTypeName,
            sourceActionId: action.actionId,
            sourceActionIndex,
            delayMs: secondsToMilliseconds(action.delaySeconds),
            disabled: action.disabled,
            scope: getVoiceAttackVariableScope(variableName),
            variableName,
          },
        ];
      }
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "set",
          ),
          kind: "set_variable",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          scope: getVoiceAttackVariableScope(variableName),
          variableName,
          valueType: "string",
          operation: "assign",
          value: buildLiteralOperand(nextValue),
        },
      ];
    }
    case "BooleanSet": {
      const variableName = normalizeVoiceAttackVariableName(
        action.context?.trim() || action.conditionSetName?.trim() || "",
      );
      if (!variableName) {
        return [
          buildUnsupportedTreeNode(
            action,
            sourceActionIndex,
            "Boolean variable action is missing a variable name.",
          ),
        ];
      }
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "bool",
          ),
          kind: "set_variable",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          scope: getVoiceAttackVariableScope(variableName),
          variableName,
          valueType: "boolean",
          operation: "assign",
          value: buildLiteralOperand(parseBooleanLiteral(action)),
        },
      ];
    }
    case "IntSet":
    case "DecimalSet": {
      const variableName = normalizeVoiceAttackVariableName(
        action.conditionSetName?.trim() || action.context?.trim() || "",
      );
      if (!variableName) {
        return [
          buildUnsupportedTreeNode(
            action,
            sourceActionIndex,
            "Numeric variable action is missing a variable name.",
          ),
        ];
      }
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "number",
          ),
          kind: "set_variable",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          scope: getVoiceAttackVariableScope(variableName),
          variableName,
          valueType: action.actionTypeName === "IntSet" ? "integer" : "decimal",
          operation: action.inputMode === 8 ? "increment" : "assign",
          value: buildLiteralOperand(parseNumericLiteral(action)),
        },
      ];
    }
    case "KillCommand":
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "stop",
          ),
          kind: "stop_command",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
        },
      ];
    case "Comment":
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "comment",
          ),
          kind: "note",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          noteType: "comment",
          content: action.context ?? "",
        },
      ];
    case "RandomSound":
    case "SoundFile":
    case "Say":
      return [
        {
          nodeId: buildVoiceAttackNodeId(
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
            "speech",
          ),
          kind: "speech_placeholder",
          actionTypeName: action.actionTypeName,
          sourceActionId: action.actionId,
          sourceActionIndex,
          delayMs: secondsToMilliseconds(action.delaySeconds),
          disabled: action.disabled,
          placeholderType: action.actionTypeName === "Say" ? "say" : "sound_file",
          originalResponsePresent: true,
          replacementRequired: true,
        },
      ];
    default: {
      const parsed = parseNeutralVoiceAttackAction(action);
      if (parsed.pendingRunMacroTarget) {
        return [
          ...stepToVoiceAttackNodes(
            parsed.steps,
            action.actionTypeName,
            action.actionId,
            sourceActionIndex,
          ),
          buildExecuteNodeFromNeutralAction(
            { ...action, context2: parsed.pendingRunMacroTarget },
            sourceActionIndex,
          ),
        ];
      }
      return stepToVoiceAttackNodes(
        parsed.steps,
        action.actionTypeName,
        action.actionId,
        sourceActionIndex,
      );
    }
  }
};

const parseVoiceAttackTreeBlock = (
  tokens: Array<VoiceAttackNode | VoiceAttackFlowToken>,
  startIndex: number,
  endKinds: Set<VoiceAttackFlowToken["kind"]>,
  depth = 0,
): {
  nodes: VoiceAttackNode[];
  nextIndex: number;
  terminator: VoiceAttackFlowToken["kind"] | null;
} => {
  const nodes: VoiceAttackNode[] = [];
  let index = startIndex;
  let iterations = 0;
  const maxIterations = Math.max(tokens.length * 4, 32);

  if (depth > tokens.length + 8) {
    console.error("[voiceattack:importer:tree:parse:depth-limit]", {
      startIndex,
      tokenCount: tokens.length,
      depth,
    });
    return { nodes, nextIndex: Math.min(startIndex + 1, tokens.length), terminator: null };
  }

  while (index < tokens.length) {
    iterations += 1;
    if (iterations > maxIterations) {
      console.error("[voiceattack:importer:tree:parse:iteration-limit]", {
        startIndex,
        index,
        tokenCount: tokens.length,
        depth,
      });
      return { nodes, nextIndex: Math.min(index + 1, tokens.length), terminator: null };
    }
    const token = tokens[index];
    if (isFlowToken(token) && endKinds.has(token.kind)) {
      return { nodes, nextIndex: index, terminator: token.kind };
    }
    if (!isFlowToken(token)) {
      nodes.push(token);
      index += 1;
      continue;
    }

    if (token.kind === "if_start" || token.kind === "else_if") {
      const thenResult = parseVoiceAttackTreeBlock(
        tokens,
        index + 1,
        new Set(["else", "else_if", "if_end"]),
        depth + 1,
      );
      let nextIndex = thenResult.nextIndex;
      let elseNodes: VoiceAttackNode[] = [];
      const terminatorToken = tokens[nextIndex];
      if (thenResult.terminator === "else_if" && terminatorToken && isFlowToken(terminatorToken)) {
        const nestedElseIfResult = parseVoiceAttackTreeBlock(
          tokens,
          nextIndex,
          new Set(["if_end"]),
          depth + 1,
        );
        if (nestedElseIfResult.nextIndex <= nextIndex) {
          elseNodes = [
            buildUnsupportedTreeNode(
              {
                actionId: terminatorToken.sourceActionId,
                actionTypeName: terminatorToken.actionTypeName,
                actionTypeValue: -1,
                delaySeconds: terminatorToken.delayMs / 1000,
                durationSeconds: 0,
                keyCodes: [],
                context: null,
                context2: null,
                context3: null,
                context4: null,
                context5: null,
                x: 0,
                y: 0,
                z: 0,
                inputMode: 0,
                conditionSetName: null,
                conditionSetCondition: null,
                conditionPairing: 0,
                conditionGroup: 0,
                conditionStartNameFrom: null,
                conditionStartOperator: 0,
                conditionStartValue: 0,
                conditionStartValueType: 0,
                conditionStartCompareToCondition: null,
                conditionStartType: 0,
                decimalContext1: null,
                decimalContext2: null,
                dateContext1: null,
                dateContext2: null,
                disabled: terminatorToken.disabled,
                integerContext1: 0,
                integerContext2: 0,
                randomSounds: [],
                conditionExpressions: [],
                unknownFields: [],
              },
              terminatorToken.sourceActionIndex,
              "Else-if block could not be parsed without re-entering the same token.",
              "blocking",
            ),
          ];
          nextIndex += 1;
        } else {
          elseNodes = nestedElseIfResult.nodes;
          nextIndex = nestedElseIfResult.nextIndex;
        }
      } else if (thenResult.terminator === "else") {
        const elseResult = parseVoiceAttackTreeBlock(
          tokens,
          nextIndex + 1,
          new Set(["if_end"]),
          depth + 1,
        );
        elseNodes = elseResult.nodes;
        nextIndex = elseResult.nextIndex;
      }

      if (
        !token.condition ||
        nextIndex >= tokens.length ||
        !isFlowToken(tokens[nextIndex]) ||
        tokens[nextIndex].kind !== "if_end"
      ) {
        nodes.push(
          buildUnsupportedTreeNode(
            {
              actionId: token.sourceActionId,
              actionTypeName: token.actionTypeName,
              actionTypeValue: -1,
              delaySeconds: token.delayMs / 1000,
              durationSeconds: 0,
              keyCodes: [],
              context: null,
              context2: null,
              context3: null,
              context4: null,
              context5: null,
              x: 0,
              y: 0,
              z: 0,
              inputMode: 0,
              conditionSetName: null,
              conditionSetCondition: null,
              conditionPairing: 0,
              conditionGroup: 0,
              conditionStartNameFrom: null,
              conditionStartOperator: 0,
              conditionStartValue: 0,
              conditionStartValueType: 0,
              conditionStartCompareToCondition: null,
              conditionStartType: 0,
              decimalContext1: null,
              decimalContext2: null,
              dateContext1: null,
              dateContext2: null,
              disabled: token.disabled,
              integerContext1: 0,
              integerContext2: 0,
              randomSounds: [],
              conditionExpressions: [],
              unknownFields: [],
            },
            token.sourceActionIndex,
            "Conditional VoiceAttack block is malformed or uses an unsupported comparison.",
            "blocking",
          ),
        );
        index += 1;
        continue;
      }

      nodes.push({
        nodeId: token.nodeId,
        kind: "if",
        actionTypeName: token.actionTypeName,
        sourceActionId: token.sourceActionId,
        sourceActionIndex: token.sourceActionIndex,
        delayMs: token.delayMs,
        disabled: token.disabled,
        condition: token.condition,
        thenNodes: thenResult.nodes,
        elseNodes,
      });
      index = nextIndex + 1;
      continue;
    }

    if (token.kind === "while_start") {
      const bodyResult = parseVoiceAttackTreeBlock(
        tokens,
        index + 1,
        new Set(["while_end"]),
        depth + 1,
      );
      if (!token.condition || bodyResult.terminator !== "while_end") {
        nodes.push(
          buildUnsupportedTreeNode(
            {
              actionId: token.sourceActionId,
              actionTypeName: token.actionTypeName,
              actionTypeValue: -1,
              delaySeconds: token.delayMs / 1000,
              durationSeconds: 0,
              keyCodes: [],
              context: null,
              context2: null,
              context3: null,
              context4: null,
              context5: null,
              x: 0,
              y: 0,
              z: 0,
              inputMode: 0,
              conditionSetName: null,
              conditionSetCondition: null,
              conditionPairing: 0,
              conditionGroup: 0,
              conditionStartNameFrom: null,
              conditionStartOperator: 0,
              conditionStartValue: 0,
              conditionStartValueType: 0,
              conditionStartCompareToCondition: null,
              conditionStartType: 0,
              decimalContext1: null,
              decimalContext2: null,
              dateContext1: null,
              dateContext2: null,
              disabled: token.disabled,
              integerContext1: 0,
              integerContext2: 0,
              randomSounds: [],
              conditionExpressions: [],
              unknownFields: [],
            },
            token.sourceActionIndex,
            "While loop is malformed or uses an unsupported comparison.",
            "blocking",
          ),
        );
        index += 1;
        continue;
      }
      nodes.push({
        nodeId: token.nodeId,
        kind: "while",
        actionTypeName: token.actionTypeName,
        sourceActionId: token.sourceActionId,
        sourceActionIndex: token.sourceActionIndex,
        delayMs: token.delayMs,
        disabled: token.disabled,
        condition: token.condition,
        body: bodyResult.nodes,
      });
      index = bodyResult.nextIndex + 1;
      continue;
    }

    nodes.push(
      buildUnsupportedTreeNode(
        {
          actionId: null as never,
          actionTypeName: String(token.kind),
          actionTypeValue: -1,
          delaySeconds: 0,
          durationSeconds: 0,
          keyCodes: [],
          context: null,
          context2: null,
          context3: null,
          context4: null,
          context5: null,
          x: 0,
          y: 0,
          z: 0,
          inputMode: 0,
          conditionSetName: null,
          conditionSetCondition: null,
          conditionPairing: 0,
          conditionGroup: 0,
          conditionStartNameFrom: null,
          conditionStartOperator: 0,
          conditionStartValue: 0,
          conditionStartValueType: 0,
          conditionStartCompareToCondition: null,
          conditionStartType: 0,
          decimalContext1: null,
          decimalContext2: null,
          dateContext1: null,
          dateContext2: null,
          disabled: false,
          integerContext1: 0,
          integerContext2: 0,
          randomSounds: [],
          conditionExpressions: [],
          unknownFields: [],
        },
        token.sourceActionIndex,
        `Unexpected flow token "${token.kind}" was preserved as unsupported metadata.`,
        "blocking",
      ),
    );
    index += 1;
  }

  return { nodes, nextIndex: index, terminator: null };
};

type VoiceAttackIfFlowToken = Extract<
  VoiceAttackFlowToken,
  { kind: "if_start" | "else_if" }
>;

type VoiceAttackWhileFlowToken = Extract<
  VoiceAttackFlowToken,
  { kind: "while_start" }
>;

type VoiceAttackParseFrame =
  | {
      kind: "if";
      token: VoiceAttackIfFlowToken;
      thenNodes: VoiceAttackNode[];
      elseNodes: VoiceAttackNode[];
      activeBranch: "then" | "else";
      syntheticElseIf: boolean;
    }
  | {
      kind: "while";
      token: VoiceAttackWhileFlowToken;
      body: VoiceAttackNode[];
    };

const buildUnsupportedFlowNode = (
  token: VoiceAttackFlowToken,
  reason: string,
): VoiceAttackUnsupportedNode => ({
  nodeId:
    "nodeId" in token
      ? token.nodeId
      : buildVoiceAttackNodeId(token.kind, null, token.sourceActionIndex, "flow"),
  kind: "unsupported",
  actionTypeName: "actionTypeName" in token ? token.actionTypeName : token.kind,
  sourceActionId: "sourceActionId" in token ? token.sourceActionId : null,
  sourceActionIndex: token.sourceActionIndex,
  delayMs: "delayMs" in token ? token.delayMs : 0,
  disabled: "disabled" in token ? token.disabled : false,
  unsupportedPolicy: "blocking",
  reason,
  rawFields: "rawFields" in token ? token.rawFields : [],
});

const buildVoiceAttackIfNodeFromFrame = (
  frame: Extract<VoiceAttackParseFrame, { kind: "if" }>,
): VoiceAttackNode =>
  frame.token.condition
    ? {
        nodeId: frame.token.nodeId,
        kind: "if",
        actionTypeName: frame.token.actionTypeName,
        sourceActionId: frame.token.sourceActionId,
        sourceActionIndex: frame.token.sourceActionIndex,
        delayMs: frame.token.delayMs,
        disabled: frame.token.disabled,
        condition: frame.token.condition,
        thenNodes: frame.thenNodes,
        elseNodes: frame.elseNodes,
      }
    : buildUnsupportedFlowNode(
        frame.token,
        "Conditional VoiceAttack block uses a comparison that could not be decoded safely.",
      );

const buildVoiceAttackWhileNodeFromFrame = (
  frame: Extract<VoiceAttackParseFrame, { kind: "while" }>,
): VoiceAttackNode =>
  frame.token.condition
    ? {
        nodeId: frame.token.nodeId,
        kind: "while",
        actionTypeName: frame.token.actionTypeName,
        sourceActionId: frame.token.sourceActionId,
        sourceActionIndex: frame.token.sourceActionIndex,
        delayMs: frame.token.delayMs,
        disabled: frame.token.disabled,
        condition: frame.token.condition,
        body: frame.body,
      }
    : buildUnsupportedFlowNode(
        frame.token,
        "While loop uses a comparison that could not be decoded safely.",
      );

const parseVoiceAttackTreeTokensIteratively = (
  tokens: Array<VoiceAttackNode | VoiceAttackFlowToken>,
): VoiceAttackNode[] => {
  const rootNodes: VoiceAttackNode[] = [];
  const stack: VoiceAttackParseFrame[] = [];

  const appendNode = (node: VoiceAttackNode): void => {
    const frame = stack[stack.length - 1];
    if (!frame) {
      rootNodes.push(node);
      return;
    }
    if (frame.kind === "while") {
      frame.body.push(node);
      return;
    }
    if (frame.activeBranch === "then") {
      frame.thenNodes.push(node);
      return;
    }
    frame.elseNodes.push(node);
  };

  const closeIfFrame = (): void => {
    const frame = stack.pop();
    if (!frame || frame.kind !== "if") {
      return;
    }
    appendNode(buildVoiceAttackIfNodeFromFrame(frame));
  };

  tokens.forEach((token) => {
    if (!isFlowToken(token)) {
      appendNode(token);
      return;
    }

    switch (token.kind) {
      case "if_start":
        stack.push({
          kind: "if",
          token,
          thenNodes: [],
          elseNodes: [],
          activeBranch: "then",
          syntheticElseIf: false,
        });
        return;
      case "else_if": {
        const frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "if") {
          appendNode(
            buildUnsupportedFlowNode(
              token,
              "Else-if appeared without an open conditional block.",
            ),
          );
          return;
        }
        frame.activeBranch = "else";
        stack.push({
          kind: "if",
          token,
          thenNodes: [],
          elseNodes: [],
          activeBranch: "then",
          syntheticElseIf: true,
        });
        return;
      }
      case "else": {
        const frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "if") {
          appendNode(
            buildUnsupportedFlowNode(
              token,
              "Else appeared without an open conditional block.",
            ),
          );
          return;
        }
        frame.activeBranch = "else";
        return;
      }
      case "if_end": {
        let frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "if") {
          appendNode(
            buildUnsupportedFlowNode(
              token,
              "Conditional end appeared without an open conditional block.",
            ),
          );
          return;
        }
        while (frame?.kind === "if" && frame.syntheticElseIf) {
          closeIfFrame();
          frame = stack[stack.length - 1];
        }
        if (frame?.kind === "if") {
          closeIfFrame();
          return;
        }
        appendNode(
          buildUnsupportedFlowNode(
            token,
            "Conditional end could not be matched to the original if block.",
          ),
        );
        return;
      }
      case "while_start":
        stack.push({
          kind: "while",
          token,
          body: [],
        });
        return;
      case "while_end": {
        const frame = stack.pop();
        if (!frame || frame.kind !== "while") {
          appendNode(
            buildUnsupportedFlowNode(
              token,
              "While end appeared without an open while block.",
            ),
          );
          return;
        }
        appendNode(buildVoiceAttackWhileNodeFromFrame(frame));
        return;
      }
    }
  });

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    appendNode(
      frame.kind === "if"
        ? buildUnsupportedFlowNode(
            frame.token,
            "Conditional VoiceAttack block was not closed.",
          )
        : buildUnsupportedFlowNode(
            frame.token,
            "While loop was not closed.",
          ),
    );
  }

  return rootNodes;
};

const VOICEATTACK_ACTION_TREE_PARSE_LIMIT = 80;

const buildNeutralActionTree = (
  actions: VoiceAttackNeutralAction[],
  debugContext?: {
    sourceBasename: string;
    commandIndex: number;
    startedAt: number;
  },
): VoiceAttackNode[] => {
  if (actions.length > VOICEATTACK_ACTION_TREE_PARSE_LIMIT) {
    console.error("[voiceattack:importer:tree:skipped-large-block]", {
      sourceBasename: debugContext?.sourceBasename,
      elapsedMs: debugContext ? Date.now() - debugContext.startedAt : null,
      commandIndex: debugContext?.commandIndex,
      actionCount: actions.length,
      limit: VOICEATTACK_ACTION_TREE_PARSE_LIMIT,
    });
    const representativeAction = actions[0];
    return representativeAction
      ? [
          buildUnsupportedTreeNode(
            representativeAction,
            0,
            `VoiceAttack action tree parsing was skipped because this command has ${actions.length} actions. Review the imported steps manually.`,
            "blocking",
          ),
        ]
      : [];
  }
  const traceActions = actions.length > 80 && debugContext;
  const tokens: Array<VoiceAttackNode | VoiceAttackFlowToken> = [];
  actions.forEach((action, index) => {
    if (traceActions) {
      console.error("[voiceattack:importer:tree:translate-action:start]", {
        sourceBasename: debugContext.sourceBasename,
        elapsedMs: Date.now() - debugContext.startedAt,
        commandIndex: debugContext.commandIndex,
        actionIndex: index,
        actionCount: actions.length,
        actionTypeName: action.actionTypeName,
      });
    }
    tokens.push(...translateNeutralActionToTreeTokens(action, index));
    if (traceActions) {
      console.error("[voiceattack:importer:tree:translate-action:done]", {
        sourceBasename: debugContext.sourceBasename,
        elapsedMs: Date.now() - debugContext.startedAt,
        commandIndex: debugContext.commandIndex,
        actionIndex: index,
        tokenCount: tokens.length,
      });
    }
  });
  if (traceActions) {
    console.error("[voiceattack:importer:tree:parse:start]", {
      sourceBasename: debugContext.sourceBasename,
      elapsedMs: Date.now() - debugContext.startedAt,
      commandIndex: debugContext.commandIndex,
      tokenCount: tokens.length,
    });
  }
  const tree = parseVoiceAttackTreeTokensIteratively(tokens);
  if (traceActions) {
    console.error("[voiceattack:importer:tree:parse:done]", {
      sourceBasename: debugContext.sourceBasename,
      elapsedMs: Date.now() - debugContext.startedAt,
      commandIndex: debugContext.commandIndex,
      nodeCount: tree.length,
    });
  }
  return tree;
};

const walkActionTree = (
  nodes: VoiceAttackNode[],
  visitor: (node: VoiceAttackNode) => void,
): void => {
  nodes.forEach((node) => {
    visitor(node);
    if (node.kind === "if") {
      walkActionTree(node.thenNodes, visitor);
      walkActionTree(node.elseNodes, visitor);
      return;
    }
    if (node.kind === "repeat") {
      walkActionTree(node.body, visitor);
      return;
    }
    if (node.kind === "while") {
      walkActionTree(node.body, visitor);
    }
  });
};

const buildPhraseLookup = (
  commands: RawCommandRecord[],
): Map<string, string | null> => {
  const lookup = new Map<string, string | null>();
  commands.forEach((command) => {
    const phrases = uniqueStrings([
      command.originalLabel,
      ...command.command.aliases,
    ]);
    phrases.forEach((phrase) => {
      const normalized = phrase.trim().toLowerCase();
      if (!normalized) {
        return;
      }
      if (!lookup.has(normalized)) {
        lookup.set(normalized, command.command.commandId);
        return;
      }
      lookup.set(normalized, null);
    });
  });
  return lookup;
};

const buildSourceCommandLookup = (
  commands: RawCommandRecord[],
): Map<string, string> => {
  const lookup = new Map<string, string>();
  commands.forEach((command) => {
    if (command.sourceCommandId) {
      lookup.set(command.sourceCommandId, command.command.commandId);
    }
  });
  return lookup;
};

const AUDIO_COMMAND_LABEL_PATTERN =
  /(?:^|[ _\-.])(?:play|stop|random)?[ _\-.]*(?:sound|audio|speech|tts)|sound[ _\-.]*bucket|play[ _\-.]*sound/i;

const AUDIO_ONLY_IMPORT_CATEGORIES = new Set([
  "sound_file",
  "say",
  "pause",
  "execute_command",
  "write_log",
]);

const isDiscardableAudioCommand = (command: RawCommandRecord): boolean => {
  if (command.keyInputCount > 0) {
    return false;
  }
  const labelText = uniqueStrings([
    command.command.commandId,
    command.originalLabel,
    command.sourceCommandString,
    command.sourceLabel ?? "",
    ...command.phrases,
  ]).join(" ");
  if (AUDIO_COMMAND_LABEL_PATTERN.test(labelText)) {
    return true;
  }
  if (
    command.actionTypeCategories.has("sound_file") ||
    command.actionTypeCategories.has("say")
  ) {
    return Array.from(command.actionTypeCategories).every((category) =>
      AUDIO_ONLY_IMPORT_CATEGORIES.has(category),
    );
  }
  return false;
};

const resolveCommandReference = (
  sourceLookup: Map<string, string>,
  phraseLookup: Map<string, string | null>,
  targetSourceCommandId: string | null,
  targetPhrase: string,
): string | null => {
  if (targetSourceCommandId && sourceLookup.has(targetSourceCommandId)) {
    return sourceLookup.get(targetSourceCommandId) ?? null;
  }
  const normalized = targetPhrase.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return phraseLookup.get(normalized) ?? null;
};

const resolveActionTreeReferences = (
  nodes: VoiceAttackNode[],
  sourceLookup: Map<string, string>,
  phraseLookup: Map<string, string | null>,
): void => {
  walkActionTree(nodes, (node) => {
    if (node.kind !== "execute_command") {
      return;
    }
    const targetCommandId = resolveCommandReference(
      sourceLookup,
      phraseLookup,
      node.targetSourceCommandId,
      node.targetReference,
    );
    node.targetCommandId = targetCommandId;
    node.unresolved = targetCommandId === null;
  });
};

const collectActionTreeDependencyReferences = (
  nodes: VoiceAttackNode[],
): string[] => {
  const values = new Set<string>();
  walkActionTree(nodes, (node) => {
    if (node.kind === "execute_command" && node.targetReference.trim()) {
      values.add(node.targetReference.trim());
    }
  });
  return [...values];
};

const collectActionTreeResolvedDependencies = (
  nodes: VoiceAttackNode[],
): string[] => {
  const values = new Set<string>();
  walkActionTree(nodes, (node) => {
    if (node.kind === "execute_command" && node.targetCommandId) {
      values.add(node.targetCommandId);
    }
  });
  return [...values];
};

const collectActionTreeUnresolvedDependencies = (
  nodes: VoiceAttackNode[],
): string[] => {
  const values = new Set<string>();
  walkActionTree(nodes, (node) => {
    if (node.kind === "execute_command" && node.unresolved) {
      values.add(node.targetReference);
    }
  });
  return [...values];
};

const collectActionTreePluginDependencies = (
  nodes: VoiceAttackNode[],
): string[] => {
  const values = new Set<string>();
  walkActionTree(nodes, (node) => {
    if (
      node.kind === "unsupported" &&
      (node.reason.toLowerCase().includes("plugin") ||
        node.actionTypeName === "ExternalInvoke")
    ) {
      values.add(node.actionTypeName);
    }
  });
  return [...values];
};

const markCyclicActionTreeReferences = (
  sourceCommandId: string,
  nodes: VoiceAttackNode[],
  cyclicEdges: Set<string>,
): boolean => {
  let foundCycle = false;
  walkActionTree(nodes, (node) => {
    if (node.kind !== "execute_command" || !node.targetCommandId) {
      return;
    }
    const edgeKey = `${sourceCommandId}::${node.targetCommandId}`;
    if (!cyclicEdges.has(edgeKey)) {
      return;
    }
    node.cyclic = true;
    foundCycle = true;
  });
  return foundCycle;
};

const collectDependencyComponentForCommand = (
  commandId: string,
  graph: Map<string, string[]>,
): string[] => {
  const visited = new Set<string>();
  const queue = [commandId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    (graph.get(current) ?? []).forEach((target) => {
      if (!visited.has(target)) {
        queue.push(target);
      }
    });
  }
  return [...visited].filter((entry) => entry !== commandId);
};

const actionTreeReachesKeyboard = (
  commandId: string,
  commandsById: Map<string, RawCommandRecord>,
  stack = new Set<string>(),
): boolean => {
  if (stack.has(commandId)) {
    return false;
  }
  stack.add(commandId);
  const command = commandsById.get(commandId);
  if (!command) {
    stack.delete(commandId);
    return false;
  }
  let reachesKeyboard = false;
  walkActionTree(command.actionTree, (node) => {
    if (reachesKeyboard) {
      return;
    }
    if (
      node.kind === "key_press" ||
      node.kind === "key_down" ||
      node.kind === "key_up" ||
      node.kind === "key_combination"
    ) {
      reachesKeyboard = true;
      return;
    }
    if (node.kind === "execute_command" && node.targetCommandId) {
      reachesKeyboard = actionTreeReachesKeyboard(
        node.targetCommandId,
        commandsById,
        stack,
      );
    }
  });
  stack.delete(commandId);
  return reachesKeyboard;
};

const countUnsupportedPolicies = (
  nodes: VoiceAttackNode[],
): Record<VoiceAttackUnsupportedPolicy, number> => {
  const counts = {
    informational: 0,
    skippable: 0,
    blocking: 0,
    prohibited: 0,
  } satisfies Record<VoiceAttackUnsupportedPolicy, number>;
  walkActionTree(nodes, (node) => {
    if (node.kind === "unsupported") {
      counts[node.unsupportedPolicy] += 1;
    }
  });
  return counts;
};

const determineExecutability = (
  commandId: string,
  command: RawCommandRecord,
  commandsById: Map<string, RawCommandRecord>,
  dependencyCycles: string[][],
): VoiceAttackExecutabilityStatus => {
  const policyCounts = countUnsupportedPolicies(command.actionTree);
  const unresolvedDependencies = collectActionTreeUnresolvedDependencies(
    command.actionTree,
  );
  const hasCycle = dependencyCycles.some((cycle) => cycle.includes(commandId));
  const reachesKeyboard = actionTreeReachesKeyboard(commandId, commandsById);
  if (!reachesKeyboard && policyCounts.skippable + policyCounts.blocking + policyCounts.prohibited > 0) {
    return "metadata_only";
  }
  if (
    unresolvedDependencies.length > 0 ||
    hasCycle ||
    policyCounts.blocking > 0 ||
    policyCounts.prohibited > 0
  ) {
    return "blocked";
  }
  if (policyCounts.skippable > 0 || policyCounts.informational > 0) {
    return "partially_executable";
  }
  return reachesKeyboard ? "fully_executable" : "metadata_only";
};

const buildSemanticContract = (
  capabilityId: string,
  desiredPath: string,
  desiredValue: boolean,
  evidence: string[],
  confidence: AutomationSemanticContractConfidence,
): AutomationSemanticContract => ({
  capabilityId,
  gameAdapterId: "elite-dangerous",
  desiredState: {
    [desiredPath]: desiredValue,
  },
  preconditions: [],
  alreadySatisfiedWhen: {
    path: desiredPath,
    operator: "equals",
    value: desiredValue,
  },
  successWhen: {
    path: desiredPath,
    operator: "equals",
    value: desiredValue,
  },
  timeoutMs: 2_500,
  pollIntervalMs: 250,
  fallbackWhenUnavailable: "execute_unconfirmed",
  inferenceConfidence: confidence,
  inferenceEvidence: evidence,
  manualReviewRequired: true,
  userOverride: false,
  source: "inferred",
});

const inferSemanticContractForCommand = (
  command: RawCommandRecord,
): AutomationSemanticContract | null => {
  if (command.internalCommand) {
    return null;
  }
  const evidence = uniqueStrings([
    command.originalLabel,
    command.sourceCommandString,
    ...command.phrases,
    command.description,
  ]).filter((value) => value.length > 0);
  const haystack = evidence.join(" ").toLowerCase();
  const has = (pattern: RegExp): boolean => pattern.test(haystack);
  if (has(/deploy hard ?points|hard ?points deploy/)) {
    return buildSemanticContract(
      "elite.deploy_hardpoints",
      "ship.hardpointsDeployed",
      true,
      evidence,
      "high",
    );
  }
  if (has(/retract hard ?points|hard ?points retract/)) {
    return buildSemanticContract(
      "elite.retract_hardpoints",
      "ship.hardpointsDeployed",
      false,
      evidence,
      "high",
    );
  }
  if (has(/lower landing gear|deploy landing gear|landing gear down/)) {
    return buildSemanticContract(
      "elite.lower_landing_gear",
      "ship.landingGearDeployed",
      true,
      evidence,
      "high",
    );
  }
  if (has(/raise landing gear|retract landing gear|landing gear up/)) {
    return buildSemanticContract(
      "elite.raise_landing_gear",
      "ship.landingGearDeployed",
      false,
      evidence,
      "high",
    );
  }
  if (has(/deploy cargo scoop|cargo scoop deploy/)) {
    return buildSemanticContract(
      "elite.deploy_cargo_scoop",
      "ship.cargoScoopDeployed",
      true,
      evidence,
      "high",
    );
  }
  if (has(/retract cargo scoop|cargo scoop retract/)) {
    return buildSemanticContract(
      "elite.retract_cargo_scoop",
      "ship.cargoScoopDeployed",
      false,
      evidence,
      "high",
    );
  }
  if (has(/lights on|turn lights on/)) {
    return buildSemanticContract(
      "elite.turn_lights_on",
      "ship.lightsOn",
      true,
      evidence,
      "high",
    );
  }
  if (has(/lights off|turn lights off/)) {
    return buildSemanticContract(
      "elite.turn_lights_off",
      "ship.lightsOn",
      false,
      evidence,
      "high",
    );
  }
  if (has(/silent running on|enable silent running/)) {
    return buildSemanticContract(
      "elite.enable_silent_running",
      "ship.silentRunning",
      true,
      evidence,
      "high",
    );
  }
  if (has(/silent running off|disable silent running/)) {
    return buildSemanticContract(
      "elite.disable_silent_running",
      "ship.silentRunning",
      false,
      evidence,
      "high",
    );
  }
  if (has(/flight assist off|disable flight assist/)) {
    return buildSemanticContract(
      "elite.disable_flight_assist",
      "ship.flightAssistOff",
      true,
      evidence,
      "high",
    );
  }
  if (has(/flight assist on|enable flight assist/)) {
    return buildSemanticContract(
      "elite.enable_flight_assist",
      "ship.flightAssistOff",
      false,
      evidence,
      "high",
    );
  }
  if (
    has(
      /exit super ?cruise|drop from super ?cruise|disengage super ?cruise/,
    )
  ) {
    return {
      capabilityId: "elite.exit_supercruise",
      gameAdapterId: "elite-dangerous",
      desiredState: {
        "ship.supercruise": false,
      },
      preconditions: [],
      alreadySatisfiedWhen: {
        path: "ship.supercruise",
        operator: "equals",
        value: false,
      },
      successWhen: {
        path: "ship.supercruise",
        operator: "equals",
        value: false,
      },
      timeoutMs: 8_000,
      pollIntervalMs: 250,
      fallbackWhenUnavailable: "execute_unconfirmed",
      inferenceConfidence: "high",
      inferenceEvidence: evidence,
      manualReviewRequired: true,
      userOverride: false,
      source: "inferred",
    };
  }
  if (
    has(
      /engage[_ -]*super ?cruise|enter[_ -]*super ?cruise|start[_ -]*super ?cruise|get[_ -]*clear[_ -]*and[_ -]*super ?cruise|engage[_ -]*fsd(?:[_ -]*jump)?|engage(?: the)?[_ -]*frame shift drive/,
    )
  ) {
    return {
      capabilityId: "elite.engage_supercruise",
      gameAdapterId: "elite-dangerous",
      desiredState: {
        "ship.supercruise": true,
      },
      preconditions: [
        {
          path: "ship.hardpointsDeployed",
          operator: "not_equals",
          value: true,
        },
        {
          path: "session.docked",
          operator: "not_equals",
          value: true,
        },
      ],
      alreadySatisfiedWhen: {
        path: "ship.supercruise",
        operator: "equals",
        value: true,
      },
      successWhen: {
        path: "ship.supercruise",
        operator: "equals",
        value: true,
      },
      timeoutMs: 12_000,
      pollIntervalMs: 250,
      fallbackWhenUnavailable: "block",
      inferenceConfidence: "high",
      inferenceEvidence: evidence,
      manualReviewRequired: true,
      userOverride: false,
      source: "inferred",
    };
  }
  if (has(/request docking|initiate docking/)) {
    return {
      capabilityId: "elite.request_docking",
      gameAdapterId: "elite-dangerous",
      desiredState: {
        "navigation.dockingGranted": true,
      },
      preconditions: [
        {
          path: "session.docked",
          operator: "not_equals",
          value: true,
        },
      ],
      successWhen: {
        path: "navigation.dockingGranted",
        operator: "equals",
        value: true,
      },
      failureWhen: {
        path: "navigation.dockingDenied",
        operator: "equals",
        value: true,
      },
      timeoutMs: 5_000,
      pollIntervalMs: 250,
      fallbackWhenUnavailable: "execute_unconfirmed",
      inferenceConfidence: "high",
      inferenceEvidence: evidence,
      manualReviewRequired: true,
      userOverride: false,
      source: "inferred",
    };
  }
  return null;
};

const buildVoiceAttackCommandMetadata = (options: {
  command: RawCommandRecord;
  sourceHash: string;
  sourceBasename: string;
  sourceFormat: VoiceAttackSourceFormat;
  decoderStatus: string;
  profileName: string;
  importWarnings: string[];
  commandsById: Map<string, RawCommandRecord>;
  dependencyGraph: Map<string, string[]>;
  dependencyCycles: string[][];
}): AutomationImportedVoiceAttackCommand => {
  const directDependencyCommandIds = collectActionTreeResolvedDependencies(
    options.command.actionTree,
  );
  const transitiveDependencyCommandIds = collectDependencyComponentForCommand(
    options.command.command.commandId,
    options.dependencyGraph,
  );
  const dependencyGraphSummary: VoiceAttackDependencyGraphSummary = {
    directDependencyCommandIds,
    transitiveDependencyCommandIds,
    unresolvedDependencyReferences: collectActionTreeUnresolvedDependencies(
      options.command.actionTree,
    ),
    dependencyCycles: options.dependencyCycles.filter((cycle) =>
      cycle.includes(options.command.command.commandId),
    ),
    externalPluginDependencies: collectActionTreePluginDependencies(
      options.command.actionTree,
    ),
    reachesExecutableKeyboardInput: actionTreeReachesKeyboard(
      options.command.command.commandId,
      options.commandsById,
    ),
    containsOnlySpeechOrUnsupportedActions:
      options.command.keyInputCount === 0 &&
      options.command.executableActionCount === 0,
  };
  const executability = determineExecutability(
    options.command.command.commandId,
    options.command,
    options.commandsById,
    options.dependencyCycles,
  );
  return {
    sourceCommandId: options.command.sourceCommandId,
    sourceCommandString: options.command.sourceCommandString,
    sourceLabel: options.command.sourceLabel,
    sourceDescription: options.command.description,
    sourceCategory: options.command.category,
    sourceProfileId: null,
    sourceProfileName: options.profileName,
    sourceFileHash: options.sourceHash,
    importProvenance: {
      sourceFormat: options.sourceFormat,
      decoderStatus: options.decoderStatus,
      importVersion: 1,
      decoderVersion: IMPORT_DECODER_VERSION,
      importedAt: new Date().toISOString(),
      sourceBasename: options.sourceBasename,
    },
    internalCommand: options.command.internalCommand,
    hiddenFromCapabilityCatalog: options.command.internalCommand,
    dependencyGraph: dependencyGraphSummary,
    executability,
    actionTree: structuredClone(options.command.actionTree),
    semanticContract: inferSemanticContractForCommand(options.command),
    reviewWarnings: [...options.importWarnings],
  };
};

const applyCommandRepeats = (command: RawCommandRecord): void => {
  if (command.repeatNumber <= 1) {
    return;
  }
  if (command.repeatNumber > MAX_IMPORT_REPEAT_COUNT) {
    command.warnings.add("Repeat counts above 24 require manual review.");
    return;
  }
  if (
    command.command.steps.some(
      (step) =>
        step.type === "unsupported_import_action" ||
        step.type === "response_placeholder",
    )
  ) {
    command.warnings.add(
      "Repeated imported placeholders require manual review.",
    );
    return;
  }

  const originalSteps = [...command.command.steps];
  const repeatedSteps: AutomationAction[] = [];
  for (let iteration = 0; iteration < command.repeatNumber; iteration += 1) {
    repeatedSteps.push(...originalSteps.map((step) => ({ ...step })));
  }
  command.command.steps = repeatedSteps;
  command.actionTree = [
    {
      nodeId: `${command.command.commandId}-repeat`,
      kind: "repeat",
      actionTypeName: "RepeatCommand",
      sourceActionId: null,
      sourceActionIndex: -1,
      delayMs: 0,
      disabled: false,
      iterations: command.repeatNumber,
      body: structuredClone(command.actionTree),
    },
  ];
  command.executableActionCount *= command.repeatNumber;
  command.keyInputCount *= command.repeatNumber;
  command.actionSummaries.push(`repeat command x${command.repeatNumber}`);
};

const collectStepResolvedDependencies = (
  steps: AutomationAction[],
): string[] =>
  uniqueStrings(
    steps
      .filter(
        (step): step is Extract<AutomationAction, { type: "run_macro" }> =>
          step.type === "run_macro",
      )
      .map((step) => step.commandId),
  );

const detectCyclicEdges = (commands: RawCommandRecord[]): Set<string> => {
  const graph = new Map<string, string[]>();
  commands.forEach((command) => {
    graph.set(
      command.command.commandId,
      uniqueStrings([
        ...collectActionTreeResolvedDependencies(command.actionTree),
        ...collectStepResolvedDependencies(command.command.steps),
      ]),
    );
  });

  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const inStack = new Set<string>();
  const cyclicEdges = new Set<string>();
  let index = 0;

  const visit = (commandId: string) => {
    indices.set(commandId, index);
    lowLinks.set(commandId, index);
    index += 1;
    stack.push(commandId);
    inStack.add(commandId);

    (graph.get(commandId) ?? []).forEach((targetId) => {
      if (!indices.has(targetId)) {
        visit(targetId);
        lowLinks.set(
          commandId,
          Math.min(lowLinks.get(commandId) ?? 0, lowLinks.get(targetId) ?? 0),
        );
      } else if (inStack.has(targetId)) {
        lowLinks.set(
          commandId,
          Math.min(lowLinks.get(commandId) ?? 0, indices.get(targetId) ?? 0),
        );
      }
    });

    if ((lowLinks.get(commandId) ?? 0) !== (indices.get(commandId) ?? 0)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      inStack.delete(node);
      component.push(node);
      if (node === commandId) {
        break;
      }
    }

    const componentSet = new Set(component);
    const selfCyclic =
      component.length === 1 &&
      (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length <= 1 && !selfCyclic) {
      return;
    }
    component.forEach((sourceId) => {
      (graph.get(sourceId) ?? []).forEach((targetId) => {
        if (componentSet.has(targetId)) {
          cyclicEdges.add(`${sourceId}::${targetId}`);
        }
      });
    });
  };

  commands.forEach((command) => {
    if (!indices.has(command.command.commandId)) {
      visit(command.command.commandId);
    }
  });

  return cyclicEdges;
};

const buildDependencyCycles = (
  commands: RawCommandRecord[],
  cyclicEdges: Set<string>,
): string[][] => {
  const adjacency = new Map<string, Set<string>>();
  commands.forEach((command) => {
    adjacency.set(command.command.commandId, new Set<string>());
  });
  cyclicEdges.forEach((edge) => {
    const [sourceId, targetId] = edge.split("::");
    if (!sourceId || !targetId) {
      return;
    }
    (adjacency.get(sourceId) ?? new Set<string>()).add(targetId);
    (adjacency.get(targetId) ?? new Set<string>()).add(sourceId);
  });

  const visited = new Set<string>();
  const cycles: string[][] = [];
  adjacency.forEach((_neighbors, commandId) => {
    if (visited.has(commandId) || (adjacency.get(commandId)?.size ?? 0) === 0) {
      return;
    }
    const component: string[] = [];
    const queue = [commandId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      component.push(current);
      (adjacency.get(current) ?? new Set<string>()).forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      });
    }
    if (component.length > 0) {
      cycles.push(component.sort());
    }
  });
  return cycles;
};

const finalizeCommandRecords = (
  rawCommands: RawCommandRecord[],
  options: {
    sourceHash: string;
    sourceBasename: string;
    sourceFormat: VoiceAttackSourceFormat;
    decoderStatus: string;
    profileName: string;
  },
): ParsedDraftCommand[] => {
  const lookup = buildPhraseLookup(rawCommands);
  const sourceLookup = buildSourceCommandLookup(rawCommands);
  const rawCommandsById = new Map(
    rawCommands.map((command) => [command.command.commandId, command]),
  );

  rawCommands.forEach((command) => {
    const pendingByIndex = new Map<number, PendingRunMacroRecord[]>();
    command.pendingRunMacros.forEach((pending) => {
      const queue = pendingByIndex.get(pending.insertIndex) ?? [];
      queue.push(pending);
      pendingByIndex.set(pending.insertIndex, queue);
    });

    const nextSteps: AutomationAction[] = [];
    for (let index = 0; index <= command.command.steps.length; index += 1) {
      const pendingAtIndex = pendingByIndex.get(index) ?? [];
      pendingAtIndex.forEach((pending) => {
        const targetId = resolveCommandReference(
          sourceLookup,
          lookup,
          pending.targetSourceCommandId,
          pending.targetPhrase,
        );
        if (!targetId) {
          nextSteps.push(
            buildUnsupportedAction(
              "execute_command",
              "Nested VoiceAttack command could not be resolved and requires manual replacement.",
            ),
          );
          command.warnings.add(
            "Some nested VoiceAttack commands could not be resolved automatically.",
          );
          command.unresolvedNestedReferences.push("unresolved nested command");
          command.unsupportedActionCount += 1;
          return;
        }
        const targetCommand = rawCommandsById.get(targetId);
        if (targetCommand && isDiscardableAudioCommand(targetCommand)) {
          command.warnings.add(
            "Nested VoiceAttack audio command calls were discarded during import.",
          );
          command.actionSummaries.push("discard nested audio command");
          return;
        }
        nextSteps.push({ type: "run_macro", commandId: targetId });
        command.executableActionCount += 1;
      });
      if (index < command.command.steps.length) {
        nextSteps.push(command.command.steps[index]);
      }
    }
    command.command.steps = nextSteps;
    resolveActionTreeReferences(command.actionTree, sourceLookup, lookup);
    command.directDependencyReferences = collectActionTreeDependencyReferences(
      command.actionTree,
    );
    command.directPluginDependencies = collectActionTreePluginDependencies(
      command.actionTree,
    );
    command.unresolvedNestedReferences = uniqueStrings([
      ...command.unresolvedNestedReferences,
      ...collectActionTreeUnresolvedDependencies(command.actionTree),
    ]);
    applyCommandRepeats(command);
  });

  const cyclicEdges = detectCyclicEdges(rawCommands);
  const dependencyCycles = buildDependencyCycles(rawCommands, cyclicEdges);
  rawCommands.forEach((command) => {
    command.command.steps = command.command.steps.map((step) => {
      if (step.type !== "run_macro") {
        return step;
      }
      const edgeKey = `${command.command.commandId}::${step.commandId}`;
      if (!cyclicEdges.has(edgeKey)) {
        return step;
      }
      command.recursiveReference = true;
      command.warnings.add(
        "Recursive nested VoiceAttack command references require manual replacement.",
      );
      command.unsupportedActionCount += 1;
      return buildUnsupportedAction(
        "execute_command",
        "Recursive VoiceAttack command reference requires manual replacement.",
      );
    });
    if (
      markCyclicActionTreeReferences(
        command.command.commandId,
        command.actionTree,
        cyclicEdges,
      )
    ) {
      command.recursiveReference = true;
      command.warnings.add(
        "Recursive nested VoiceAttack command references require manual replacement.",
      );
    }
    if (command.command.steps.length === 0) {
      command.command.steps.push(
        buildUnsupportedAction(
          "empty_command",
          "VoiceAttack command had no executable actions after unsupported or discarded actions were removed.",
        ),
      );
      command.warnings.add(
        "Empty VoiceAttack command requires manual replacement.",
      );
      command.unsupportedActionCount += 1;
    }
  });

  const dependencyGraph = new Map<string, string[]>();
  rawCommands.forEach((command) => {
    dependencyGraph.set(
      command.command.commandId,
      collectActionTreeResolvedDependencies(command.actionTree),
    );
  });
  const commandsById = new Map(
    rawCommands.map((command) => [command.command.commandId, command]),
  );

  return rawCommands.map((command) => {
    const supportStatus = (
      command.unsupportedActionCount === 0 &&
      command.responsePlaceholderCount === 0
        ? "supported"
        : command.executableActionCount > 0 ||
            command.responsePlaceholderCount > 0
          ? "partially_supported"
          : "unsupported"
    ) as VoiceAttackImportSupportStatus;

    const enabledByDefault = supportStatus === "supported";
    command.command.enabled = enabledByDefault;
    const importWarnings = Array.from(command.warnings);
    command.command.voiceAttack = buildVoiceAttackCommandMetadata({
      command,
      sourceHash: options.sourceHash,
      sourceBasename: options.sourceBasename,
      sourceFormat: options.sourceFormat,
      decoderStatus: options.decoderStatus,
      profileName: options.profileName,
      importWarnings,
      commandsById,
      dependencyGraph,
      dependencyCycles,
    });

    return {
      sourceCommandId: command.sourceCommandId,
      sourceCommandString: command.sourceCommandString,
      triggerMode: command.triggerMode,
      command: command.command,
      warnings: importWarnings,
      actionTypeCategories: Array.from(command.actionTypeCategories),
      actionTypeCounts: new Map(command.actionTypeCounts),
      actionDetails: command.actionDetails.map((action) => ({ ...action })),
      supportStatus,
      actionSummaries: command.actionSummaries,
      responsePlaceholderCount: command.responsePlaceholderCount,
      unsupportedActionCount: command.unsupportedActionCount,
      unresolvedNestedReferences: command.unresolvedNestedReferences,
      recursiveReference: command.recursiveReference,
      executableActionCount: command.executableActionCount,
      keyInputCount: command.keyInputCount,
      variableOrPluginWarning: command.variableOrPluginWarning,
      unresolvedPluginCount: command.unresolvedPluginCount,
      unresolvedVariableCount: command.unresolvedVariableCount,
      selectedByDefault: supportStatus === "supported",
      internalCommand: command.internalCommand,
    };
  });
};

const calculateCommandDuration = (
  command: AutomationCommand,
  commandsById: Map<string, AutomationCommand>,
  stack = new Set<string>(),
): number => {
  if (stack.has(command.commandId)) {
    return 30_000;
  }
  stack.add(command.commandId);
  let total = 0;
  command.steps.forEach((step) => {
    switch (step.type) {
      case "wait":
        total += step.milliseconds;
        break;
      case "key_press":
        total += step.durationMs ?? 80;
        break;
      case "key_combination":
      case "key_down":
      case "key_up":
        total += 80;
        break;
      case "run_macro": {
        const nested = commandsById.get(step.commandId);
        total += nested
          ? calculateCommandDuration(nested, commandsById, stack)
          : 5_000;
        break;
      }
      default:
        break;
    }
  });
  stack.delete(command.commandId);
  return Math.max(1_000, Math.min(300_000, total + 1_000));
};

const buildVoiceAttackPreviewFromRawCommands = (options: {
  importId: string;
  sourceBasename: string;
  sourceHash: string;
  sourceFormat: VoiceAttackSourceFormat;
  originalProfileVersion: string | null;
  profileName: string;
  decoderStatus: string;
  envelopeFormat: string | null;
  containerBasename: string | null;
  embeddedEntryName: string | null;
  packageEntries: VoiceAttackPackageEntrySummary[];
  embeddedProfiles: VoiceAttackEmbeddedProfileSummary[];
  diagnostics: VoiceAttackImportCandidateSummary["diagnostics"];
  rawCommands: RawCommandRecord[];
}): VoiceAttackProfilePreview & { draftCommands: ParsedDraftCommand[] } => {
  const {
    importId,
    sourceBasename,
    sourceHash,
    sourceFormat,
    originalProfileVersion,
    profileName,
    decoderStatus,
    envelopeFormat,
    containerBasename,
    embeddedEntryName,
    packageEntries,
    embeddedProfiles,
    diagnostics,
    rawCommands,
  } = options;
  const draftCommands = finalizeCommandRecords(rawCommands, {
    sourceHash,
    sourceBasename,
    sourceFormat,
    decoderStatus,
    profileName,
  });
  const commandsById = new Map(
    draftCommands.map((entry) => [entry.command.commandId, entry.command]),
  );
  draftCommands.forEach((entry) => {
    entry.command.maxDurationMs = calculateCommandDuration(
      entry.command,
      commandsById,
    );
  });

  const previewProfile: AutomationProfile = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    profileId: "voiceattack-preview",
    displayName: `${profileName} (Imported Draft)`,
    description: "VoiceAttack import preview",
    enabled: false,
    processNames: [],
    commands: draftCommands.map((entry) => entry.command),
    importMetadata: {
      imported: true,
      importSource: "voiceattack",
      sourceBasename,
      sourceHash,
      importedAt: new Date().toISOString(),
      reviewStatus: "required",
      importWarnings: uniqueStrings(
        draftCommands.flatMap((entry) => entry.warnings),
      ),
      originalProfileVersion,
    },
  };

  const reviewReport = buildImportedProfileReviewReport(previewProfile);
  const actionTypeCounts = draftCommands.reduce<Record<string, number>>(
    (accumulator, entry) => {
      entry.actionTypeCounts.forEach((count, actionType) => {
        accumulator[actionType] = (accumulator[actionType] ?? 0) + count;
      });
      return accumulator;
    },
    {},
  );
  const commands = draftCommands.map((entry) => ({
    commandId: entry.command.commandId,
    sourceCommandId: entry.sourceCommandId,
    sourceCommandString: entry.sourceCommandString,
    label: entry.command.label,
    description: entry.command.description,
    aliases: [...entry.command.aliases],
    category: entry.command.category,
    triggerMode: entry.triggerMode,
    internalCommand: entry.internalCommand,
    supportStatus: entry.supportStatus,
    executability:
      entry.command.voiceAttack?.executability ?? "metadata_only",
    selectedByDefault: entry.selectedByDefault,
    enabledByDefault: entry.command.enabled,
    actionCount: entry.actionDetails.length,
    actionTypes: Array.from(entry.actionTypeCounts.keys()),
    actions: entry.actionDetails.map((action) => ({ ...action })),
    actionSummaries: [...entry.actionSummaries],
    warnings: [...entry.warnings],
    responsePlaceholderCount: entry.responsePlaceholderCount,
    unsupportedActionCount: entry.unsupportedActionCount,
    unresolvedNestedReferences: [...entry.unresolvedNestedReferences],
    recursiveReference: entry.recursiveReference,
    executableActionCount: entry.executableActionCount,
    keyInputCount: entry.keyInputCount,
    dependencyGraph: entry.command.voiceAttack?.dependencyGraph ?? null,
    semanticContract: entry.command.voiceAttack?.semanticContract ?? null,
  }));

  return {
    importId,
    candidateId: "",
    sourceBasename,
    sourceHash,
    sourceFormat,
    originalProfileVersion,
    profileName,
    decoderStatus,
    envelopeFormat,
    containerBasename,
    embeddedEntryName,
    packageEntries: packageEntries.map((entry) => ({ ...entry })),
    embeddedProfiles: embeddedProfiles.map((entry) => ({ ...entry })),
    diagnostics,
    commandCount: commands.length,
    supportedCommandCount: commands.filter(
      (entry) => entry.supportStatus === "supported",
    ).length,
    partiallySupportedCommandCount: commands.filter(
      (entry) => entry.supportStatus === "partially_supported",
    ).length,
    unsupportedCommandCount: commands.filter(
      (entry) => entry.supportStatus === "unsupported",
    ).length,
    responsePlaceholderCount: commands.reduce(
      (sum, entry) => sum + entry.responsePlaceholderCount,
      0,
    ),
    unresolvedNestedReferenceCount: commands.reduce(
      (sum, entry) => sum + entry.unresolvedNestedReferences.length,
      0,
    ),
    recursionWarningCount: commands.filter((entry) => entry.recursiveReference)
      .length,
    variablePluginWarningCount: draftCommands.filter(
      (entry) => entry.variableOrPluginWarning,
    ).length,
    unresolvedPluginCount: draftCommands.reduce(
      (sum, entry) => sum + entry.unresolvedPluginCount,
      0,
    ),
    unresolvedVariableCount: draftCommands.reduce(
      (sum, entry) => sum + entry.unresolvedVariableCount,
      0,
    ),
    actionTypeCounts,
    validationErrors: [...reviewReport.findings],
    warnings: uniqueStrings(draftCommands.flatMap((entry) => entry.warnings)),
    commands,
    draftCommands,
  };
};

const parseVapDocument = (
  document: Document,
  importId: string,
  sourceBasename: string,
  sourceHash: string,
  sourceFormat: VoiceAttackSourceFormat,
  options?: {
    containerBasename?: string | null;
    embeddedEntryName?: string | null;
    packageEntries?: VoiceAttackPackageEntrySummary[];
    embeddedProfiles?: VoiceAttackEmbeddedProfileSummary[];
    diagnostics?: VoiceAttackImportCandidateSummary["diagnostics"];
  },
): VoiceAttackProfilePreview & { draftCommands: ParsedDraftCommand[] } => {
  const profileElement = document.documentElement;
  const profileName =
    childText(profileElement, "Name") ??
    path.basename(sourceBasename, path.extname(sourceBasename));
  const originalProfileVersion = childText(profileElement, "ExportVAVersion");
  if (originalProfileVersion && !originalProfileVersion.startsWith("1.")) {
    throw new Error(
      `VoiceAttack export version "${originalProfileVersion}" is not supported.`,
    );
  }
  const commandContainer = firstChildElement(profileElement, "Commands");
  const commandElements = commandContainer
    ? childElements(commandContainer, "Command")
    : [];

  const commandIdSet = new Set<string>();
  const rawCommands: RawCommandRecord[] = commandElements.map(
    (commandElement, index) => {
      const sourceCommandString = childText(commandElement, "CommandString") ?? "";
      const phrases = normalizeCommandPhraseList(sourceCommandString);
      const spokenEnabled = childBoolean(commandElement, "UseSpokenPhrase");
      const useShortcut = childBoolean(commandElement, "UseShortcut") ?? false;
      const label =
        childText(commandElement, "Name") ??
        phrases[0] ??
        `Imported Command ${index + 1}`;
      const internalCommand = isInternalVoiceAttackCommandString(
        sourceCommandString || label,
      );
      const commandId = buildUniqueCommandId(label, commandIdSet);
      const aliases = uniqueStrings(
        phrases
          .slice(1)
          .map((phrase) => sanitizeAliasPhrase(phrase))
          .filter((phrase): phrase is string => Boolean(phrase)),
      );
      const warnings = new Set<string>();
      const actionTypeCategories = new Set<string>();
      const actionTypeCounts = new Map<string, number>();
      const actionDetails: VoiceAttackActionPreviewRecord[] = [];
      const actionSummaries: string[] = [];
      const pendingRunMacros: PendingRunMacroRecord[] = [];
      let responsePlaceholderCount = 0;
      let unsupportedActionCount = 0;
      let executableActionCount = 0;
      let keyInputCount = 0;
      let variableOrPluginWarning = false;
      let unresolvedPluginCount = 0;
      let unresolvedVariableCount = 0;

      const steps: AutomationAction[] = [];
      const actionTree: VoiceAttackNode[] = [];
      const actionSequence = firstChildElement(
        commandElement,
        "ActionSequence",
      );
      childElements(actionSequence ?? commandElement, "CommandAction").forEach(
        (actionElement, actionIndex) => {
          const actionType =
            childText(actionElement, "ActionType") ?? "Unknown";
          const parsedAction = parseXmlVoiceAttackAction(actionElement);
          actionTypeCategories.add(parsedAction.category);
          actionTypeCounts.set(
            parsedAction.actionTypeLabel,
            (actionTypeCounts.get(parsedAction.actionTypeLabel) ?? 0) + 1,
          );
          actionDetails.push({
            actionType: parsedAction.actionTypeLabel,
            summary: parsedAction.summary,
            supportStatus: parsedAction.supportStatus,
          });
          actionSummaries.push(parsedAction.summary);
          responsePlaceholderCount +=
            parsedAction.responsePlaceholderCount ?? 0;
          unsupportedActionCount += parsedAction.unsupportedActionCount ?? 0;
          executableActionCount += parsedAction.executableActionCount ?? 0;
          keyInputCount += parsedAction.keyInputCount ?? 0;
          unresolvedPluginCount += parsedAction.unresolvedPluginCount ?? 0;
          unresolvedVariableCount += parsedAction.unresolvedVariableCount ?? 0;
          variableOrPluginWarning =
            variableOrPluginWarning ||
            parsedAction.variableOrPluginWarning === true;
          steps.push(...parsedAction.steps);
          actionTree.push(
            ...createXmlActionTreeRecord(actionType, actionIndex, parsedAction),
          );
          if (parsedAction.pendingRunMacroTarget) {
            pendingRunMacros.push({
              insertIndex: steps.length,
              targetPhrase: parsedAction.pendingRunMacroTarget,
              targetSourceCommandId: null,
              summary: parsedAction.summary,
              nodeId:
                actionTree[actionTree.length - 1]?.kind === "execute_command"
                  ? actionTree[actionTree.length - 1].nodeId
                  : null,
            });
          }
          if (parsedAction.unresolvedNestedReference) {
            warnings.add(
              "Some nested VoiceAttack commands could not be resolved automatically.",
            );
          }
        },
      );

      const command: AutomationCommand = {
        commandId,
        label,
        description: childText(commandElement, "Description") ?? "",
        aliases,
        category: childText(commandElement, "Category") ?? PREVIEW_CATEGORY,
        enabled: false,
        cooldownMs: 0,
        maxDurationMs: 5_000,
        riskLevel: executableActionCount > 0 ? "low" : "harmless",
        allowedTriggerSources: ["manual"],
        autonomyPolicy: "disabled",
        confirmationPolicy: "always",
        concurrencyPolicy: "reject_duplicates",
        defaultDryRun: true,
        steps,
      };

      return {
        sourceCommandId: childText(commandElement, "Id"),
        sourceCommandString,
        sourceLabel: childText(commandElement, "Name"),
        originalLabel: label,
        description: command.description,
        category: command.category,
        phrases,
        triggerMode: determineTriggerMode({
          useSpokenPhrase: spokenEnabled,
          useShortcut,
          phrases,
        }),
        warnings,
        actionTypeCategories,
        actionTypeCounts,
        actionDetails,
        actionSummaries,
        responsePlaceholderCount,
        unsupportedActionCount,
        unresolvedNestedReferences: [],
        recursiveReference: false,
        executableActionCount,
        keyInputCount,
        variableOrPluginWarning,
        unresolvedPluginCount,
        unresolvedVariableCount,
        repeatNumber: Math.max(
          1,
          Math.round(childNumber(commandElement, "RepeatNumber") ?? 1),
        ),
        repeatType: childText(commandElement, "RepeatType"),
        internalCommand,
        command,
        pendingRunMacros,
        actionTree,
        directDependencyReferences: [],
        directPluginDependencies: [],
      };
    },
  );

  return buildVoiceAttackPreviewFromRawCommands({
    importId,
    sourceBasename,
    sourceHash,
    sourceFormat,
    originalProfileVersion,
    profileName,
    decoderStatus: "xml_document",
    envelopeFormat: buildEnvelopeFormatLabel(
      sourceFormat,
      options?.diagnostics ?? null,
    ),
    containerBasename: options?.containerBasename ?? null,
    embeddedEntryName: options?.embeddedEntryName ?? null,
    packageEntries: options?.packageEntries ?? [],
    embeddedProfiles: options?.embeddedProfiles ?? [],
    diagnostics: options?.diagnostics ?? null,
    rawCommands,
  });
};

const parseNeutralProfile = (
  inspection: VoiceAttackBinaryInspectionResult,
  importId: string,
  sourceBasename: string,
  sourceHash: string,
  sourceFormat: VoiceAttackSourceFormat,
  options?: {
    containerBasename?: string | null;
    embeddedEntryName?: string | null;
    packageEntries?: VoiceAttackPackageEntrySummary[];
    embeddedProfiles?: VoiceAttackEmbeddedProfileSummary[];
  },
): VoiceAttackProfilePreview & { draftCommands: ParsedDraftCommand[] } => {
  const startedAt = Date.now();
  const profile: VoiceAttackNeutralProfile = inspection.profile;
  console.error("[voiceattack:importer:neutral:start]", {
    sourceBasename,
    profileName: profile.name,
    commandCount: profile.commands.length,
  });
  const commandIdSet = new Set<string>();
  const rawCommands: RawCommandRecord[] = profile.commands.map(
    (command, index) => {
      const commandStartedAt = Date.now();
      if (index === 0 || index % 100 === 0) {
        console.error("[voiceattack:importer:neutral:command:start]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          total: profile.commands.length,
          actionCount: command.actions.length,
          commandTypeName: command.commandTypeName,
        });
      }
      const traceCommandStages = index === 0;
      const sourceCommandString = command.commandString;
      if (traceCommandStages) {
        console.error("[voiceattack:importer:neutral:command:phrase:start]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          commandStringLength: sourceCommandString.length,
        });
      }
      const phrases = normalizeCommandPhraseList(sourceCommandString);
      if (traceCommandStages) {
        console.error("[voiceattack:importer:neutral:command:phrase:done]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          phraseCount: phrases.length,
        });
      }
      const label =
        command.label?.trim() || phrases[0] || `Imported Command ${index + 1}`;
      const internalCommand = isInternalVoiceAttackCommandString(
        sourceCommandString || label,
      );
      const commandId = buildUniqueCommandId(label, commandIdSet);
      const aliases = uniqueStrings(
        phrases
          .slice(1)
          .map((phrase) => sanitizeAliasPhrase(phrase))
          .filter((phrase): phrase is string => Boolean(phrase)),
      );
      const warnings = new Set<string>();
      const actionTypeCategories = new Set<string>();
      const actionTypeCounts = new Map<string, number>();
      const actionDetails: VoiceAttackActionPreviewRecord[] = [];
      const actionSummaries: string[] = [];
      const pendingRunMacros: PendingRunMacroRecord[] = [];
      let responsePlaceholderCount = 0;
      let unsupportedActionCount = 0;
      let executableActionCount = 0;
      let keyInputCount = 0;
      let variableOrPluginWarning = false;
      let unresolvedPluginCount = 0;
      let unresolvedVariableCount = 0;

      const steps: AutomationAction[] = [];
      if (traceCommandStages) {
        console.error("[voiceattack:importer:neutral:command:tree:start]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          actionCount: command.actions.length,
        });
      }
      const actionTree = buildNeutralActionTree(command.actions, {
        sourceBasename,
        commandIndex: index,
        startedAt,
      });
      if (traceCommandStages) {
        console.error("[voiceattack:importer:neutral:command:tree:done]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          nodeCount: actionTree.length,
        });
      }
      command.actions.forEach((action) => {
        if (traceCommandStages) {
          console.error("[voiceattack:importer:neutral:action:start]", {
            sourceBasename,
            elapsedMs: Date.now() - startedAt,
            commandIndex: index,
            actionTypeName: action.actionTypeName,
            keyCodeCount: action.keyCodes.length,
          });
        }
        const parsedAction = parseNeutralVoiceAttackAction(action);
        if (traceCommandStages) {
          console.error("[voiceattack:importer:neutral:action:done]", {
            sourceBasename,
            elapsedMs: Date.now() - startedAt,
            commandIndex: index,
            actionTypeName: action.actionTypeName,
            stepCount: parsedAction.steps.length,
          });
        }
        actionTypeCategories.add(parsedAction.category);
        actionTypeCounts.set(
          parsedAction.actionTypeLabel,
          (actionTypeCounts.get(parsedAction.actionTypeLabel) ?? 0) + 1,
        );
        actionDetails.push({
          actionType: parsedAction.actionTypeLabel,
          summary: parsedAction.summary,
          supportStatus: parsedAction.supportStatus,
        });
        actionSummaries.push(parsedAction.summary);
        responsePlaceholderCount += parsedAction.responsePlaceholderCount ?? 0;
        unsupportedActionCount += parsedAction.unsupportedActionCount ?? 0;
        executableActionCount += parsedAction.executableActionCount ?? 0;
        keyInputCount += parsedAction.keyInputCount ?? 0;
        unresolvedPluginCount += parsedAction.unresolvedPluginCount ?? 0;
        unresolvedVariableCount += parsedAction.unresolvedVariableCount ?? 0;
        variableOrPluginWarning =
          variableOrPluginWarning ||
          parsedAction.variableOrPluginWarning === true;
        steps.push(...parsedAction.steps);
        if (parsedAction.pendingRunMacroTarget) {
          pendingRunMacros.push({
            insertIndex: steps.length,
            targetPhrase: parsedAction.pendingRunMacroTarget,
            targetSourceCommandId:
              action.context && action.context !== ALL_ZERO_GUID
                ? action.context
                : null,
            summary: parsedAction.summary,
            nodeId: null,
          });
        }
        if (action.unknownFields.length > 0) {
          warnings.add(
            "Some binary VoiceAttack action fields were preserved for manual review.",
          );
        }
      });

      if (
        command.useVariableHotkey ||
        command.useVariableMouseShortcut ||
        command.useVariableJoystickShortcut
      ) {
        warnings.add(
          "Variable-based VoiceAttack shortcuts require manual review.",
        );
        variableOrPluginWarning = true;
        unresolvedVariableCount += 1;
      }
      if (command.unknownFields.length > 0) {
        warnings.add(
          "Some binary VoiceAttack command fields were preserved for manual review.",
        );
      }
      if (command.useProcessOverride && command.processOverride) {
        warnings.add(
          "VoiceAttack process overrides are not applied automatically during import.",
        );
      }

      const automationCommand: AutomationCommand = {
        commandId,
        label,
        description: command.description ?? "",
        aliases,
        category: command.category?.trim() || PREVIEW_CATEGORY,
        enabled: false,
        cooldownMs: 0,
        maxDurationMs: 5_000,
        riskLevel: executableActionCount > 0 ? "low" : "harmless",
        allowedTriggerSources: ["manual"],
        autonomyPolicy: "disabled",
        confirmationPolicy: "always",
        concurrencyPolicy: "reject_duplicates",
        defaultDryRun: true,
        steps,
      };

      const rawCommand: RawCommandRecord = {
        sourceCommandId: command.commandId,
        sourceCommandString,
        sourceLabel: command.label ?? null,
        originalLabel: label,
        description: automationCommand.description,
        category: automationCommand.category,
        phrases,
        triggerMode: determineTriggerMode({
          useSpokenPhrase: command.useSpokenPhrase,
          useShortcut: command.useShortcut,
          phrases,
        }),
        warnings,
        actionTypeCategories,
        actionTypeCounts,
        actionDetails,
        actionSummaries,
        responsePlaceholderCount,
        unsupportedActionCount,
        unresolvedNestedReferences: [],
        recursiveReference: false,
        executableActionCount,
        keyInputCount,
        variableOrPluginWarning,
        unresolvedPluginCount,
        unresolvedVariableCount,
        repeatNumber: command.repeatNumber,
        repeatType: String(command.repeatType),
        internalCommand,
        command: automationCommand,
        pendingRunMacros,
        actionTree,
        directDependencyReferences: [],
        directPluginDependencies: [],
      };
      const commandElapsedMs = Date.now() - commandStartedAt;
      if (commandElapsedMs > 250) {
        console.error("[voiceattack:importer:neutral:command:slow]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          index,
          actionCount: command.actions.length,
          commandElapsedMs,
          commandTypeName: command.commandTypeName,
        });
      }
      if (index === profile.commands.length - 1 || (index + 1) % 100 === 0) {
        console.error("[voiceattack:importer:neutral:command:progress]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
          completed: index + 1,
          total: profile.commands.length,
        });
      }
      return rawCommand;
    },
  );
  console.error("[voiceattack:importer:neutral:raw-commands-built]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    rawCommandCount: rawCommands.length,
    actionCount: profile.commands.reduce(
      (total, command) => total + command.actions.length,
      0,
    ),
  });

  const preview = buildVoiceAttackPreviewFromRawCommands({
    importId,
    sourceBasename,
    sourceHash,
    sourceFormat,
    originalProfileVersion: profile.exportVersion,
    profileName: profile.name,
    decoderStatus: "binary_profile2_manual_schema",
    envelopeFormat: buildEnvelopeFormatLabel(
      sourceFormat,
      inspection.diagnostics,
    ),
    containerBasename: options?.containerBasename ?? null,
    embeddedEntryName: options?.embeddedEntryName ?? null,
    packageEntries: options?.packageEntries ?? [],
    embeddedProfiles: options?.embeddedProfiles ?? [],
    diagnostics: inspection.diagnostics,
    rawCommands,
  });
  console.error("[voiceattack:importer:neutral:preview-built]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    commandCount: preview.commandCount,
    supportedCommandCount: preview.supportedCommandCount,
    partiallySupportedCommandCount: preview.partiallySupportedCommandCount,
    unsupportedCommandCount: preview.unsupportedCommandCount,
  });
  return preview;
};

const buildParseableCandidateRecord = (options: {
  sourcePath: string;
  sourceBasename: string;
  extension: string;
  sourceHash: string;
  sourceFormat: VoiceAttackSourceFormat;
  encrypted: boolean;
  containerBasename?: string | null;
  embeddedEntryName?: string | null;
  packageEntries?: VoiceAttackPackageEntrySummary[];
  embeddedProfiles?: VoiceAttackEmbeddedProfileSummary[];
  preview: VoiceAttackProfilePreview & { draftCommands: ParsedDraftCommand[] };
}): ImportCandidateRecord => {
  const {
    sourcePath,
    sourceBasename,
    extension,
    sourceHash,
    sourceFormat,
    encrypted,
    containerBasename,
    embeddedEntryName,
    packageEntries,
    embeddedProfiles,
    preview,
  } = options;
  const candidateId = randomUUID();
  const actionTypeCategories = uniqueStrings(
    preview.draftCommands.flatMap((entry) => entry.actionTypeCategories),
  );
  const candidatePreview: VoiceAttackProfilePreview = {
    ...preview,
    candidateId,
  };
  return {
    sourcePath,
    sourceBasename,
    extension,
    sourceHash,
    sourceFormat,
    encrypted,
    containerBasename: containerBasename ?? null,
    embeddedEntryName: embeddedEntryName ?? null,
    packageEntries: packageEntries?.map((entry) => ({ ...entry })) ?? [],
    embeddedProfiles: embeddedProfiles?.map((entry) => ({ ...entry })) ?? [],
    decoderStatus: preview.decoderStatus,
    envelopeFormat: preview.envelopeFormat,
    profileName: preview.profileName,
    originalProfileVersion: preview.originalProfileVersion,
    preview: candidatePreview,
    summary: {
      candidateId,
      sourceBasename,
      extension,
      sourceFormat,
      parseable: true,
      encrypted,
      profileName: preview.profileName,
      originalProfileVersion: preview.originalProfileVersion,
      commandCount: preview.commandCount,
      supportedCommandCount: preview.supportedCommandCount,
      partiallySupportedCommandCount: preview.partiallySupportedCommandCount,
      unsupportedCommandCount: preview.unsupportedCommandCount,
      responsePlaceholderCount: preview.responsePlaceholderCount,
      unresolvedNestedReferenceCount: preview.unresolvedNestedReferenceCount,
      recursionWarningCount: preview.recursionWarningCount,
      variablePluginWarningCount: preview.variablePluginWarningCount,
      unresolvedPluginCount: preview.unresolvedPluginCount,
      unresolvedVariableCount: preview.unresolvedVariableCount,
      actionTypeCategories,
      actionTypeCounts: { ...preview.actionTypeCounts },
      decoderStatus: preview.decoderStatus,
      envelopeFormat: preview.envelopeFormat,
      containerBasename: containerBasename ?? null,
      embeddedEntryName: embeddedEntryName ?? null,
      packageEntries: packageEntries?.map((entry) => ({ ...entry })) ?? [],
      embeddedProfiles: embeddedProfiles?.map((entry) => ({ ...entry })) ?? [],
      diagnostics: cloneDiagnostics(preview.diagnostics, false),
      parseError: null,
    },
  };
};

const buildUnparseableCandidateRecord = (options: {
  sourcePath: string;
  sourceBasename: string;
  extension: string;
  sourceHash: string;
  sourceFormat: VoiceAttackSourceFormat;
  encrypted: boolean;
  parseError: string;
  decoderStatus?: string;
  containerBasename?: string | null;
  embeddedEntryName?: string | null;
  packageEntries?: VoiceAttackPackageEntrySummary[];
  embeddedProfiles?: VoiceAttackEmbeddedProfileSummary[];
  diagnostics?: VoiceAttackImportCandidateSummary["diagnostics"];
}): ImportCandidateRecord => ({
  sourcePath: options.sourcePath,
  sourceBasename: options.sourceBasename,
  extension: options.extension,
  sourceHash: options.sourceHash,
  sourceFormat: options.sourceFormat,
  encrypted: options.encrypted,
  containerBasename: options.containerBasename ?? null,
  embeddedEntryName: options.embeddedEntryName ?? null,
  packageEntries: options.packageEntries?.map((entry) => ({ ...entry })) ?? [],
  embeddedProfiles:
    options.embeddedProfiles?.map((entry) => ({ ...entry })) ?? [],
  decoderStatus: options.decoderStatus ?? "unsupported",
  envelopeFormat: buildEnvelopeFormatLabel(
    options.sourceFormat,
    options.diagnostics ?? null,
  ),
  profileName: null,
  originalProfileVersion: null,
  preview: null,
  summary: {
    candidateId: randomUUID(),
    sourceBasename: options.sourceBasename,
    extension: options.extension,
    sourceFormat: options.sourceFormat,
    parseable: false,
    encrypted: options.encrypted,
    profileName: null,
    originalProfileVersion: null,
    commandCount: 0,
    supportedCommandCount: 0,
    partiallySupportedCommandCount: 0,
    unsupportedCommandCount: 0,
    responsePlaceholderCount: 0,
    unresolvedNestedReferenceCount: 0,
    recursionWarningCount: 0,
    variablePluginWarningCount: 0,
    unresolvedPluginCount: 0,
    unresolvedVariableCount: 0,
    actionTypeCategories: [],
    actionTypeCounts: {},
    decoderStatus: options.decoderStatus ?? "unsupported",
    envelopeFormat: buildEnvelopeFormatLabel(
      options.sourceFormat,
      options.diagnostics ?? null,
    ),
    containerBasename: options.containerBasename ?? null,
    embeddedEntryName: options.embeddedEntryName ?? null,
    packageEntries:
      options.packageEntries?.map((entry) => ({ ...entry })) ?? [],
    embeddedProfiles:
      options.embeddedProfiles?.map((entry) => ({ ...entry })) ?? [],
    diagnostics: cloneDiagnostics(options.diagnostics ?? null, false),
    parseError: options.parseError,
  },
});

const cloneDiagnostics = (
  diagnostics: VoiceAttackImportCandidateSummary["diagnostics"],
  includePrintableStrings = false,
): VoiceAttackImportCandidateSummary["diagnostics"] =>
  diagnostics
    ? {
        ...diagnostics,
        propertyOffsets: [...diagnostics.propertyOffsets],
        printableStrings: includePrintableStrings
          ? diagnostics.printableStrings.map((entry) => ({ ...entry }))
          : [],
        repeatedStructuralSignatures:
          diagnostics.repeatedStructuralSignatures.map((entry) => ({
            ...entry,
          })),
      }
    : null;

const inspectVapFile = async (
  filePath: string,
  importId: string,
): Promise<ImportCandidateRecord[]> => {
  const startedAt = Date.now();
  const sourceBasename = redactSourceLabel(filePath);
  console.error("[voiceattack:importer:vap:start]", {
    sourceBasename,
  });
  const buffer = await fs.readFile(filePath);
  console.error("[voiceattack:importer:vap:file-read]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    bytes: buffer.length,
  });
  const sourceHash = hashBuffer(buffer);
  const detected = inspectVoiceAttackBufferFormat(buffer);
  console.error("[voiceattack:importer:vap:format-detected]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    sourceFormat: detected.sourceFormat,
    compressedSize: detected.diagnostics.compressedSize,
    inflatedSize: detected.diagnostics.inflatedSize,
    lastPropertyIndex: detected.diagnostics.lastPropertyIndex,
  });

  if (detected.sourceFormat === "xml" && detected.decodedXml) {
    try {
      const document = parseXmlDocument(detected.decodedXml, sourceBasename);
      const preview = parseVapDocument(
        document,
        importId,
        sourceBasename,
        sourceHash,
        "vap_xml",
        { diagnostics: detected.diagnostics },
      );
      return [
        buildParseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename,
          extension: path.extname(filePath).toLowerCase(),
          sourceHash,
          sourceFormat: "vap_xml",
          encrypted: false,
          preview,
        }),
      ];
    } catch (error) {
      return [
        buildUnparseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename,
          extension: path.extname(filePath).toLowerCase(),
          sourceHash,
          sourceFormat: "vap_xml",
          encrypted: false,
          diagnostics: detected.diagnostics,
          parseError:
            error instanceof Error
              ? error.message
              : `Unable to parse "${sourceBasename}".`,
        }),
      ];
    }
  }

    if (detected.sourceFormat === "binary_deflate_profile2") {
      try {
        console.error("[voiceattack:importer:vap:binary-preview:start]", {
          sourceBasename,
          elapsedMs: Date.now() - startedAt,
      });
      const preview = parseNeutralProfile(
        inspectBinaryVoiceAttackBuffer(buffer, sourceBasename),
        importId,
        sourceBasename,
        sourceHash,
        "vap_wrapped_binary",
      );
      return [
        buildParseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename,
          extension: path.extname(filePath).toLowerCase(),
          sourceHash,
          sourceFormat: "vap_wrapped_binary",
          encrypted: false,
          preview,
        }),
      ];
    } catch (error) {
      console.error("[voiceattack:importer:vap:binary-preview:error]", {
        sourceBasename,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      return [
        buildUnparseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename,
          extension: path.extname(filePath).toLowerCase(),
          sourceHash,
          sourceFormat: "vap_wrapped_binary",
          encrypted: false,
          diagnostics: detected.diagnostics,
          decoderStatus: "binary_profile2_failed",
          parseError:
            error instanceof Error
              ? error.message
              : `Unable to parse "${sourceBasename}".`,
        }),
      ];
    }
  }

  return [
    buildUnparseableCandidateRecord({
      sourcePath: filePath,
      sourceBasename,
      extension: path.extname(filePath).toLowerCase(),
      sourceHash,
      sourceFormat: "unknown",
      encrypted: false,
      diagnostics: detected.diagnostics,
      parseError: `The VoiceAttack payload in "${sourceBasename}" is not recognized as XML or a supported binary profile.`,
    }),
  ];
};

const inspectVaxFile = async (
  filePath: string,
  importId: string,
): Promise<ImportCandidateRecord[]> => {
  const startedAt = Date.now();
  const sourceBasename = redactSourceLabel(filePath);
  console.error("[voiceattack:importer:vax:start]", {
    sourceBasename,
  });
  const archiveBuffer = await fs.readFile(filePath);
  console.error("[voiceattack:importer:vax:file-read]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    bytes: archiveBuffer.length,
  });
  const archiveHash = hashBuffer(archiveBuffer);
  const packageInspection = await inspectVoiceAttackPackageFile(filePath);
  console.error("[voiceattack:importer:vax:package-inspected]", {
    sourceBasename,
    elapsedMs: Date.now() - startedAt,
    entries: packageInspection.packageEntries.length,
    embeddedProfiles: packageInspection.embeddedProfiles.length,
  });
  const packageEntries = packageInspection.packageEntries.map((entry) => ({
    ...entry,
  }));

  if (packageInspection.embeddedProfiles.length === 0) {
    return [
      buildUnparseableCandidateRecord({
        sourcePath: filePath,
        sourceBasename,
        extension: ".vax",
        sourceHash: archiveHash,
        sourceFormat: "vax_container",
        encrypted: false,
        packageEntries,
        embeddedProfiles: [],
        parseError: `The VoiceAttack archive "${sourceBasename}" did not contain an embedded .vap profile.`,
      }),
    ];
  }

  const provisionalResults = packageInspection.embeddedProfiles.map((entry) => {
    const entryBasename = path.posix.basename(entry.entryName);
    const detected = inspectVoiceAttackBufferFormat(entry.sourceBuffer);

    if (detected.sourceFormat === "xml" && detected.decodedXml) {
      try {
        const preview = parseVapDocument(
          parseXmlDocument(detected.decodedXml, entryBasename),
          importId,
          entryBasename,
          entry.sourceHash,
          "vax_container",
          {
            containerBasename: sourceBasename,
            embeddedEntryName: entry.entryName,
            packageEntries,
            diagnostics: detected.diagnostics,
          },
        );
        return {
          entry,
          sourceBasename: entryBasename,
          sourceFormat: "vax_container" as VoiceAttackSourceFormat,
          parseable: true,
          decoderStatus: preview.decoderStatus,
          diagnostics: detected.diagnostics,
          preview,
          parseError: null as string | null,
        };
      } catch (error) {
        return {
          entry,
          sourceBasename: entryBasename,
          sourceFormat: "vax_container" as VoiceAttackSourceFormat,
          parseable: false,
          decoderStatus: "xml_failed",
          diagnostics: detected.diagnostics,
          preview: null,
          parseError:
            error instanceof Error
              ? error.message
              : `Unable to parse "${entryBasename}".`,
        };
      }
    }

    if (detected.sourceFormat === "binary_deflate_profile2") {
      try {
        console.error("[voiceattack:importer:vax:binary-preview:start]", {
          sourceBasename: entryBasename,
          containerBasename: sourceBasename,
          elapsedMs: Date.now() - startedAt,
        });
        const preview = parseNeutralProfile(
          inspectBinaryVoiceAttackBuffer(entry.sourceBuffer, entryBasename),
          importId,
          entryBasename,
          entry.sourceHash,
          "vax_wrapped_binary",
          {
            containerBasename: sourceBasename,
            embeddedEntryName: entry.entryName,
            packageEntries,
          },
        );
        return {
          entry,
          sourceBasename: entryBasename,
          sourceFormat: "vax_wrapped_binary" as VoiceAttackSourceFormat,
          parseable: true,
          decoderStatus: preview.decoderStatus,
          diagnostics: preview.diagnostics,
          preview,
          parseError: null as string | null,
        };
      } catch (error) {
        console.error("[voiceattack:importer:vax:binary-preview:error]", {
          sourceBasename: entryBasename,
          containerBasename: sourceBasename,
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          entry,
          sourceBasename: entryBasename,
          sourceFormat: "vax_wrapped_binary" as VoiceAttackSourceFormat,
          parseable: false,
          decoderStatus: "binary_profile2_failed",
          diagnostics: detected.diagnostics,
          preview: null,
          parseError:
            error instanceof Error
              ? error.message
              : `Unable to parse "${entryBasename}".`,
        };
      }
    }

    return {
      entry,
      sourceBasename: entryBasename,
      sourceFormat: "vax_wrapped_binary" as VoiceAttackSourceFormat,
      parseable: false,
      decoderStatus: "unsupported",
      diagnostics: detected.diagnostics,
      preview: null,
      parseError: `The embedded VoiceAttack payload "${entryBasename}" is not recognized as XML or a supported binary profile.`,
    };
  });

  const embeddedProfiles: VoiceAttackEmbeddedProfileSummary[] =
    provisionalResults.map((result) => ({
      entryName: result.entry.entryName,
      sourceFormat: result.sourceFormat,
      parseable: result.parseable,
      profileName: result.preview?.profileName ?? null,
      decoderStatus: result.decoderStatus,
    }));

  return provisionalResults.map((result) =>
    result.parseable && result.preview
      ? buildParseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename: result.sourceBasename,
          extension: ".vax",
          sourceHash: result.entry.sourceHash,
          sourceFormat: result.sourceFormat,
          encrypted: false,
          containerBasename: sourceBasename,
          embeddedEntryName: result.entry.entryName,
          packageEntries,
          embeddedProfiles,
          preview: {
            ...result.preview,
            embeddedProfiles,
            packageEntries,
          },
        })
      : buildUnparseableCandidateRecord({
          sourcePath: filePath,
          sourceBasename: result.sourceBasename,
          extension: ".vax",
          sourceHash: result.entry.sourceHash,
          sourceFormat: result.sourceFormat,
          encrypted: false,
          containerBasename: sourceBasename,
          embeddedEntryName: result.entry.entryName,
          packageEntries,
          embeddedProfiles,
          diagnostics: result.diagnostics,
          decoderStatus: result.decoderStatus,
          parseError:
            result.parseError ?? `Unable to parse "${result.sourceBasename}".`,
        }),
  );
};

const collectCandidatePaths = async (
  selectedPath: string,
  signal: AbortSignal,
): Promise<{
  sourceKind: "file" | "directory";
  files: string[];
}> => {
  const stat = await fs.stat(selectedPath);
  if (stat.isFile()) {
    return { sourceKind: "file", files: [selectedPath] };
  }

  const queue = [selectedPath];
  const files: string[] = [];
  while (queue.length > 0) {
    throwIfAborted(signal);
    const currentPath = queue.shift() as string;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    });
  }
  return { sourceKind: "directory", files };
};

export const inspectVoiceAttackSourcePath = async (
  selectedPath: string,
  signal: AbortSignal,
): Promise<VoiceAttackImportSessionData> => {
  const importId = randomUUID();
  const { sourceKind, files } = await collectCandidatePaths(
    selectedPath,
    signal,
  );
  const candidatePaths = files.filter((filePath) =>
    CANDIDATE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
  );

  const candidates = new Map<string, ImportCandidateRecord>();
  for (const filePath of candidatePaths) {
    throwIfAborted(signal);
    const extension = path.extname(filePath).toLowerCase();
    const inspectedCandidates =
      extension === ".vap"
        ? await inspectVapFile(filePath, importId)
        : await inspectVaxFile(filePath, importId);
    inspectedCandidates.forEach((candidate) => {
      candidates.set(candidate.summary.candidateId, candidate);
    });
  }

  const summaries = Array.from(candidates.values()).map(
    (entry) => entry.summary,
  );
  const previews = Array.from(candidates.values())
    .map((entry) => entry.preview)
    .filter((entry): entry is VoiceAttackProfilePreview => Boolean(entry));

  const actionTypeCategories = uniqueStrings(
    summaries.flatMap((entry) => entry.actionTypeCategories),
  );
  const supportedImportCategories = actionTypeCategories.filter((category) =>
    SUPPORTED_IMPORT_CATEGORIES.has(category),
  );
  const partiallySupportedCategories = actionTypeCategories.filter((category) =>
    PARTIALLY_SUPPORTED_IMPORT_CATEGORIES.has(category),
  );
  const unsupportedCategories = actionTypeCategories.filter(
    (category) =>
      !SUPPORTED_IMPORT_CATEGORIES.has(category) &&
      !PARTIALLY_SUPPORTED_IMPORT_CATEGORIES.has(category),
  );

  const inspection: VoiceAttackInspectionResult = {
    importId,
    sourceBasename: redactSourceLabel(selectedPath),
    sourceKind,
    candidateProfileCount: summaries.length,
    parseableFileCount: summaries.filter((entry) => entry.parseable).length,
    unparseableFileCount: summaries.filter((entry) => !entry.parseable).length,
    formatsDiscovered: uniqueStrings(
      summaries.map((entry) => entry.sourceFormat),
    ) as VoiceAttackSourceFormat[],
    actionTypeCategories,
    supportedImportCategories,
    partiallySupportedCategories,
    unsupportedCategories,
    candidates: summaries.sort((left, right) =>
      left.sourceBasename.localeCompare(right.sourceBasename),
    ),
  };

  return {
    importId,
    sourceBasename: inspection.sourceBasename,
    sourceKind,
    inspection,
    candidates,
  };
};

export const getVoiceAttackPreview = (
  session: VoiceAttackImportSessionData,
  candidateId: string,
): VoiceAttackProfilePreview => {
  const candidate = session.candidates.get(candidateId);
  if (!candidate || !candidate.preview) {
    throw new Error("The selected VoiceAttack profile could not be previewed.");
  }
  const preview = structuredClone(
    candidate.preview,
  ) as VoiceAttackProfilePreview & { draftCommands?: ParsedDraftCommand[] };
  delete preview.draftCommands;
  preview.packageEntries = preview.packageEntries.map((entry) => ({
    ...entry,
  }));
  preview.embeddedProfiles = preview.embeddedProfiles.map((entry) => ({
    ...entry,
  }));
  preview.diagnostics = cloneDiagnostics(preview.diagnostics, false);
  return preview;
};

export const buildVoiceAttackDiagnosticReport = (
  session: VoiceAttackImportSessionData,
  candidateId: string,
): Record<string, unknown> => {
  const candidate = session.candidates.get(candidateId);
  if (!candidate) {
    throw new Error(
      "The selected VoiceAttack profile could not be found for report export.",
    );
  }

  const summary = structuredClone(candidate.summary);
  summary.diagnostics = cloneDiagnostics(
    candidate.preview?.diagnostics ?? candidate.summary.diagnostics,
    true,
  );

  const preview = candidate.preview
    ? (structuredClone(candidate.preview) as VoiceAttackProfilePreview & {
        draftCommands?: ParsedDraftCommand[];
      })
    : null;
  if (preview) {
    delete preview.draftCommands;
    preview.diagnostics = cloneDiagnostics(
      candidate.preview?.diagnostics ?? null,
      true,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    importId: session.importId,
    sourceBasename: session.sourceBasename,
    sourceKind: session.sourceKind,
    selectedCandidateId: candidateId,
    candidate: summary,
    preview,
  };
};

export const buildVoiceAttackImportedProfile = (
  session: VoiceAttackImportSessionData,
  request: VoiceAttackImportRequest,
  existingProfileIds: Iterable<string>,
): {
  profile: AutomationProfile;
  result: VoiceAttackImportProfileResult;
} => {
  const candidate = session.candidates.get(request.candidateId);
  if (!candidate || !candidate.preview) {
    throw new Error("The selected VoiceAttack profile is not importable.");
  }

  const selectedIds = new Set(
    request.selectedCommandIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
  if (selectedIds.size === 0) {
    throw new Error("Select at least one VoiceAttack command to import.");
  }

  const selectedCommands = candidate.preview.commands.filter((entry) =>
    selectedIds.has(entry.commandId),
  );
  if (selectedCommands.length === 0) {
    throw new Error(
      "The selected VoiceAttack commands were not found in the preview.",
    );
  }

  const storedPreview = candidate.preview as VoiceAttackProfilePreview & {
    draftCommands?: ParsedDraftCommand[];
  };
  const draftByCommandId = new Map(
    (storedPreview.draftCommands ?? []).map((entry) => [
      entry.command.commandId,
      entry,
    ]),
  );
  const expandedSelectedIds = new Set(selectedIds);
  const pendingCommandIds = [...selectedIds];
  while (pendingCommandIds.length > 0) {
    const commandId = pendingCommandIds.shift() as string;
    const draft = draftByCommandId.get(commandId);
    if (!draft) {
      continue;
    }
    const dependencyIds = new Set<string>([
      ...(draft.command.voiceAttack?.dependencyGraph.directDependencyCommandIds ??
        []),
      ...draft.command.steps
        .filter((step): step is Extract<AutomationAction, { type: "run_macro" }> => step.type === "run_macro")
        .map((step) => step.commandId),
    ]);
    dependencyIds.forEach((dependencyId) => {
      if (expandedSelectedIds.has(dependencyId)) {
        return;
      }
      expandedSelectedIds.add(dependencyId);
      pendingCommandIds.push(dependencyId);
    });
  }

  const autoIncludedNestedCommands =
    expandedSelectedIds.size > selectedIds.size;
  const draftCommands = candidate.preview.commands
    .filter((entry) => expandedSelectedIds.has(entry.commandId))
    .map((entry) => {
      const draft = draftByCommandId.get(entry.commandId);
      if (!draft) {
        throw new Error(
          "The selected VoiceAttack command preview is incomplete.",
        );
      }
      return draft;
    });

  const profileId = buildUniqueProfileId(
    request.profileId,
    request.displayName?.trim() || candidate.preview.profileName,
    new Set(existingProfileIds),
  );
  const displayName =
    request.displayName?.trim() ||
    `${candidate.preview.profileName} (Imported Draft)`;

  const importedAt = new Date().toISOString();
  const importMetadata: AutomationImportedProfileMetadata = {
    imported: true,
    importSource: "voiceattack",
    sourceBasename: getCandidateImportSourceLabel(candidate),
    sourceHash: candidate.sourceHash,
    importedAt,
    reviewStatus: "required",
    importWarnings: uniqueStrings([
      ...draftCommands.flatMap((entry) => entry.warnings),
      ...(autoIncludedNestedCommands
        ? [
            "Nested VoiceAttack command dependencies were included automatically to preserve command order and references.",
          ]
        : []),
    ]),
    originalProfileVersion: candidate.originalProfileVersion,
  };

  const profile: AutomationProfile = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    profileId,
    displayName,
    description: "Imported from VoiceAttack. Review required before enabling.",
    enabled: false,
    processNames: [],
    commands: draftCommands.map((entry) => ({
      ...entry.command,
      aliases: [...entry.command.aliases],
      steps: entry.command.steps.map((step) => ({ ...step })),
      voiceAttack: entry.command.voiceAttack
        ? structuredClone(entry.command.voiceAttack)
        : undefined,
    })),
    importMetadata,
  };

  const reviewReport = buildImportedProfileReviewReport(profile);
  const result: VoiceAttackImportProfileResult = {
    profileId,
    displayName,
    importedCommandCount: profile.commands.length,
    supportedCommandCount: reviewReport.supportedCommandCount,
    partiallySupportedCommandCount: reviewReport.partiallySupportedCommandCount,
    unsupportedCommandCount: reviewReport.unsupportedCommandCount,
    responsePlaceholderCount: reviewReport.responsePlaceholderCount,
    reviewStatus: importMetadata.reviewStatus,
    importedAt,
  };

  return { profile, result };
};
