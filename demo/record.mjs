/**
 * Records the product walkthrough: drives the real app inside the iPad stage
 * (frontend/demo/ipad.html) through the core features in order, and writes an mp4.
 *
 * Needs both servers running, the session server in scripted mode at 2x:
 *   MODE=scripted REPLAY_SPEED=2 npm run start -w server
 *   npm run dev:web
 * Then:
 *   node demo/record.mjs
 *
 * Uses the Chrome installed on this machine (headless, GPU on) with a fake microphone,
 * so voice enrolment can be shown. The video has no sound.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out", "teammate-ai-walkthrough.mp4");
const URL = process.env.DEMO_URL ?? "http://localhost:5173/demo/ipad.html";
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light", permissions: ["microphone"] });

// Headless Chrome has no system voices, so a spoken line would end instantly. For the recording,
// stand in for the voice with a silent utterance of realistic length; the app's own flow
// (speak_started → speaking state → speak_done) runs unchanged.
await context.addInitScript(() => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.speak = (u) => {
    setTimeout(() => u.onstart?.(new Event("start")), 80);
    setTimeout(() => u.onend?.(new Event("end")), 1100 + u.text.length * 58);
  };
  window.speechSynthesis.cancel = () => {};
});

// Start from a clean slate: a previous run may have left a meeting live on the server.
await new Promise((resolve, reject) => {
  const ws = new WebSocket(process.env.DEMO_WS ?? "ws://localhost:8787");
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "reset" }));
    setTimeout(() => (ws.close(), resolve()), 300);
  };
  ws.onerror = () => reject(new Error("Session server is not running on :8787"));
});

const page = await context.newPage();
await page.goto(URL);
const app = page.frameLocator("#app");
await app.getByText("IC AI Hack").waitFor();
await sleep(1500);

// ───────────── recording: screencast frames → ffmpeg ─────────────
const ffmpeg = spawn(
  ffmpegPath,
  ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-use_wallclock_as_timestamps", "1", "-i", "-",
   "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", OUT],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const cdp = await context.newCDPSession(page);
let frames = 0;
cdp.on("Page.screencastFrame", (f) => {
  frames++;
  ffmpeg.stdin.write(Buffer.from(f.data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// ───────────── helpers ─────────────
const step = (i, text) => {
  log(`step ${i + 1}: ${text}`);
  return page.evaluate(([i, text]) => window.demo.step(i, text), [i, text]);
};
const note = (text) => {
  log(`  · ${text}`);
  return page.evaluate((text) => window.demo.note(text), text);
};

/** Move the touch point (and the real pointer, so hover and gaze react) */
async function glide(x, y, ms = 520) {
  await page.evaluate(([x, y]) => window.demo.moveTo(x, y), [x, y]);
  await page.mouse.move(x, y, { steps: 18 });
  await sleep(ms);
}
async function centre(locator) {
  await locator.waitFor({ state: "visible", timeout: 20_000 });
  // Not scrollIntoViewIfNeeded(): it waits for the element to stop moving, and the agents never do
  await locator.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  await sleep(150);
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function tap(locator, after = 500) {
  const { x, y } = await centre(locator);
  await glide(x, y);
  await page.evaluate(() => window.demo.press());
  await sleep(130);
  await page.mouse.click(x, y);
  await sleep(after);
}
const type = (text, delay = 48) => page.keyboard.type(text, { delay });
/** The Adopt / Dismiss button of the agent that is on stage */
const stationButton = (agent, label) =>
  app.locator(`xpath=//div[@data-agent="${agent}"]/ancestor::div[.//button[@aria-label="${label}"]][1]`).getByLabel(label);
const seen = (text, timeout = 60_000) => app.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });

try {
// ═════════════ 1 · Teams and the main agent ═════════════
await step(0, "Every team keeps its people, its agents and its meetings. Mate, the main agent, follows you around.");
const mate = await centre(app.locator('[data-agent="main"]').first());
await glide(mate.x + 260, mate.y - 120, 700);
await glide(mate.x - 240, mate.y + 60, 700);
await glide(mate.x + 40, mate.y - 20, 500);
await page.evaluate(() => window.demo.press());
await page.mouse.click(mate.x, mate.y);
await sleep(1500);
const hack = app.getByRole("button", { name: /IC AI Hack/ });
const studio = app.getByRole("button", { name: /Design Studio/ });
await glide(...Object.values(await centre(studio)), 900);
await glide(...Object.values(await centre(hack)), 1100);

// ═════════════ 2 · Create a team ═════════════
await step(1, "A new team gets a name and an invite link. The four agents come with it.");
await tap(app.getByLabel("Add team"), 700);
await type("Robotics Club");
await sleep(600);
await tap(app.getByLabel("Copy invite link"), 1400);
await tap(app.getByLabel("Cancel"), 700);

// ═════════════ 3 · History and minutes ═════════════
await step(2, "Each past meeting shows who attended, people and agents. Its minutes are colour-coded by agent.");
await tap(hack, 1800);
const panel = { x: 1330, y: 600 }; // inside the right-hand card
await glide(panel.x, panel.y, 400);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, 170);
  await sleep(520);
}
await sleep(700);
await tap(app.getByRole("button", { name: /Team roles and working hours/ }), 2200);
await note("Pick another meeting: the roster shows who was there. Agents that were not called stay asleep.");
await sleep(2600);

