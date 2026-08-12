import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AutomationProfile } from "../../shared/automation/schema";
import type {
  VoiceAttackEmbeddedProfileSummary,
  VoiceAttackImportCandidateSummary,
  VoiceAttackImportProfileResult,
  VoiceAttackImportRequest,
  VoiceAttackInspectionResult,
  VoiceAttackPackageEntrySummary,
  VoiceAttackProfilePreview,
  VoiceAttackSourceFormat,
} from "../../shared/automation/voiceattack";
import { buildVoiceAttackDiagnosticReport, buildVoiceAttackImportedProfile, getVoiceAttackPreview, inspectVoiceAttackSourcePath } from "./voiceattack-importer";
import type { VoiceAttackImportSessionData } from "./voiceattack-importer";
import { inspectVoiceAttackBufferFormat, inspectVoiceAttackPackageFile } from "./voiceattack-binary";

const VOICEATTACK_HELPER_TIMEOUT_MS = 150_000;

type VoiceAttackHelperCandidateRecord = {
  candidateId: string;
  sourcePath: string;
  sourceBasename: string;
  containerBasename: string | null;
  embeddedEntryName: string | null;
};

type VoiceAttackHelperSessionRecord = {
  importId: string;
  sourceBasename: string;
  sourceKind: "file" | "directory";
  inspection: VoiceAttackInspectionResult;
  candidates: VoiceAttackHelperCandidateRecord[];
};

export interface VoiceAttackHelperProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinText?: string;
  traceLabel?: string;
  timeoutMs: number;
}

export interface VoiceAttackHelperProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface VoiceAttackHelperInspectResponse {
  type: "inspect_source";
  sessionFilePath: string;
  inspection: VoiceAttackInspectionResult;
}

export interface VoiceAttackHelperPreviewResponse {
  type: "load_preview";
  preview: VoiceAttackProfilePreview;
}

export interface VoiceAttackHelperDiagnosticResponse {
  type: "build_diagnostic_report";
  report: Record<string, unknown>;
}

export interface VoiceAttackHelperImportResponse {
  type: "build_import";
  profile: AutomationProfile;
  result: VoiceAttackImportProfileResult;
}

export type VoiceAttackHelperRequest =
  | {
      type: "inspect_source";
      selectedPath: string;
    }
  | {
      type: "load_preview";
      sessionFilePath: string;
      candidateId: string;
    }
  | {
      type: "build_diagnostic_report";
      sessionFilePath: string;
      candidateId: string;
    }
  | {
      type: "build_import";
      sessionFilePath: string;
      request: VoiceAttackImportRequest;
      existingProfileIds: string[];
    };

export type VoiceAttackHelperResponse =
  | VoiceAttackHelperInspectResponse
  | VoiceAttackHelperPreviewResponse
  | VoiceAttackHelperDiagnosticResponse
  | VoiceAttackHelperImportResponse;

const toJson = (value: unknown): string => JSON.stringify(value);

const fromJson = <T>(text: string): T => JSON.parse(text) as T;

const summarizeVoiceAttackHelperRequest = (
  request: VoiceAttackHelperRequest,
): Record<string, unknown> => {
  switch (request.type) {
    case "inspect_source":
      return {
        type: request.type,
        selectedPath: request.selectedPath,
      };
    case "load_preview":
    case "build_diagnostic_report":
      return {
        type: request.type,
        sessionFilePath: request.sessionFilePath,
        candidateId: request.candidateId,
      };
    case "build_import":
      return {
        type: request.type,
        sessionFilePath: request.sessionFilePath,
        candidateId: request.request.candidateId,
        selectedCommandCount: request.request.selectedCommandIds.length,
        existingProfileCount: request.existingProfileIds.length,
      };
    default: {
      const exhaustiveCheck: never = request;
      return { type: String(exhaustiveCheck) };
    }
  }
};

const summarizeVoiceAttackHelperResponse = (
  response: VoiceAttackHelperResponse,
): Record<string, unknown> => {
  switch (response.type) {
    case "inspect_source":
      return {
        type: response.type,
        importId: response.inspection.importId,
        candidates: response.inspection.candidateProfileCount,
        parseable: response.inspection.parseableFileCount,
      };
    case "load_preview":
      return {
        type: response.type,
        importId: response.preview.importId,
        candidateId: response.preview.candidateId,
        profileName: response.preview.profileName,
        commandCount: response.preview.commandCount,
      };
    case "build_diagnostic_report":
      return {
        type: response.type,
      };
    case "build_import":
      return {
        type: response.type,
        profileId: response.result.profileId,
        importedCommandCount: response.result.importedCommandCount,
      };
    default: {
      const exhaustiveCheck: never = response;
      return { type: String(exhaustiveCheck) };
    }
  }
};

