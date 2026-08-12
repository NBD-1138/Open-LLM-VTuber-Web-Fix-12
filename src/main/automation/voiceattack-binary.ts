import { createHash } from 'node:crypto';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as yauzl from 'yauzl';
import type { Entry } from 'yauzl';

const MAX_PACKAGE_ENTRY_COUNT = 256;
const MAX_PACKAGE_ENTRY_SIZE = 64 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_SIZE = 128 * 1024 * 1024;
const MAX_SEQUENCE_LENGTH = 250_000;
const MAX_OBJECT_INDEX = 512;
const MIN_STRING_LENGTH = 4;
const UTF16_PRINTABLE_MIN_LENGTH = 4;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

export type VoiceAttackBinarySourceFormat =
  | 'xml'
  | 'binary_deflate_profile2'
  | 'binary_inflated_profile2'
  | 'unknown';

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
  sourceFormat: VoiceAttackBinarySourceFormat;
  compressedSize: number;
  inflatedSize: number | null;
  declaredInflatedSize: number | null;
  lastPropertyIndex: number | null;
  propertyOffsets: number[];
  printableStrings: Array<{ offset: number; value: string; encoding: 'utf8' | 'utf16le' }>;
  repeatedStructuralSignatures: Array<{ lastPropertyIndex: number; count: number }>;
}

export interface VoiceAttackNeutralUnknownField {
  index: number;
  name: string;
  valueType: string;
  valueText: string | null;
}

export interface VoiceAttackNeutralSoundReference {
  soundId: string;
  location: string | null;
  volume: number;
  complete: boolean;
  wait: boolean;
  pan: number;
  channel: string;
}

export interface VoiceAttackNeutralCondition {
  conditionId: string;
  conditionStartType: number;
  conditionStartNameFrom: string | null;
  conditionStartValueType: number;
  conditionStartValue: number;
  conditionStartCompareToCondition: string | null;
  z: number;
  conditionStartOperator: number;
  context2: string | null;
  dateContext1: string | null;
  decimalContext1: string | null;
}

export interface VoiceAttackNeutralAction {
  actionId: string;
  actionTypeName: string;
  actionTypeValue: number;
  delaySeconds: number;
  durationSeconds: number;
  keyCodes: number[];
  context: string | null;
  context2: string | null;
  context3: string | null;
  context4: string | null;
  context5: string | null;
  x: number;
  y: number;
  z: number;
  inputMode: number;
  conditionSetName: string | null;
  conditionSetCondition: string | null;
  conditionPairing: number;
  conditionGroup: number;
  conditionStartNameFrom: string | null;
  conditionStartOperator: number;
  conditionStartValue: number;
  conditionStartValueType: number;
  conditionStartCompareToCondition: string | null;
  conditionStartType: number;
  decimalContext1: string | null;
  decimalContext2: string | null;
  dateContext1: string | null;
  dateContext2: string | null;
  disabled: boolean;
  integerContext1: number;
  integerContext2: number;
  randomSounds: VoiceAttackNeutralSoundReference[];
  conditionExpressions: VoiceAttackNeutralCondition[][];
  unknownFields: VoiceAttackNeutralUnknownField[];
}

export interface VoiceAttackNeutralCommand {
  commandId: string;
  internalId: string | null;
  commandString: string;
  label: string | null;
  description: string | null;
  category: string | null;
  enabled: boolean;
  async: boolean;
  useSpokenPhrase: boolean | null;
  useShortcut: boolean;
  repeatNumber: number;
  repeatType: number;
  commandType: number;
  commandTypeName: string;
  onlyKeyUp: boolean;
  useMouse: boolean;
  useJoystick: boolean;
  useVariableHotkey: boolean;
  variableHotkey: string | null;
  useVariableMouseShortcut: boolean;
  variableMouseShortcut: string | null;
  useVariableJoystickShortcut: boolean;
  variableJoystickShortcut: string | null;
  useProcessOverride: boolean;
  processOverride: string | null;
  processOverrideActiveWindow: boolean;
  actions: VoiceAttackNeutralAction[];
  unknownFields: VoiceAttackNeutralUnknownField[];
}

export interface VoiceAttackNeutralProfile {
  profileId: string;
  internalId: string | null;
  name: string;
  exportVersion: string | null;
  defaultTts: string | null;
  deleted: boolean;
  blockExternal: boolean;
  disableAdvancedTts: boolean;
  excludeGlobalProfiles: boolean;
  useProcessOverride: boolean;
  processOverride: string | null;
  processOverrideActiveWindow: boolean;
  enableProfileSwitch: boolean;
  profileSwitchCriteria: string | null;
  commands: VoiceAttackNeutralCommand[];
  unknownFields: VoiceAttackNeutralUnknownField[];
}

export interface VoiceAttackBinaryInspectionResult {
  diagnostics: VoiceAttackEnvelopeDiagnostics;
  profile: VoiceAttackNeutralProfile;
  actionTypeCounts: Record<string, number>;
}

export interface VoiceAttackPackageInspectionResult {
  packageEntries: VoiceAttackPackageEntrySummary[];
  embeddedProfiles: Array<{
    entryName: string;
    sourceHash: string;
    sourceBuffer: Buffer;
  }>;
}

type PrimitiveKind =
  | 'guid'
  | 'nullable_guid'
  | 'string'
  | 'int32'
  | 'uint16'
  | 'boolean'
  | 'nullable_boolean'
  | 'double'
  | 'single'
  | 'decimal'
  | 'datetime'
  | 'sequence_guid'
  | 'sequence_uint16'
  | 'sequence_string'
  | 'sequence_command'
  | 'sequence_action'
  | 'sequence_sound'
  | 'sequence_condition'
  | 'sequence_condition_group';

type SchemaField = {
  index: number;
  name: string;
  type: PrimitiveKind;
};

type ExtendedPrimitiveKind =
  | PrimitiveKind
  | 'sequence_command_item'
  | 'sequence_action_item'
  | 'sequence_sound_item'
  | 'sequence_condition_item';

type DecodedFieldIssue = {
  index: number;
  name: string;
  type: ExtendedPrimitiveKind;
  message: string;
};

type DecodedObject = {
  byteSize: number;
  lastIndex: number;
  offsets: number[];
  values: Map<string, unknown>;
  issues: DecodedFieldIssue[];
};

type BinaryReader = {
  buffer: Buffer;
  readObject: (offset: number, schema: readonly SchemaField[]) => DecodedObject | null;
};

const COMMAND_TYPE_NAMES: Record<number, string> = {
  0: 'Full',
  1: 'Prefix',
  2: 'Suffix',
  3: 'Combined',
};

