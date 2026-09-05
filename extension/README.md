# ChatGPT Local Bridge Extension

Chrome Manifest V3 extension that lets a normal ChatGPT web conversation call a restricted localhost coding executor.

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
9. Enable **Auto execute local_tool blocks** only when you want the current ChatGPT page to execute tool blocks automatically.

Auto execution is OFF by default.

## Protocol

The extension scans assistant messages for fenced blocks named `local_tool`.

Example:

````markdown
```local_tool
{"action":"list_dir","path":"."}
```
````

The extension sends that JSON to `POST /local/execute`, then places a new user message back into ChatGPT:

```text
[LOCAL_RESULT]
{
  "request": {...},
  "response": {...}
}
```

This allows the same ChatGPT conversation to inspect the result and issue another tool request.

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

Do not expose the backend port to LAN or the public Internet without adding authentication.

## Current v1 limitations

- No screenshot/upload pipeline yet.
- No patch/hunk editor yet; `write_file` replaces a whole UTF-8 file.
- No interactive/long-running process management yet.
- DOM selectors can need maintenance when ChatGPT changes its web UI.
