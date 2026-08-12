import type { VoiceAttackHelperRequest } from "./voiceattack-helper";
import {
  deserializeVoiceAttackHelperPayload,
  executeVoiceAttackHelperRequest,
  serializeVoiceAttackHelperPayload,
} from "./voiceattack-helper";

const readStdin = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      resolve(buffer);
    });
    process.stdin.on("error", (error) => {
      reject(error);
    });
  });

const main = async (): Promise<void> => {
  const input = await readStdin();
  if (!input.trim()) {
    throw new Error("VoiceAttack helper did not receive a request payload.");
  }
  const request =
    deserializeVoiceAttackHelperPayload<VoiceAttackHelperRequest>(input);
  const response = await executeVoiceAttackHelperRequest(request);
  process.stdout.write(serializeVoiceAttackHelperPayload(response));
};

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(message);
  process.exitCode = 1;
});