const ACTION_TYPE_NAMES: Record<number, string> = {
  0: 'PressKey',
  2: 'Pause',
  3: 'Launch',
  4: 'Kill',
  5: 'RepeatStart',
  6: 'RepeatEnd',
  7: 'TypeLiteral',
  8: 'KeyDown',
  9: 'KeyUp',
  10: 'ResetMouseShortcuts',
  11: 'ResetJoystickShortcuts',
  12: 'MouseAction',
  13: 'Say',
  14: 'SoundFile',
  15: 'ChangeProfile',
  16: 'ExecuteCommand',
  17: 'KillCommand',
  18: 'ConditionSet',
  19: 'ConditionStart',
  20: 'ConditionEnd',
  21: 'TextSet',
  22: 'ExternalInvoke',
  23: 'WriteToLog',
  24: 'SetClipboard',
  25: 'StartDictation',
  26: 'StopDictation',
  27: 'ClearDictation',
  28: 'Comment',
  29: 'ConditionElse',
  30: 'WhileStart',
  31: 'WhileEnd',
  32: 'Marker',
  33: 'Jump',
  34: 'Windows',
  35: 'RandomSound',
  36: 'BooleanSet',
  37: 'IntSet',
  38: 'DecimalSet',
  39: 'ClearSavedValues',
  40: 'FreeType',
  41: 'StopSounds',
  42: 'StopSpeech',
  43: 'DateSet',
  44: 'WriteText',
  45: 'PlaybackAudio',
  50: 'InternalProcess_StartListening',
  51: 'InternalProcess_StopListening',
  52: 'InternalProcess_Close',
  53: 'InternalProcess_ClearOutput',
  54: 'InternalProcess_ListProcesses',
  55: 'InternalProcess_Ignore',
  56: 'InternalProcess_StartProcessing',
  57: 'InternalProcess_StopProcessing',
  58: 'InternalProcess_StartHotkeys',
  59: 'InternalProcess_StopHotkeys',
  60: 'InternalProcess_StartJoysticks',
  61: 'InternalProcess_StopJoysticks',
  62: 'PauseVariable',
  63: 'ConditionElseIf',
  64: 'ExitCommand',
  65: 'InternalProcess_StartMouse',
  66: 'InternalProcess_StopMouse',
  67: 'KeyToggle',
  68: 'ChangeAudio',
  69: 'WindowsMisc',
  70: 'AudioVolume',
  71: 'InlineFunctionCS',
  72: 'InlineFunctionVB',
  73: 'InlineFunctionPrecompiled',
  74: 'WaitSpokenPrompt',
  75: 'LoopBreak',
  76: 'ResetProfile',
  77: 'Convert',
  78: 'GetUserText',
  79: 'GetUserInt',
  80: 'GetUserBoolean',
  81: 'GetUserDecimal',
  82: 'GetUserDate',
  83: 'GetUserList',
  84: 'BlockKeyboard',
  85: 'BlockMouse',
  86: 'RestrictMouseMove',
  87: 'QueueAction',
  88: 'ResetHotkeys',
  89: 'Screenshot',
  90: 'ToggleListening',
  91: 'ToggleHotkeys',
  92: 'ToggleJoysticks',
  93: 'ToggleMouse',
  94: 'LoopContinue',
  95: 'WaitKeyPress',
  96: 'WaitJoystick',
  97: 'WaitMouse',
  99: 'Command_Deprecated',
};

const PROFILE_SCHEMA: readonly SchemaField[] = [
  { index: 0, name: 'Id', type: 'guid' },
  { index: 1, name: 'Name', type: 'string' },
  { index: 2, name: 'Commands', type: 'sequence_command' },
  { index: 32, name: 'ExportVAVersion', type: 'string' },
  { index: 42, name: 'ProcessOverride', type: 'string' },
  { index: 43, name: 'ProcessOverrideAciveWindow', type: 'boolean' },
  { index: 46, name: 'EnableProfileSwitch', type: 'boolean' },
  { index: 47, name: 'ProfileSwitchCriteria', type: 'string' },
  { index: 61, name: 'DefaultTTS', type: 'string' },
  { index: 68, name: 'BlockExternal', type: 'boolean' },
  { index: 74, name: 'InternalID', type: 'nullable_guid' },
  { index: 86, name: 'ExcludeGlobalProfiles', type: 'boolean' },
  { index: 87, name: 'DisableAdvancedTTS', type: 'boolean' },
  { index: 89, name: 'Deleted', type: 'boolean' },
];

const COMMAND_SCHEMA: readonly SchemaField[] = [
  { index: 0, name: 'Id', type: 'guid' },
  { index: 1, name: 'CommandString', type: 'string' },
  { index: 2, name: 'ActionSequence', type: 'sequence_action' },
  { index: 3, name: 'Async', type: 'boolean' },
  { index: 4, name: 'Enabled', type: 'boolean' },
  { index: 5, name: 'Name', type: 'string' },
  { index: 6, name: 'Description', type: 'string' },
  { index: 7, name: 'Category', type: 'string' },
  { index: 8, name: 'UseShortcut', type: 'boolean' },
  { index: 15, name: 'UseSpokenPhrase', type: 'nullable_boolean' },
  { index: 16, name: 'onlyKeyUp', type: 'boolean' },
  { index: 17, name: 'RepeatNumber', type: 'int32' },
  { index: 18, name: 'RepeatType', type: 'int32' },
  { index: 19, name: 'CommandType', type: 'int32' },
  { index: 31, name: 'UseProcessOverride', type: 'boolean' },
  { index: 32, name: 'ProcessOverride', type: 'string' },
  { index: 33, name: 'ProcessOverrideActiveWindow', type: 'boolean' },
  { index: 37, name: 'UseMouse', type: 'boolean' },
  { index: 51, name: 'UseProfileProcessOverride', type: 'boolean' },
  { index: 52, name: 'ProfileProcessOverride', type: 'string' },
  { index: 53, name: 'ProfileProcessOverrideActiveWindow', type: 'boolean' },
  { index: 60, name: 'UseVariableHotkey', type: 'boolean' },
  { index: 61, name: 'VariableHotkey', type: 'string' },
  { index: 66, name: 'InternalId', type: 'nullable_guid' },
  { index: 79, name: 'UseVariableMouseShortcut', type: 'boolean' },
  { index: 80, name: 'VariableMouseShortcut', type: 'string' },
  { index: 81, name: 'UseVariableJoystickShortcut', type: 'boolean' },
  { index: 82, name: 'VariableJoystickShortcut', type: 'string' },
];

