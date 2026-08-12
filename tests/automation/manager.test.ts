import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AutomationManagerEvent } from "../../src/shared/automation/ipc";
import type {
  AutomationAssistantStateSnapshot,
  AutomationProfile,
  ValidKeyIdentifier,
  ValidModifierKey,
} from "../../src/shared/automation/schema";
import { AutomationProfileStore } from "../../src/main/automation/profile-store";
import { AutomationManager } from "../../src/main/automation/manager";
import { KeyboardInputAdapter } from "../../src/main/automation/input-adapter";

class FakeKeyboardAdapter implements KeyboardInputAdapter {
  events: string[] = [];

  async keyTap(key: ValidKeyIdentifier): Promise<void> {
    this.events.push(`tap:${key}`);
  }

  async keyDown(key: ValidKeyIdentifier): Promise<void> {
    this.events.push(`down:${key}`);
  }

  async keyUp(key: ValidKeyIdentifier): Promise<void> {
    this.events.push(`up:${key}`);
  }

  async keyCombination(
    modifiers: ValidModifierKey[],
    key: ValidKeyIdentifier,
  ): Promise<void> {
    this.events.push(`combo:${modifiers.join("+")}+${key}`);
  }

  async releaseAll(keys: Iterable<ValidKeyIdentifier>): Promise<void> {
    for (const key of keys) {
      this.events.push(`release:${key}`);
    }
  }
}

const createProfile = (
  commandOverrides?: Partial<AutomationProfile["commands"][number]>,
): AutomationProfile => ({
  schemaVersion: 1,
  profileId: "test-profile",
  displayName: "Test Profile",
  description: "Test profile",
  enabled: true,
  processNames: [],
  commands: [
    {
      commandId: "test-command",
      label: "Test Command",
      description: "",
      aliases: [],
      category: "testing",
      enabled: true,
      cooldownMs: 0,
      maxDurationMs: 5_000,
      riskLevel: "harmless",
      allowedTriggerSources: ["manual"],
      autonomyPolicy: "disabled",
      confirmationPolicy: "always",
      concurrencyPolicy: "reject_duplicates",
      defaultDryRun: false,
      steps: [{ type: "wait", milliseconds: 1 }],
      ...commandOverrides,
    },
  ],
});

const waitFor = async <T>(
  predicate: () => T | undefined,
  timeoutMs = 3000,
): Promise<T> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = predicate();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
};

const createAssistantStateSnapshot = (
  overrides?: Partial<AutomationAssistantStateSnapshot>,
): AutomationAssistantStateSnapshot => ({
  activeProfileId: "test-profile",
  capabilityRevision: 0,
  settings: {
    llmAutomationEnabled: false,
    allowAutonomousHarmlessCommands: false,
    allowAutonomousLowRiskCommands: false,
    confirmationTimeoutMs: 10_000,
    maxPendingConfirmations: 1,
    announceBlockedCommandRequests: false,
    includeCommandSuggestionsInSpeech: true,
    resultAcknowledgementsEnabled: false,
    confirmationPhrases: ["confirm"],
    cancellationPhrases: ["cancel"],
    defaultSpeechMode: "action",
    proactiveCommentaryEnabled: false,
    minimumCommentaryIntervalMs: 15_000,
    maxQueuedConversationEvents: 5,
    announceApplicationChanges: false,
    acknowledgeRoutineAutomationSuccess: false,
    voiceCommandActivationMode: "wake_phrase",
    voiceCommandWakePhrases: ["assistant"],
    voiceCommandPushToCommandHotkey: "",
    voiceCommandAmbiguityTimeoutMs: 15_000,
    voiceCommandAcknowledgementMode: "none",
    telemetry: {
      enabled: true,
      automaticJournalDiscovery: true,
      manualJournalDirectory: null,
      lowFuelThreshold: 0.25,
      criticalFuelThreshold: 0.1,
      hullWarningThresholds: [75, 50, 25, 10],
      explorationCommentaryCooldownMs: 90_000,
      commentary: {
        announceDockingEvents: true,
        announceJumpEvents: true,
        announceMissionEvents: true,
        announceDiscoveries: true,
        announceMaterialCollection: false,
      },
    },
  },
  telemetry: {
    adapterId: "elite-dangerous",
    gameId: "elite-dangerous",
    gameDisplayName: "Elite Dangerous",
    status: "running",
    replayMode: false,
    error: null,
    sourceKind: "log",
    sourceDirectoryStatus: "automatic",
    sourceDirectoryLabel: "Automatic",
    currentSource: "Status.json",
    journalDirectoryStatus: "automatic",
    journalDirectoryLabel: "Automatic",
    currentJournalFile: "Journal.01.log",
    lastEventAt: "2026-07-31T00:00:00.000Z",
    snapshot: {
      sourceTimestamp: "2026-07-31T00:00:00.000Z",
      lastUpdateTimestamp: "2026-07-31T00:00:00.000Z",
      confidence: 1,
      stale: false,
      session: {
        docked: false,
        landed: false,
      },
      ship: {
        hardpointsDeployed: false,
        landingGearDeployed: false,
        cargoScoopDeployed: false,
        lightsOn: false,
        silentRunning: false,
        flightAssistOff: false,
        supercruise: false,
        fsdStatus: null,
      },
      navigation: {
        dockingGranted: false,
        dockingDenied: false,
        docked: false,
      },
      combat: {},
      missions: {},
      world: {},
      automation: {},
      highlights: [],
    },
  },
  capabilities: [],
  pendingConfirmations: [],
  recentDecisions: [],
  lastBlockedReason: null,
  stateVersion: 1,
  detectedApplication: null,
  matchedProfileId: "test-profile",
  effectiveProfileId: "test-profile",
  profileSelectionMode: "manual",
  profileSelectionSource: "manual",
  profileMatchConfidence: 1,
  lastProfileTransitionAt: null,
  speechMode: "action",
  queueSummary: {
    total: 0,
    highPriority: 0,
    conversational: 0,
    suppressed: 0,
  },
  currentEvent: null,
  suppressedEventCount: 0,
  activity: [],
  vtuberSpeaking: false,
  playerSpeaking: false,
  lastPlayerRequest: null,
  pendingAmbiguity: null,
  resolverActivity: [],
  ...overrides,
});

