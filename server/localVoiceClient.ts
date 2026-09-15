import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export type LocalVoiceHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type PendingRequest = {
  resolve: (reply: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  onDelta?: (delta: string) => void;
  accumulated: string;
};

type WorkerMessage = {
  type?: string;
  id?: string;
  reply?: string;
  delta?: string;
  done?: boolean;
  error?: string;
};

let worker: ChildProcessWithoutNullStreams | null = null;
let ready = false;
const pending = new Map<string, PendingRequest>();

function privateRoot() {
  return process.env.QUQU_PRIVATE_CORPUS_DIR
    ? resolve(process.env.QUQU_PRIVATE_CORPUS_DIR)
    : resolve(process.cwd(), "../.ququ-private-corpus");
}

function discoverPaths() {
  const root = privateRoot();
  const python = process.env.QUQU_LOCAL_PYTHON
    ? resolve(process.env.QUQU_LOCAL_PYTHON)
    : resolve(root, "mlx-env/bin/python");
  const database = process.env.QUQU_VOICE_INDEX_PATH
    ? resolve(process.env.QUQU_VOICE_INDEX_PATH)
    : resolve(root, "voice-index-v1.sqlite3");
  const snapshots = resolve(root, "hf-cache/hub/models--Qwen--Qwen3-4B-MLX-4bit/snapshots");
  const configuredModel = process.env.QUQU_LOCAL_MODEL_PATH;
  const model = configuredModel
    ? resolve(configuredModel)
    : existsSync(snapshots)
      ? resolve(snapshots, readdirSync(snapshots).sort().at(-1) ?? "")
      : "";
  const script = resolve(process.cwd(), "scripts/local-voice-chat.py");
  return { python, database, model, script };
}

export function canUseLocalVoiceModel() {
  if (process.env.NODE_ENV !== "development") return false;
  const paths = discoverPaths();
  return Object.values(paths).every((path) => path.length > 0 && existsSync(path));
}

export function warmLocalVoiceModel() {
  if (canUseLocalVoiceModel()) ensureWorker();
}

function rejectAll(error: Error) {
  pending.forEach((request) => {
    clearTimeout(request.timeout);
    request.reject(error);
  });
  pending.clear();
}

function ensureWorker() {
  if (worker && !worker.killed) return worker;
  const paths = discoverPaths();
  worker = spawn(paths.python, [paths.script, "--db", paths.database, "--model", paths.model], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  ready = false;
  const lines = createInterface({ input: worker.stdout });
  lines.on("line", (line) => {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch {
      return;
    }
    if (message.type === "ready") {
      ready = true;
      return;
    }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    if (typeof message.delta === "string") {
      request.accumulated += message.delta;
      request.onDelta?.(message.delta);
      return;
    }
    if (message.done) {
      pending.delete(message.id);
      clearTimeout(request.timeout);
      request.resolve(message.reply ?? request.accumulated);
      return;
    }
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error));
    else if (message.reply) request.resolve(message.reply);
    else request.reject(new Error("本地曲曲模型没有返回有效回复。"));
  });
  worker.stderr.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message && !message.includes("NotOpenSSLWarning")) console.warn(`[local-voice] ${message}`);
  });
  worker.on("error", (error) => {
    rejectAll(error);
    worker = null;
    ready = false;
  });
  worker.on("exit", (code) => {
    rejectAll(new Error(`本地曲曲模型已退出（${code ?? "unknown"}）。`));
    worker = null;
    ready = false;
  });
  return worker;
}

export function generateLocalVoiceReply(
  content: string,
  history: LocalVoiceHistoryMessage[],
  timeoutMs = 120_000,
) {
  if (!canUseLocalVoiceModel()) {
    return Promise.reject(new Error("本地曲曲模型文件尚未准备好。"));
  }
  const activeWorker = ensureWorker();
  const id = randomUUID();
  return new Promise<string>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`本地曲曲模型响应超时${ready ? "" : "（仍在载入）"}。`));
    }, timeoutMs);
    pending.set(id, { resolve: resolvePromise, reject, timeout, accumulated: "" });
    activeWorker.stdin.write(`${JSON.stringify({ id, content, history })}\n`);
  });
}

export function generateLocalVoiceReplyStream(
  content: string,
  history: LocalVoiceHistoryMessage[],
  onDelta: (delta: string) => void,
  timeoutMs = 120_000,
  judgment = "",
) {
  if (!canUseLocalVoiceModel()) {
    return Promise.reject(new Error("本地曲曲模型文件尚未准备好。"));
  }
  const activeWorker = ensureWorker();
  const id = randomUUID();
  return new Promise<string>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`本地曲曲模型响应超时${ready ? "" : "（仍在载入）"}。`));
    }, timeoutMs);
    pending.set(id, {
      resolve: resolvePromise,
      reject,
      timeout,
      onDelta,
      accumulated: "",
    });
    activeWorker.stdin.write(`${JSON.stringify({ id, content, history, stream: true, judgment })}\n`);
  });
}
