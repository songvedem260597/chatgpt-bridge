from __future__ import annotations

import json
import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_MAX_OUTPUT = 16000


class LocalToolError(RuntimeError):
    pass


@dataclass
class LocalToolConfig:
    workspace: Path
    allow_commands: tuple[str, ...]
    timeout_seconds: int = 60
    max_output_chars: int = DEFAULT_MAX_OUTPUT

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "LocalToolConfig":
        data = data or {}
        workspace = Path(data.get("workspace", ".")).expanduser().resolve()
        allow_commands = tuple(
            str(x).lower()
            for x in data.get(
                "allow_commands",
                ["git", "python", "py", "pytest", "npm", "pnpm", "yarn", "node", "npx"],
            )
        )
        timeout_seconds = max(1, min(int(data.get("timeout_seconds", 60)), 300))
        max_output_chars = max(1000, min(int(data.get("max_output_chars", DEFAULT_MAX_OUTPUT)), 100000))
        return cls(workspace, allow_commands, timeout_seconds, max_output_chars)


class LocalToolExecutor:
    def __init__(self, config: LocalToolConfig):
        self.config = config
        self.config.workspace.mkdir(parents=True, exist_ok=True)

    def _resolve(self, relative_path: str | None) -> Path:
        if relative_path in (None, "", "."):
            candidate = self.config.workspace
        else:
            raw = Path(str(relative_path).replace("\\", os.sep))
            if raw.is_absolute():
                raise LocalToolError("absolute paths are not allowed")
            candidate = (self.config.workspace / raw).resolve()

        try:
            candidate.relative_to(self.config.workspace)
        except ValueError as exc:
            raise LocalToolError("path escapes configured workspace") from exc
        return candidate

    def _truncate(self, text: str) -> str:
        limit = self.config.max_output_chars
        if len(text) <= limit:
            return text
        half = limit // 2
        return text[:half] + "\n...[output truncated]...\n" + text[-half:]

    def execute(self, request: dict[str, Any]) -> dict[str, Any]:
        action = str(request.get("action", "")).strip().lower()
        if not action:
            raise LocalToolError("missing action")

        handlers = {
            "status": self._status,
            "list_dir": self._list_dir,
            "read_file": self._read_file,
            "write_file": self._write_file,
            "mkdir": self._mkdir,
            "run": self._run,
            "git_diff": self._git_diff,
            "git_status": self._git_status,
        }
        handler = handlers.get(action)
        if not handler:
            raise LocalToolError(f"unsupported action: {action}")
        result = handler(request)
        return {"ok": True, "action": action, "result": result}

    def _status(self, _request: dict[str, Any]) -> dict[str, Any]:
        return {
            "workspace": str(self.config.workspace),
            "allow_commands": list(self.config.allow_commands),
            "timeout_seconds": self.config.timeout_seconds,
        }

    def _list_dir(self, request: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve(request.get("path", "."))
        if not path.exists():
            raise LocalToolError("path does not exist")
        if not path.is_dir():
            raise LocalToolError("path is not a directory")
        entries = []
        for item in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            entries.append({
                "name": item.name,
                "type": "dir" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            })
        return {"path": str(path.relative_to(self.config.workspace) or "."), "entries": entries[:1000]}

    def _read_file(self, request: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve(request.get("path"))
        if not path.exists() or not path.is_file():
            raise LocalToolError("file does not exist")
        if path.stat().st_size > 2_000_000:
            raise LocalToolError("file is too large (>2 MB)")
        text = path.read_text(encoding="utf-8", errors="replace")
        return {
            "path": str(path.relative_to(self.config.workspace)),
            "content": self._truncate(text),
            "size": path.stat().st_size,
        }

    def _write_file(self, request: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve(request.get("path"))
        content = request.get("content")
        if not isinstance(content, str):
            raise LocalToolError("content must be a string")
        if len(content) > 2_000_000:
            raise LocalToolError("content is too large (>2 MB)")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {
            "path": str(path.relative_to(self.config.workspace)),
            "bytes": path.stat().st_size,
        }

    def _mkdir(self, request: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve(request.get("path"))
        path.mkdir(parents=True, exist_ok=True)
        return {"path": str(path.relative_to(self.config.workspace))}

    def _command_tokens(self, request: dict[str, Any]) -> list[str]:
        command = request.get("command")
        if isinstance(command, str):
            tokens = shlex.split(command, posix=os.name != "nt")
        elif isinstance(command, list) and all(isinstance(x, str) for x in command):
            tokens = command
        else:
            raise LocalToolError("command must be a string or string array")
        if not tokens:
            raise LocalToolError("empty command")
        executable = Path(tokens[0]).name.lower()
        if executable.endswith(".exe"):
            executable = executable[:-4]
        if executable.endswith(".cmd"):
            executable = executable[:-4]
        if executable not in self.config.allow_commands:
            raise LocalToolError(f"command is not allowlisted: {tokens[0]}")
        return tokens

    def _run_process(self, tokens: list[str], cwd: Path) -> dict[str, Any]:
        completed = subprocess.run(
            tokens,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=self.config.timeout_seconds,
            shell=False,
        )
        stdout = self._truncate(completed.stdout or "")
        stderr = self._truncate(completed.stderr or "")
        return {
            "command": tokens,
            "cwd": str(cwd.relative_to(self.config.workspace) or "."),
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }

    def _run(self, request: dict[str, Any]) -> dict[str, Any]:
        cwd = self._resolve(request.get("cwd", "."))
        if not cwd.exists() or not cwd.is_dir():
            raise LocalToolError("cwd does not exist or is not a directory")
        return self._run_process(self._command_tokens(request), cwd)

    def _git_diff(self, request: dict[str, Any]) -> dict[str, Any]:
        cwd = self._resolve(request.get("cwd", "."))
        return self._run_process(["git", "diff", "--no-ext-diff"], cwd)

    def _git_status(self, request: dict[str, Any]) -> dict[str, Any]:
        cwd = self._resolve(request.get("cwd", "."))
        return self._run_process(["git", "status", "--short", "--branch"], cwd)


def format_local_result(payload: dict[str, Any]) -> str:
    return "[LOCAL_RESULT]\n" + json.dumps(payload, ensure_ascii=False, indent=2)