const ACTION_SCHEMA: readonly SchemaField[] = [
  { index: 0, name: 'Id', type: 'guid' },
  { index: 1, name: 'ActionType', type: 'int32' },
  { index: 2, name: 'Duration', type: 'double' },
  { index: 3, name: 'Delay', type: 'double' },
  { index: 4, name: 'KeyCodes', type: 'sequence_uint16' },
  { index: 5, name: 'Context', type: 'string' },
  { index: 6, name: 'Context2', type: 'string' },
  { index: 7, name: 'Context3', type: 'string' },
  { index: 8, name: 'Context4', type: 'string' },
  { index: 9, name: 'Context5', type: 'string' },
  { index: 10, name: 'X', type: 'int32' },
  { index: 11, name: 'Y', type: 'int32' },
  { index: 12, name: 'Z', type: 'int32' },
  { index: 13, name: 'InputMode', type: 'int32' },
  { index: 14, name: 'ConditionSetName', type: 'string' },
  { index: 15, name: 'ConditionSetCondition', type: 'string' },
  { index: 16, name: 'ConditionPairing', type: 'int32' },
  { index: 17, name: 'ConditionGroup', type: 'int32' },
  { index: 18, name: 'ConditionStartNameFrom', type: 'string' },
  { index: 19, name: 'ConditionStartOperator', type: 'int32' },
  { index: 20, name: 'ConditionStartValue', type: 'int32' },
  { index: 21, name: 'ConditionStartValueType', type: 'int32' },
  { index: 22, name: 'ConditionStartCompareToCondtion', type: 'string' },
  { index: 23, name: 'ConditionStartType', type: 'int32' },
  { index: 24, name: 'DecimalContext1', type: 'decimal' },
  { index: 25, name: 'DecimalContext2', type: 'decimal' },
  { index: 26, name: 'DateContext1', type: 'datetime' },
  { index: 27, name: 'DateContext2', type: 'datetime' },
  { index: 28, name: 'Disabled', type: 'boolean' },
  { index: 29, name: 'RandomSounds', type: 'sequence_sound' },
  { index: 30, name: 'ConditionExpressions', type: 'sequence_condition_group' },
  { index: 31, name: 'IntegerContext1', type: 'int32' },
  { index: 32, name: 'IntegerContext2', type: 'int32' },
];

const SOUND_SCHEMA: readonly SchemaField[] = [
  { index: 0, name: 'Id', type: 'guid' },
  { index: 1, name: 'Location', type: 'string' },
  { index: 2, name: 'Volume', type: 'int32' },
  { index: 3, name: 'Complete', type: 'boolean' },
  { index: 4, name: 'Wait', type: 'boolean' },
  { index: 5, name: 'Pan', type: 'single' },
  { index: 6, name: 'Channel', type: 'guid' },
];

const CONDITION_SCHEMA: readonly SchemaField[] = [
  { index: 0, name: 'Id', type: 'guid' },
  { index: 1, name: 'ConditionStartType', type: 'int32' },
  { index: 2, name: 'ConditionStartNameFrom', type: 'string' },
  { index: 3, name: 'ConditionStartValueType', type: 'int32' },
  { index: 4, name: 'ConditionStartValue', type: 'int32' },
  { index: 5, name: 'ConditionStartCompareToCondtion', type: 'string' },
  { index: 6, name: 'Z', type: 'int32' },
  { index: 7, name: 'ConditionStartOperator', type: 'int32' },
  { index: 8, name: 'Context2', type: 'string' },
  { index: 9, name: 'DateContext1', type: 'datetime' },
  { index: 10, name: 'DecimalContext1', type: 'decimal' },
];

const isVariableKind = (kind: PrimitiveKind): boolean => ![
  'guid',
  'nullable_guid',
  'int32',
  'uint16',
  'boolean',
  'nullable_boolean',
  'double',
  'single',
  'decimal',
  'datetime',
].includes(kind);

const hashBuffer = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

const normalizeZipInspectionError = (error: unknown): Error => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('compressed/uncompressed size mismatch')
      || message.includes('invalid relative path')
      || message.includes('absolute path')
      || message.includes('traversal')
    ) {
      return new Error(
        'The VoiceAttack archive is invalid or violates the local inspection size/path safety rules.',
      );
    }
    return error;
  }
  return new Error('Unable to inspect the VoiceAttack archive safely.');
};

const listZipEntries = async (filePath: string): Promise<Entry[]> => new Promise((resolve, reject) => {
  yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) {
      reject(normalizeZipInspectionError(error ?? new Error('Unable to open the VoiceAttack archive.')));
      return;
    }
    const entries: Entry[] = [];
    zip.on('entry', (entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => {
      zip.close();
      resolve(entries);
    });
    zip.on('error', (zipError) => {
      zip.close();
      reject(normalizeZipInspectionError(zipError));
    });
    zip.readEntry();
  });
});

const readZipEntryBuffer = async (filePath: string, entry: Entry): Promise<Buffer> => new Promise((resolve, reject) => {
  yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
    if (openError || !zip) {
      reject(normalizeZipInspectionError(openError ?? new Error('Unable to read the VoiceAttack archive.')));
      return;
    }
    const closeZip = () => {
      try {
        zip.close();
      } catch {
        // Ignore close failures.
      }
    };
    zip.on('error', (error) => {
      closeZip();
      reject(normalizeZipInspectionError(error));
    });
    zip.readEntry();
    zip.on('entry', (candidate) => {
      if (candidate.fileName !== entry.fileName) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(candidate, (streamError, stream) => {
        if (streamError || !stream) {
          closeZip();
          reject(normalizeZipInspectionError(streamError ?? new Error('Unable to open the VoiceAttack archive entry.')));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (error) => {
          closeZip();
          reject(normalizeZipInspectionError(error));
        });
        stream.on('end', () => {
          closeZip();
          resolve(Buffer.concat(chunks));
        });
      });
    });
  });
});

const decodeXmlBuffer = (buffer: Buffer): string | null => {
  const attempts: string[] = [];
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    attempts.push(new TextDecoder('utf-8').decode(buffer.subarray(3)));
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    attempts.push(new TextDecoder('utf-16le').decode(buffer.subarray(2)));
  }
  attempts.push(
    new TextDecoder('utf-8', { fatal: false }).decode(buffer),
    new TextDecoder('utf-16le', { fatal: false }).decode(buffer),
  );

  for (const text of attempts) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<Profile')) {
      return text;
    }
  }
  return null;
};

const normalizeZipEntryName = (entryName: string): string => entryName.replace(/\\/g, '/');

