import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomationCapabilityCatalog,
  createAssistantTestProfile,
  createProfileSummary,
  getDefaultAutomationSettings,
  MAX_ASSISTANT_CAPABILITY_CATALOG_SIZE,
  normalizeAutomationSettings,
  validateAutomationProfile,
  AutomationValidationError,
} from "../../src/shared/automation/schema";

test("schema accepts the built-in assistant test profile", () => {
  const profile = createAssistantTestProfile();
  const validated = validateAutomationProfile(profile);
  assert.equal(validated.profileId, "assistant-test-profile");
  assert.equal(validated.commands.length, 2);
  const assistantTest = validated.commands.find(
    (command) => command.commandId === "assistant_test_sequence",
  );
  assert.ok(assistantTest);
  assert.equal(assistantTest.enabled, true);
  assert.equal(assistantTest.riskLevel, "harmless");
  assert.equal(assistantTest.autonomyPolicy, "confirmation_required");
  assert.deepEqual(assistantTest.allowedTriggerSources.sort(), [
    "manual",
    "vtuber",
  ]);
});

test("schema rejects unsupported actions", () => {
  const profile = createAssistantTestProfile();
  (profile.commands[0].steps as any[]).push({
    type: "shell_exec",
    command: "whoami",
  });
  assert.throws(
    () => validateAutomationProfile(profile),
    AutomationValidationError,
  );
});

test("schema rejects recursive macro calls", () => {
  const profile = createAssistantTestProfile();
  profile.commands = [
    {
      ...profile.commands[0],
      commandId: "alpha",
      label: "Alpha",
      steps: [{ type: "run_macro", commandId: "beta" }],
    },
    {
      ...profile.commands[1],
      commandId: "beta",
      label: "Beta",
      steps: [{ type: "run_macro", commandId: "alpha" }],
    },
  ];

  assert.throws(
    () => validateAutomationProfile(profile),
    AutomationValidationError,
  );
});

test("schema rejects malformed profile ids", () => {
  const profile = createAssistantTestProfile();
  profile.profileId = "Assistant Test Profile";

  assert.throws(
    () => validateAutomationProfile(profile),
    /profile\.profileId is malformed\./,
  );
});

test("schema rejects malformed command ids", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].commandId = "Assistant Test Command";

  assert.throws(
    () => validateAutomationProfile(profile),
    /profile\.commands\[0\]\.commandId is malformed\./,
  );
});

test("schema normalizes uppercase key identifiers to their keyboard key", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].steps = [
    { type: "key_press", key: "A" as any, durationMs: 120 },
    { type: "key_combination", modifiers: ["SHIFT" as any], key: "Z" as any },
  ];

  const validated = validateAutomationProfile(profile);

  assert.deepEqual(validated.commands[0].steps, [
    { type: "key_press", key: "a", durationMs: 120 },
    { type: "key_combination", modifiers: ["shift"], key: "z" },
  ]);
});

test("schema accepts imported log and mic control actions", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].steps = [
    { type: "write_log", message: "Imported VoiceAttack log line." },
    { type: "set_mic_state", enabled: false },
    { type: "set_mic_state", enabled: true },
  ];

  const validated = validateAutomationProfile(profile);

  assert.deepEqual(validated.commands[0].steps, [
    { type: "write_log", message: "Imported VoiceAttack log line." },
    { type: "set_mic_state", enabled: false },
    { type: "set_mic_state", enabled: true },
  ]);
});

test("schema accepts validated script steps", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].steps = [
    {
      type: "script",
      script: [
        "let delay_ms = 120",
        "if !dry_run",
        '  speak "Running automation."',
        "  press f8 for delay_ms + 30",
        "  call assistant_test_key_input",
        "else",
        '  log "Preview only."',
        "endif",
      ].join("\n"),
    },
  ];

  const validated = validateAutomationProfile(profile);

  assert.deepEqual(validated.commands[0].steps, profile.commands[0].steps);
});

