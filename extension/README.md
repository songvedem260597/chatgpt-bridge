# ChatGPT Local Bridge Extension

Chrome Manifest V3 extension that lets a normal ChatGPT web conversation call a restricted localhost coding executor.

## Why this version avoids the Browser Layer problem

This extension uses **plain-text messages only** inside ChatGPT:

- it does not upload markdown files
- it does not create ChatGPT attachments
- it does not call MCP, Work, Codex, or ChatGPT tool APIs
- it does not create `File`, `Blob`, or `DataTransfer` uploads
- it refuses to auto-send if the ChatGPT composer already has a pending attachment
- large local results are truncated before being sent back into ChatGPT

That means the bridge loop is based on normal text chat rather than attachment/advanced-feature transport.

This cannot guarantee that ChatGPT will never apply account/workspace limits of its own; it only ensures this extension does not deliberately invoke file-upload or advanced-tool flows.

## Install

1. Pull branch `feature/chrome-extension-local-tools`.
2. Install Python dependencies: `pip install -r requirements.txt`.
3. Point the bridge at the project you want ChatGPT to work on.

PowerShell:

```powershell
$env:CHATGPT_BRIDGE_WORKSPACE = "D:\\Projects\\my-app"
$env:CHATGPT_BRIDGE_ALLOW_COMMANDS = "git,python,py,pytest,npm,pnpm,yarn,node,npx"
python run.py
```

4. Open `chrome://extensions`.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the repository's `extension` folder.
7. Open `https://chatgpt.com` and click the extension icon.
8. Click **Test**. `/local/status` should show the configured workspace.
9. Enable **Auto execute local_tool blocks** only when you want the current ChatGPT page to execute tool commands automatically.

Auto execution is OFF by default.

## Protocol

Preferred v2 plain-text marker format:

```text
[[LOCAL_TOOL]]
{"action":"list_dir","path":"."}
[[/LOCAL_TOOL]]
```

To reduce chat round trips, batch independent operations in one block as a JSON array:

```text
[[LOCAL_TOOL]]
[
  {"action":"read_file","path":"AGENTS.md"},
  {"action":"read_file","path":"package.json"},
  {"action":"git_status","cwd":"."}
]
[[/LOCAL_TOOL]]
```

The extension executes the batch locally and sends one combined `[LOCAL_RESULT]` message back to ChatGPT. Dependent operations should still be sent in separate turns when a later command needs an earlier result.

The older fenced format is still recognized for compatibility:

````markdown
```local_tool
{"action":"list_dir","path":"."}
```
````

The extension sends that JSON to `POST /local/execute`, then places a new normal user text message back into ChatGPT:

```text
[LOCAL_RESULT]
{
  "request": {...},
  "response": {...}
}
```

No file is created or attached for this result.

## Supported actions

### status

```json
{"action":"status"}
```

### list_dir

```json
{"action":"list_dir","path":"src"}
```

### read_file

```json
{"action":"read_file","path":"src/app.ts"}
```

### write_file

Complete-file replacement only in v1:

```json
{"action":"write_file","path":"src/app.ts","content":"...complete file..."}
```

### mkdir

```json
{"action":"mkdir","path":"src/new-folder"}
```

### run

Commands are executed with `shell=false`. The executable must be in `CHATGPT_BRIDGE_ALLOW_COMMANDS`.

```json
{"action":"run","command":["npm.cmd","test"],"cwd":"."}
```

On Windows, `.cmd` names such as `npm.cmd`, `pnpm.cmd`, `npx.cmd` are generally the safest form.

### git_status / git_diff

```json
{"action":"git_status","cwd":"."}
```

```json
{"action":"git_diff","cwd":"."}
```

## Security model

- Backend should remain bound to `127.0.0.1`.
- File actions reject absolute paths and `..` escapes outside `CHATGPT_BRIDGE_WORKSPACE`.
- Command execution does not use a shell.
- Only allowlisted executables can run.
- File reads/writes are capped at 2 MB.
- Command output is truncated before returning to ChatGPT.
- Auto execution is opt-in.
- Plain-text mode refuses auto-send while an attachment is present in the composer.

Do not expose the backend port to LAN or the public Internet without adding authentication.

## Current limitations

- No screenshot/upload pipeline yet. This is intentional while keeping transport text-only.
- No patch/hunk editor yet; `write_file` replaces a whole UTF-8 file.
- No interactive/long-running process management yet.
- DOM selectors can need maintenance when ChatGPT changes its web UI.
- ChatGPT may still enforce independent workspace/account limits unrelated to this extension.
