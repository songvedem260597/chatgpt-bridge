"""ChatGPT WebUI Bridge — FastAPI backend service."""
from __future__ import annotations

import sys
import threading
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .bridge_state import state
from .local_api import router as local_router

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_supervisor_thread = None
_supervisor_stop_event = threading.Event()


class RegisterReq(BaseModel):
    page_id: str | None = None
    page: str = "chatgpt"
    url: str = ""
    title: str = ""


class PollReq(BaseModel):
    page_id: str
    snapshot: dict[str, Any] | None = None


class ResultReq(BaseModel):
    id: str
    result: dict[str, Any] = {}


class SendReq(BaseModel):
    text: str
    page_id: str | None = None


class NewChatReq(BaseModel):
    page_id: str | None = None


app = FastAPI(
    title="ChatGPT WebUI Bridge",
    description="Bridge logged-in ChatGPT web tabs to local agents and restricted local coding tools.",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(local_router)


@app.post("/register")
def register(req: RegisterReq):
    pid = state.register(req.page_id, req.dict())
    return {"ok": True, "page_id": pid}


@app.post("/poll")
def poll(req: PollReq):
    return state.poll(req.page_id, req.snapshot)


@app.post("/result")
def submit_result(req: ResultReq):
    state.submit_result(req.id, req.result)
    return {"ok": True}


@app.get("/status")
def get_status():
    pages = state.list_pages()
    alive = sum(1 for p in pages if p["alive"])
    return {
        "pages_connected": len(pages),
        "pages_alive": alive,
        "supervisor_running": _supervisor_thread is not None and _supervisor_thread.is_alive(),
    }


@app.get("/pages")
def list_pages():
    pages = state.list_pages()
    return {"pages": pages, "total": len(pages)}


@app.get("/snapshot")
def get_snapshot(page_id: str | None = None):
    snap = state.get_snapshot(page_id)
    return snap or {"error": "no available snapshot"}


@app.get("/all_snapshots")
def get_all_snapshots():
    return {"pages": state.get_all_snapshots()}


@app.post("/send")
def send_message(req: SendReq):
    try:
        cid = state.send_command(req.page_id, "send", req.text)
        return state.wait_result(cid, timeout=180)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/send_async")
def send_async(req: SendReq):
    try:
        cid = state.send_command(req.page_id, "send", req.text)
        return {"ok": True, "cmd_id": cid}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/new_chat")
def new_chat(req: NewChatReq):
    try:
        cid = state.send_command(req.page_id, "new_chat")
        return state.wait_result(cid, timeout=30)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/idle")
def find_idle():
    return {"page_id": state.find_idle_page()}


@app.post("/supervisor/{action}")
def control_supervisor(action: str):
    global _supervisor_thread, _supervisor_stop_event
    from .supervisor import Supervisor

    if action == "start":
        if _supervisor_thread and _supervisor_thread.is_alive():
            return {"ok": True, "msg": "supervisor already running"}
        _supervisor_stop_event = threading.Event()
        sup = Supervisor(config={}, stop_event=_supervisor_stop_event)
        _supervisor_thread = threading.Thread(target=sup.run, daemon=True)
        _supervisor_thread.start()
        return {"ok": True, "msg": "supervisor started"}
    if action == "stop":
        _supervisor_stop_event.set()
        return {"ok": True, "msg": "supervisor stop requested"}
    raise HTTPException(status_code=400, detail=f"unknown action: {action}")


@app.get("/")
def root():
    return {"service": "ChatGPT WebUI Bridge", "version": "1.1.0", "docs": "/docs"}
