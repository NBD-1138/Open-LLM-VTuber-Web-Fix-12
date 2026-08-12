import type {
  AutomationAction,
  AutomationConfirmationPolicy,
  AutomationImportReviewStatus,
  AutomationProfile,
} from './schema';
import type {
  AutomationSemanticContract,
  VoiceAttackDependencyGraphSummary,
  VoiceAttackExecutabilityStatus,
} from './voiceattack-script';
import {
  validateAutomationProfile,
  AutomationValidationError,
} from './schema';

export type VoiceAttackSourceFormat =
  | 'vap_xml'
  | 'vap_wrapped_binary'
  | 'vax_container'
  | 'vax_wrapped_binary'
  | 'unknown';

export type VoiceAttackImportSupportStatus =
  | 'supported'
  | 'partially_supported'
  | 'unsupported';

export interface VoiceAttackPackageEntrySummary {
  entryName: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
  kind: 'directory' | 'profile' | 'resource' | 'blocked' | 'other';
  blockedReason?: string;
  hash?: string;
}

export interface VoiceAttackEnvelopeDiagnostics {
  sourceFormat: 'xml' | 'binary_deflate_profile2' | 'binary_inflated_profile2' | 'unknown';
  compressedSize: number;
  inflatedSize: number | null;
  declaredInflatedSize: number | null;
  lastPropertyIndex: number | null;
  propertyOffsets: number[];
  printableStrings: Array<{ offset: number; value: string; encoding: 'utf8' | 'utf16le' }>;
  repeatedStructuralSignatures: Array<{ lastPropertyIndex: number; count: number }>;
}

export interface VoiceAttackEmbeddedProfileSummary {
  entryName: string;
  sourceFormat: VoiceAttackSourceFormat;
  parseable: boolean;
  profileName: string | null;
  decoderStatus: string;
}

export interface VoiceAttackImportCandidateSummary {
  candidateId: string;
  sourceBasename: string;
  extension: string;
  sourceFormat: VoiceAttackSourceFormat;
  parseable: boolean;
  encrypted: boolean;
  profileName: string | null;
  originalProfileVersion: string | null;
  commandCount: number;
  supportedCommandCount: number;
  partiallySupportedCommandCount: number;
  unsupportedCommandCount: number;
  responsePlaceholderCount: number;
  unresolvedNestedReferenceCount: number;
  recursionWarningCount: number;
  variablePluginWarningCount: number;
  unresolvedPluginCount: number;
  unresolvedVariableCount: number;
  actionTypeCategories: string[];
  actionTypeCounts: Record<string, number>;
  decoderStatus: string;
  envelopeFormat: string | null;
  containerBasename: string | null;
  embeddedEntryName: string | null;
  packageEntries: VoiceAttackPackageEntrySummary[];
  embeddedProfiles: VoiceAttackEmbeddedProfileSummary[];
  diagnostics: VoiceAttackEnvelopeDiagnostics | null;
  parseError: string | null;
}

export interface VoiceAttackInspectionResult {
  importId: string;
  sourceBasename: string;
  sourceKind: 'file' | 'directory';
  candidateProfileCount: number;
  parseableFileCount: number;
  unparseableFileCount: number;
  formatsDiscovered: VoiceAttackSourceFormat[];
  actionTypeCategories: string[];
  supportedImportCategories: string[];
  partiallySupportedCategories: string[];
  unsupportedCategories: string[];
  candidates: VoiceAttackImportCandidateSummary[];
}

