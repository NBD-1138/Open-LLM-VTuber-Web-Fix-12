import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  inspectBinaryVoiceAttackBuffer,
  inspectVoiceAttackBufferFormat,
  inspectVoiceAttackPackageFile,
} from '../../src/main/automation/voiceattack-binary';
import {
  buildVoiceAttackImportedProfile,
  getVoiceAttackPreview,
  inspectVoiceAttackSourcePath,
} from '../../src/main/automation/voiceattack-importer';
import { runVoiceAttackHelperProcess } from '../../src/main/automation/voiceattack-helper';

const PROFILE_LAST_INDEX = 89;
const COMMAND_LAST_INDEX = 82;
const ACTION_LAST_INDEX = 32;

const createTempDir = async (prefix: string): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), prefix));

const encodeInt32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
};

const encodeUInt16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

const encodeBoolean = (value: boolean): Buffer => Buffer.from([value ? 1 : 0]);

const encodeNullableBoolean = (value: boolean | null): Buffer => (
  value === null ? Buffer.from([0, 0]) : Buffer.from([1, value ? 1 : 0])
);

const encodeDouble = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value, 0);
  return buffer;
};

const encodeString = (value: string | null): Buffer => (
  value === null
    ? encodeInt32(-1)
    : Buffer.concat([encodeInt32(Buffer.byteLength(value, 'utf8')), Buffer.from(value, 'utf8')])
);

const encodeGuid = (seed: number): Buffer => {
  const buffer = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) {
    buffer[index] = (seed + index) & 0xff;
  }
  return buffer;
};

const encodeSequence = (items: Buffer[]): Buffer => Buffer.concat([encodeInt32(items.length), ...items]);

const encodeObject = (lastIndex: number, fields: Map<number, Buffer>): Buffer => {
  const headerSize = 8 + ((lastIndex + 1) * 4);
  const offsets = new Array<number>(lastIndex + 1).fill(0);
  const valueChunks: Buffer[] = [];
  let cursor = headerSize;

  Array.from(fields.entries())
    .sort((left, right) => left[0] - right[0])
    .forEach(([index, value]) => {
      offsets[index] = cursor;
      valueChunks.push(value);
      cursor += value.length;
    });

  const header = Buffer.alloc(headerSize);
  header.writeInt32LE(cursor, 0);
  header.writeInt32LE(lastIndex, 4);
  offsets.forEach((offset, index) => {
    header.writeInt32LE(offset, 8 + (index * 4));
  });
  return Buffer.concat([header, ...valueChunks]);
};

const encodeAction = (options: {
  seed: number;
  actionType: number;
  delaySeconds?: number;
  durationSeconds?: number;
  keyCodes?: number[];
  context?: string | null;
  context2?: string | null;
  conditionStartNameFrom?: string | null;
  conditionStartOperator?: number;
  conditionStartValue?: number;
  conditionStartValueType?: number;
  conditionStartCompareToCondition?: string | null;
  conditionStartType?: number;
}): Buffer => {
  const fields = new Map<number, Buffer>();
  fields.set(0, encodeGuid(options.seed));
  fields.set(1, encodeInt32(options.actionType));
  if (options.durationSeconds !== undefined) {
    fields.set(2, encodeDouble(options.durationSeconds));
  }
  if (options.delaySeconds !== undefined) {
    fields.set(3, encodeDouble(options.delaySeconds));
  }
  if (options.keyCodes) {
    fields.set(4, encodeSequence(options.keyCodes.map((code) => encodeUInt16(code))));
  }
  if (options.context !== undefined) {
    fields.set(5, encodeString(options.context ?? null));
  }
  if (options.context2 !== undefined) {
    fields.set(6, encodeString(options.context2 ?? null));
  }
  if (options.conditionStartNameFrom !== undefined) {
    fields.set(18, encodeString(options.conditionStartNameFrom ?? null));
  }
  if (options.conditionStartOperator !== undefined) {
    fields.set(19, encodeInt32(options.conditionStartOperator));
  }
  if (options.conditionStartValue !== undefined) {
    fields.set(20, encodeInt32(options.conditionStartValue));
  }
  if (options.conditionStartValueType !== undefined) {
    fields.set(21, encodeInt32(options.conditionStartValueType));
  }
  if (options.conditionStartCompareToCondition !== undefined) {
    fields.set(22, encodeString(options.conditionStartCompareToCondition ?? null));
  }
  if (options.conditionStartType !== undefined) {
    fields.set(23, encodeInt32(options.conditionStartType));
  }
  return encodeObject(ACTION_LAST_INDEX, fields);
};

