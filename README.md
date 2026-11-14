# Teammate AI

AI teammates that sit in on a small team's brainstorm and fill the role nobody is playing.

A four-person hackathon team rarely has a facilitator, a researcher, a domain expert and a sceptic all at the table. Teammate AI listens to the meeting on one shared device and brings in a specialist only when that role is missing. If someone on the team is already keeping time, the timekeeper stays asleep. If someone has already raised the risk, nobody repeats it. Most of the time the right thing for it to do is nothing.

## The teammates

| Teammate | Role | Steps in when |
|---|---|---|
| **Atlas** | Coordinator | Always listening. Answers when you speak to it by name, and decides when to wake the others. |
| **Pilot** | Facilitator | Nobody is steering: the talk has drifted, time is running out, no decision is forming. |
| **Scout** | Researcher | The team needs a fact from outside the room, such as whether a product already exists. It searches the web and cites sources. |
| **Sage** | Domain expert | A claim about the field is accepted without anyone checking it. |
| **Rebel** | Devil's advocate | The team is about to commit and nobody has voiced a risk. |

Each specialist has a paired rule: what it looks like when the role is empty, and what it looks like when a person is already filling it. The second case means silence.

## What it does

- **Listens live.** The browser streams the microphone to the server, where speech is transcribed and split by speaker.
- **Knows who is talking.** Each person records a few seconds of speech once. After that their voice is matched to their name in every meeting.
- **Decides whether to step in.** After each pause, Atlas reads the whole conversation and decides to stay quiet, keep watching something, or send in one specialist with a brief.
- **Speaks at the right moment.** A teammate waits for a gap in the conversation, says one short line aloud, and shows a small box under it only when there is something to add, such as a number or sources.
- **Answers questions.** Say "Atlas, how much time do we have left?" and it answers. If the question needs a web search or a fact check, it passes it to Scout or Sage, shown as a note flying across the screen.
- **Can be told to wait.** Say "not now, Atlas" or mute a single teammate.
- **Writes the minutes.** When the meeting ends you get a summary, the decision, who took which task, open risks, and what each teammate contributed.
- **Learns how the team works.** After each meeting it keeps private notes on each person's habits, such as who tends to keep time. These are background for the next meeting only: what happens in the room always decides.

## How it works

```
microphone → speech-to-text + speaker split → voiceprint match
          → Atlas decides: silent / keep watching / send a specialist
          → specialist writes its line (Scout searches the web)
          → wait for a pause, check cooldowns → spoken line and card on every device
```

One rule shapes the design: **the models decide whether to speak, who speaks and what is said; plain code decides when it is actually said.** Pause detection, the speaking queue, cooldowns, expiry of stale remarks, mute and echo suppression are deterministic and live in `server/src/session.ts`, with their timings in `server/src/config.ts`.

| Job | Model | Why |
|---|---|---|
| Atlas: deciding after every pause, answering questions | `claude-sonnet-5-5` | Runs constantly, so it has to be fast and steady |
| Pilot, Scout, Sage, Rebel; meeting minutes; private notes | `claude-opus-5-5` | Runs rarely, and its words are what the team hears |
| Keyword chips on the listening screen | `claude-haiku-5-5` | Cosmetic and frequent |

Speech-to-text is Deepgram `nova-3` with speaker diarization. Voiceprints run locally on the server with `sherpa-onnx`.

## Quick start

Requires Node.js 22 or later.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

Open <http://localhost:5173>, pick a team, start a new meeting, enter a topic and a length, and press start.

Out of the box this runs in `scripted` mode, which plays a fixed conversation and fixed cards and **needs no API keys**. It is the quickest way to see the interface.

Other devices on the same network can follow the meeting by opening the same address with `?role=viewer`.

## Modes

Set `MODE` in `.env`.

