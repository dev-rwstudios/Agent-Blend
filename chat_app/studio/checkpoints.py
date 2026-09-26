"""Per-turn scene checkpoints — the chat's undo history.

After every turn that changed the scene, a compressed copy of the .blend is
written next to the chat's history (Blender keeps its current file open;
see blender_ops.save_copy). Restoring opens that copy in Blender, after
first checkpointing the current state so a restore can itself be undone.
The index is kept on disk per thread, so a resumed chat keeps its history.
"""

from __future__ import annotations

import json
import shutil
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from studio import blender_ops
from studio.persistence import DATA_DIR

MAX_CHECKPOINTS = 30


@dataclass
class Checkpoint:
    id: str
    label: str
    created: float
    path: str
    thumb: str | None = None


class CheckpointStore:
    def __init__(self, thread_id: str):
        self.dir = DATA_DIR / "checkpoints" / thread_id
        self._index = self.dir / "index.json"
        self.items: list[Checkpoint] = []
        # The checkpoint matching the scene as it is now (None until the
        # first checkpoint of this session) — "undo" steps back from here.
        self.current_id: str | None = None
        if self._index.exists():
            try:
                self.items = [Checkpoint(**c) for c in json.loads(self._index.read_text())]
            except (json.JSONDecodeError, TypeError):
                self.items = []

    def create(self, label: str) -> Checkpoint:
        """Blocking — call via cl.make_async."""
        cp_id = uuid.uuid4().hex[:10]
        path = self.dir / f"{int(time.time())}_{cp_id}.blend"
        blender_ops.save_copy(path)
        checkpoint = Checkpoint(
            id=cp_id, label=label[:80], created=time.time(), path=str(path),
            thumb=blender_ops.capture_viewport(max_size=320),
        )
        self.items.append(checkpoint)
        self.current_id = checkpoint.id
        self._prune()
        self._save()
        return checkpoint

    def restore(self, cp_id: str) -> Checkpoint:
        """Blocking — call via cl.make_async."""
        target = self.get(cp_id)
        if target is None or not Path(target.path).exists():
            raise blender_ops.BlenderOpError("That checkpoint no longer exists.")
        self.create(f"Before restoring “{target.label}”")
        # Open a working copy, never the checkpoint itself — otherwise a
        # Ctrl+S in Blender would silently overwrite this checkpoint.
        working = self.dir / "restored" / f"{int(time.time())}_{target.id}.blend"
        working.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target.path, working)
        blender_ops.open_blend(working)
        self.current_id = target.id
        return target

    def get(self, cp_id: str) -> Checkpoint | None:
        return next((c for c in self.items if c.id == cp_id), None)

    def previous(self) -> Checkpoint | None:
        """The checkpoint just before the current one — what "undo" restores."""
        ids = [c.id for c in self.items]
        if self.current_id not in ids:
            return self.items[-1] if self.items else None
        index = ids.index(self.current_id)
        return self.items[index - 1] if index > 0 else None

    def as_props(self) -> list[dict]:
        return [
            {
                "id": c.id, "label": c.label, "created": c.created, "thumb": c.thumb,
                "current": c.id == self.current_id,
            }
            for c in reversed(self.items)
        ]

    def _prune(self) -> None:
        while len(self.items) > MAX_CHECKPOINTS:
            old = self.items.pop(0)
            Path(old.path).unlink(missing_ok=True)

    def _save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self._index.write_text(json.dumps([asdict(c) for c in self.items]))
