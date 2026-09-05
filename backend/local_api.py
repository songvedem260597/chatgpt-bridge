from __future__ import annotations

import os
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .local_tools import LocalToolConfig, LocalToolError, LocalToolExecutor


router = APIRouter(prefix="/local", tags=["local-tools"])


class LocalToolReq(BaseModel):
    action: str
    path: str | None = None
    content: str | None = None
    command: str | list[str] | None = None
    cwd: str | None = None


def _executor() -> LocalToolExecutor:
    workspace = os.environ.get("CHATGPT_BRIDGE_WORKSPACE", ".")
    commands = os.environ.get(
        "CHATGPT_BRIDGE_ALLOW_COMMANDS",
        "git,python,py,pytest,npm,pnpm,yarn,node,npx",
    )
    config = LocalToolConfig.from_dict({
        "workspace": workspace,
        "allow_commands": [x.strip() for x in commands.split(",") if x.strip()],
        "timeout_seconds": int(os.environ.get("CHATGPT_BRIDGE_COMMAND_TIMEOUT", "60")),
    })
    return LocalToolExecutor(config)


@router.get("/status")
def local_status():
    return _executor().execute({"action": "status"})


@router.post("/execute")
def execute_local_tool(req: LocalToolReq):
    try:
        if hasattr(req, "model_dump"):
            payload = req.model_dump(exclude_none=True)
        else:
            payload = req.dict(exclude_none=True)
        return _executor().execute(payload)
    except LocalToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="command timed out") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"local tool failed: {exc}") from exc
