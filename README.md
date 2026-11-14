# Teammate AI

放在桌上的一组 AI 队友：在 4 人黑客松头脑风暴中，自动识别团队缺哪种角色，默默启用对应的队友，用共享卡片和语音补位。

| 队友 | 角色 | 补什么位 |
|---|---|---|
| Pilot | 主持 | 没人控场：超时、跑题、偏离评分标准 |
| Scout | 研究员 | 信息不足：有没有人做过、提到的产品是什么 |
| Sage | 领域专家 | 未经验证的事实断言 |
| Rebel | 唱反调者 | 太快达成一致、没人提风险 |

## 5 分钟跑起来

需要 Node.js 22 以上。

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

然后打开 <http://localhost:5173>：选一个团队 → New meeting → 输入议题 → Start。默认是 `scripted` 模式：播放一段写死的对话和卡片，**不需要任何 API key**。

其他设备连入：打开同一地址加上 `?role=viewer`。

## 三种模式

在 `.env` 里改 `MODE`：

| 模式 | 对话来源 | 卡片来源 | 需要的 key |
|---|---|---|---|
| `scripted` | `fixtures/brainstorm.json` | 同一文件里写死的 | 无 |
| `replay` | `fixtures/brainstorm.json` | 真实 agent | `ANTHROPIC_API_KEY` |
| `live` | 主设备的麦克风 | 真实 agent | 加上 `DEEPGRAM_API_KEY` |

`REPLAY_SPEED=5` 可以快进回放，停顿和冷却时间会按同样倍数缩短。

### live 模式

在 `.env` 里设 `MODE=live`，并用 `ASR_LANGUAGE` 指定会议语言（默认 `en`，中文用 `zh-CN`）。Deepgram 没有中英混说模式，中文会议里的英文术语可能识别不准。

- **谁是谁**：语音识别只能分出"第几个开口的人"。开场请大家按名单顺序各说一句，之后的发言就会对应到名字。
- **麦克风权限**：浏览器只在 https 或 `localhost` 下允许用麦克风。iPad 通过局域网访问时，用 `npm run dev:https -w frontend` 启动页面（自签证书，首次打开要点一次"继续访问"），然后打开 `https://<电脑的局域网 IP>:5173`。页面右上角出现麦克风图标表示正在收音，红色表示被拦了。
- **不用浏览器测试识别**：`npm run asr:file -w server -- recordings/某段录音.wav --speakers 小王,小李`，把一段录音按实时速度送进同一条链路，只打印识别结果，不调用 agent。加 `--speed 3` 可以快进。

## 结构

```
shared/src/index.ts    三方共用的事件格式。唯一的接口，改之前在群里说一声
fixtures/              测试用的对话
frontend/              界面（A）
server/                语音链路、调度、WebSocket（老师）
agents/                主 agent 和四个角色（B）
```

数据流：

```
麦克风 → 语音识别 → session.onUtterance() → 主 agent 判断 → 角色 agent 写内容
       → session.intervene() → 等停顿 / 冷却 → 卡片和语音推送到所有设备
```

分工原则：**agent 决定说不说、谁说、说什么；确定性代码决定什么时候真的说出口**（停顿、冷却、排队、过期、静音、回声屏蔽都在 `server/src/session.ts`）。

## 各人从哪里开始

### A · 界面 — `frontend/`

- 三个页面：`pages/HomePage`（团队列表 + 主 agent）、`pages/TeamPage`（成员、历史、纪要、新会议）、`pages/MeetingPage`（倾听与 agent 发言）。
- Agent 形象在 `frontend/src/agents/`：`Blob.tsx` 是 three.js 液态身体，`Face.tsx` 是表情，`Prop.tsx` 是道具。打开 `/?lab=1` 可以看所有 agent 的所有状态。
- 团队和历史会议存在浏览器 localStorage 里（`store/teams.ts`），清除后回到示例数据。
- 所有能收到和能发出的事件都在 `shared/src/index.ts`。
- 队友的名字和主色在 `shared/src/index.ts` 的 `TEAMMATES`，渐变色在 `frontend/src/agents/meta.ts`。

### B · Agent — `agents/`

- 把 `ANTHROPIC_API_KEY` 写进 `.env`，然后：

  ```bash
  npm run agents:dry
  ```

  它把 `fixtures/brainstorm.json` 逐句喂给 agent，打印每句话后的决定、卡片内容和耗时。加 `-- --no-roles` 只看主 agent 的决定。
- 主 agent 的提示词：`agents/src/orchestrator.ts` 的 `ORCHESTRATOR_PROMPT`。
- 四个角色的提示词：`agents/src/roles.ts` 的 `ROLE_PROMPTS` 和 `SHARED_RULES`。
- 模型在 `.env` 里换：`ORCHESTRATOR_MODEL`、`ROLE_MODEL`，默认都是 `claude-opus-5-5`。
- 调参方法：改提示词 → 重跑同一段对话 → 对比介入的时机和内容。录好真实的头脑风暴后，把文字稿整理成同样格式放进 `fixtures/`。

### 老师 · 语音链路 — `server/`

- `server/src/audio/asr.ts`：接入流式语音识别。文件里写了建议的数据流；产出只有一个调用：`session.onUtterance({ speakerId, text, isFinal })`。
- `server/src/audio/tts.ts`：接入 TTS。现在返回 `null`，前端用浏览器自带的语音兜底。
- 停顿、冷却等时间常数：`server/src/config.ts`。
- 冒烟测试（服务端跑起来后）：

  ```bash
  npm run smoke -w server
  ```

### Henry · 产品和视频

- 队友的语气和卡片写法：和 B 一起改 `agents/src/roles.ts`。
- 演示对话：`fixtures/brainstorm.json`。视频脚本可以直接从这里改。
- 评判介入合不合理：跑 `npm run agents:dry`，逐条看“该说的说了吗、不该说的说了吗”。

## 还没做的

- 真实语音识别和说话人区分（`server/src/audio/asr.ts`）
- 真实 TTS 音色（`server/src/audio/tts.ts`）
- 录一段自己的 20 分钟英语头脑风暴作为调参素材
- iPad 访问需要 HTTPS 才能用麦克风：用 Cloudflare Tunnel 或类似工具把本地端口暴露出去