test("schema rejects malformed script blocks", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].steps = [
    {
      type: "script",
      script: ["if true", '  log "missing endif"'].join("\n"),
    },
  ];

  assert.throws(() => validateAutomationProfile(profile), /missing an endif/i);
});

test("schema rejects recursive script command calls", () => {
  const profile = createAssistantTestProfile();
  profile.commands = [
    {
      ...profile.commands[0],
      commandId: "alpha",
      label: "Alpha",
      steps: [{ type: "script", script: "call beta" }],
    },
    {
      ...profile.commands[1],
      commandId: "beta",
      label: "Beta",
      steps: [{ type: "run_macro", commandId: "alpha" }],
    },
  ];

  assert.throws(
    () => validateAutomationProfile(profile),
    /Recursive macro call detected/i,
  );
});

test("capability catalogue is sanitized and excludes macro implementation details", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].category =
    "Ad Astra - Information - Outfitting - Core Internals";
  const defaults = getDefaultAutomationSettings();
  const snapshot = {
    status: "ready" as const,
    emergencyStopped: false,
    activeProfileId: profile.profileId,
    dryRun: defaults.dryRun,
    emergencyStopHotkey: defaults.emergencyStopHotkey,
    llmAutomationEnabled: defaults.llmAutomationEnabled,
    allowAutonomousHarmlessCommands: defaults.allowAutonomousHarmlessCommands,
    allowAutonomousLowRiskCommands: defaults.allowAutonomousLowRiskCommands,
    confirmationTimeoutMs: defaults.confirmationTimeoutMs,
    maxPendingConfirmations: defaults.maxPendingConfirmations,
    announceBlockedCommandRequests: defaults.announceBlockedCommandRequests,
    includeCommandSuggestionsInSpeech:
      defaults.includeCommandSuggestionsInSpeech,
    resultAcknowledgementsEnabled: defaults.resultAcknowledgementsEnabled,
    confirmationPhrases: defaults.confirmationPhrases,
    cancellationPhrases: defaults.cancellationPhrases,
    runningRequestIds: [],
    profiles: [],
    history: [],
  };

  const capabilities = buildAutomationCapabilityCatalog(profile, snapshot);
  const capability = capabilities.find(
    (entry) => entry.commandId === "assistant_test_sequence",
  );
  assert.ok(capability);
  assert.equal(capability.available, true);
  assert.equal("steps" in capability, false);
  assert.equal("aliases" in capability, true);
  assert.equal("localAssetPath" in capability, false);
  assert.ok(capability.category.length <= 48);
  assert.match(capability.category, /\.\.\./);
});

test("capability catalogue marks running commands unavailable and reports cooldown", () => {
  const profile = createAssistantTestProfile();
  profile.commands[0].cooldownMs = 5_000;
  const defaults = getDefaultAutomationSettings();
  const snapshot = {
    status: "executing" as const,
    emergencyStopped: false,
    activeProfileId: profile.profileId,
    dryRun: defaults.dryRun,
    emergencyStopHotkey: defaults.emergencyStopHotkey,
    llmAutomationEnabled: defaults.llmAutomationEnabled,
    allowAutonomousHarmlessCommands: defaults.allowAutonomousHarmlessCommands,
    allowAutonomousLowRiskCommands: defaults.allowAutonomousLowRiskCommands,
    confirmationTimeoutMs: defaults.confirmationTimeoutMs,
    maxPendingConfirmations: defaults.maxPendingConfirmations,
    announceBlockedCommandRequests: defaults.announceBlockedCommandRequests,
    includeCommandSuggestionsInSpeech:
      defaults.includeCommandSuggestionsInSpeech,
    resultAcknowledgementsEnabled: defaults.resultAcknowledgementsEnabled,
    confirmationPhrases: defaults.confirmationPhrases,
    cancellationPhrases: defaults.cancellationPhrases,
    runningRequestIds: ["req-1"],
    profiles: [],
    history: [
      {
        requestId: "req-1",
        profileId: profile.profileId,
        commandId: "assistant_test_sequence",
        status: "started" as const,
        source: "manual" as const,
        startedAt: new Date().toISOString(),
        dryRun: true,
      },
    ],
  };

  const capabilities = buildAutomationCapabilityCatalog(profile, snapshot);
  const capability = capabilities.find(
    (entry) => entry.commandId === "assistant_test_sequence",
  );
  assert.ok(capability);
  assert.equal(capability.available, false);
  assert.ok(capability.cooldownRemainingMs > 0);
});

