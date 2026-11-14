import "../config.ts";

/**
 * 列出这个 ElevenLabs 账号能用的音色（名字、id、标签），用来给每个 agent 挑声音。
 *   npm run voices -w server
 */
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set in .env");
  process.exit(1);
}

const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
if (!res.ok) {
  console.error(`ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { voices } = (await res.json()) as { voices: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; description?: string }[] };
for (const v of voices) {
  const l = v.labels ?? {};
  console.log([v.voice_id, v.name.padEnd(28), (v.category ?? "").padEnd(10), [l.gender, l.age, l.accent, l.descriptive ?? l.description, l.use_case].filter(Boolean).join(" · ")].join("  "));
}
console.log(`\n${voices.length} voices`);