const validateZipEntryName = (entryName: string): string | null => {
  const normalized = normalizeZipEntryName(entryName);
  if (!normalized || normalized.includes('\0')) {
    return 'Entry path is empty or invalid.';
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return 'Entry path must not be absolute.';
  }
  const resolved = path.posix.normalize(normalized);
  if (resolved === '..' || resolved.startsWith('../') || resolved.includes('/../')) {
    return 'Entry path attempts directory traversal.';
  }
  return null;
};

const classifyPackageEntry = (entryName: string): VoiceAttackPackageEntrySummary['kind'] => {
  const lower = entryName.toLowerCase();
  if (lower.endsWith('/')) {
    return 'directory';
  }
  if (lower.endsWith('.vap')) {
    return 'profile';
  }
  if (/\.(dll|exe|bat|cmd|ps1|vbs|js|jar|msi|com)$/i.test(lower)) {
    return 'blocked';
  }
  if (/\.(wav|mp3|ogg|flac|png|jpg|jpeg|gif|bmp|txt|json|xml)$/i.test(lower)) {
    return 'resource';
  }
  return 'other';
};

export const inspectVoiceAttackPackageFile = async (filePath: string): Promise<VoiceAttackPackageInspectionResult> => {
  const entries = await listZipEntries(filePath);
  if (entries.length > MAX_PACKAGE_ENTRY_COUNT) {
    throw new Error(`The VoiceAttack package contains too many entries (${entries.length}).`);
  }

  let totalUncompressedSize = 0;
  const packageEntries: VoiceAttackPackageEntrySummary[] = [];
  const embeddedProfiles: VoiceAttackPackageInspectionResult['embeddedProfiles'] = [];

  for (const entry of entries) {
    const encrypted = (entry.generalPurposeBitFlag & 0x1) !== 0;
    const blockedReason = validateZipEntryName(entry.fileName);
    const kind = classifyPackageEntry(entry.fileName);
    totalUncompressedSize += entry.uncompressedSize;
    if (entry.uncompressedSize > MAX_PACKAGE_ENTRY_SIZE) {
      throw new Error(`The VoiceAttack package entry "${entry.fileName}" exceeds the allowed size limit.`);
    }
    if (totalUncompressedSize > MAX_PACKAGE_TOTAL_SIZE) {
      throw new Error('The VoiceAttack package exceeds the allowed total extracted size.');
    }

    const entrySummary: VoiceAttackPackageEntrySummary = {
      entryName: entry.fileName,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      encrypted,
      kind,
      ...(blockedReason ? { blockedReason } : {}),
    };

    if (!blockedReason && !encrypted && kind === 'profile') {
      const sourceBuffer = await readZipEntryBuffer(filePath, entry);
      entrySummary.hash = hashBuffer(sourceBuffer);
      embeddedProfiles.push({
        entryName: entry.fileName,
        sourceHash: entrySummary.hash,
        sourceBuffer,
      });
    } else if (encrypted) {
      entrySummary.blockedReason = 'Encrypted package entries cannot be inspected locally.';
    } else if (kind === 'blocked') {
      entrySummary.blockedReason = 'Executable or plugin package entries are never extracted or executed.';
    }

    packageEntries.push(entrySummary);
  }

  return {
    packageEntries,
    embeddedProfiles,
  };
};

const collectPrintableStrings = (buffer: Buffer): VoiceAttackEnvelopeDiagnostics['printableStrings'] => {
  const found = new Map<string, { offset: number; value: string; encoding: 'utf8' | 'utf16le' }>();

  const utf8Pattern = /[ -~]{4,}/g;
  const utf8Text = buffer.toString('latin1');
  let match: RegExpExecArray | null;
  while ((match = utf8Pattern.exec(utf8Text)) !== null) {
    const value = match[0].trim();
    if (value.length < MIN_STRING_LENGTH || found.has(`utf8:${value}`)) {
      continue;
    }
    found.set(`utf8:${value}`, { offset: match.index, value, encoding: 'utf8' });
    if (found.size >= 200) {
      break;
    }
  }

  for (let offset = 0; offset + UTF16_PRINTABLE_MIN_LENGTH * 2 <= buffer.length && found.size < 300; offset += 2) {
    let end = offset;
    while (end + 1 < buffer.length) {
      const codeUnit = buffer.readUInt16LE(end);
      if (codeUnit === 0 || codeUnit < 32 || codeUnit > 126) {
        break;
      }
      end += 2;
    }
    const charCount = (end - offset) / 2;
    if (charCount < UTF16_PRINTABLE_MIN_LENGTH) {
      continue;
    }
    const value = buffer.subarray(offset, end).toString('utf16le').trim();
    if (!value || found.has(`utf16:${value}`)) {
      continue;
    }
    found.set(`utf16:${value}`, { offset, value, encoding: 'utf16le' });
    offset = end;
  }

  return Array.from(found.values())
    .sort((left, right) => left.offset - right.offset)
    .slice(0, 120);
};

