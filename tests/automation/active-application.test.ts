import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomationProfileStore } from '../../src/main/automation/profile-store';
import { AutomationManager } from '../../src/main/automation/manager';
import type { AutomationManagerEvent } from '../../src/shared/automation/ipc';
import type {
  AutomationProfile,
  ValidKeyIdentifier,
  ValidModifierKey,
} from '../../src/shared/automation/schema';
import { KeyboardInputAdapter } from '../../src/main/automation/input-adapter';
import type { ActiveApplicationSnapshot } from '../../src/main/automation/active-application';
import {
  sanitizeProcessName,
  sanitizeWindowTitle,
} from '../../src/main/automation/active-application';
import {
  chooseMatchedProfile,
  getMatchingProfiles,
} from '../../src/main/automation/profile-selection';

class FakeKeyboardAdapter implements KeyboardInputAdapter {
  async keyTap(_key: ValidKeyIdentifier): Promise<void> {}

  async keyDown(_key: ValidKeyIdentifier): Promise<void> {}

  async keyUp(_key: ValidKeyIdentifier): Promise<void> {}

  async keyCombination(
    _modifiers: ValidModifierKey[],
    _key: ValidKeyIdentifier,
  ): Promise<void> {}

  async releaseAll(_keys: Iterable<ValidKeyIdentifier>): Promise<void> {}
}

class FakeActiveApplicationAdapter {
  current: ActiveApplicationSnapshot | null = null;

  async pollActiveApplication(): Promise<ActiveApplicationSnapshot | null> {
    return this.current;
  }
}

const createProfile = (
  profileId: string,
  processNames: string[],
): AutomationProfile => ({
  schemaVersion: 1,
  profileId,
  displayName: profileId,
  description: '',
  enabled: true,
  processNames,
  commands: [{
    commandId: 'test-command',
    label: 'Test Command',
    description: '',
    aliases: [],
    category: 'testing',
    enabled: true,
    cooldownMs: 0,
    maxDurationMs: 5_000,
    riskLevel: 'harmless',
    allowedTriggerSources: ['manual'],
    autonomyPolicy: 'disabled',
    confirmationPolicy: 'always',
    concurrencyPolicy: 'reject_duplicates',
    defaultDryRun: true,
    steps: [{ type: 'wait', milliseconds: 1 }],
  }],
});

const waitFor = async <T,>(predicate: () => Promise<T | undefined> | T | undefined, timeoutMs = 3000): Promise<T> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
};

const createHarness = async (profiles: AutomationProfile[]) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-active-app-'));
  const store = new AutomationProfileStore(tempDir);
  await store.ensureInitialized();
  for (const profile of profiles) {
    await store.saveProfile(profile);
  }

  const adapter = new FakeActiveApplicationAdapter();
  const events: AutomationManagerEvent[] = [];
  const manager = new AutomationManager({
    store,
    keyboardAdapter: new FakeKeyboardAdapter(),
    hotkeyApi: {
      register: () => true,
      unregister: () => undefined,
    },
    dialogApi: {
      openImportFile: async () => null,
      openExportFile: async () => null,
      openVoiceAttackSource: async () => null,
    },
    activeApplicationAdapter: adapter,
    emitEvent: (event) => {
      events.push(event);
    },
  });
  await manager.initialize();

  const cleanup = async () => {
    await manager.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { adapter, events, manager, cleanup };
};

test('sanitizers trim active application metadata', () => {
  assert.equal(
    sanitizeProcessName('C:\\Games\\EliteDangerous64.exe'),
    'EliteDangerous64.exe',
  );
  assert.equal(
    sanitizeWindowTitle('  Elite Dangerous \u0000  '),
    'Elite Dangerous',
  );
});

test('profile matching favors the current effective profile when ambiguous', () => {
  const profiles = [
    createProfile('first', ['EliteDangerous64.exe']),
    createProfile('second', ['EliteDangerous64.exe']),
  ];
  const matches = getMatchingProfiles(profiles, 'EliteDangerous64.exe');
  const selected = chooseMatchedProfile(matches, 'second');

  assert.equal(matches.length, 2);
  assert.equal(selected?.profileId, 'second');
});