export interface VoiceAttackCommandPreview {
  commandId: string;
  sourceCommandId: string | null;
  sourceCommandString: string;
  label: string;
  description: string;
  aliases: string[];
  category: string;
  triggerMode: 'spoken' | 'internal' | 'hotkey' | 'mixed' | 'unknown';
  internalCommand: boolean;
  supportStatus: VoiceAttackImportSupportStatus;
  executability: VoiceAttackExecutabilityStatus;
  selectedByDefault: boolean;
  enabledByDefault: boolean;
  actionCount: number;
  actionTypes: string[];
  actions: Array<{
    actionType: string;
    summary: string;
    supportStatus: VoiceAttackImportSupportStatus;
  }>;
  actionSummaries: string[];
  warnings: string[];
  responsePlaceholderCount: number;
  unsupportedActionCount: number;
  unresolvedNestedReferences: string[];
  recursiveReference: boolean;
  executableActionCount: number;
  keyInputCount: number;
  dependencyGraph: VoiceAttackDependencyGraphSummary | null;
  semanticContract: AutomationSemanticContract | null;
}

export interface VoiceAttackProfilePreview {
  importId: string;
  candidateId: string;
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
  diagnostics: VoiceAttackEnvelopeDiagnostics | null;
  commandCount: number;
  supportedCommandCount: number;
  partiallySupportedCommandCount: number;
  unsupportedCommandCount: number;
  responsePlaceholderCount: number;
  unresolvedNestedReferenceCount: number;
  recursionWarningCount: number;
  variablePluginWarningCount: number;
  unresolvedPluginCount: number;
  unresolvedVariableCount: number;
  actionTypeCounts: Record<string, number>;
  validationErrors: string[];
  warnings: string[];
  commands: VoiceAttackCommandPreview[];
}

export interface VoiceAttackImportRequest {
  importId: string;
  candidateId: string;
  selectedCommandIds: string[];
  profileId?: string;
  displayName?: string;
}

export interface VoiceAttackImportProfileResult {
  profileId: string;
  displayName: string;
  importedCommandCount: number;
  supportedCommandCount: number;
  partiallySupportedCommandCount: number;
  unsupportedCommandCount: number;
  responsePlaceholderCount: number;
  reviewStatus: AutomationImportReviewStatus;
  importedAt: string;
}

export interface ImportedAutomationProfileReviewReport {
  profileId: string;
  imported: boolean;
  reviewStatus: AutomationImportReviewStatus | null;
  readyToMarkReviewed: boolean;
  findings: string[];
  executableCommandCount: number;
  keyInputCommandCount: number;
  confirmationRequiredCommandCount: number;
  unresolvedWarningCount: number;
  responsePlaceholderCount: number;
  unsupportedActionCount: number;
  supportedCommandCount: number;
  partiallySupportedCommandCount: number;
  unsupportedCommandCount: number;
}

const getActionPlaceholderState = (action: AutomationAction) => {
  if (action.type === 'unsupported_import_action') {
    return { unsupported: true, responsePlaceholder: false };
  }
  if (action.type === 'response_placeholder') {
    return { unsupported: false, responsePlaceholder: true };
  }
  return { unsupported: false, responsePlaceholder: false };
};

const isExecutableAction = (action: AutomationAction): boolean => ![
  'wait',
  'unsupported_import_action',
  'response_placeholder',
].includes(action.type);

const isKeyInputAction = (action: AutomationAction): boolean => [
  'key_press',
  'key_down',
  'key_up',
  'key_combination',
].includes(action.type);

export const getImportedCommandSupportStatus = (
  command: AutomationProfile['commands'][number],
): VoiceAttackImportSupportStatus => {
  const unsupportedCount = command.steps.filter((step) => step.type === 'unsupported_import_action').length;
  const responsePlaceholderCount = command.steps.filter((step) => step.type === 'response_placeholder').length;
  const executableCount = command.steps.filter((step) => isExecutableAction(step)).length;

  if (unsupportedCount === 0 && responsePlaceholderCount === 0) {
    return 'supported';
  }
  if (executableCount > 0 || responsePlaceholderCount > 0) {
    return 'partially_supported';
  }
  return 'unsupported';
};

