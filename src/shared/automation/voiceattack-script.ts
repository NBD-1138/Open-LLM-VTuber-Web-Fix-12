import type { ValidKeyIdentifier, ValidModifierKey } from "./schema";

export const VOICEATTACK_UNSUPPORTED_POLICIES = [
  "informational",
  "skippable",
  "blocking",
  "prohibited",
] as const;

export const VOICEATTACK_EXECUTION_RESULT_TYPES = [
  "completed",
  "already_satisfied",
  "command_sent_unconfirmed",
  "blocked_by_precondition",
  "blocked_by_policy",
  "unsupported",
  "partially_executed",
  "timed_out",
  "cancelled",
  "failed",
  "invalid_dependency_graph",
  "unresolved_dependency",
] as const;

export const VOICEATTACK_EXECUTABILITY_STATUSES = [
  "fully_executable",
  "partially_executable",
  "blocked",
  "metadata_only",
] as const;

export const AUTOMATION_STATE_PREDICATE_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "exists",
  "not_exists",
  "contains",
  "changed_to",
  "event_received",
] as const;

export const AUTOMATION_SEMANTIC_CONTRACT_CONFIDENCE = [
  "high",
  "medium",
  "low",
] as const;

export const VOICEATTACK_VARIABLE_SCOPES = [
  "local",
  "profile",
  "global",
] as const;

export type VoiceAttackUnsupportedPolicy =
  (typeof VOICEATTACK_UNSUPPORTED_POLICIES)[number];
export type VoiceAttackExecutionResultType =
  (typeof VOICEATTACK_EXECUTION_RESULT_TYPES)[number];
export type VoiceAttackExecutabilityStatus =
  (typeof VOICEATTACK_EXECUTABILITY_STATUSES)[number];
export type AutomationStatePredicateOperator =
  (typeof AUTOMATION_STATE_PREDICATE_OPERATORS)[number];
export type AutomationSemanticContractConfidence =
  (typeof AUTOMATION_SEMANTIC_CONTRACT_CONFIDENCE)[number];
export type VoiceAttackVariableScope =
  (typeof VOICEATTACK_VARIABLE_SCOPES)[number];

export interface VoiceAttackPreservedField {
  index?: number;
  name: string;
  valueType: string;
  valueText: string | null;
}

export interface VoiceAttackImportProvenance {
  sourceFormat: string;
  decoderStatus: string;
  importVersion: number;
  decoderVersion: string;
  importedAt: string;
  sourceBasename: string;
}

export interface VoiceAttackOperandLiteral {
  kind: "literal";
  value: string | number | boolean | null;
}

export interface VoiceAttackOperandVariable {
  kind: "variable";
  variableName: string;
  scope: VoiceAttackVariableScope;
}

export interface VoiceAttackOperandStatePath {
  kind: "state_path";
  path: string;
}

export type VoiceAttackOperand =
  | VoiceAttackOperandLiteral
  | VoiceAttackOperandVariable
  | VoiceAttackOperandStatePath;

export interface VoiceAttackConditionExpression {
  left: VoiceAttackOperand;
  operator: AutomationStatePredicateOperator;
  right?: VoiceAttackOperand;
  sourceConditionType?: number | null;
  sourceOperator?: number | null;
  sourceValueType?: number | null;
  sourceCompareText?: string | null;
}

interface VoiceAttackNodeBase {
  nodeId: string;
  kind: string;
  actionTypeName: string;
  sourceActionId: string | null;
  sourceActionIndex: number;
  delayMs: number;
  disabled: boolean;
  note?: string;
}

export interface VoiceAttackKeyPressNode extends VoiceAttackNodeBase {
  kind: "key_press";
  key: ValidKeyIdentifier;
  durationMs?: number;
}

export interface VoiceAttackKeyDownNode extends VoiceAttackNodeBase {
  kind: "key_down";
  key: ValidKeyIdentifier;
}

export interface VoiceAttackKeyUpNode extends VoiceAttackNodeBase {
  kind: "key_up";
  key: ValidKeyIdentifier;
}

export interface VoiceAttackKeyCombinationNode extends VoiceAttackNodeBase {
  kind: "key_combination";
  modifiers: ValidModifierKey[];
  key: ValidKeyIdentifier;
}