const createHarness = async (
  profile: AutomationProfile,
  options?: { telemetryDirectory?: string | null },
) => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "assistant-manager-"),
  );
  const keyboard = new FakeKeyboardAdapter();
  const store = new AutomationProfileStore(tempDir);
  await store.ensureInitialized();
  await store.saveProfile(profile);

  const events: AutomationManagerEvent[] = [];
  const logs: string[] = [];
  let manager!: AutomationManager;
  manager = new AutomationManager({
    store,
    keyboardAdapter: keyboard,
    hotkeyApi: {
      register: () => true,
      unregister: () => undefined,
    },
    dialogApi: {
      openImportFile: async () => null,
      openExportFile: async () => null,
      openTelemetryDirectory: async () => options?.telemetryDirectory ?? null,
      openVoiceAttackSource: async () => null,
    },
    emitEvent: (event) => {
      events.push(event);
      if (event.type === "scene-action") {
        setTimeout(() => {
          void manager.respondToSceneAction({
            requestId: event.action.requestId,
            actionId: event.action.actionId,
            ok: true,
          });
        }, 0);
      }
    },
    logger: {
      info: (...parts: unknown[]) =>
        logs.push(`info:${parts.map(String).join(" ")}`),
      warn: (...parts: unknown[]) =>
        logs.push(`warn:${parts.map(String).join(" ")}`),
      error: (...parts: unknown[]) =>
        logs.push(`error:${parts.map(String).join(" ")}`),
    },
  });
  await manager.initialize();

  const cleanup = async () => {
    await manager.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { manager, store, keyboard, events, logs, cleanup };
};

test("profile store persists profiles and blocks unsafe asset paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-store-"));
  const store = new AutomationProfileStore(tempDir);
  const profile = createProfile();
  await store.saveProfile(profile);

  const loaded = await store.getProfile("test-profile");
  assert.equal(loaded?.displayName, "Test Profile");
  assert.throws(() => store.resolveAssetPath("../secrets.txt"));

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("profile store publishes saved profiles atomically", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-store-"));
  const store = new AutomationProfileStore(tempDir);
  const profile = createProfile({
    description: "Large profile payload ".repeat(10_000),
  });

  await store.saveProfile(profile);

  const loaded = await store.getProfile("test-profile");
  const profileFiles = await fs.readdir(store.profilesDir);
  assert.equal(loaded?.profileId, "test-profile");
  assert.equal(profileFiles.some((fileName) => fileName.endsWith(".tmp")), false);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("profile store skips malformed profile files instead of failing the full listing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-store-"));
  const store = new AutomationProfileStore(tempDir);
  await store.saveProfile(createProfile());
  await fs.writeFile(
    path.join(store.profilesDir, "broken-profile.json"),
    '{"schemaVersion": 1, "profileId": "broken-profile"',
    "utf8",
  );

  const profiles = await store.listProfiles();

  assert.ok(profiles.some((profile) => profile.profileId === "test-profile"));
  assert.equal(await store.getProfile("broken-profile"), null);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("manager enforces command cooldown", async () => {
  const { manager, cleanup } = await createHarness(
    createProfile({
      cooldownMs: 5_000,
    }),
  );

  await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  await assert.rejects(
    () =>
      manager.executeCommand("test-profile", "test-command", {
        source: "manual",
      }),
    /cooldown/i,
  );

  await cleanup();
});