test("capability catalogue is capped and prioritizes useful commands", () => {
  const profile = createAssistantTestProfile();
  profile.commands = Array.from(
    { length: MAX_ASSISTANT_CAPABILITY_CATALOG_SIZE + 24 },
    (_, index) => ({
      ...profile.commands[0],
      commandId: `bulk_${index}`,
      label: `Bulk ${index}`,
      category: index % 2 === 0 ? "voice" : "manual",
      enabled: index < 12,
      allowedTriggerSources: index < 12 ? ["player_voice", "vtuber"] : ["manual"],
    }),
  );
  const defaults = getDefaultAutomationSettings();
  const snapshot = {
    status: "ready" as const,
    emergencyStopped: false,
    activeProfileId: profile.profileId,
    dryRun: defaults.dryRun,
    emergencyStopHotkey: defaults.emergencyStopHotkey,
    llmAutomationEnabled: defaults.llmAutomationEnabled,
    allowAutonomousHarmlessCommands: defaults.allowAutonomousHarmlessCommands,
    allowAutonomousLowRiskCommands: defaults.allowAutonomousLowRiskCommands,
    confirmationTimeoutMs: defaults.confirmationTimeoutMs,
    maxPendingConfirmations: defaults.maxPendingConfirmations,
    announceBlockedCommandRequests: defaults.announceBlockedCommandRequests,
    includeCommandSuggestionsInSpeech:
      defaults.includeCommandSuggestionsInSpeech,
    resultAcknowledgementsEnabled: defaults.resultAcknowledgementsEnabled,
    confirmationPhrases: defaults.confirmationPhrases,
    cancellationPhrases: defaults.cancellationPhrases,
    runningRequestIds: [],
    profiles: [],
    history: [],
  };

  const capabilities = buildAutomationCapabilityCatalog(profile, snapshot);
  assert.equal(capabilities.length, MAX_ASSISTANT_CAPABILITY_CATALOG_SIZE);
  const prioritizedCommandIds = new Set(
    capabilities.slice(0, 12).map((capability) => capability.commandId),
  );
  Array.from({ length: 12 }, (_, index) => `bulk_${index}`).forEach(
    (commandId) => assert.equal(prioritizedCommandIds.has(commandId), true),
  );
});

test("settings normalization clamps telemetry thresholds and preserves process names", () => {
  const normalized = normalizeAutomationSettings({
    telemetry: {
      enabled: false,
      lowFuelThreshold: 2,
      criticalFuelThreshold: 0.9,
      hullWarningThresholds: [10, 10, 150, 0],
      explorationCommentaryCooldownMs: 100,
      commentary: {
        announceDiscoveries: false,
      },
    },
  });

  assert.equal(normalized.telemetry.enabled, false);
  assert.equal(normalized.telemetry.lowFuelThreshold, 0.95);
  assert.equal(normalized.telemetry.criticalFuelThreshold, 0.9);
  assert.deepEqual(normalized.telemetry.hullWarningThresholds, [100, 10, 1]);
  assert.equal(normalized.telemetry.explorationCommentaryCooldownMs, 5_000);
  assert.equal(normalized.telemetry.commentary.announceDiscoveries, false);
  assert.equal(normalized.telemetry.commentary.announceDockingEvents, true);

  const summary = createProfileSummary({
    ...createAssistantTestProfile(),
    processNames: ["EliteDangerous64.exe"],
  });
  assert.deepEqual(summary.processNames, ["EliteDangerous64.exe"]);
});