test('manager auto-selects the matching profile after the debounce interval', async () => {
  const { adapter, manager, cleanup } = await createHarness([
    createProfile('elite-dangerous', ['EliteDangerous64.exe']),
  ]);

  await manager.updateSettings({
    profileSelectionMode: 'automatic',
    manualProfileId: null,
    activeApplicationPollIntervalMs: 20,
    profileSwitchDebounceMs: 40,
  });

  adapter.current = {
    processName: 'EliteDangerous64.exe',
    windowTitle: 'Elite Dangerous',
    detectedAt: '2026-07-20T12:00:00+00:00',
    confidence: 1,
  };

  const snapshot = await waitFor(async () => {
    const value = await manager.getStatus();
    return value.activeProfileId === 'elite-dangerous' ? value : undefined;
  }, 2500);

  assert.equal(snapshot.profileSelectionSource, 'automatic');
  assert.equal(snapshot.matchedProfileId, 'elite-dangerous');
  await cleanup();
});

test('manager manual override ignores automatic matches', async () => {
  const { adapter, manager, cleanup } = await createHarness([
    createProfile('elite-dangerous', ['EliteDangerous64.exe']),
    createProfile('star-citizen', ['StarCitizen.exe']),
  ]);

  await manager.updateSettings({
    profileSelectionMode: 'manual',
    manualProfileId: 'star-citizen',
    activeApplicationPollIntervalMs: 20,
    profileSwitchDebounceMs: 40,
  });

  adapter.current = {
    processName: 'EliteDangerous64.exe',
    windowTitle: 'Elite Dangerous',
    detectedAt: '2026-07-20T12:00:00+00:00',
    confidence: 1,
  };

  const snapshot = await waitFor(async () => {
    const value = await manager.getStatus();
    return value.matchedProfileId === 'elite-dangerous' ? value : undefined;
  }, 2500);

  assert.equal(snapshot.activeProfileId, 'star-citizen');
  assert.equal(snapshot.profileSelectionSource, 'manual');
  await cleanup();
});

test('manager retains the current profile through a brief detection failure', async () => {
  const { adapter, manager, cleanup } = await createHarness([
    createProfile('elite-dangerous', ['EliteDangerous64.exe']),
  ]);

  await manager.updateSettings({
    profileSelectionMode: 'automatic',
    manualProfileId: null,
    activeApplicationPollIntervalMs: 20,
    profileSwitchDebounceMs: 40,
    detectionFailureGracePeriodMs: 200,
  });

  adapter.current = {
    processName: 'EliteDangerous64.exe',
    windowTitle: 'Elite Dangerous',
    detectedAt: '2026-07-20T12:00:00+00:00',
    confidence: 1,
  };

  await waitFor(async () => {
    const value = await manager.getStatus();
    return value.activeProfileId === 'elite-dangerous' ? value : undefined;
  }, 2500);

  adapter.current = null;
  await new Promise((resolve) => setTimeout(resolve, 80));
  const snapshot = await manager.getStatus();

  assert.equal(snapshot.activeProfileId, 'elite-dangerous');
  await cleanup();
});

test('manager disabled selection keeps match state but clears the effective profile', async () => {
  const { adapter, manager, cleanup } = await createHarness([
    createProfile('elite-dangerous', ['EliteDangerous64.exe']),
  ]);

  await manager.updateSettings({
    profileSelectionMode: 'disabled',
    manualProfileId: 'elite-dangerous',
    activeApplicationPollIntervalMs: 20,
    profileSwitchDebounceMs: 40,
  });

  adapter.current = {
    processName: 'EliteDangerous64.exe',
    windowTitle: 'Elite Dangerous',
    detectedAt: '2026-07-20T12:00:00+00:00',
    confidence: 1,
  };

  const snapshot = await waitFor(async () => {
    const value = await manager.getStatus();
    return value.matchedProfileId === 'elite-dangerous' ? value : undefined;
  }, 2500);

  assert.equal(snapshot.activeProfileId, null);
  assert.equal(snapshot.effectiveProfileId, null);
  assert.equal(snapshot.profileSelectionSource, 'none');
  await cleanup();
});