test("manager blocks commands that exceed maximum duration", async () => {
  const { manager, events, cleanup } = await createHarness(
    createProfile({
      maxDurationMs: 1_000,
      steps: [{ type: "wait", milliseconds: 1_100 }],
    }),
  );

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "blocked");
  await cleanup();
});

test("manager supports cancellation", async () => {
  const { manager, events, cleanup } = await createHarness(
    createProfile({
      steps: [{ type: "wait", milliseconds: 400 }],
    }),
  );

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  await manager.cancel(started.requestId);
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "cancelled");
  await cleanup();
});

test("manager enters emergency stop and blocks new execution until reset", async () => {
  const { manager, cleanup } = await createHarness(
    createProfile({
      steps: [{ type: "wait", milliseconds: 200 }],
    }),
  );

  await manager.emergencyStop("manual stop");
  const blocked = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  assert.equal(blocked.status, "blocked");
  const snapshot = await manager.getStatus();
  assert.equal(snapshot.emergencyStopped, true);

  await manager.resetEmergencyStop();
  const resetSnapshot = await manager.getStatus();
  assert.equal(resetSnapshot.emergencyStopped, false);
  await cleanup();
});

test("manager allows manual preview for disabled profiles", async () => {
  const disabledProfile: AutomationProfile = {
    ...createProfile({
      defaultDryRun: true,
    }),
    enabled: false,
  };
  const { manager, events, cleanup } = await createHarness(disabledProfile);

  await assert.rejects(
    () =>
      manager.executeCommand("test-profile", "test-command", {
        source: "manual",
        dryRun: true,
      }),
    /disabled/i,
  );

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
    dryRun: true,
    allowDisabled: true,
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  await cleanup();
});

test("manager allows manual preview for disabled commands", async () => {
  const { manager, events, cleanup } = await createHarness(
    createProfile({
      enabled: false,
      defaultDryRun: true,
    }),
  );

  await assert.rejects(
    () =>
      manager.executeCommand("test-profile", "test-command", {
        source: "manual",
        dryRun: true,
      }),
    /disabled/i,
  );

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
    dryRun: true,
    allowDisabled: true,
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  await cleanup();
});

test("manager executes script steps with variables, conditions, and nested commands", async () => {
  const profile: AutomationProfile = {
    schemaVersion: 1,
    profileId: "test-profile",
    displayName: "Script Profile",
    description: "",
    enabled: true,
    processNames: [],
    commands: [
      {
        commandId: "test-command",
        label: "Script Command",
        description: "",
        aliases: [],
        category: "testing",
        enabled: true,
        cooldownMs: 0,
        maxDurationMs: 5_000,
        riskLevel: "harmless",
        allowedTriggerSources: ["manual"],
        autonomyPolicy: "disabled",
        confirmationPolicy: "always",
        concurrencyPolicy: "reject_duplicates",
        defaultDryRun: false,
        steps: [
          {
            type: "script",
            script: [
              'let greeting = "Hello"',
              'log greeting + " there"',
              "if dry_run",
              '  log "Preview only"',
              "else",
              "  press a for 5 * 2",
              "  call follow-up",
              "endif",
              'speak greeting + " there"',
            ].join("\n"),
          },
        ],
      },
      {
        commandId: "follow-up",
        label: "Follow Up",
        description: "",
        aliases: [],
        category: "testing",
        enabled: true,
        cooldownMs: 0,
        maxDurationMs: 5_000,
        riskLevel: "harmless",
        allowedTriggerSources: ["manual"],
        autonomyPolicy: "disabled",
        confirmationPolicy: "always",
        concurrencyPolicy: "reject_duplicates",
        defaultDryRun: false,
        steps: [{ type: "key_combination", modifiers: ["ctrl"], key: "b" }],
      },
    ],
  };

  const { manager, keyboard, logs, events, cleanup } =
    await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  assert.ok(logs.some((entry) => entry.includes("Hello there")));
  assert.ok(!logs.some((entry) => entry.includes("Preview only")));
  assert.ok(keyboard.events.includes("down:a"));
  assert.ok(keyboard.events.includes("up:a"));
  assert.ok(keyboard.events.includes("combo:ctrl+b"));
  assert.ok(
    events.some(
      (event) =>
        event.type === "scene-action" &&
        event.action.actionType === "speak_fixed" &&
        event.action.text === "Hello there",
    ),
  );

  await cleanup();
});

