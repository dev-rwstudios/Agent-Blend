# Projects & Chats (desktop app)

The desktop app separates **projects** (scene-building workspaces) from
**general chats** (questions about anything).

| | Project | General chat |
|---|---|---|
| What it is | One Blender scene with its own brief, asset sources, Asset Bucket and chats | A conversation not attached to any scene |
| Chats | Many per project; each gets the project brief + live scene as context | One conversation each |
| Can change Blender | Yes — only while Blender shows *this* project's scene | Never (Ask mode only; tool calls are dropped) |
| Knows about | Its brief, its scene, assets from its own sources | Every project (brief + saved scene summary) and all asset sources |

Why several chats per project: the scene lives in the project's `.blend`, not in
the chat, so a new chat loses nothing — and short, focused chats keep local
models (8–32K context) from overflowing.

## Storage

Everything lives in the app data folder (`<app data>/workspace/`, e.g.
`~/.local/share/com.agentblend.studio/workspace` on Linux), written by the Rust
commands in `desktop_app/src-tauri/src/storage.rs`:

```
state.json                          last active project/chat
projects/<projectId>/
  project.json                      name, description, asset sources, scene summary
  scene.blend                       the project's scene (saved by Blender)
  bucket.json                       the project's Asset Bucket
  assets.json                       cached scan of the project's asset sources
  chats/<chatId>/meta.json          title, timestamps, message count
  chats/<chatId>/messages.json      the conversation
chats/<chatId>/...                  general chats
.trash/                             deleted projects/chats (recoverable)
```

- A project folder is self-contained: back it up, move it, or delete it as one unit.
- Paths from the frontend are validated segment by segment — nothing can be read
  or written outside the workspace folder.
- Writes are atomic (temp file + rename). Deletes move to `.trash/`.
- Empty chats are never written, so "New chat" leaves no clutter.

## Scene safety rules (`src/services/sceneSession.ts`)

Blender has one file open at a time, so switching projects means saving one
`.blend` and opening another. The rules:

1. **Never overwrite a project with the wrong scene.** A project's scene is saved
   only when Blender's open file *is* that project's `scene.blend` (checked with
   the addon's `get_file_info`).
2. **Never discard unsaved work.** If Blender has unsaved changes in another file,
   the app stops and asks ("Discard changes & open project") instead of opening.
3. **Never build into the wrong scene.** Build / Plan / bucket builds are blocked
   while the project's scene isn't open; the banner above the composer explains
   why and offers to open it.
4. **Nothing opens on startup.** The last session's project is restored in the
   sidebar, but its scene is opened only when you ask.
5. The scene is saved automatically after every change the AI makes, when
   switching away, and with the header's **Save scene** button.

## Addon commands added

- `get_file_info` → `{filepath, is_dirty, object_count}`
- `new_file` → empty scene (`read_homefile(use_empty=True)`; *not* factory
  startup, which would disable this addon), optionally saved to `filepath`.

The installed addon must be updated to use projects; the app detects an older
addon and says so.

## Not done yet

- Per-project undo checkpoints (`save_checkpoint` exists in the addon; wire it to
  each Build turn and add an Undo action).
- Scene thumbnails in the sidebar.
- Markdown rendering in chat messages (they're shown as plain text today).
- Projects require Blender on the same machine as the app (Blender reads/writes
  the project folder directly).