const encodeCommand = (options: {
  seed: number;
  commandString: string;
  name: string;
  description: string;
  category: string;
  actions: Buffer[];
  useSpokenPhrase?: boolean | null;
  useShortcut?: boolean;
  enabled?: boolean;
}): Buffer => {
  const fields = new Map<number, Buffer>();
  fields.set(0, encodeGuid(options.seed));
  fields.set(1, encodeString(options.commandString));
  fields.set(2, encodeSequence(options.actions));
  fields.set(4, encodeBoolean(options.enabled ?? true));
  fields.set(5, encodeString(options.name));
  fields.set(6, encodeString(options.description));
  fields.set(7, encodeString(options.category));
  fields.set(8, encodeBoolean(options.useShortcut ?? false));
  fields.set(15, encodeNullableBoolean(options.useSpokenPhrase ?? true));
  fields.set(17, encodeInt32(1));
  fields.set(18, encodeInt32(0));
  fields.set(19, encodeInt32(0));
  return encodeObject(COMMAND_LAST_INDEX, fields);
};

const encodeProfile = (options: {
  seed: number;
  name: string;
  exportVersion?: string;
  commands: Buffer[];
}): Buffer => {
  const fields = new Map<number, Buffer>();
  fields.set(0, encodeGuid(options.seed));
  fields.set(1, encodeString(options.name));
  fields.set(2, encodeSequence(options.commands));
  fields.set(32, encodeString(options.exportVersion ?? '1.16'));
  return encodeObject(PROFILE_LAST_INDEX, fields);
};

const buildBinaryVapBuffer = (profile: Buffer): Buffer => deflateRawSync(profile);

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const createZipBuffer = (entries: Array<{
  name: string;
  data: Buffer;
  compressedData?: Buffer;
  compressionMethod?: 0 | 8;
  declaredUncompressedSize?: number;
}>): Buffer => {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const compressedData = entry.compressedData ?? entry.data;
    const compressionMethod = entry.compressionMethod ?? 0;
    const declaredUncompressedSize = entry.declaredUncompressedSize ?? entry.data.length;
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(declaredUncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBytes, compressedData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(declaredUncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressedData.length;
  });

  const centralDirectory = Buffer.concat(centralChunks);
  const localSection = Buffer.concat(localChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localSection.length, 16);
  endRecord.writeUInt16LE(0, 20);
  return Buffer.concat([localSection, centralDirectory, endRecord]);
};

const createSampleBinaryProfile = (): Buffer => {
  const helperCommand = encodeCommand({
    seed: 32,
    commandString: 'helper action',
    name: 'Helper Action',
    description: 'Nested helper action.',
    category: 'testing',
    actions: [
      encodeAction({ seed: 41, actionType: 0, durationSeconds: 0.05, keyCodes: [66] }),
    ],
    useSpokenPhrase: false,
  });

  const mainCommand = encodeCommand({
    seed: 12,
    commandString: 'type hello; test hello',
    name: 'Type Hello',
    description: 'Testing key output.',
    category: 'testing',
    actions: [
      encodeAction({ seed: 21, actionType: 0, durationSeconds: 0.07, keyCodes: [65] }),
      encodeAction({ seed: 22, actionType: 2, durationSeconds: 0.25 }),
      encodeAction({ seed: 23, actionType: 16, context2: 'helper action' }),
      encodeAction({ seed: 24, actionType: 123, context: 'opaque action payload' }),
      encodeAction({ seed: 25, actionType: 14, context: '{VA_SOUNDS}\\secret.wav' }),
    ],
  });

  return buildBinaryVapBuffer(encodeProfile({
    seed: 2,
    name: 'Binary Fixture',
    commands: [mainCommand, helperCommand],
  }));
};

