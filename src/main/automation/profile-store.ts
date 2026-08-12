import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as yaml from "js-yaml";
import {
  AutomationProfile,
  AutomationSettings,
  createAssistantTestProfile,
  createProfileSummary,
  getDefaultAutomationSettings,
  normalizeAutomationSettings,
  validateAutomationProfile,
} from "../../shared/automation/schema";

const PROFILE_FILE_EXTENSION = ".json";

export class AutomationProfileStore {
  readonly rootDir: string;

  readonly profilesDir: string;

  readonly assetsDir: string;

  readonly settingsPath: string;

  private readonly warnedInvalidProfilePaths = new Set<string>();

  constructor(userDataDir: string) {
    this.rootDir = path.join(userDataDir, "automation");
    this.profilesDir = path.join(this.rootDir, "profiles");
    this.assetsDir = path.join(this.rootDir, "assets");
    this.settingsPath = path.join(this.rootDir, "settings.json");
  }

  async ensureInitialized(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.profilesDir, { recursive: true });
    await fs.mkdir(this.assetsDir, { recursive: true });
    await this.ensureSettings();
    await this.ensureExampleProfile();
  }

  async listProfiles(): Promise<AutomationProfile[]> {
    await this.ensureInitialized();
    const entries = await fs.readdir(this.profilesDir, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(PROFILE_FILE_EXTENSION),
      )
      .map((entry) => path.join(this.profilesDir, entry.name));

    const profiles: AutomationProfile[] = [];
    for (const filePath of files) {
      try {
        const profile = await this.readProfileFile(filePath);
        if (profile) {
          profiles.push(profile);
        }
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          continue;
        }
        throw error;
      }
    }

    return profiles.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  }

  async listProfileSummaries() {
    const profiles = await this.listProfiles();
    return profiles.map(createProfileSummary);
  }

  async getProfile(profileId: string): Promise<AutomationProfile | null> {
    await this.ensureInitialized();
    const filePath = this.getProfilePath(profileId);
    try {
      return await this.readProfileFile(filePath);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async saveProfile(profile: AutomationProfile): Promise<AutomationProfile> {
    await this.ensureInitialized();
    const validatedProfile = validateAutomationProfile(profile);
    const filePath = this.getProfilePath(validatedProfile.profileId);
    await this.writeTextFileAtomic(
      filePath,
      `${JSON.stringify(validatedProfile, null, 2)}\n`,
    );
    return validatedProfile;
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    await this.ensureInitialized();
    const filePath = this.getProfilePath(profileId);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async loadSettings(): Promise<AutomationSettings> {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeAutomationSettings(parsed);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return this.ensureSettings();
      }
      throw error;
    }
  }

  async saveSettings(
    settings: AutomationSettings,
  ): Promise<AutomationSettings> {
    await this.ensureInitialized();
    const normalized = normalizeAutomationSettings(settings);
    await this.writeTextFileAtomic(
      this.settingsPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
    );
    return normalized;
  }

  resolveAssetPath(relativeAssetPath: string): string {
    const normalized = relativeAssetPath.replace(/\\/g, "/").trim();
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(
        "Asset paths must stay relative to the automation assets directory.",
      );
    }
    const assetPath = path.resolve(this.assetsDir, normalized);
    const assetsRoot = path.resolve(this.assetsDir);
    if (!assetPath.startsWith(assetsRoot)) {
      throw new Error("Asset path escapes the automation assets directory.");
    }
    return assetPath;
  }

  async importProfilesFromFile(filePath: string): Promise<string[]> {
    await this.ensureInitialized();
    const raw = await fs.readFile(filePath, "utf8");
    const extension = path.extname(filePath).toLowerCase();
    const parsed =
      extension === ".yaml" || extension === ".yml"
        ? yaml.load(raw)
        : JSON.parse(raw);

    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.profiles)
        ? (parsed as any).profiles
        : [parsed];

    const importedProfileIds: string[] = [];
    for (const candidate of candidates) {
      const profile = validateAutomationProfile(candidate);
      await this.saveProfile(profile);
      importedProfileIds.push(profile.profileId);
    }
    return importedProfileIds;
  }

  async exportProfile(
    profileId: string,
    format: "json" | "yaml",
  ): Promise<string> {
    const profile = await this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" was not found.`);
    }
    if (format === "yaml") {
      return yaml.dump(profile, { noRefs: true, lineWidth: 120 });
    }
    return `${JSON.stringify(profile, null, 2)}\n`;
  }

  private getProfilePath(profileId: string): string {
    return path.join(this.profilesDir, `${profileId}${PROFILE_FILE_EXTENSION}`);
  }

  private async readProfileFile(
    filePath: string,
  ): Promise<AutomationProfile | null> {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return validateAutomationProfile(parsed);
    } catch (error) {
      this.warnInvalidProfile(filePath, error);
      return null;
    }
  }

  private warnInvalidProfile(filePath: string, error: unknown): void {
    if (this.warnedInvalidProfilePaths.has(filePath)) {
      return;
    }
    this.warnedInvalidProfilePaths.add(filePath);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[automation] Skipping invalid automation profile "${filePath}": ${message}`,
    );
  }

  private async ensureExampleProfile(): Promise<void> {
    const exampleProfile = createAssistantTestProfile();
    const filePath = this.getProfilePath(exampleProfile.profileId);
    try {
      await fs.access(filePath);
    } catch {
      await this.writeTextFileAtomic(
        filePath,
        `${JSON.stringify(exampleProfile, null, 2)}\n`,
      );
    }
  }

  private async ensureSettings(): Promise<AutomationSettings> {
    const defaults = getDefaultAutomationSettings();
    try {
      await fs.access(this.settingsPath);
      return defaults;
    } catch {
      await this.writeTextFileAtomic(
        this.settingsPath,
        `${JSON.stringify(defaults, null, 2)}\n`,
      );
      return defaults;
    }
  }

  private async writeTextFileAtomic(
    targetPath: string,
    contents: string,
  ): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(tempPath, "w");
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
