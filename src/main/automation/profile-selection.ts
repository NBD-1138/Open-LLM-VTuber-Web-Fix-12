import type {
  AutomationDetectedApplication,
  AutomationProfile,
  AutomationProfileSelectionMode,
  AutomationProfileSelectionSource,
} from '../../shared/automation/schema';

export interface ProfileSelectionRuntimeState {
  detectedApplication: AutomationDetectedApplication | null;
  matchedProfileId: string | null;
  effectiveProfileId: string | null;
  manualProfileId: string | null;
  profileSelectionMode: AutomationProfileSelectionMode;
  profileSelectionSource: AutomationProfileSelectionSource;
  profileMatchConfidence: number | null;
  lastProfileTransitionAt: string | null;
}

const normalizeProcessName = (value: string): string => value.trim().toLowerCase();

export const getMatchingProfiles = (
  profiles: AutomationProfile[],
  processName: string | null | undefined,
): AutomationProfile[] => {
  if (!processName) {
    return [];
  }
  const normalizedProcessName = normalizeProcessName(processName);
  return profiles.filter((profile) => (
    profile.enabled
    && profile.processNames.some((candidate) => normalizeProcessName(candidate) === normalizedProcessName)
  ));
};

export const chooseMatchedProfile = (
  matches: AutomationProfile[],
  currentEffectiveProfileId: string | null,
): AutomationProfile | null => {
  if (matches.length === 0) {
    return null;
  }
  if (currentEffectiveProfileId) {
    const current = matches.find((profile) => profile.profileId === currentEffectiveProfileId);
    if (current) {
      return current;
    }
  }
  return [...matches].sort((left, right) => left.displayName.localeCompare(right.displayName))[0];
};

export const getProfileMatchConfidence = (matches: AutomationProfile[]): number | null => {
  if (matches.length === 0) {
    return null;
  }
  return Number((1 / matches.length).toFixed(2));
};