test('voiceattack binary detector recognizes raw-deflate Profile2 payloads deterministically', () => {
  const binaryVap = createSampleBinaryProfile();
  const detected = inspectVoiceAttackBufferFormat(binaryVap);
  assert.equal(detected.sourceFormat, 'binary_deflate_profile2');

  const first = inspectBinaryVoiceAttackBuffer(binaryVap, 'binary-fixture.vap');
  const second = inspectBinaryVoiceAttackBuffer(binaryVap, 'binary-fixture.vap');
  assert.equal(first.profile.name, 'Binary Fixture');
  assert.equal(first.profile.commands.length, 2);
  assert.equal(first.profile.commands[0]?.actions[0]?.actionTypeName, 'PressKey');
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test('voiceattack binary decoder rejects malformed headers and invalid offsets safely', () => {
  const binaryVap = createSampleBinaryProfile();
  const originalInflated = Buffer.from(inflateRawSync(binaryVap));
  const badLength = Buffer.from(originalInflated);
  badLength.writeInt32LE(originalInflated.length + 10, 0);
  assert.throws(
    () => inspectBinaryVoiceAttackBuffer(deflateRawSync(badLength), 'bad-length.vap'),
    /length mismatch/i,
  );

  const badOffset = Buffer.from(originalInflated);
  badOffset.writeInt32LE(originalInflated.length + 25, 8 + (2 * 4));
  assert.throws(
    () => inspectBinaryVoiceAttackBuffer(deflateRawSync(badOffset), 'bad-offset.vap'),
    /outside the inflated buffer|outside the declared object range/i,
  );
});

test('voiceattack importer preserves unknown actions and nested command ordering from binary profiles', async () => {
  const tempDir = await createTempDir('voiceattack-binary-import-');
  const filePath = path.join(tempDir, 'binary-fixture.vap');
  await fs.writeFile(filePath, createSampleBinaryProfile());

  const session = await inspectVoiceAttackSourcePath(filePath, new AbortController().signal);
  assert.equal(session.inspection.candidateProfileCount, 1);
  const preview = getVoiceAttackPreview(session, session.inspection.candidates[0].candidateId);
  assert.equal(preview.decoderStatus, 'binary_profile2_manual_schema');
  assert.equal(preview.commandCount, 2);
  assert.equal(preview.embeddedProfiles.length, 0);
  assert.equal(preview.packageEntries.length, 0);

  const command = preview.commands.find((entry) => entry.label === 'Type Hello');
  assert.ok(command);
  assert.equal(command?.actionTypes.includes('Unknown(123)'), true);
  assert.equal(command?.actions.some((action) => action.supportStatus === 'unsupported'), true);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack importer maps write-log and mic listening actions from binary profiles', async () => {
  const tempDir = await createTempDir('voiceattack-binary-log-mic-');
  const filePath = path.join(tempDir, 'log-mic.vap');
  await fs.writeFile(filePath, buildBinaryVapBuffer(encodeProfile({
    seed: 12,
    name: 'Binary Log Mic Fixture',
    commands: [
      encodeCommand({
        seed: 120,
        commandString: 'log command',
        name: 'log command',
        description: '',
        category: 'testing',
        actions: [encodeAction({ seed: 121, actionType: 23, context: 'Waiting for response...' })],
      }),
      encodeCommand({
        seed: 130,
        commandString: 'listen command',
        name: 'listen command',
        description: '',
        category: 'testing',
        actions: [
          encodeAction({ seed: 131, actionType: 51 }),
          encodeAction({ seed: 132, actionType: 2, durationSeconds: 0.05 }),
          encodeAction({ seed: 133, actionType: 50 }),
        ],
      }),
    ],
  })));

  const session = await inspectVoiceAttackSourcePath(filePath, new AbortController().signal);
  const preview = getVoiceAttackPreview(session, session.inspection.candidates[0].candidateId);
  assert.equal(preview.supportedCommandCount, 2);

  const logPreview = preview.commands.find((command) => command.label === 'log command');
  assert.deepEqual(logPreview?.actionTypes, ['WriteToLog']);
  const listenPreview = preview.commands.find((command) => command.label === 'listen command');
  assert.deepEqual(listenPreview?.actionTypes, [
    'InternalProcess_StopListening',
    'Pause',
    'InternalProcess_StartListening',
  ]);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack importer preserves bounded binary conditionals as action trees', async () => {
  const tempDir = await createTempDir('voiceattack-binary-flow-');
  const filePath = path.join(tempDir, 'flow.vap');
  await fs.writeFile(filePath, buildBinaryVapBuffer(encodeProfile({
    seed: 40,
    name: 'Binary Flow Fixture',
    commands: [
      encodeCommand({
        seed: 401,
        commandString: 'conditional command',
        name: 'Conditional Command',
        description: '',
        category: 'testing',
        actions: [
          encodeAction({
            seed: 402,
            actionType: 19,
            conditionStartNameFrom: '~~hardpointsDeployed',
            conditionStartOperator: 1,
            conditionStartValue: 1,
            conditionStartValueType: 0,
            conditionStartType: 2,
          }),
          encodeAction({ seed: 403, actionType: 0, durationSeconds: 0.01, keyCodes: [66] }),
          encodeAction({ seed: 404, actionType: 29 }),
          encodeAction({ seed: 405, actionType: 0, durationSeconds: 0.01, keyCodes: [67] }),
          encodeAction({ seed: 406, actionType: 20 }),
        ],
      }),
    ],
  })));

  const session = await inspectVoiceAttackSourcePath(filePath, new AbortController().signal);
  const preview = getVoiceAttackPreview(session, session.inspection.candidates[0].candidateId);
  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const command = profile.commands.find((entry) => entry.label === 'Conditional Command');
  const actionTree = command?.voiceAttack?.actionTree ?? [];
  assert.equal(actionTree[0]?.kind, 'if');
  if (actionTree[0]?.kind === 'if') {
    assert.equal(actionTree[0].condition.left.kind, 'state_path');
    if (actionTree[0].condition.left.kind === 'state_path') {
      assert.equal(actionTree[0].condition.left.path, 'ship.hardpointsDeployed');
    }
    assert.equal(actionTree[0].thenNodes[0]?.kind, 'key_press');
    assert.equal(actionTree[0].elseNodes[0]?.kind, 'key_press');
  }

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack importer infers supercruise hardpoint preconditions', async () => {
  const tempDir = await createTempDir('voiceattack-binary-supercruise-');
  const filePath = path.join(tempDir, 'supercruise.vap');
  await fs.writeFile(filePath, buildBinaryVapBuffer(encodeProfile({
    seed: 50,
    name: 'Elite Fixture',
    commands: [
      encodeCommand({
        seed: 501,
        commandString: 'engage supercruise',
        name: 'Engage Supercruise',
        description: 'Engage the frame shift drive.',
        category: 'elite',
        actions: [encodeAction({ seed: 502, actionType: 0, durationSeconds: 0.01, keyCodes: [74] })],
      }),
    ],
  })));

  const session = await inspectVoiceAttackSourcePath(filePath, new AbortController().signal);
  const preview = getVoiceAttackPreview(session, session.inspection.candidates[0].candidateId);
  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const command = profile.commands.find((entry) => entry.label === 'Engage Supercruise');
  const contract = command?.voiceAttack?.semanticContract;
  assert.equal(contract?.capabilityId, 'elite.engage_supercruise');
  assert.equal(contract?.fallbackWhenUnavailable, 'block');
  assert.ok(contract?.preconditions.some((predicate) =>
    predicate.path === 'ship.hardpointsDeployed' &&
    predicate.operator === 'not_equals' &&
    predicate.value === true,
  ));

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack package reader blocks traversal and oversize entries without extraction', async () => {
  const profileData = createSampleBinaryProfile();
  const blockedZip = createZipBuffer([
    { name: '../evil.vap', data: profileData },
  ]);
  const tempDir = await createTempDir('voiceattack-vax-safety-');
  const blockedPath = path.join(tempDir, 'blocked.vax');
  await fs.writeFile(blockedPath, blockedZip);

  await assert.rejects(
    () => inspectVoiceAttackPackageFile(blockedPath),
    /safety rules|size\/path safety/i,
  );

  const oversizedZip = createZipBuffer([
    {
      name: 'too-large.vap',
      data: Buffer.alloc(0),
      declaredUncompressedSize: (64 * 1024 * 1024) + 1,
    },
  ]);
  const oversizedPath = path.join(tempDir, 'oversized.vax');
  await fs.writeFile(oversizedPath, oversizedZip);

  await assert.rejects(
    () => inspectVoiceAttackPackageFile(oversizedPath),
    /safety rules|size limit|size\/path safety/i,
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack importer supports multiple embedded profiles in a VAX package', async () => {
  const alphaProfile = buildBinaryVapBuffer(encodeProfile({
    seed: 4,
    name: 'Alpha Profile',
    commands: [
      encodeCommand({
        seed: 10,
        commandString: 'alpha command',
        name: 'Alpha Command',
        description: 'Alpha description.',
        category: 'alpha',
        actions: [encodeAction({ seed: 11, actionType: 0, keyCodes: [65], durationSeconds: 0.05 })],
      }),
    ],
  }));
  const betaProfile = buildBinaryVapBuffer(encodeProfile({
    seed: 8,
    name: 'Beta Profile',
    commands: [
      encodeCommand({
        seed: 20,
        commandString: 'beta command',
        name: 'Beta Command',
        description: 'Beta description.',
        category: 'beta',
        actions: [encodeAction({ seed: 21, actionType: 2, durationSeconds: 0.1 })],
      }),
    ],
  }));

  const zip = createZipBuffer([
    { name: 'Alpha.vap', data: alphaProfile },
    { name: 'Beta.vap', data: betaProfile },
  ]);

  const tempDir = await createTempDir('voiceattack-vax-multi-');
  const vaxPath = path.join(tempDir, 'multi.vax');
  await fs.writeFile(vaxPath, zip);

  const session = await inspectVoiceAttackSourcePath(vaxPath, new AbortController().signal);
  assert.equal(session.inspection.candidateProfileCount, 2);
  assert.equal(session.inspection.parseableFileCount, 2);

  const profileNames = session.inspection.candidates.map((candidate) => candidate.profileName).sort();
  assert.deepEqual(profileNames, ['Alpha Profile', 'Beta Profile']);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('voiceattack helper runner enforces timeouts for out-of-process decoder work', async () => {
  await assert.rejects(
    () => runVoiceAttackHelperProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => console.log("late"), 250)'],
      timeoutMs: 50,
    }),
    /timed out/i,
  );
});