const formatEnvelopeLabel = (
  sourceFormat: VoiceAttackSourceFormat,
): string | null => {
  if (sourceFormat === "vap_xml" || sourceFormat === "vax_container") {
    return "Plain XML";
  }
  if (
    sourceFormat === "vap_wrapped_binary" ||
    sourceFormat === "vax_wrapped_binary"
  ) {
    return "Raw DEFLATE + Profile2 envelope";
  }
  return null;
};

const formatPreviewPendingDecoderStatus = (
  sourceFormat: VoiceAttackSourceFormat,
): string => {
  if (
    sourceFormat === "vap_wrapped_binary" ||
    sourceFormat === "vax_wrapped_binary"
  ) {
    return "binary_profile2_preview_pending";
  }
  if (sourceFormat === "vap_xml" || sourceFormat === "vax_container") {
    return "xml_preview_pending";
  }
  return "unsupported";
};

const redactSourceLabel = (inputPath: string): string =>
  path.basename(inputPath);

const collectCandidatePaths = async (
  selectedPath: string,
): Promise<{
  sourceKind: "file" | "directory";
  files: string[];
}> => {
  const stat = await fs.stat(selectedPath);
  if (stat.isFile()) {
    return {
      sourceKind: "file",
      files: [selectedPath],
    };
  }

  const queue = [selectedPath];
  const files: string[] = [];
  while (queue.length > 0) {
    const currentPath = queue.shift() as string;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    });
  }

  return {
    sourceKind: "directory",
    files,
  };
};

const mapBinaryFormatToVapSourceFormat = (
  sourceFormat: ReturnType<typeof inspectVoiceAttackBufferFormat>["sourceFormat"],
): VoiceAttackSourceFormat => {
  if (sourceFormat === "xml") {
    return "vap_xml";
  }
  if (sourceFormat === "binary_deflate_profile2") {
    return "vap_wrapped_binary";
  }
  return "unknown";
};

const mapBinaryFormatToVaxSourceFormat = (
  sourceFormat: ReturnType<typeof inspectVoiceAttackBufferFormat>["sourceFormat"],
): VoiceAttackSourceFormat => {
  if (sourceFormat === "xml") {
    return "vax_container";
  }
  if (sourceFormat === "binary_deflate_profile2") {
    return "vax_wrapped_binary";
  }
  return "unknown";
};

const buildShallowCandidateSummary = (options: {
  candidateId: string;
  sourceBasename: string;
  extension: string;
  sourceFormat: VoiceAttackSourceFormat;
  parseable: boolean;
  encrypted: boolean;
  profileName: string | null;
  containerBasename?: string | null;
  embeddedEntryName?: string | null;
  packageEntries?: VoiceAttackPackageEntrySummary[];
  embeddedProfiles?: VoiceAttackEmbeddedProfileSummary[];
  parseError?: string | null;
}): VoiceAttackImportCandidateSummary => ({
  candidateId: options.candidateId,
  sourceBasename: options.sourceBasename,
  extension: options.extension,
  sourceFormat: options.sourceFormat,
  parseable: options.parseable,
  encrypted: options.encrypted,
  profileName: options.profileName,
  originalProfileVersion: null,
  commandCount: 0,
  supportedCommandCount: 0,
  partiallySupportedCommandCount: 0,
  unsupportedCommandCount: 0,
  responsePlaceholderCount: 0,
  unresolvedNestedReferenceCount: 0,
  recursionWarningCount: 0,
  variablePluginWarningCount: 0,
  unresolvedPluginCount: 0,
  unresolvedVariableCount: 0,
  actionTypeCategories: [],
  actionTypeCounts: {},
  decoderStatus: formatPreviewPendingDecoderStatus(options.sourceFormat),
  envelopeFormat: formatEnvelopeLabel(options.sourceFormat),
  containerBasename: options.containerBasename ?? null,
  embeddedEntryName: options.embeddedEntryName ?? null,
  packageEntries: options.packageEntries?.map((entry) => ({ ...entry })) ?? [],
  embeddedProfiles:
    options.embeddedProfiles?.map((entry) => ({ ...entry })) ?? [],
  diagnostics: null,
  parseError: options.parseError ?? null,
});