const collectStructuralSignatures = (buffer: Buffer): VoiceAttackEnvelopeDiagnostics['repeatedStructuralSignatures'] => {
  const counts = new Map<number, number>();
  for (let offset = 0; offset + 8 <= buffer.length; offset += 4) {
    const byteSize = buffer.readInt32LE(offset);
    const lastIndex = buffer.readInt32LE(offset + 4);
    if (byteSize <= 8 || byteSize > buffer.length - offset || lastIndex < 0 || lastIndex > 128) {
      continue;
    }
    counts.set(lastIndex, (counts.get(lastIndex) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([lastPropertyIndex, count]) => ({ lastPropertyIndex, count }))
    .filter((entry) => entry.count > 1)
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);
};

const buildEnvelopeDiagnostics = (
  sourceFormat: VoiceAttackBinarySourceFormat,
  compressedBuffer: Buffer,
  inflatedBuffer: Buffer | null,
): VoiceAttackEnvelopeDiagnostics => {
  if (!inflatedBuffer) {
    return {
      sourceFormat,
      compressedSize: compressedBuffer.length,
      inflatedSize: null,
      declaredInflatedSize: null,
      lastPropertyIndex: null,
      propertyOffsets: [],
      printableStrings: collectPrintableStrings(compressedBuffer),
      repeatedStructuralSignatures: [],
    };
  }

  let declaredInflatedSize: number | null = null;
  let lastPropertyIndex: number | null = null;
  let propertyOffsets: number[] = [];
  if (inflatedBuffer.length >= 8) {
    declaredInflatedSize = inflatedBuffer.readInt32LE(0);
    lastPropertyIndex = inflatedBuffer.readInt32LE(4);
    if (lastPropertyIndex >= 0 && lastPropertyIndex <= MAX_OBJECT_INDEX && inflatedBuffer.length >= 8 + ((lastPropertyIndex + 1) * 4)) {
      propertyOffsets = Array.from({ length: lastPropertyIndex + 1 }, (_value, index) => inflatedBuffer.readInt32LE(8 + (index * 4)));
    }
  }

  return {
    sourceFormat,
    compressedSize: compressedBuffer.length,
    inflatedSize: inflatedBuffer.length,
    declaredInflatedSize,
    lastPropertyIndex,
    propertyOffsets,
    printableStrings: collectPrintableStrings(inflatedBuffer),
    repeatedStructuralSignatures: collectStructuralSignatures(inflatedBuffer),
  };
};

const validateEnvelopeHeader = (buffer: Buffer): { declaredSize: number; lastIndex: number; offsets: number[] } => {
  if (buffer.length < 8) {
    throw new Error('Binary VoiceAttack payload is too short to contain a valid header.');
  }

  const declaredSize = buffer.readInt32LE(0);
  const lastIndex = buffer.readInt32LE(4);
  if (declaredSize !== buffer.length) {
    throw new Error(`Binary VoiceAttack payload length mismatch: declared ${declaredSize}, actual ${buffer.length}.`);
  }
  if (lastIndex < 0 || lastIndex > MAX_OBJECT_INDEX) {
    throw new Error(`Binary VoiceAttack payload has an invalid last-property index: ${lastIndex}.`);
  }

  const offsetCount = lastIndex + 1;
  const tableEnd = 8 + (offsetCount * 4);
  if (tableEnd > buffer.length) {
    throw new Error('Binary VoiceAttack payload header index table exceeds the inflated buffer length.');
  }

  const offsets = Array.from({ length: offsetCount }, (_value, index) => buffer.readInt32LE(8 + (index * 4)));
  offsets.forEach((entryOffset, index) => {
    if (entryOffset < 0 || entryOffset >= buffer.length) {
      throw new Error(`Binary VoiceAttack payload index ${index} points outside the inflated buffer.`);
    }
  });
  return { declaredSize, lastIndex, offsets };
};

const canSkipFieldDecodeFailure = (type: ExtendedPrimitiveKind): boolean => [
  'decimal',
  'datetime',
  'sequence_sound',
  'sequence_condition',
  'sequence_condition_group',
  'sequence_sound_item',
  'sequence_condition_item',
].includes(type);

const createBinaryReader = (buffer: Buffer): BinaryReader => {
  const readGuid = (offset: number): string => {
    const bytes = buffer.subarray(offset, offset + 16);
    if (bytes.length < 16) {
      throw new Error('GUID extends beyond the end of the VoiceAttack buffer.');
    }
    const part1 = bytes.readUInt32LE(0).toString(16).padStart(8, '0');
    const part2 = bytes.readUInt16LE(4).toString(16).padStart(4, '0');
    const part3 = bytes.readUInt16LE(6).toString(16).padStart(4, '0');
    const part4 = bytes.subarray(8, 10).toString('hex');
    const part5 = bytes.subarray(10, 16).toString('hex');
    return `${part1}-${part2}-${part3}-${part4}-${part5}`;
  };

  const readString = (offset: number): { value: string | null; size: number } => {
    const length = buffer.readInt32LE(offset);
    if (length === -1) {
      return { value: null, size: 4 };
    }
    if (length < 0 || offset + 4 + length > buffer.length) {
      throw new Error('String extends beyond the end of the VoiceAttack buffer.');
    }
    return {
      value: UTF8_DECODER.decode(buffer.subarray(offset + 4, offset + 4 + length)),
      size: 4 + length,
    };
  };

  const readDecimal = (offset: number): { value: string; size: number } => {
    const lo = buffer.readInt32LE(offset);
    const mid = buffer.readInt32LE(offset + 4);
    const hi = buffer.readInt32LE(offset + 8);
    const flags = buffer.readInt32LE(offset + 12);
    return { value: `${lo},${mid},${hi},${flags}`, size: 16 };
  };

  const readDateTime = (offset: number): { value: string; size: number } => {
    const seconds = Number(buffer.readBigInt64LE(offset));
    const nanos = buffer.readInt32LE(offset + 8);
    const milliseconds = Math.trunc(nanos / 1_000_000);
    const iso = new Date((seconds * 1000) + milliseconds).toISOString();
    return { value: iso, size: 12 };
  };

  const readSequence = (offset: number, elementType: ExtendedPrimitiveKind): { value: unknown[] | null; size: number } => {
    const length = buffer.readInt32LE(offset);
    if (length === -1) {
      return { value: null, size: 4 };
    }
    if (length < 0 || length > MAX_SEQUENCE_LENGTH) {
      throw new Error(`VoiceAttack sequence length ${length} is invalid.`);
    }
    const items: unknown[] = [];
    let cursor = offset + 4;
    for (let index = 0; index < length; index += 1) {
      const parsed = readTypedValue(cursor, elementType);
      items.push(parsed.value);
      cursor += parsed.size;
    }
    return { value: items, size: cursor - offset };
  };

  const readObject = (offset: number, schema: readonly SchemaField[]): DecodedObject | null => {
    const byteSize = buffer.readInt32LE(offset);
    if (byteSize === -1) {
      return null;
    }
    if (byteSize < 8 || offset + byteSize > buffer.length) {
      throw new Error('VoiceAttack object extends beyond the end of the inflated payload.');
    }
    const lastIndex = buffer.readInt32LE(offset + 4);
    if (lastIndex < 0 || lastIndex > MAX_OBJECT_INDEX) {
      throw new Error(`VoiceAttack object has an invalid last-property index: ${lastIndex}.`);
    }
    const offsetCount = lastIndex + 1;
    const tableEnd = offset + 8 + (offsetCount * 4);
    if (tableEnd > offset + byteSize) {
      throw new Error('VoiceAttack object index table exceeds the declared object size.');
    }
    const offsets = Array.from({ length: offsetCount }, (_value, index) => buffer.readInt32LE(offset + 8 + (index * 4)));
    const values = new Map<string, unknown>();
    const issues: DecodedFieldIssue[] = [];
    for (const field of schema) {
      if (field.index > lastIndex) {
        continue;
      }
      const relativeOffset = offsets[field.index];
      if (relativeOffset === 0) {
        continue;
      }
      const absoluteOffset = offset + relativeOffset;
      if (absoluteOffset < tableEnd || absoluteOffset >= offset + byteSize) {
        throw new Error(`VoiceAttack object field "${field.name}" points outside the declared object range.`);
      }
      try {
        const parsed = readTypedValue(absoluteOffset, field.type);
        values.set(field.name, parsed.value);
      } catch (error) {
        if (!canSkipFieldDecodeFailure(field.type)) {
          throw error;
        }
        issues.push({
          index: field.index,
          name: field.name,
          type: field.type,
          message: error instanceof Error ? error.message : `Unable to decode ${field.name}.`,
        });
      }
    }
    return {
      byteSize,
      lastIndex,
      offsets,
      values,
      issues,
    };
  };

  const readTypedValue = (offset: number, type: ExtendedPrimitiveKind): { value: unknown; size: number } => {
    switch (type) {
      case 'guid':
        return { value: readGuid(offset), size: 16 };
      case 'nullable_guid': {
        const hasValue = buffer.readUInt8(offset) !== 0;
        return hasValue
          ? { value: readGuid(offset + 1), size: 17 }
          : { value: null, size: 17 };
      }
      case 'string':
        return readString(offset);
      case 'int32':
        return { value: buffer.readInt32LE(offset), size: 4 };
      case 'uint16':
        return { value: buffer.readUInt16LE(offset), size: 2 };
      case 'boolean':
        return { value: buffer.readUInt8(offset) !== 0, size: 1 };
      case 'nullable_boolean': {
        const hasValue = buffer.readUInt8(offset) !== 0;
        return { value: hasValue ? buffer.readUInt8(offset + 1) !== 0 : null, size: 2 };
      }
      case 'double':
        return { value: buffer.readDoubleLE(offset), size: 8 };
      case 'single':
        return { value: buffer.readFloatLE(offset), size: 4 };
      case 'decimal':
        return readDecimal(offset);
      case 'datetime':
        return readDateTime(offset);
      case 'sequence_guid':
        return readSequence(offset, 'guid');
      case 'sequence_uint16':
        return readSequence(offset, 'uint16');
      case 'sequence_string':
        return readSequence(offset, 'string');
      case 'sequence_command':
        return readSequence(offset, 'sequence_command_item');
      case 'sequence_action':
        return readSequence(offset, 'sequence_action_item');
      case 'sequence_sound':
        return readSequence(offset, 'sequence_sound_item');
      case 'sequence_condition':
        return readSequence(offset, 'sequence_condition_item');
      case 'sequence_condition_group':
        return readSequence(offset, 'sequence_condition');
      case 'sequence_command_item': {
        const value = readObject(offset, COMMAND_SCHEMA);
        if (!value) {
          return { value: null, size: 4 };
        }
        return { value, size: value.byteSize };
      }
      case 'sequence_action_item': {
        const value = readObject(offset, ACTION_SCHEMA);
        if (!value) {
          return { value: null, size: 4 };
        }
        return { value, size: value.byteSize };
      }
      case 'sequence_sound_item': {
        const value = readObject(offset, SOUND_SCHEMA);
        if (!value) {
          return { value: null, size: 4 };
        }
        return { value, size: value.byteSize };
      }
      case 'sequence_condition_item': {
        const value = readObject(offset, CONDITION_SCHEMA);
        if (!value) {
          return { value: null, size: 4 };
        }
        return { value, size: value.byteSize };
      }
      default:
        throw new Error(`Unsupported VoiceAttack schema type: ${type as string}`);
    }
  };

  return {
    buffer,
    readObject,
  };
};

const getDecodedValue = <T>(decoded: DecodedObject, name: string, fallback: T): T => (
  decoded.values.has(name) ? decoded.values.get(name) as T : fallback
);

const buildUnknownFields = (
  decoded: DecodedObject,
  schema: readonly SchemaField[],
  handledFields: Set<string>,
): VoiceAttackNeutralUnknownField[] => {
  const schemaByName = new Map(schema.map((field) => [field.name, field]));
  const valueFields = schema
    .filter((field) => !handledFields.has(field.name) && decoded.values.has(field.name))
    .map((field) => {
      const value = decoded.values.get(field.name);
      return {
        index: field.index,
        name: field.name,
        valueType: schemaByName.get(field.name)?.type ?? 'unknown',
        valueText: formatUnknownValue(value),
      };
    });
  const issueFields = decoded.issues
    .filter((issue) => !handledFields.has(issue.name))
    .map((issue) => ({
      index: issue.index,
      name: issue.name,
      valueType: issue.type,
      valueText: `decode_error: ${issue.message}`,
    }));
  return [...valueFields, ...issueFields];
};

const formatUnknownValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `collection[${value.length}]`;
  }
  if (typeof value === 'object' && value && 'byteSize' in (value as Record<string, unknown>)) {
    return `object[${(value as { byteSize: number }).byteSize}]`;
  }
  return JSON.stringify(value);
};

