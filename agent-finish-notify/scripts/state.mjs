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
  return readJson(configPath) ?? { thresholdMinutes: 3, questionThresholdSeconds: 30 };
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
  const taskActive = Boolean(session && session.enabled && session.startedAt);
  console.log(
    JSON.stringify(
      {
        sessionId,
        config: fs.existsSync(configPath) ? readJson(configPath) : null,
        session,
        armed: Boolean(session && session.enabled),
        taskActive,
        warning:
          session && session.enabled && !session.startedAt
            ? "сессия включена, но задача не начата: вызови arm"
            : null,
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
  session.lastUserAt = now();
  writeJson(sessionPath, session);
  console.log(JSON.stringify({ armed: true, startedAt: session.startedAt }));
} else if (command === "arm") {
  pruneSessions();
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  if (!session.startedAt) {
    session.startedAt = now();
    session.lastUserAt = now();
  }
  writeJson(sessionPath, session);
  console.log(JSON.stringify({ armed: true, startedAt: session.startedAt }));
} else if (command === "touch") {
  // Человек написал по ходу задачи: отсчёт вопросов идёт от его сообщения.
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  session.lastUserAt = now();
  writeJson(sessionPath, session);
  console.log(JSON.stringify({ lastUserAt: session.lastUserAt }));
} else if (command === "check") {
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  const threshold = Number(readConfig().thresholdMinutes ?? 3);
  // Таймер не запущен (забыли arm) — считаем от последней активности человека.
  // Лучше прислать уведомление, чем промолчать из-за пропущенного шага.
  const start = session.startedAt ?? session.lastUserAt;
  if (!start) {
    console.log("NOTARMED");
    process.exit(0);
  }
  const minutes = Math.round((now() - start) / 60000);
  const send = threshold === 0 || minutes >= threshold;
  const auto = session.startedAt ? "" : " auto";
  console.log(`${send ? "SEND" : "SKIP"} ${minutes} ${threshold}${auto}`);
} else if (command === "ask") {
  // Перед вопросом: человек только что писал — он у экрана; иначе сообщаем сразу.
  const session = readJson(sessionPath);
  if (!session || !session.enabled) {
    console.log("OFF");
    process.exit(0);
  }
  const config = readConfig();
  const threshold = Number(config.questionThresholdSeconds ?? 30);
  const last = session.lastUserAt ?? session.startedAt;
  if (!last) {
    console.log(`SEND 0 ${threshold}`);
    process.exit(0);
  }
  const seconds = Math.round((now() - last) / 1000);
  console.log(`${seconds >= threshold ? "SEND" : "SKIP"} ${seconds} ${threshold}`);
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
  console.error("Команды: status, enable, arm, touch, check, ask, done, disarm, config key=value");
  process.exit(2);
}