const inspectVapCandidate = async (
  filePath: string,
): Promise<{
  record: VoiceAttackHelperCandidateRecord;
  summary: VoiceAttackImportCandidateSummary;
}> => {
  const sourceBasename = redactSourceLabel(filePath);
  const buffer = await fs.readFile(filePath);
  const detected = inspectVoiceAttackBufferFormat(buffer);
  const sourceFormat = mapBinaryFormatToVapSourceFormat(detected.sourceFormat);
  const parseable = sourceFormat !== "unknown";
  const candidateId = randomUUID();
  return {
    record: {
      candidateId,
      sourcePath: filePath,
      sourceBasename,
      containerBasename: null,
      embeddedEntryName: null,
    },
    summary: buildShallowCandidateSummary({
      candidateId,
      sourceBasename,
      extension: path.extname(filePath).toLowerCase(),
      sourceFormat,
      parseable,
      encrypted: false,
      profileName: path.basename(sourceBasename, path.extname(sourceBasename)),
      parseError: parseable
        ? null
        : `The VoiceAttack profile "${sourceBasename}" uses an unsupported format.`,
    }),
  };
};

const inspectVaxCandidates = async (
  filePath: string,
): Promise<
  Array<{
    record: VoiceAttackHelperCandidateRecord;
    summary: VoiceAttackImportCandidateSummary;
  }>
> => {
  const sourceBasename = redactSourceLabel(filePath);
  const packageInspection = await inspectVoiceAttackPackageFile(filePath);
  const embeddedProfiles: VoiceAttackEmbeddedProfileSummary[] =
    packageInspection.embeddedProfiles.map((entry) => {
      const entryBasename = path.posix.basename(entry.entryName);
      const detected = inspectVoiceAttackBufferFormat(entry.sourceBuffer);
      const sourceFormat = mapBinaryFormatToVaxSourceFormat(
        detected.sourceFormat,
      );
      return {
        entryName: entry.entryName,
        sourceFormat,
        parseable: sourceFormat !== "unknown",
        profileName: path.basename(entryBasename, path.extname(entryBasename)),
        decoderStatus: formatPreviewPendingDecoderStatus(sourceFormat),
      };
    });

  if (packageInspection.embeddedProfiles.length === 0) {
    const candidateId = randomUUID();
    return [
      {
        record: {
          candidateId,
          sourcePath: filePath,
          sourceBasename,
          containerBasename: null,
          embeddedEntryName: null,
        },
        summary: buildShallowCandidateSummary({
          candidateId,
          sourceBasename,
          extension: ".vax",
          sourceFormat: "unknown",
          parseable: false,
          encrypted: false,
          profileName: null,
          packageEntries: packageInspection.packageEntries,
          embeddedProfiles,
          parseError: `The VoiceAttack archive "${sourceBasename}" did not contain an embedded .vap profile.`,
        }),
      },
    ];
  }

  return packageInspection.embeddedProfiles.map((entry) => {
    const entryBasename = path.posix.basename(entry.entryName);
    const detected = inspectVoiceAttackBufferFormat(entry.sourceBuffer);
    const sourceFormat = mapBinaryFormatToVaxSourceFormat(detected.sourceFormat);
    const parseable = sourceFormat !== "unknown";
    const candidateId = randomUUID();
    return {
      record: {
        candidateId,
        sourcePath: filePath,
        sourceBasename: entryBasename,
        containerBasename: sourceBasename,
        embeddedEntryName: entry.entryName,
      },
      summary: buildShallowCandidateSummary({
        candidateId,
        sourceBasename: entryBasename,
        extension: ".vax",
        sourceFormat,
        parseable,
        encrypted: false,
        profileName: path.basename(entryBasename, path.extname(entryBasename)),
        containerBasename: sourceBasename,
        embeddedEntryName: entry.entryName,
        packageEntries: packageInspection.packageEntries,
        embeddedProfiles,
        parseError: parseable
          ? null
          : `The embedded VoiceAttack profile "${entryBasename}" uses an unsupported format.`,
      }),
    };
  });
};