const mapSoundReference = (decoded: DecodedObject | null): VoiceAttackNeutralSoundReference | null => {
  if (!decoded) {
    return null;
  }
  return {
    soundId: getDecodedValue(decoded, 'Id', ''),
    location: getDecodedValue(decoded, 'Location', null),
    volume: getDecodedValue(decoded, 'Volume', 0),
    complete: getDecodedValue(decoded, 'Complete', false),
    wait: getDecodedValue(decoded, 'Wait', false),
    pan: getDecodedValue(decoded, 'Pan', 0),
    channel: getDecodedValue(decoded, 'Channel', ''),
  };
};

const mapCondition = (decoded: DecodedObject | null): VoiceAttackNeutralCondition | null => {
  if (!decoded) {
    return null;
  }
  return {
    conditionId: getDecodedValue(decoded, 'Id', ''),
    conditionStartType: getDecodedValue(decoded, 'ConditionStartType', 0),
    conditionStartNameFrom: getDecodedValue(decoded, 'ConditionStartNameFrom', null),
    conditionStartValueType: getDecodedValue(decoded, 'ConditionStartValueType', 0),
    conditionStartValue: getDecodedValue(decoded, 'ConditionStartValue', 0),
    conditionStartCompareToCondition: getDecodedValue(decoded, 'ConditionStartCompareToCondtion', null),
    z: getDecodedValue(decoded, 'Z', 0),
    conditionStartOperator: getDecodedValue(decoded, 'ConditionStartOperator', 0),
    context2: getDecodedValue(decoded, 'Context2', null),
    dateContext1: getDecodedValue(decoded, 'DateContext1', null),
    decimalContext1: getDecodedValue(decoded, 'DecimalContext1', null),
  };
};

