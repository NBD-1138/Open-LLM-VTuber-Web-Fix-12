import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectVoiceAttackSourcePath,
  getVoiceAttackPreview,
  buildVoiceAttackImportedProfile,
} from "../../src/main/automation/voiceattack-importer";
import { AutomationProfileStore } from "../../src/main/automation/profile-store";
import { AutomationManager } from "../../src/main/automation/manager";
import { KeyboardInputAdapter } from "../../src/main/automation/input-adapter";
import type {
  ValidKeyIdentifier,
  ValidModifierKey,
} from "../../src/shared/automation/schema";

class SilentKeyboardAdapter implements KeyboardInputAdapter {
  async keyTap(_key: ValidKeyIdentifier): Promise<void> {}

  async keyDown(_key: ValidKeyIdentifier): Promise<void> {}

  async keyUp(_key: ValidKeyIdentifier): Promise<void> {}

  async keyCombination(
    _modifiers: ValidModifierKey[],
    _key: ValidKeyIdentifier,
  ): Promise<void> {}

  async releaseAll(_keys: Iterable<ValidKeyIdentifier>): Promise<void> {}
}

const wrapAction = (inner: string): string =>
  `<CommandAction>${inner}</CommandAction>`;

const pauseAction = (durationSeconds: number, delaySeconds = 0): string =>
  wrapAction(`
  <ActionType>Pause</ActionType>
  <Duration>${durationSeconds}</Duration>
  <Delay>${delaySeconds}</Delay>
  <KeyCodes />
`);

const pressKeyAction = (
  keyCodes: number[],
  durationSeconds = 0.07,
  delaySeconds = 0,
): string =>
  wrapAction(`
  <ActionType>PressKey</ActionType>
  <Duration>${durationSeconds}</Duration>
  <Delay>${delaySeconds}</Delay>
  <KeyCodes>${keyCodes.map((code) => `<unsignedShort>${code}</unsignedShort>`).join("")}</KeyCodes>
`);

const executeCommandAction = (targetPhrase: string, delaySeconds = 0): string =>
  wrapAction(`
  <ActionType>ExecuteCommand</ActionType>
  <Duration>0</Duration>
  <Delay>${delaySeconds}</Delay>
  <KeyCodes />
  <Context>00000000-0000-0000-0000-000000000000</Context>
  <Context2>${targetPhrase}</Context2>
`);

const soundFileAction = (soundPath: string): string =>
  wrapAction(`
  <ActionType>SoundFile</ActionType>
  <Duration>0</Duration>
  <Delay>0</Delay>
  <KeyCodes />
  <Context>${soundPath}</Context>
`);

const sayAction = (line: string): string =>
  wrapAction(`
  <ActionType>Say</ActionType>
  <Duration>0</Duration>
  <Delay>0</Delay>
  <KeyCodes />
  <Context>${line}</Context>
`);

const writeToLogAction = (message: string): string =>
  wrapAction(`
  <ActionType>WriteToLog</ActionType>
  <Duration>0</Duration>
  <Delay>0</Delay>
  <KeyCodes />
  <Context>${message}</Context>
`);

const internalProcessAction = (
  actionType:
    | "InternalProcess_StartListening"
    | "InternalProcess_StopListening",
): string =>
  wrapAction(`
  <ActionType>${actionType}</ActionType>
  <Duration>0</Duration>
  <Delay>0</Delay>
  <KeyCodes />
`);

const customAction = (actionType: string): string =>
  wrapAction(`
  <ActionType>${actionType}</ActionType>
  <Duration>0</Duration>
  <Delay>0</Delay>
  <KeyCodes />
`);

const commandXml = (
  commandString: string,
  actions: string[],
  options?: {
    useSpokenPhrase?: boolean;
    useShortcut?: boolean;
    repeatNumber?: number;
    repeatType?: number;
  },
): string => `
  <Command>
    <CommandString>${commandString}</CommandString>
    <ActionSequence>${actions.join("")}</ActionSequence>
    <UseShortcut>${options?.useShortcut ? "true" : "false"}</UseShortcut>
    <UseSpokenPhrase>${options?.useSpokenPhrase === false ? "false" : "true"}</UseSpokenPhrase>
    <RepeatNumber>${options?.repeatNumber ?? 1}</RepeatNumber>
    <RepeatType>${options?.repeatType ?? 0}</RepeatType>
    <CommandType>0</CommandType>
    <Enabled>true</Enabled>
  </Command>
`;