export interface VoiceAttackWaitNode extends VoiceAttackNodeBase {
  kind: "wait";
  milliseconds: number;
}

export interface VoiceAttackExecuteCommandNode extends VoiceAttackNodeBase {
  kind: "execute_command";
  targetReference: string;
  targetCommandId: string | null;
  targetSourceCommandId: string | null;
  unresolved: boolean;
  cyclic: boolean;
}

export interface VoiceAttackSetVariableNode extends VoiceAttackNodeBase {
  kind: "set_variable";
  scope: VoiceAttackVariableScope;
  variableName: string;
  valueType: "string" | "boolean" | "integer" | "decimal";
  operation: "assign" | "increment" | "decrement";
  value: VoiceAttackOperand;
}

export interface VoiceAttackClearVariableNode extends VoiceAttackNodeBase {
  kind: "clear_variable";
  scope: VoiceAttackVariableScope;
  variableName: string;
}

export interface VoiceAttackIfNode extends VoiceAttackNodeBase {
  kind: "if";
  condition: VoiceAttackConditionExpression;
  thenNodes: VoiceAttackNode[];
  elseNodes: VoiceAttackNode[];
}

export interface VoiceAttackRepeatNode extends VoiceAttackNodeBase {
  kind: "repeat";
  iterations: number;
  body: VoiceAttackNode[];
}

export interface VoiceAttackWhileNode extends VoiceAttackNodeBase {
  kind: "while";
  condition: VoiceAttackConditionExpression;
  body: VoiceAttackNode[];
}

export interface VoiceAttackWaitUntilNode extends VoiceAttackNodeBase {
  kind: "wait_until";
  condition: VoiceAttackConditionExpression;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface VoiceAttackStopCommandNode extends VoiceAttackNodeBase {
  kind: "stop_command";
}

export interface VoiceAttackReturnNode extends VoiceAttackNodeBase {
  kind: "return";
}

export interface VoiceAttackPlaySoundNode extends VoiceAttackNodeBase {
  kind: "play_sound";
  location: string | null;
  volume: number | null;
  waitForCompletion: boolean;
  pan: number | null;
}

export interface VoiceAttackSpeechPlaceholderNode extends VoiceAttackNodeBase {
  kind: "speech_placeholder";
  placeholderType: "say" | "sound_file";
  originalResponsePresent: boolean;
  replacementRequired: boolean;
}

export interface VoiceAttackLogNode extends VoiceAttackNodeBase {
  kind: "log";
  message: string;
}

export interface VoiceAttackNoteNode extends VoiceAttackNodeBase {
  kind: "note";
  noteType: "comment" | "metadata";
  content: string;
}

export interface VoiceAttackUnsupportedNode extends VoiceAttackNodeBase {
  kind: "unsupported";
  unsupportedPolicy: VoiceAttackUnsupportedPolicy;
  reason: string;
  rawFields: VoiceAttackPreservedField[];
}

export type VoiceAttackNode =
  | VoiceAttackKeyPressNode
  | VoiceAttackKeyDownNode
  | VoiceAttackKeyUpNode
  | VoiceAttackKeyCombinationNode
  | VoiceAttackWaitNode
  | VoiceAttackExecuteCommandNode
  | VoiceAttackSetVariableNode
  | VoiceAttackClearVariableNode
  | VoiceAttackIfNode
  | VoiceAttackRepeatNode
  | VoiceAttackWhileNode
  | VoiceAttackWaitUntilNode
  | VoiceAttackStopCommandNode
  | VoiceAttackReturnNode
  | VoiceAttackPlaySoundNode
  | VoiceAttackSpeechPlaceholderNode
  | VoiceAttackLogNode
  | VoiceAttackNoteNode
  | VoiceAttackUnsupportedNode;

export interface VoiceAttackDependencyGraphSummary {
  directDependencyCommandIds: string[];
  transitiveDependencyCommandIds: string[];
  unresolvedDependencyReferences: string[];
  dependencyCycles: string[][];
  externalPluginDependencies: string[];
  reachesExecutableKeyboardInput: boolean;
  containsOnlySpeechOrUnsupportedActions: boolean;
}

export interface AutomationStatePredicate {
  path: string;
  operator: AutomationStatePredicateOperator;
  value?: string | number | boolean | null;
  eventName?: string;
}

export interface AutomationSemanticContract {
  capabilityId: string;
  gameAdapterId: string;
  desiredState: Record<string, string | number | boolean | null>;
  preconditions: AutomationStatePredicate[];
  alreadySatisfiedWhen?: AutomationStatePredicate;
  successWhen?: AutomationStatePredicate;
  failureWhen?: AutomationStatePredicate;
  timeoutMs: number;
  pollIntervalMs?: number;
  fallbackWhenUnavailable: "execute_unconfirmed" | "block";
  inferenceConfidence: AutomationSemanticContractConfidence;
  inferenceEvidence: string[];
  manualReviewRequired: boolean;
  userOverride: boolean;
  source: "inferred" | "manual";
}

export interface AutomationVoiceAttackExecutionTraceEntry {
  commandId: string;
  nodeId: string;
  kind: string;
  status: "executed" | "skipped" | "blocked" | "dry_run" | "unsupported";
  summary: string;
}

export interface AutomationVoiceAttackExecutionOutcome {
  commandId: string;
  resultType: VoiceAttackExecutionResultType;
  reason: string;
  physicalInputSent: boolean;
  telemetryConfirmed: boolean;
  skippedActions: string[];
  blockingActions: string[];
  unsupportedActions: string[];
  nestedCommandTrace: string[];
  durationMs: number;
  finalObservedState: Record<string, unknown> | null;
  trace: AutomationVoiceAttackExecutionTraceEntry[];
  semanticCapabilityId?: string | null;
}

export interface AutomationImportedVoiceAttackCommand {
  sourceCommandId: string | null;
  sourceCommandString: string;
  sourceLabel: string | null;
  sourceDescription: string;
  sourceCategory: string;
  sourceProfileId: string | null;
  sourceProfileName: string;
  sourceFileHash: string;
  importProvenance: VoiceAttackImportProvenance;
  internalCommand: boolean;
  hiddenFromCapabilityCatalog: boolean;
  dependencyGraph: VoiceAttackDependencyGraphSummary;
  executability: VoiceAttackExecutabilityStatus;
  actionTree: VoiceAttackNode[];
  semanticContract: AutomationSemanticContract | null;
  reviewWarnings: string[];
}

export const isInternalVoiceAttackCommandString = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith("((") && trimmed.endsWith("))");
};

