#!/usr/bin/env node
// Состояние навыка agent-finish-notify: настройки окружения и отметки сессий.
// Лежит в /data/external/agent-finish-notify/ (копируется туда при настройке).
import fs from "node:fs";
import path from "node:path";

const root = "/data/external/agent-finish-notify";
const configPath = path.join(root, "config.json");
const sessionId = process.env.DSH_SESSION_ID || "unknown-session";
const sessionPath = path.join(root, "sessions", `${sessionId}.json`);

const now = () => Date.now();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readConfig() {
  return readJson(configPath) ?? { thresholdMinutes: 3 };
}

function pruneSessions() {
  const dir = path.join(root, "sessions");
  if (!fs.existsSync(dir)) return;
  const cutoff = now() - 30 * 24 * 3600 * 1000;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      // старый файл мог исчезнуть — не мешает
    }
  }
}

const command = process.argv[2] || "status";

if (command === "status") {
  const session = readJson(sessionPath);
  console.log(
    JSON.stringify(
      {
        sessionId,
        config: fs.existsSync(configPath) ? readJson(configPath) : null,
        session,
        armed: Boolean(session && session.enabled),
      },
      null,
      2,
    ),
  );
} else if (command === "enable") {
  pruneSessions();
  const session = readJson(sessionPath) ?? {};
  session.enabled = true;
  session.enabledAt = now();
  session.startedAt = now();
  writeJson(sessionPath, session);
  console.log(JSON.stringify({ armed: true, startedAt: session.startedAt }));
} else if (command === "arm") {
  pruneSessions();
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  if (!session.startedAt) session.startedAt = now();
  writeJson(sessionPath, session);
  console.log(JSON.stringify({ armed: true, startedAt: session.startedAt }));
} else if (command === "check") {
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  if (!session.startedAt) {
    console.log("NOSTART");
    process.exit(0);
  }
  const threshold = Number(readConfig().thresholdMinutes ?? 3);
  const minutes = Math.round((now() - session.startedAt) / 60000);
  const send = threshold === 0 || minutes >= threshold;
  console.log(`${send ? "SEND" : "SKIP"} ${minutes} ${threshold}`);
} else if (command === "done") {
  const session = readJson(sessionPath);
  if (!session) {
    console.log("OFF");
    process.exit(0);
  }
  session.lastNotifiedAt = now();
  session.startedAt = null;
  writeJson(sessionPath, session);
  console.log(JSON.stringify(session));
} else if (command === "disarm") {
  try {
    fs.unlinkSync(sessionPath);
  } catch {
    // уже выключено
  }
  console.log("OFF");
} else if (command === "config") {
  const config = readConfig();
  for (const pair of process.argv.slice(3)) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const key = pair.slice(0, index);
    const raw = pair.slice(index + 1);
    let value = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    config[key] = value;
  }
  config.updatedAt = new Date().toISOString();
  writeJson(configPath, config);
  console.log(JSON.stringify(config, null, 2));
} else {
  console.error("Команды: status, enable, arm, check, done, disarm, config key=value");
  process.exit(2);
}