const inspectVoiceAttackSourceShallow = async (
  selectedPath: string,
): Promise<VoiceAttackHelperSessionRecord> => {
  const importId = randomUUID();
  const { sourceKind, files } = await collectCandidatePaths(selectedPath);
  const records: VoiceAttackHelperCandidateRecord[] = [];
  const summaries: VoiceAttackImportCandidateSummary[] = [];

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".vap") {
      const result = await inspectVapCandidate(filePath);
      records.push(result.record);
      summaries.push(result.summary);
      continue;
    }
    if (extension === ".vax") {
      const results = await inspectVaxCandidates(filePath);
      results.forEach((result) => {
        records.push(result.record);
        summaries.push(result.summary);
      });
    }
  }

  const inspection: VoiceAttackInspectionResult = {
    importId,
    sourceBasename: redactSourceLabel(selectedPath),
    sourceKind,
    candidateProfileCount: summaries.length,
    parseableFileCount: summaries.filter((summary) => summary.parseable).length,
    unparseableFileCount: summaries.filter((summary) => !summary.parseable)
      .length,
    formatsDiscovered: Array.from(
      new Set(summaries.map((summary) => summary.sourceFormat)),
    ),
    actionTypeCategories: [],
    supportedImportCategories: [],
    partiallySupportedCategories: [],
    unsupportedCategories: [],
    candidates: summaries.sort((left, right) =>
      left.sourceBasename.localeCompare(right.sourceBasename),
    ),
  };

  return {
    importId,
    sourceBasename: inspection.sourceBasename,
    sourceKind,
    inspection,
    candidates: records,
  };
};

const findHelperCandidate = (
  session: VoiceAttackHelperSessionRecord,
  candidateId: string,
): VoiceAttackHelperCandidateRecord => {
  const candidate = session.candidates.find((entry) => entry.candidateId === candidateId);
  if (!candidate) {
    throw new Error("The selected VoiceAttack profile could not be found.");
  }
  return candidate;
};

const resolveHeavySessionCandidate = async (
  sessionFilePath: string,
  candidateId: string,
): Promise<{
  helperSession: VoiceAttackHelperSessionRecord;
  helperCandidate: VoiceAttackHelperCandidateRecord;
  resolvedSession: VoiceAttackImportSessionData;
  resolvedCandidateId: string;
}> => {
  const startedAt = Date.now();
  console.error("[voiceattack:helper-resolve:start]", {
    sessionFilePath,
    candidateId,
  });
  const helperSession = await readVoiceAttackSessionFile(sessionFilePath);
  console.error("[voiceattack:helper-resolve:session-read]", {
    elapsedMs: Date.now() - startedAt,
    importId: helperSession.importId,
    candidateCount: helperSession.candidates.length,
    sourceBasename: helperSession.sourceBasename,
  });
  const helperCandidate = findHelperCandidate(helperSession, candidateId);
  console.error("[voiceattack:helper-resolve:candidate-found]", {
    elapsedMs: Date.now() - startedAt,
    sourceBasename: helperCandidate.sourceBasename,
    containerBasename: helperCandidate.containerBasename,
    embeddedEntryName: helperCandidate.embeddedEntryName,
  });
  const resolvedSession = await inspectVoiceAttackSourcePath(
    helperCandidate.sourcePath,
    new AbortController().signal,
  );
  console.error("[voiceattack:helper-resolve:source-inspected]", {
    elapsedMs: Date.now() - startedAt,
    importId: resolvedSession.importId,
    candidateCount: resolvedSession.inspection.candidateProfileCount,
    parseableCount: resolvedSession.inspection.parseableFileCount,
  });
  const resolvedCandidate =
    resolvedSession.inspection.candidates.find(
      (entry) =>
        entry.sourceBasename === helperCandidate.sourceBasename &&
        entry.containerBasename === helperCandidate.containerBasename &&
        entry.embeddedEntryName === helperCandidate.embeddedEntryName,
    ) ?? resolvedSession.inspection.candidates[0];
  if (!resolvedCandidate) {
    throw new Error("The selected VoiceAttack profile could not be resolved.");
  }
  console.error("[voiceattack:helper-resolve:candidate-resolved]", {
    elapsedMs: Date.now() - startedAt,
    candidateId: resolvedCandidate.candidateId,
    sourceBasename: resolvedCandidate.sourceBasename,
    parseable: resolvedCandidate.parseable,
    decoderStatus: resolvedCandidate.decoderStatus,
    parseError: resolvedCandidate.parseError,
  });
  if (!resolvedCandidate.parseable || !resolvedSession.candidates.get(resolvedCandidate.candidateId)?.preview) {
    throw new Error(
      resolvedCandidate.parseError ||
        `The selected VoiceAttack profile "${resolvedCandidate.sourceBasename}" could not be previewed.`,
    );
  }
  return {
    helperSession,
    helperCandidate,
    resolvedSession,
    resolvedCandidateId: resolvedCandidate.candidateId,
  };
};