test("manager releases held keys after failure", async () => {
  const profile = createProfile({
    steps: [
      { type: "key_down", key: "shift" },
      {
        type: "show_overlay",
        overlayId: "unknown_overlay",
        durationMs: 1000,
        placement: "center",
        animationName: "fade",
      },
    ],
  });
  const { manager, keyboard, events, cleanup } = await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "blocked");
  assert.ok(keyboard.events.includes("down:shift"));
  assert.ok(
    keyboard.events.some(
      (entry) => entry === "release:shift" || entry === "up:shift",
    ),
  );
  await cleanup();
});

test("manager rejects excessive macro nesting depth", async () => {
  const nestedProfile: AutomationProfile = {
    schemaVersion: 1,
    profileId: "test-profile",
    displayName: "Nested",
    description: "",
    enabled: true,
    processNames: [],
    commands: Array.from({ length: 6 }, (_, index) => ({
      commandId: `command-${index}`,
      label: `Command ${index}`,
      description: "",
      aliases: [],
      category: "testing",
      enabled: true,
      cooldownMs: 0,
      maxDurationMs: 5_000,
      riskLevel: "harmless",
      allowedTriggerSources: ["manual"],
      autonomyPolicy: "disabled",
      confirmationPolicy: "always",
      concurrencyPolicy: "reject_duplicates",
      defaultDryRun: true,
      steps:
        index === 5
          ? [{ type: "wait", milliseconds: 1 }]
          : [{ type: "run_macro", commandId: `command-${index + 1}` }],
    })),
  };

  const { manager, events, cleanup } = await createHarness(nestedProfile);
  const started = await manager.executeCommand("test-profile", "command-0", {
    source: "manual",
    dryRun: true,
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "blocked");
  await cleanup();
});

test("manager skips keyboard injection during dry-run", async () => {
  const profile = createProfile({
    steps: [{ type: "key_press", key: "f8", durationMs: 50 }],
  });
  const { manager, keyboard, events, cleanup } = await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
    dryRun: true,
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  assert.equal(keyboard.events.length, 0);
  await cleanup();
});

test("manager emits background set and restore scene actions", async () => {
  const profile = createProfile({
    steps: [
      {
        type: "set_background",
        backgroundId: "ceiling-window-room-night.jpeg",
      },
      { type: "restore_background" },
    ],
  });
  const { manager, events, cleanup } = await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
    dryRun: true,
  });
  await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status === "completed",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  const sceneActions = events
    .filter(
      (
        event,
      ): event is Extract<AutomationManagerEvent, { type: "scene-action" }> =>
        event.type === "scene-action",
    )
    .map((event) => event.action.actionType);
  assert.deepEqual(sceneActions, ["set_background", "restore_background"]);
  await cleanup();
});

test("manager executes imported log and mic-control actions", async () => {
  const profile = createProfile({
    steps: [
      { type: "write_log", message: "Waiting for response..." },
      { type: "set_mic_state", enabled: false },
      { type: "set_mic_state", enabled: true },
    ],
  });
  const { manager, events, logs, cleanup } = await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
    dryRun: true,
  });
  await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status === "completed",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  const sceneActions = events
    .filter(
      (
        event,
      ): event is Extract<AutomationManagerEvent, { type: "scene-action" }> =>
        event.type === "scene-action",
    )
    .map((event) => ({
      actionType: event.action.actionType,
      enabled: event.action.enabled,
    }));
  assert.deepEqual(sceneActions, [
    { actionType: "set_mic_state", enabled: false },
    { actionType: "set_mic_state", enabled: true },
  ]);
  assert.ok(
    logs.some((entry) =>
      entry.includes("[automation][voiceattack-log] Waiting for response..."),
    ),
  );

  await cleanup();
});

