# ChatGPT WebUI Bridge

ChatGPT WebUI Bridge lets a local agent control multiple logged-in ChatGPT browser tabs through an HTTP API: send prompts, read replies, monitor page state, and **auto-download generated images**.

For agent-led installs and troubleshooting, read [`AGENT_INSTALL_SKILL.md`](AGENT_INSTALL_SKILL.md).

## How It Works

```text
Your agent  ←HTTP API→  Local backend service  ←HTTP polling→  Userscript injected into ChatGPT
                                                              ↕
                                                          ChatGPT Web UI
```

- The **userscript** runs inside logged-in ChatGPT pages, sends snapshots to the backend, and receives commands.
- The **backend service** manages page state and exposes HTTP APIs to agents.
- The **auto-download script** monitors ChatGPT for newly generated images and downloads them automatically.
- The optional **supervisor** scans idle tabs and calls Claude CLI, Codex CLI, or an OpenAI-compatible API to produce short continuation messages.

## Quick Start

### 1. Install backend dependencies

```bash
cd chatgpt-bridge
pip install -r requirements.txt
```

### 2. Start the service

```bash
python run.py
# Start with the Claude supervisor
python run.py --with-supervisor
```

Open `http://127.0.0.1:5000/docs` for the generated API docs.

### 3. Install the userscripts

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension in Chrome.
2. Open `chrome://extensions/` and enable **Developer mode** + **Allow User Scripts**.
3. Create a new Tampermonkey script and paste the full contents of `userscript/chatgpt_bridge.user.js`. Save with Ctrl+S.
4. Create another Tampermonkey script and paste the full contents of `userscript/auto_download_images.user.js`. Save with Ctrl+S.
5. Open or refresh `https://chatgpt.com/`.
6. A green `Bridge: ready` badge means the page is connected.

If the badge says `waiting for service`, start the backend first. If it says `connection error`, check Tampermonkey permissions and the backend port.

## Image Generation

Generate images in ChatGPT programmatically and auto-download them:

```bash
python generate_image.py "a samurai standing in rain, cinematic lighting"
```

The script sends the prompt to ChatGPT via the bridge API. When ChatGPT generates the image, the auto-download userscript detects it and saves it to your Downloads folder automatically.

**Features:**
- Only downloads **new** images (skips existing ones on page load)
- Only downloads **assistant-generated** images (skips user uploads)
- Downloads only the **latest** image per generation

## Agent Example

```python
from examples.agent_client import ChatGPTBridge

bridge = ChatGPTBridge("http://127.0.0.1:5000")

for p in bridge.list_pages():
    print(p["page_id"], p["title"], "generating" if p["is_generating"] else "idle")

reply = bridge.send("Summarize this conversation")
print(reply)

snap = bridge.snapshot()
for t in snap["recentTurns"]:
    print(f"[{t['role']}] {t['text']}")
```

## Main APIs

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Service status |
| GET | `/pages` | List connected tabs |
| GET | `/snapshot?page_id=` | Get one page snapshot |
| GET | `/all_snapshots` | Get all snapshots |
| POST | `/send` | Send a message and wait for reply |
| POST | `/send_async` | Send a message asynchronously |
| POST | `/new_chat` | Start a new chat |
| GET | `/idle` | Find an idle page |
| POST | `/supervisor/start` | Start the Claude supervisor |
| POST | `/supervisor/stop` | Stop the Claude supervisor |

## Configuration

Edit `config.yaml`:

- `server.port`: backend port; keep it aligned with `BACKEND_URL` in the userscript.
- `supervisor.enabled`: whether the supervisor starts automatically.
- `supervisor.prompt`: prompt template for Claude supervisor decisions.
- `supervisor.banned_words`: words removed from supervisor replies.

## Project Layout

```text
chatgpt-bridge/
├── run.py                              # FastAPI entrypoint
├── config.yaml                         # Configuration
├── requirements.txt                    # Python dependencies
├── generate_image.py                   # CLI tool: generate images via ChatGPT
├── auto_paste.py                       # Helper: auto-paste script into Tampermonkey
├── LICENSE
├── README.md
├── AGENT_INSTALL_SKILL.md              # Agent install guide
├── backend/
│   ├── __init__.py
│   ├── server.py                       # FastAPI backend (with CORS support)
│   ├── bridge_state.py                 # Page state manager
│   └── supervisor.py                   # Claude/Codex/API supervisor
├── userscript/
│   ├── chatgpt_bridge.user.js          # Tampermonkey: bridge between ChatGPT and backend
│   └── auto_download_images.user.js    # Tampermonkey: auto-download generated images
├── examples/
│   ├── agent_client.py                 # Python client wrapper
│   └── neurogolf_config.yaml           # NeuroGolf sample config
└── local/                              # Single-process version (no FastAPI needed)
    ├── run_all.py                      # Bridge + supervisor in one process
    ├── launcher.py                     # GUI launcher
    ├── monitor.py                      # tkinter monitor GUI
    ├── start.bat                       # Windows start helper
    └── restart.bat                     # Windows restart helper
```

## Notes

- The userscript relies on `GM_xmlhttpRequest`; Tampermonkey is recommended.
- Background tabs may be throttled by the browser; switching back to a tab lets it reconnect.
- `page_id` is based on the conversation URL, so duplicate tabs of the same conversation can still be distinguished.
- Auto-supervision is intended for short continuation nudges; complex strategies should live in the external agent.
- The auto-download script uses DOM polling (every 3s) to detect newly generated images.

## License

MIT