export const serializeVoiceAttackHelperPayload = (value: unknown): string =>
  toJson(value);

export const deserializeVoiceAttackHelperPayload = <T>(text: string): T =>
  fromJson<T>(text);

export const writeVoiceAttackSessionFile = async (
  session: VoiceAttackHelperSessionRecord,
): Promise<string> => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "open-llm-vtuber-voiceattack-"),
  );
  const sessionFilePath = path.join(directory, "session.json");
  await fs.writeFile(sessionFilePath, toJson(session), "utf8");
  return sessionFilePath;
};

export const readVoiceAttackSessionFile = async (
  sessionFilePath: string,
): Promise<VoiceAttackHelperSessionRecord> => {
  const contents = await fs.readFile(sessionFilePath, "utf8");
  return fromJson<VoiceAttackHelperSessionRecord>(contents);
};

export const deleteVoiceAttackSessionFile = async (
  sessionFilePath: string,
): Promise<void> => {
  const directory = path.dirname(sessionFilePath);
  await fs.rm(directory, { recursive: true, force: true });
};

const getVoiceAttackHelperEntryPath = (): string =>
  path.resolve(
    process.cwd(),
    "src",
    "main",
    "automation",
    "voiceattack-helper-entry.ts",
  );

const buildVoiceAttackHelperCommandArgs = (): string[] => [
  "--import",
  "tsx",
  getVoiceAttackHelperEntryPath(),
];

const buildVoiceAttackHelperEnv = (): NodeJS.ProcessEnv => {
  const env = {
    ...process.env,
  };
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
};

export const runVoiceAttackHelperProcess = (
  options: VoiceAttackHelperProcessOptions,
): Promise<VoiceAttackHelperProcessResult> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (options.traceLabel) {
      console.info("[voiceattack:helper-process:start]", {
        traceLabel: options.traceLabel,
        pid: child.pid,
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      });
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const elapsedMs = Date.now() - startedAt;
      if (options.traceLabel) {
        console.warn("[voiceattack:helper-process:timeout]", {
          traceLabel: options.traceLabel,
          pid: child.pid,
          elapsedMs,
          timeoutMs: options.timeoutMs,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          stderrTail: stderr.slice(-800),
        });
      }
      child.kill();
      reject(
        new Error(
          `VoiceAttack helper timed out after ${options.timeoutMs}ms.`,
        ),
      );
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (options.traceLabel) {
        console.error("[voiceattack:helper-process:error]", {
          traceLabel: options.traceLabel,
          pid: child.pid,
          elapsedMs: Date.now() - startedAt,
          message: error.message,
        });
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (options.traceLabel) {
        console.info("[voiceattack:helper-process:close]", {
          traceLabel: options.traceLabel,
          pid: child.pid,
          exitCode: code ?? -1,
          elapsedMs: Date.now() - startedAt,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          stderrTail: stderr.slice(-800),
        });
      }
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
      });
    });

    const stdin = child.stdin;
    if (!stdin) {
      settled = true;
      clearTimeout(timeout);
      if (options.traceLabel) {
        console.error("[voiceattack:helper-process:stdin-missing]", {
          traceLabel: options.traceLabel,
          pid: child.pid,
        });
      }
      reject(new Error("VoiceAttack helper stdin is unavailable."));
      return;
    }

    stdin.setDefaultEncoding("utf8");
    stdin.on("error", (error) => {
      if (settled || (error as NodeJS.ErrnoException).code === "EPIPE") {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (options.traceLabel) {
        console.error("[voiceattack:helper-process:stdin-error]", {
          traceLabel: options.traceLabel,
          pid: child.pid,
          elapsedMs: Date.now() - startedAt,
          message: error.message,
        });
      }
      reject(error);
    });
    stdin.end(options.stdinText ?? "");
  });