| Mode | Conversation comes from | Teammates are | Keys needed |
|---|---|---|---|
| `scripted` | `fixtures/brainstorm.json` | Written in the same file | None |
| `replay` | `fixtures/brainstorm.json` | Real models | `ANTHROPIC_API_KEY` |
| `live` | The host device's microphone | Real models | `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` |

`REPLAY_SPEED=5` fast-forwards a replay. Pauses and cooldowns shrink by the same factor.

### Running a live meeting

- **Language.** Meetings are in English.
- **Voices.** In a team's settings, record each person speaking for a few seconds. A person with no recording is matched to the roster in the order they first speak.
- **Voiceprint model.** About 40 MB, downloaded to `data/models/` the first time the server starts.
- **Microphone on a tablet.** Browsers allow the microphone only on `https` or `localhost`. To use an iPad on the local network, run the server and the page with the two commands below, then open `https://<your computer's LAN address>:5173`. The certificate is self-signed, so the browser asks once before continuing.

```bash
npm run dev:server
```

```bash
npm run dev:https -w frontend
```

### Testing without a room full of people

Play a recording into a live meeting as if it were the microphone. Everything runs for real, including both APIs, and the result prints in the terminal. Start the server in `live` mode first.

```bash
npm run mic:file -w server -- recordings/session.wav --speakers Henry,Ava --minutes 15
```

Check transcription and speaker split on a recording, without calling any model:

```bash
npm run asr:file -w server -- recordings/session.wav --speakers Henry,Ava
```

## Evaluating when it steps in

Staying quiet at the right time is the product, so it is tested directly. `fixtures/eval/` holds short scenarios in pairs: the same situation once with the role empty, where a specialist should appear, and once with a person filling it, where nothing should happen.

```bash
npm run agents:eval
```

There are three sets: `cases` (12 scenarios), `holdout` (7, kept aside from prompt tuning) and `personas` (6, testing that private notes inform a decision without overriding the room). Each scenario runs 3 times by default. Choose a set with `-- --file holdout` and change the repeat count with `-- --runs 5`.

The current prompt passes all 36 runs of `cases`. In a side-by-side on all three sets, Sonnet 5.5 passed 50 of 50 runs. Haiku 5.5 was close but less consistent from run to run, which is why Atlas runs on Sonnet.

To watch the decisions on a full conversation, one utterance at a time:

```bash
npm run agents:dry
```

## Project layout

```
shared/src/index.ts   The event contract shared by the browser, the server and the agents
agents/               Atlas, the four specialists, minutes, private notes, keywords, evals
server/               Session timing, WebSocket hub, speech-to-text, voiceprints
frontend/             The interface: teams, team page with minutes, the meeting screen
fixtures/             The demo conversation and the eval scenarios
demo/                 Script that records a walkthrough video of the interface
```

The agent figures are drawn in code: a three.js liquid body, an SVG face and an object for each specialist, all in `frontend/src/agents/`. In development, `/?lab=1` shows every figure in every state.

Built with TypeScript throughout: React 19, Vite, Tailwind CSS, Motion and three.js in the browser; Node.js with `ws` on the server; the Anthropic SDK with structured outputs and the web search tool for the agents.

## Privacy

- Voiceprints are stored as numeric vectors, not audio, in `data/voiceprints.json` on the server. They are never sent to a browser.
- Private notes about how each person works are stored in `data/personas.json` on the server and are read only by Atlas. They are never shown on screen.
- Deleting a team deletes its voiceprints and notes.
- `data/`, `.env` and recordings are excluded from the repository.

## Known limits

- Teammates speak with the browser's built-in speech voice. Dedicated voices are not connected yet.
- While a teammate is speaking, what people say is not heard. This stops the device from listening to itself.
- Voiceprints are matched within one language: someone enrolled in Mandarin is not recognised when speaking English, so enrol in the language of the meeting.
- A new voice takes about two seconds of speech to be named.
- The export button on the minutes and the invite link for a new team are placeholders.
- Teams and past meetings are stored in the browser, so they do not sync between devices.