export const buildImportedProfileReviewReport = (
  profile: AutomationProfile,
): ImportedAutomationProfileReviewReport => {
  const findings = new Set<string>();

  try {
    validateAutomationProfile(profile);
  } catch (error) {
    const message = error instanceof AutomationValidationError || error instanceof Error
      ? error.message
      : 'Profile validation failed.';
    findings.add(message);
  }

  const imported = profile.importMetadata?.imported === true;
  const reviewStatus = profile.importMetadata?.reviewStatus ?? null;
  const unresolvedWarningCount = profile.importMetadata?.importWarnings.length ?? 0;

  if (profile.enabled) {
    findings.add('Imported profiles must remain disabled until they are explicitly reviewed and enabled.');
  }
  if (profile.processNames.length > 0) {
    findings.add('Automatic process matching must remain disabled until review is complete.');
  }
  if (profile.importMetadata?.importWarnings.length) {
    profile.importMetadata.importWarnings.forEach((warning) => findings.add(warning));
  }

  let executableCommandCount = 0;
  let keyInputCommandCount = 0;
  let confirmationRequiredCommandCount = 0;
  let responsePlaceholderCount = 0;
  let unsupportedActionCount = 0;
  let supportedCommandCount = 0;
  let partiallySupportedCommandCount = 0;
  let unsupportedCommandCount = 0;

  profile.commands.forEach((command) => {
    const supportStatus = getImportedCommandSupportStatus(command);
    if (supportStatus === 'supported') {
      supportedCommandCount += 1;
    } else if (supportStatus === 'partially_supported') {
      partiallySupportedCommandCount += 1;
    } else {
      unsupportedCommandCount += 1;
    }

    const hasExecutableAction = command.steps.some((step) => isExecutableAction(step));
    const hasKeyInputAction = command.steps.some((step) => isKeyInputAction(step));
    const commandUnsupportedActionCount = command.steps.filter(
      (step) => getActionPlaceholderState(step).unsupported,
    ).length;
    const commandResponsePlaceholderCount = command.steps.filter(
      (step) => getActionPlaceholderState(step).responsePlaceholder,
    ).length;

    if (hasExecutableAction) {
      executableCommandCount += 1;
    }
    if (hasKeyInputAction) {
      keyInputCommandCount += 1;
    }
    if (
      command.confirmationPolicy !== 'always'
      && command.confirmationPolicy !== ('high_risk' as AutomationConfirmationPolicy)
    ) {
      findings.add('Imported executable commands should require confirmation before review is complete.');
    } else if (hasExecutableAction) {
      confirmationRequiredCommandCount += 1;
    }
    if (command.allowedTriggerSources.some((source) => source !== 'manual')) {
      findings.add('Imported commands must keep non-manual trigger sources disabled until review is complete.');
    }
    if (command.autonomyPolicy !== 'disabled') {
      findings.add('Imported commands must keep autonomous execution disabled until review is complete.');
    }
    if ((commandUnsupportedActionCount > 0 || commandResponsePlaceholderCount > 0) && command.enabled) {
      findings.add('Commands containing imported placeholders must remain disabled until they are replaced or removed.');
    }
    if (commandUnsupportedActionCount > 0) {
      findings.add('Unsupported imported actions require manual replacement or removal before review.');
    }
    if (commandResponsePlaceholderCount > 0) {
      findings.add('Imported response placeholders require deliberate replacement or removal before review.');
    }
    if (command.voiceAttack?.executability === 'blocked') {
      findings.add(`Imported command "${command.label}" still has blocking VoiceAttack actions or dependency issues.`);
    }
    if (command.voiceAttack?.executability === 'metadata_only') {
      findings.add(`Imported command "${command.label}" does not currently reach executable key actions.`);
    }
    unsupportedActionCount += commandUnsupportedActionCount;
    responsePlaceholderCount += commandResponsePlaceholderCount;
  });

  return {
    profileId: profile.profileId,
    imported,
    reviewStatus,
    readyToMarkReviewed: findings.size === 0,
    findings: Array.from(findings),
    executableCommandCount,
    keyInputCommandCount,
    confirmationRequiredCommandCount,
    unresolvedWarningCount,
    responsePlaceholderCount,
    unsupportedActionCount,
    supportedCommandCount,
    partiallySupportedCommandCount,
    unsupportedCommandCount,
  };
};