export const runVoiceAttackHelperCommand = async (
  request: VoiceAttackHelperRequest,
  options: { timeoutMs?: number } = {},
): Promise<VoiceAttackHelperResponse> => {
  const traceLabel = `${request.type}:${Date.now()}`;
  const startedAt = Date.now();
  console.info("[voiceattack:helper-command:start]", {
    traceLabel,
    request: summarizeVoiceAttackHelperRequest(request),
  });
  const helperEntryPath = getVoiceAttackHelperEntryPath();
  await fs.access(helperEntryPath);
  try {
    const result = await runVoiceAttackHelperProcess({
      command: process.execPath,
      args: buildVoiceAttackHelperCommandArgs(),
      cwd: process.cwd(),
      env: buildVoiceAttackHelperEnv(),
      stdinText: toJson(request),
      traceLabel,
      timeoutMs: options.timeoutMs ?? VOICEATTACK_HELPER_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          `VoiceAttack helper exited with code ${result.exitCode}.`,
      );
    }
    if (!result.stdout.trim()) {
      throw new Error("VoiceAttack helper returned an empty response.");
    }
    const response = fromJson<VoiceAttackHelperResponse>(result.stdout);
    console.info("[voiceattack:helper-command:success]", {
      traceLabel,
      elapsedMs: Date.now() - startedAt,
      response: summarizeVoiceAttackHelperResponse(response),
    });
    return response;
  } catch (error) {
    console.error("[voiceattack:helper-command:error]", {
      traceLabel,
      elapsedMs: Date.now() - startedAt,
      request: summarizeVoiceAttackHelperRequest(request),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const executeVoiceAttackHelperRequest = async (
  request: VoiceAttackHelperRequest,
): Promise<VoiceAttackHelperResponse> => {
  const startedAt = Date.now();
  console.error("[voiceattack:helper-entry:execute:start]", {
    request: summarizeVoiceAttackHelperRequest(request),
  });
  try {
    const response = await executeVoiceAttackHelperRequestInner(request);
    console.error("[voiceattack:helper-entry:execute:success]", {
      elapsedMs: Date.now() - startedAt,
      response: summarizeVoiceAttackHelperResponse(response),
    });
    return response;
  } catch (error) {
    console.error("[voiceattack:helper-entry:execute:error]", {
      elapsedMs: Date.now() - startedAt,
      request: summarizeVoiceAttackHelperRequest(request),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const executeVoiceAttackHelperRequestInner = async (
  request: VoiceAttackHelperRequest,
): Promise<VoiceAttackHelperResponse> => {
  switch (request.type) {
    case "inspect_source": {
      const helperSession = await inspectVoiceAttackSourceShallow(
        request.selectedPath,
      );
      const sessionFilePath = await writeVoiceAttackSessionFile(helperSession);
      return {
        type: "inspect_source",
        sessionFilePath,
        inspection: helperSession.inspection,
      };
    }
    case "load_preview": {
      const resolved = await resolveHeavySessionCandidate(
        request.sessionFilePath,
        request.candidateId,
      );
      const preview = getVoiceAttackPreview(
        resolved.resolvedSession,
        resolved.resolvedCandidateId,
      );
      preview.importId = resolved.helperSession.importId;
      preview.candidateId = resolved.helperCandidate.candidateId;
      return {
        type: "load_preview",
        preview,
      };
    }
    case "build_diagnostic_report": {
      const resolved = await resolveHeavySessionCandidate(
        request.sessionFilePath,
        request.candidateId,
      );
      const report = buildVoiceAttackDiagnosticReport(
        resolved.resolvedSession,
        resolved.resolvedCandidateId,
      );
      report.importId = resolved.helperSession.importId;
      report.selectedCandidateId = resolved.helperCandidate.candidateId;
      return {
        type: "build_diagnostic_report",
        report,
      };
    }
    case "build_import": {
      const resolved = await resolveHeavySessionCandidate(
        request.sessionFilePath,
        request.request.candidateId,
      );
      const { profile, result } = buildVoiceAttackImportedProfile(
        resolved.resolvedSession,
        {
          ...request.request,
          importId: resolved.resolvedSession.importId,
          candidateId: resolved.resolvedCandidateId,
        },
        request.existingProfileIds,
      );
      return {
        type: "build_import",
        profile,
        result,
      };
    }
    default: {
      const exhaustiveCheck: never = request;
      throw new Error(
        `Unsupported VoiceAttack helper request: ${String(exhaustiveCheck)}`,
      );
    }
  }
};