const profileXml = (
  profileName: string,
  version: string,
  commands: string[],
): string => `<?xml version="1.0" encoding="utf-8"?>
<Profile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Name>${profileName}</Name>
  <ExportVAVersion>${version}</ExportVAVersion>
  <Commands>
    ${commands.join("\n")}
  </Commands>
</Profile>
`;

const createTempDir = async (prefix: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), prefix));

const createManagerHarness = async (userDataDir: string) => {
  const store = new AutomationProfileStore(userDataDir);
  await store.ensureInitialized();
  const manager = new AutomationManager({
    store,
    keyboardAdapter: new SilentKeyboardAdapter(),
    hotkeyApi: {
      register: () => true,
      unregister: () => undefined,
    },
    dialogApi: {
      openImportFile: async () => null,
      openExportFile: async () => null,
      openTelemetryDirectory: async () => null,
      openVoiceAttackSource: async () => null,
    },
    emitEvent: () => undefined,
  });
  await manager.initialize();
  return { manager, store };
};

test("voiceattack importer builds disabled review-required drafts and omits proprietary response content", async () => {
  const tempDir = await createTempDir("voiceattack-import-");
  const filePath = path.join(tempDir, "fixture.vap");
  const spokenResponse = "TOP SECRET RESPONSE";
  const soundPath = "{VA_SOUNDS}\\private-pack\\secret.wav";
  await fs.writeFile(
    filePath,
    profileXml("Fixture Profile", "1.7.3", [
      commandXml("main command; alternate phrase", [
        soundFileAction(soundPath),
        pauseAction(0.05),
        pressKeyAction([65], 0.072),
      ]),
      commandXml("helper command", [
        pauseAction(0.05),
        pressKeyAction([17, 65], 0.02),
      ]),
      commandXml("say command", [sayAction(spokenResponse)]),
      commandXml("call helper", [executeCommandAction("helper command", 0.1)]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  assert.equal(session.inspection.candidateProfileCount, 1);
  assert.equal(session.inspection.parseableFileCount, 1);

  const candidateId = session.inspection.candidates[0].candidateId;
  const preview = getVoiceAttackPreview(session, candidateId);
  assert.equal(preview.commandCount, 4);
  assert.equal(preview.supportedCommandCount, 2);
  assert.equal(preview.partiallySupportedCommandCount, 2);
  assert.ok(!JSON.stringify(preview).includes(soundPath));
  assert.ok(!JSON.stringify(preview).includes(spokenResponse));

  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  assert.equal(profile.enabled, false);
  assert.equal(profile.importMetadata?.reviewStatus, "required");
  assert.equal(profile.importMetadata?.sourceBasename, "fixture.vap");
  assert.ok(!JSON.stringify(profile).includes(tempDir));
  assert.ok(
    profile.commands.every(
      (command) =>
        command.allowedTriggerSources.length === 1 &&
        command.allowedTriggerSources[0] === "manual",
    ),
  );
  assert.ok(
    profile.commands.every((command) => command.autonomyPolicy === "disabled"),
  );
  assert.ok(
    profile.commands.some((command) =>
      command.steps.some((step) => step.type === "response_placeholder"),
    ),
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer rejects malformed and unsupported-version profiles without leaking source paths", async () => {
  const tempDir = await createTempDir("voiceattack-invalid-");
  const malformedPath = path.join(tempDir, "broken.vap");
  const unsupportedPath = path.join(tempDir, "future.vap");
  await fs.writeFile(
    malformedPath,
    "<Profile><Name>Broken</Name><Commands>",
    "utf8",
  );
  await fs.writeFile(
    unsupportedPath,
    profileXml("Future Profile", "2.0.0", [
      commandXml("unsupported", [pressKeyAction([65])]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  assert.equal(session.inspection.parseableFileCount, 0);
  assert.equal(session.inspection.unparseableFileCount, 2);
  session.inspection.candidates.forEach((candidate) => {
    assert.ok(candidate.parseError);
    assert.ok(!candidate.parseError?.includes(tempDir));
  });

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer maps key combinations, key transitions, repeats, recursion, and unresolved nesting", async () => {
  const tempDir = await createTempDir("voiceattack-steps-");
  const filePath = path.join(tempDir, "steps.vap");
  await fs.writeFile(
    filePath,
    profileXml("Step Fixture", "1.7.3", [
      commandXml("combo command", [pressKeyAction([17, 65], 0.01)]),
      commandXml("hold command", [
        customAction("KeyDown").replace(
          "<KeyCodes />",
          "<KeyCodes><unsignedShort>16</unsignedShort></KeyCodes>",
        ),
        customAction("KeyUp").replace(
          "<KeyCodes />",
          "<KeyCodes><unsignedShort>16</unsignedShort></KeyCodes>",
        ),
      ]),
      commandXml("repeat command", [pressKeyAction([66], 0.01)], {
        repeatNumber: 3,
      }),
      commandXml("loop alpha", [executeCommandAction("loop beta")]),
      commandXml("loop beta", [executeCommandAction("loop alpha")]),
      commandXml("missing target", [executeCommandAction("missing command")]),
      commandXml("plugin action", [customAction("ExternalInvoke")]),
      commandXml("shell action", [customAction("RunCommand")]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  const preview = getVoiceAttackPreview(
    session,
    session.inspection.candidates[0].candidateId,
  );
  assert.ok(preview.recursionWarningCount >= 2);
  assert.ok(preview.unresolvedNestedReferenceCount >= 1);

  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const combo = profile.commands.find(
    (command) => command.label === "combo command",
  );
  assert.ok(combo?.steps.some((step) => step.type === "key_combination"));
  const hold = profile.commands.find(
    (command) => command.label === "hold command",
  );
  assert.ok(hold?.steps.some((step) => step.type === "key_down"));
  assert.ok(hold?.steps.some((step) => step.type === "key_up"));
  const repeat = profile.commands.find(
    (command) => command.label === "repeat command",
  );
  assert.equal(
    repeat?.steps.filter((step) => step.type === "key_press").length,
    3,
  );
  const recursive = profile.commands.find(
    (command) => command.label === "loop alpha",
  );
  assert.ok(
    recursive?.steps.some((step) => step.type === "unsupported_import_action"),
  );
  const unresolved = profile.commands.find(
    (command) => command.label === "missing target",
  );
  assert.ok(
    unresolved?.steps.some((step) => step.type === "unsupported_import_action"),
  );
  const plugin = profile.commands.find(
    (command) => command.label === "plugin action",
  );
  assert.ok(
    plugin?.steps.some((step) => step.type === "unsupported_import_action"),
  );
  const shell = profile.commands.find(
    (command) => command.label === "shell action",
  );
  assert.ok(
    shell?.steps.some((step) => step.type === "unsupported_import_action"),
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer maps write-log and mic listening actions", async () => {
  const tempDir = await createTempDir("voiceattack-log-mic-");
  const filePath = path.join(tempDir, "log-mic.vap");
  await fs.writeFile(
    filePath,
    profileXml("Log Mic Fixture", "1.7.3", [
      commandXml("log command", [writeToLogAction("Waiting for response...")]),
      commandXml("listen command", [
        internalProcessAction("InternalProcess_StopListening"),
        pauseAction(0.05),
        internalProcessAction("InternalProcess_StartListening"),
      ]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  const preview = getVoiceAttackPreview(
    session,
    session.inspection.candidates[0].candidateId,
  );
  assert.equal(preview.supportedCommandCount, 2);

  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const logCommand = profile.commands.find(
    (command) => command.label === "log command",
  );
  assert.deepEqual(logCommand?.steps, [
    { type: "write_log", message: "Waiting for response..." },
  ]);

  const listenCommand = profile.commands.find(
    (command) => command.label === "listen command",
  );
  assert.deepEqual(listenCommand?.steps, [
    { type: "set_mic_state", enabled: false },
    { type: "wait", milliseconds: 50 },
    { type: "set_mic_state", enabled: true },
  ]);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer discards nested audio command calls", async () => {
  const tempDir = await createTempDir("voiceattack-audio-calls-");
  const filePath = path.join(tempDir, "audio-calls.vap");
  await fs.writeFile(
    filePath,
    profileXml("Audio Call Fixture", "1.7.3", [
      commandXml("main command", [
        pressKeyAction([65], 0.01),
        executeCommandAction("play sound bucket ad astra"),
      ]),
      commandXml("play sound bucket ad astra", [
        soundFileAction("{VA_SOUNDS}\\ad-astra.wav"),
        executeCommandAction("play sound bucket ad astra"),
      ]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  const preview = getVoiceAttackPreview(
    session,
    session.inspection.candidates[0].candidateId,
  );
  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const mainCommand = profile.commands.find(
    (command) => command.label === "main command",
  );
  assert.ok(mainCommand?.steps.some((step) => step.type === "key_press"));
  assert.equal(
    mainCommand?.steps.some((step) => step.type === "run_macro"),
    false,
  );

  const audioCommand = profile.commands.find(
    (command) => command.label === "play sound bucket ad astra",
  );
  assert.equal(
    audioCommand?.steps.some((step) => step.type === "run_macro"),
    false,
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer splits long pause actions into schema-safe wait chunks", async () => {
  const tempDir = await createTempDir("voiceattack-long-wait-");
  const filePath = path.join(tempDir, "long-wait.vap");
  await fs.writeFile(
    filePath,
    profileXml("Long Wait Fixture", "1.7.3", [
      commandXml("long wait command", [pauseAction(125)]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  const preview = getVoiceAttackPreview(
    session,
    session.inspection.candidates[0].candidateId,
  );

  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [],
  );

  const longWaitCommand = profile.commands.find(
    (command) => command.label === "long wait command",
  );
  assert.deepEqual(longWaitCommand?.steps, [
    { type: "wait", milliseconds: 60_000 },
    { type: "wait", milliseconds: 60_000 },
    { type: "wait", milliseconds: 5_000 },
  ]);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("voiceattack importer supports partial imports, cancellation, and reviewed-vs-enabled separation", async () => {
  const tempDir = await createTempDir("voiceattack-partial-");
  const filePath = path.join(tempDir, "partial.vap");
  await fs.writeFile(
    filePath,
    profileXml("Partial Fixture", "1.7.3", [
      commandXml("ready command", [pressKeyAction([65], 0.01)]),
      commandXml("placeholder command", [
        soundFileAction("{VA_SOUNDS}\\private.wav"),
      ]),
    ]),
    "utf8",
  );

  const session = await inspectVoiceAttackSourcePath(
    tempDir,
    new AbortController().signal,
  );
  const preview = getVoiceAttackPreview(
    session,
    session.inspection.candidates[0].candidateId,
  );
  const readyCommand = preview.commands.find(
    (command) => command.label === "ready command",
  );
  assert.ok(readyCommand);

  const { profile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: [readyCommand.commandId],
    },
    [],
  );
  assert.equal(profile.commands.length, 1);

  const userDataDir = await createTempDir("voiceattack-manager-");
  const { manager, store } = await createManagerHarness(userDataDir);
  await store.saveProfile(profile);
  await assert.doesNotReject(() =>
    manager.validateImportedProfile(profile.profileId),
  );
  const reviewed = await manager.markImportedProfileReviewed(profile.profileId);
  assert.equal(reviewed.importMetadata?.reviewStatus, "reviewed");
  assert.equal(reviewed.enabled, false);

  const { profile: blockedProfile } = buildVoiceAttackImportedProfile(
    session,
    {
      importId: session.importId,
      candidateId: session.inspection.candidates[0].candidateId,
      selectedCommandIds: preview.commands.map((command) => command.commandId),
    },
    [reviewed.profileId],
  );
  await store.saveProfile(blockedProfile);
  await assert.rejects(
    () => manager.markImportedProfileReviewed(blockedProfile.profileId),
    /review/i,
  );

  const cancelDir = await createTempDir("voiceattack-cancel-");
  await fs.writeFile(
    path.join(cancelDir, "cancel.vap"),
    profileXml("Cancel Fixture", "1.7.3", [
      commandXml("cancel command", [pressKeyAction([65], 0.01)]),
    ]),
    "utf8",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => inspectVoiceAttackSourcePath(cancelDir, controller.signal),
    /cancelled/i,
  );

  await manager.dispose();
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(userDataDir, { recursive: true, force: true });
  await fs.rm(cancelDir, { recursive: true, force: true });
});