test("manager exposes telemetry directory selection through the dialog bridge", async () => {
  const { manager, cleanup } = await createHarness(createProfile(), {
    telemetryDirectory: "C:\\Telemetry\\Elite",
  });

  const selected = await manager.selectTelemetryDirectory();
  assert.equal(selected, "C:\\Telemetry\\Elite");

  await cleanup();
});

test("manager returns already_satisfied without sending physical input for semantic commands", async () => {
  const profile = createProfile({
    label: "Deploy Hardpoints",
    steps: [{ type: "key_press", key: "h" }],
    voiceAttack: {
      sourceCommandId: "source-1",
      sourceCommandString: "deploy hardpoints",
      sourceLabel: "Deploy Hardpoints",
      sourceDescription: "",
      sourceCategory: "combat",
      sourceProfileId: "source-profile",
      sourceProfileName: "Fixture",
      sourceFileHash: "hash",
      importProvenance: {
        sourceFormat: "vap_xml",
        decoderStatus: "supported",
        importVersion: 1,
        decoderVersion: "test",
        importedAt: "2026-07-31T00:00:00.000Z",
        sourceBasename: "fixture.vap",
      },
      internalCommand: false,
      hiddenFromCapabilityCatalog: false,
      dependencyGraph: {
        directDependencyCommandIds: [],
        transitiveDependencyCommandIds: [],
        unresolvedDependencyReferences: [],
        dependencyCycles: [],
        externalPluginDependencies: [],
        reachesExecutableKeyboardInput: true,
        containsOnlySpeechOrUnsupportedActions: false,
      },
      executability: "fully_executable",
      actionTree: [
        {
          nodeId: "press-hardpoints",
          kind: "key_press",
          actionTypeName: "PressKey",
          sourceActionId: "press-hardpoints",
          sourceActionIndex: 0,
          delayMs: 0,
          disabled: false,
          key: "h",
        },
      ],
      semanticContract: {
        capabilityId: "elite.deploy_hardpoints",
        gameAdapterId: "elite-dangerous",
        desiredState: {
          "ship.hardpointsDeployed": true,
        },
        preconditions: [],
        alreadySatisfiedWhen: {
          path: "ship.hardpointsDeployed",
          operator: "equals",
          value: true,
        },
        successWhen: {
          path: "ship.hardpointsDeployed",
          operator: "equals",
          value: true,
        },
        timeoutMs: 2000,
        pollIntervalMs: 100,
        fallbackWhenUnavailable: "execute_unconfirmed",
        inferenceConfidence: "high",
        inferenceEvidence: ["test"],
        manualReviewRequired: false,
        userOverride: false,
        source: "manual",
      },
      reviewWarnings: [],
    },
  });
  const { manager, keyboard, events, cleanup } = await createHarness(profile);
  const baseState = createAssistantStateSnapshot();
  await manager.syncAssistantState({
    ...baseState,
    telemetry: {
      ...baseState.telemetry!,
      snapshot: {
        ...baseState.telemetry!.snapshot!,
        ship: {
          ...baseState.telemetry!.snapshot!.ship,
          hardpointsDeployed: true,
        },
      },
    },
  });

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  assert.equal(completed.record.outcome?.resultType, "already_satisfied");
  assert.deepEqual(keyboard.events, []);
  await cleanup();
});