export const splitVoiceAttackCommandPhrases = (value: string): string[] =>
  value
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const getPathValue = (
  source: Record<string, unknown> | null | undefined,
  path: string,
): unknown => {
  if (!source) {
    return undefined;
  }
  return path
    .split(".")
    .filter((segment) => segment.length > 0)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, source);
};

export const evaluateAutomationStatePredicate = (
  source: Record<string, unknown> | null | undefined,
  predicate: AutomationStatePredicate,
  previousValue?: unknown,
): boolean | null => {
  const currentValue = getPathValue(source, predicate.path);
  switch (predicate.operator) {
    case "exists":
      return currentValue !== undefined;
    case "not_exists":
      return currentValue === undefined;
    case "equals":
      return currentValue === predicate.value;
    case "not_equals":
      return currentValue !== predicate.value;
    case "greater_than":
      return typeof currentValue === "number" &&
        typeof predicate.value === "number"
        ? currentValue > predicate.value
        : null;
    case "greater_than_or_equal":
      return typeof currentValue === "number" &&
        typeof predicate.value === "number"
        ? currentValue >= predicate.value
        : null;
    case "less_than":
      return typeof currentValue === "number" &&
        typeof predicate.value === "number"
        ? currentValue < predicate.value
        : null;
    case "less_than_or_equal":
      return typeof currentValue === "number" &&
        typeof predicate.value === "number"
        ? currentValue <= predicate.value
        : null;
    case "contains":
      if (typeof currentValue === "string" && typeof predicate.value === "string") {
        return currentValue.includes(predicate.value);
      }
      if (Array.isArray(currentValue)) {
        return currentValue.includes(predicate.value);
      }
      return null;
    case "changed_to":
      return previousValue !== currentValue && currentValue === predicate.value;
    case "event_received":
      return currentValue === predicate.eventName;
    default:
      return null;
  }
};