const mapAction = (decoded: DecodedObject | null): VoiceAttackNeutralAction | null => {
  if (!decoded) {
    return null;
  }
  const actionTypeValue = getDecodedValue(decoded, 'ActionType', -1);
  return {
    actionId: getDecodedValue(decoded, 'Id', ''),
    actionTypeName: ACTION_TYPE_NAMES[actionTypeValue] ?? `Unknown(${actionTypeValue})`,
    actionTypeValue,
    delaySeconds: getDecodedValue(decoded, 'Delay', 0),
    durationSeconds: getDecodedValue(decoded, 'Duration', 0),
    keyCodes: getDecodedValue(decoded, 'KeyCodes', []) as number[],
    context: getDecodedValue(decoded, 'Context', null),
    context2: getDecodedValue(decoded, 'Context2', null),
    context3: getDecodedValue(decoded, 'Context3', null),
    context4: getDecodedValue(decoded, 'Context4', null),
    context5: getDecodedValue(decoded, 'Context5', null),
    x: getDecodedValue(decoded, 'X', 0),
    y: getDecodedValue(decoded, 'Y', 0),
    z: getDecodedValue(decoded, 'Z', 0),
    inputMode: getDecodedValue(decoded, 'InputMode', 0),
    conditionSetName: getDecodedValue(decoded, 'ConditionSetName', null),
    conditionSetCondition: getDecodedValue(decoded, 'ConditionSetCondition', null),
    conditionPairing: getDecodedValue(decoded, 'ConditionPairing', 0),
    conditionGroup: getDecodedValue(decoded, 'ConditionGroup', 0),
    conditionStartNameFrom: getDecodedValue(decoded, 'ConditionStartNameFrom', null),
    conditionStartOperator: getDecodedValue(decoded, 'ConditionStartOperator', 0),
    conditionStartValue: getDecodedValue(decoded, 'ConditionStartValue', 0),
    conditionStartValueType: getDecodedValue(decoded, 'ConditionStartValueType', 0),
    conditionStartCompareToCondition: getDecodedValue(decoded, 'ConditionStartCompareToCondtion', null),
    conditionStartType: getDecodedValue(decoded, 'ConditionStartType', 0),
    decimalContext1: getDecodedValue(decoded, 'DecimalContext1', null),
    decimalContext2: getDecodedValue(decoded, 'DecimalContext2', null),
    dateContext1: getDecodedValue(decoded, 'DateContext1', null),
    dateContext2: getDecodedValue(decoded, 'DateContext2', null),
    disabled: getDecodedValue(decoded, 'Disabled', false),
    integerContext1: getDecodedValue(decoded, 'IntegerContext1', 0),
    integerContext2: getDecodedValue(decoded, 'IntegerContext2', 0),
    randomSounds: (getDecodedValue(decoded, 'RandomSounds', []) as Array<DecodedObject | null>)
      .map((item) => mapSoundReference(item))
      .filter((item): item is VoiceAttackNeutralSoundReference => Boolean(item)),
    conditionExpressions: (getDecodedValue(decoded, 'ConditionExpressions', []) as Array<Array<DecodedObject | null> | null>)
      .map((group) => (group ?? [])
        .map((item) => mapCondition(item))
        .filter((item): item is VoiceAttackNeutralCondition => Boolean(item))),
    unknownFields: buildUnknownFields(
      decoded,
      ACTION_SCHEMA,
      new Set([
        'Id',
        'ActionType',
        'Delay',
        'Duration',
        'KeyCodes',
        'Context',
        'Context2',
        'Context3',
        'Context4',
        'Context5',
        'X',
        'Y',
        'Z',
        'InputMode',
        'ConditionSetName',
        'ConditionSetCondition',
        'ConditionPairing',
        'ConditionGroup',
        'ConditionStartNameFrom',
        'ConditionStartOperator',
        'ConditionStartValue',
        'ConditionStartValueType',
        'ConditionStartCompareToCondtion',
        'ConditionStartType',
        'DecimalContext1',
        'DecimalContext2',
        'DateContext1',
        'DateContext2',
        'Disabled',
        'RandomSounds',
        'ConditionExpressions',
        'IntegerContext1',
        'IntegerContext2',
      ]),
    ),
  };
};

const mapCommand = (decoded: DecodedObject | null): VoiceAttackNeutralCommand | null => {
  if (!decoded) {
    return null;
  }
  const commandTypeValue = getDecodedValue(decoded, 'CommandType', 0);
  return {
    commandId: getDecodedValue(decoded, 'Id', ''),
    internalId: getDecodedValue(decoded, 'InternalId', null),
    commandString: getDecodedValue(decoded, 'CommandString', ''),
    label: getDecodedValue(decoded, 'Name', null),
    description: getDecodedValue(decoded, 'Description', null),
    category: getDecodedValue(decoded, 'Category', null),
    enabled: getDecodedValue(decoded, 'Enabled', false),
    async: getDecodedValue(decoded, 'Async', false),
    useSpokenPhrase: getDecodedValue(decoded, 'UseSpokenPhrase', null),
    useShortcut: getDecodedValue(decoded, 'UseShortcut', false),
    repeatNumber: Math.max(1, getDecodedValue(decoded, 'RepeatNumber', 1)),
    repeatType: getDecodedValue(decoded, 'RepeatType', 0),
    commandType: commandTypeValue,
    commandTypeName: COMMAND_TYPE_NAMES[commandTypeValue] ?? `Unknown(${commandTypeValue})`,
    onlyKeyUp: getDecodedValue(decoded, 'onlyKeyUp', false),
    useMouse: getDecodedValue(decoded, 'UseMouse', false),
    useJoystick: getDecodedValue(decoded, 'UseJoystick', false),
    useVariableHotkey: getDecodedValue(decoded, 'UseVariableHotkey', false),
    variableHotkey: getDecodedValue(decoded, 'VariableHotkey', null),
    useVariableMouseShortcut: getDecodedValue(decoded, 'UseVariableMouseShortcut', false),
    variableMouseShortcut: getDecodedValue(decoded, 'VariableMouseShortcut', null),
    useVariableJoystickShortcut: getDecodedValue(decoded, 'UseVariableJoystickShortcut', false),
    variableJoystickShortcut: getDecodedValue(decoded, 'VariableJoystickShortcut', null),
    useProcessOverride: getDecodedValue(decoded, 'UseProcessOverride', false) || getDecodedValue(decoded, 'UseProfileProcessOverride', false),
    processOverride: getDecodedValue(decoded, 'ProcessOverride', null) ?? getDecodedValue(decoded, 'ProfileProcessOverride', null),
    processOverrideActiveWindow: getDecodedValue(decoded, 'ProcessOverrideActiveWindow', false) || getDecodedValue(decoded, 'ProfileProcessOverrideActiveWindow', false),
    actions: (getDecodedValue(decoded, 'ActionSequence', []) as Array<DecodedObject | null>)
      .map((item) => mapAction(item))
      .filter((item): item is VoiceAttackNeutralAction => Boolean(item)),
    unknownFields: buildUnknownFields(
      decoded,
      COMMAND_SCHEMA,
      new Set([
        'Id',
        'InternalId',
        'CommandString',
        'Name',
        'Description',
        'Category',
        'Enabled',
        'Async',
        'UseSpokenPhrase',
        'UseShortcut',
        'RepeatNumber',
        'RepeatType',
        'CommandType',
        'onlyKeyUp',
        'UseMouse',
        'UseJoystick',
        'UseVariableHotkey',
        'VariableHotkey',
        'UseVariableMouseShortcut',
        'VariableMouseShortcut',
        'UseVariableJoystickShortcut',
        'VariableJoystickShortcut',
        'UseProcessOverride',
        'ProcessOverride',
        'ProcessOverrideActiveWindow',
        'UseProfileProcessOverride',
        'ProfileProcessOverride',
        'ProfileProcessOverrideActiveWindow',
        'ActionSequence',
      ]),
    ),
  };
};