test("manager confirms semantic telemetry transitions after imported input", async () => {
  const profile = createProfile({
    label: "Deploy Hardpoints",
    steps: [{ type: "key_press", key: "h" }],
    voiceAttack: {
      sourceCommandId: "source-2",
      sourceCommandString: "deploy hardpoints",
      sourceLabel: "Deploy Hardpoints",
      sourceDescription: "",
      sourceCategory: "combat",
      sourceProfileId: "source-profile",
      sourceProfileName: "Fixture",
      sourceFileHash: "hash",
      importProvenance: {
        sourceFormat: "vap_xml",
        decoderStatus: "supported",
        importVersion: 1,
        decoderVersion: "test",
        importedAt: "2026-07-31T00:00:00.000Z",
        sourceBasename: "fixture.vap",
      },
      internalCommand: false,
      hiddenFromCapabilityCatalog: false,
      dependencyGraph: {
        directDependencyCommandIds: [],
        transitiveDependencyCommandIds: [],
        unresolvedDependencyReferences: [],
        dependencyCycles: [],
        externalPluginDependencies: [],
        reachesExecutableKeyboardInput: true,
        containsOnlySpeechOrUnsupportedActions: false,
      },
      executability: "fully_executable",
      actionTree: [
        {
          nodeId: "press-hardpoints",
          kind: "key_press",
          actionTypeName: "PressKey",
          sourceActionId: "press-hardpoints",
          sourceActionIndex: 0,
          delayMs: 0,
          disabled: false,
          key: "h",
        },
      ],
      semanticContract: {
        capabilityId: "elite.deploy_hardpoints",
        gameAdapterId: "elite-dangerous",
        desiredState: {
          "ship.hardpointsDeployed": true,
        },
        preconditions: [],
        alreadySatisfiedWhen: {
          path: "ship.hardpointsDeployed",
          operator: "equals",
          value: true,
        },
        successWhen: {
          path: "ship.hardpointsDeployed",
          operator: "equals",
          value: true,
        },
        timeoutMs: 2000,
        pollIntervalMs: 100,
        fallbackWhenUnavailable: "execute_unconfirmed",
        inferenceConfidence: "high",
        inferenceEvidence: ["test"],
        manualReviewRequired: false,
        userOverride: false,
        source: "manual",
      },
      reviewWarnings: [],
    },
  });
  const { manager, keyboard, events, cleanup } = await createHarness(profile);
  const baseState = createAssistantStateSnapshot();
  await manager.syncAssistantState(baseState);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  setTimeout(() => {
    void manager.syncAssistantState({
      ...baseState,
      telemetry: {
        ...baseState.telemetry!,
        snapshot: {
          ...baseState.telemetry!.snapshot!,
          ship: {
            ...baseState.telemetry!.snapshot!.ship,
            hardpointsDeployed: true,
          },
        },
      },
    });
  }, 50);

  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "completed");
  assert.equal(completed.record.outcome?.resultType, "completed");
  assert.equal(completed.record.outcome?.telemetryConfirmed, true);
  assert.deepEqual(keyboard.events, ["down:h", "up:h"]);
  await cleanup();
});

test("manager reports unresolved imported command dependencies without sending input", async () => {
  const profile = createProfile({
    label: "Broken Imported Command",
    steps: [{ type: "wait", milliseconds: 1 }],
    voiceAttack: {
      sourceCommandId: "source-3",
      sourceCommandString: "broken imported command",
      sourceLabel: "Broken Imported Command",
      sourceDescription: "",
      sourceCategory: "testing",
      sourceProfileId: "source-profile",
      sourceProfileName: "Fixture",
      sourceFileHash: "hash",
      importProvenance: {
        sourceFormat: "vap_xml",
        decoderStatus: "supported",
        importVersion: 1,
        decoderVersion: "test",
        importedAt: "2026-07-31T00:00:00.000Z",
        sourceBasename: "fixture.vap",
      },
      internalCommand: false,
      hiddenFromCapabilityCatalog: false,
      dependencyGraph: {
        directDependencyCommandIds: [],
        transitiveDependencyCommandIds: [],
        unresolvedDependencyReferences: ["missing"],
        dependencyCycles: [],
        externalPluginDependencies: [],
        reachesExecutableKeyboardInput: false,
        containsOnlySpeechOrUnsupportedActions: false,
      },
      executability: "blocked",
      actionTree: [
        {
          nodeId: "missing-node",
          kind: "execute_command",
          actionTypeName: "ExecuteCommand",
          sourceActionId: "missing-node",
          sourceActionIndex: 0,
          delayMs: 0,
          disabled: false,
          targetReference: "missing",
          targetCommandId: null,
          targetSourceCommandId: null,
          unresolved: true,
          cyclic: false,
        },
      ],
      semanticContract: null,
      reviewWarnings: [],
    },
  });
  const { manager, keyboard, events, cleanup } = await createHarness(profile);

  const started = await manager.executeCommand("test-profile", "test-command", {
    source: "manual",
  });
  const completed = await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === "execution" &&
          event.record.requestId === started.requestId &&
          event.record.status !== "started",
      ) as Extract<AutomationManagerEvent, { type: "execution" }> | undefined,
  );

  assert.equal(completed.record.status, "blocked");
  assert.equal(completed.record.outcome?.resultType, "unresolved_dependency");
  assert.deepEqual(keyboard.events, []);
  await cleanup();
});
