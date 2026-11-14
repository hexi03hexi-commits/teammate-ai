import fs from "node:fs";
import path from "node:path";
import type { Persona } from "@teammate/agents";
import { ROOT } from "./config.ts";

/**
 * 成员画像的存放处：服务端本地的一个 JSON 文件，按团队分开。
 * 画像不公开——它从不通过 WebSocket 发给任何设备，也不进 git（data/ 已忽略）。
 * 想清空某个团队的画像，删掉文件里对应的键即可；删掉整个文件则全部清空。
 */
const FILE = path.join(ROOT, "data", "personas.json");

type Store = Record<string, Persona[]>;

function read(): Store {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

export function loadPersonas(teamId: string | undefined): Persona[] {
  return teamId ? (read()[teamId] ?? []) : [];
}

export function savePersonas(teamId: string, personas: Persona[]) {
  const store = read();
  store[teamId] = personas;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}