export const inspectBinaryVoiceAttackBuffer = (
  sourceBuffer: Buffer,
  sourceLabel: string,
): VoiceAttackBinaryInspectionResult => {
  const startedAt = Date.now();
  console.error('[voiceattack:binary:inspect:start]', {
    sourceLabel,
    compressedSize: sourceBuffer.length,
  });
  const inflatedBuffer = inflateRawSync(sourceBuffer);
  console.error('[voiceattack:binary:inspect:inflated]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
    inflatedSize: inflatedBuffer.length,
  });
  validateEnvelopeHeader(inflatedBuffer);
  console.error('[voiceattack:binary:inspect:header-valid]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
  });
  const reader = createBinaryReader(inflatedBuffer);
  console.error('[voiceattack:binary:inspect:read-root:start]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
  });
  const rootObject = reader.readObject(0, PROFILE_SCHEMA);
  console.error('[voiceattack:binary:inspect:read-root:done]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
    rootFieldCount: rootObject?.values.size ?? 0,
    rootIssueCount: rootObject?.issues.length ?? 0,
  });
  if (!rootObject) {
    throw new Error(`The binary VoiceAttack profile "${sourceLabel}" decoded to a null root object.`);
  }
  const commandObjects = getDecodedValue(rootObject, 'Commands', []) as Array<DecodedObject | null>;
  console.error('[voiceattack:binary:inspect:map-commands:start]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
    commandObjectCount: commandObjects.length,
  });

  const profile: VoiceAttackNeutralProfile = {
    profileId: getDecodedValue(rootObject, 'Id', ''),
    internalId: getDecodedValue(rootObject, 'InternalID', null),
    name: getDecodedValue(rootObject, 'Name', path.basename(sourceLabel, path.extname(sourceLabel))),
    exportVersion: getDecodedValue(rootObject, 'ExportVAVersion', null),
    defaultTts: getDecodedValue(rootObject, 'DefaultTTS', null),
    deleted: getDecodedValue(rootObject, 'Deleted', false),
    blockExternal: getDecodedValue(rootObject, 'BlockExternal', false),
    disableAdvancedTts: getDecodedValue(rootObject, 'DisableAdvancedTTS', false),
    excludeGlobalProfiles: getDecodedValue(rootObject, 'ExcludeGlobalProfiles', false),
    useProcessOverride: getDecodedValue(rootObject, 'UseProcessOverride', false),
    processOverride: getDecodedValue(rootObject, 'ProcessOverride', null),
    processOverrideActiveWindow: getDecodedValue(rootObject, 'ProcessOverrideAciveWindow', false),
    enableProfileSwitch: getDecodedValue(rootObject, 'EnableProfileSwitch', false),
    profileSwitchCriteria: getDecodedValue(rootObject, 'ProfileSwitchCriteria', null),
    commands: commandObjects
      .map((item) => mapCommand(item))
      .filter((item): item is VoiceAttackNeutralCommand => Boolean(item)),
    unknownFields: buildUnknownFields(
      rootObject,
      PROFILE_SCHEMA,
      new Set([
        'Id',
        'InternalID',
        'Name',
        'ExportVAVersion',
        'DefaultTTS',
        'Deleted',
        'BlockExternal',
        'DisableAdvancedTTS',
        'ExcludeGlobalProfiles',
        'UseProcessOverride',
        'ProcessOverride',
        'ProcessOverrideAciveWindow',
        'EnableProfileSwitch',
        'ProfileSwitchCriteria',
        'Commands',
      ]),
    ),
  };
  console.error('[voiceattack:binary:inspect:map-commands:done]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
    commandCount: profile.commands.length,
    actionCount: profile.commands.reduce(
      (total, command) => total + command.actions.length,
      0,
    ),
  });

  const diagnostics = buildEnvelopeDiagnostics('binary_deflate_profile2', sourceBuffer, inflatedBuffer);
  console.error('[voiceattack:binary:inspect:diagnostics-built]', {
    sourceLabel,
    elapsedMs: Date.now() - startedAt,
    propertyOffsetCount: diagnostics.propertyOffsets.length,
    printableStringCount: diagnostics.printableStrings.length,
    structuralSignatureCount: diagnostics.repeatedStructuralSignatures.length,
  });
  const actionTypeCounts: Record<string, number> = {};
  profile.commands.forEach((command) => {
    command.actions.forEach((action) => {
      actionTypeCounts[action.actionTypeName] = (actionTypeCounts[action.actionTypeName] ?? 0) + 1;
    });
  });

  return {
    diagnostics,
    profile,
    actionTypeCounts,
  };
};

export const inspectVoiceAttackBufferFormat = (
  sourceBuffer: Buffer,
): {
  sourceFormat: VoiceAttackBinarySourceFormat;
  decodedXml: string | null;
  diagnostics: VoiceAttackEnvelopeDiagnostics;
} => {
  const decodedXml = decodeXmlBuffer(sourceBuffer);
  if (decodedXml) {
    return {
      sourceFormat: 'xml',
      decodedXml,
      diagnostics: buildEnvelopeDiagnostics('xml', sourceBuffer, null),
    };
  }

  try {
    const inflated = inflateRawSync(sourceBuffer);
    validateEnvelopeHeader(inflated);
    return {
      sourceFormat: 'binary_deflate_profile2',
      decodedXml: null,
      diagnostics: buildEnvelopeDiagnostics('binary_deflate_profile2', sourceBuffer, inflated),
    };
  } catch {
    return {
      sourceFormat: 'unknown',
      decodedXml: null,
      diagnostics: buildEnvelopeDiagnostics('unknown', sourceBuffer, null),
    };
  }
};