// ═════════════ 4 · Team brief and voices ═════════════
await step(3, "The target, the judging criteria and the track belong to the team, and can be edited at any time.");
await tap(app.getByLabel("Team settings"), 1500);
await tap(app.getByPlaceholder("industry or track"), 300);
await page.keyboard.press("End");
await type(", study tools");
await sleep(900);
await note("Voice enrolment: each person introduces themselves once, so speakers can be told apart.");
await tap(app.getByLabel("Record Henry", { exact: true }), 300);
await app.getByLabel("Record Henry again").waitFor({ timeout: 10_000 });
await sleep(500);
await tap(app.getByLabel("Record Ava", { exact: true }), 300);
await app.getByLabel("Record Ava again").waitFor({ timeout: 10_000 });
await sleep(900);
await tap(app.getByLabel("Done"), 1200);

// ═════════════ 5 · Start a meeting ═════════════
await step(4, "A meeting only needs a topic and a length. Choose who attends and which agents may be called.");
await tap(app.getByRole("button", { name: "New meeting" }), 900);
await type("Pick one idea for the hackathon");
await sleep(500);
await tap(app.getByRole("radio", { name: /^5/ }), 900);
await tap(app.getByRole("button", { name: "Start" }), 600);

// ═════════════ 6 · Listening ═════════════
await step(5, "Mate listens. You see who is talking and the keywords it picks up, never a transcript.");
await page.evaluate(() => window.demo.hide());
await seen("This space is crowded");

// ═════════════ 7 · Agents step in ═════════════
await step(6, "“Has anyone done this?” Nobody knows. Scout, the researcher, checks and reports.");
await sleep(5200);
await tap(stationButton("scout", "Adopt"), 600);
await page.evaluate(() => window.demo.hide());
await note("Adopted. Scout steps back and Mate keeps listening.");

await seen("One minute in, no idea chosen yet");
await note("The talk drifts to coffee. Pilot, the facilitator, waits for a pause, then speaks.");
await sleep(7500);

await note("Pause holds everything: the clock, the listening, the agents.");
await tap(app.getByLabel("Pause"), 2600);
await tap(app.getByLabel("Resume"), 500);
await page.evaluate(() => window.demo.hide());

await seen("The 80% figure isn't established");
await note("An unverified number. Sage, the domain expert, corrects it and offers safer wording.");

await seen("Nobody has named a risk yet");
await note("Everyone agrees in ten seconds. Rebel, the devil's advocate, asks what could sink the demo.");

await seen("Lecture recordings you can use");
await note("“Hey Scout…” Called by name, Scout answers. With four agents active the stage rearranges itself.");
await sleep(5500);

await note("Adopt what helps, dismiss the rest.");
await tap(stationButton("rebel", "Adopt"), 900);
await tap(stationButton("sage", "Dismiss"), 1500);
await page.evaluate(() => window.demo.hide());
await sleep(5000);

// ═════════════ 8 · Minutes, filed ═════════════
await step(7, "End the meeting and it is filed as minutes: decision, action items, discussion, each agent's input.");
await tap(app.getByLabel("End meeting"), 900);
await tap(app.getByLabel("End meeting"), 400);
await seen("Meeting minutes", 20_000);
await sleep(2400);
await glide(panel.x, panel.y, 300);
for (let i = 0; i < 9; i++) {
  await page.mouse.wheel(0, 190);
  await sleep(700);
}
await sleep(1200);
await note("Light and dark themes.");
await tap(app.getByLabel("Switch theme"), 2600);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -420);
  await sleep(350);
}
await sleep(1500);
await tap(app.getByLabel("Back"), 1800);
await page.evaluate(() => window.demo.hide());
await note("teammate ai");
await sleep(3000);

} catch (err) {
  // Keep what was recorded and a picture of where it stopped
  await page.screenshot({ path: path.join(here, "out", "failed-at.png") });
  log("FAILED:", String(err.message).slice(0, 200));
  process.exitCode = 1;
}

// ───────────── finish ─────────────
await cdp.send("Page.stopScreencast");
await sleep(300);
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));
await browser.close();
log(`done: ${frames} frames → ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
