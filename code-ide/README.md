# Code IDE

A Monaco-powered code editor that runs entirely in the browser, with a
**Cursor-style on-device AI assistant** that also runs entirely in the
browser. No backend, no API key, no cloud LLM, no telemetry.

[joeheyming.github.io/code-ide/](https://joeheyming.github.io/code-ide/)

## Features

### Editor

- Monaco editor (the engine behind VS Code)
- Multi-file project tree, tabbed editing, dirty-state tracking
- Light / dark / high-contrast themes
- Vim keybindings (toggle on/off)
- Prettier format-on-save (JS, TS, JSON, CSS, HTML, Markdown)
- Sandboxed JS runner with captured console output
- Side-by-side diff between any two open files
- File System Access API for opening real folders from disk
- Saves to the HeymingOS virtual filesystem when embedded

### Source control

- Git status, stage / unstage / discard, commit
- Branch picker with create / checkout / delete
- Pull, push, sync (HeymingOS-embedded only — git lives in the
  terminal app's filesystem)
- VS Code-style "working vs HEAD" diff in the main editor area

### ✨ AI assistant (new)

The AI panel and `Cmd+K` inline edit run **on the user's GPU** via
WebGPU + [WebLLM](https://webllm.mlc.ai/), using
[Hermes-3-Llama-3.1-8B](https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B)
quantized to q4f16_1. The first time the user installs the model it
downloads ~4.5 GB into the browser's OPFS cache; after that it's
instant and offline.

- **Cmd+K (Ctrl+K) — inline edit.** Select code, press the shortcut,
  type "extract this into a function" / "add error handling" / "rename
  to camelCase", and the model proposes an edit. The IDE renders the
  proposed change as a side-by-side Monaco diff with **Apply / Reject**
  buttons. Nothing writes to disk until you click Apply.
- **Assistant side panel.** Multi-turn chat about your code. The
  assistant sees the active file (path + content + your selection)
  automatically, so you can ask "what does this do?" or "where would
  you add a null check here?" without having to copy-paste.
- **Mandatory diff preview.** Every write goes through a dry-run step
  (`applyEdit` for changes to existing files, `createFile` for new
  files). The model proposes; the IDE shows you the diff (current vs
  proposed, or empty vs proposed for a new file); only an explicit
  click writes anything. The model **cannot** silently modify or
  create files.
- **Same engine as `/chat/`.** Code IDE and the standalone chat share
  the OPFS model cache — install once, use everywhere on this site.

#### Architecture

```
code-ide/
├── ai-engine.js     — lazy WebLLM bootstrap; runChatTurn delegate
├── ai-context.js    — toolCtx + fs shim + active-file snapshot
├── ai-panel.js      — Assistant tab UI (multi-turn chat)
├── ai-cmdk.js       — Cmd+K floating prompt (single-turn edits)
├── ai-diff.js       — Apply/Reject overlay on showMainDiff
└── style-ai.css     — panel + Cmd+K + diff bar styling
```

The chat-side modules (`/chat/chat-client.js`, `/chat/webllm-adapter.js`,
`/chat/tools.js`, `/chat/system-prompt.js`) are reused as-is. The IDE
supplies its own:

- `toolCtx` — wraps the IDE's filesystem adapter as the
  `FileSystemDB`-shaped object the chat tools expect.
- `host: 'code-ide'` — switches `system-prompt.js` to a
  coding-focused prompt with the active file injected.
- `activeFile()` — feeds the system prompt the path / language /
  content / Monaco selection on every turn.

#### Privacy

The AI lives entirely in the browser tab. Conversations are not
persisted (the IDE chat resets when the tab closes); model weights
sit in OPFS on the user's machine; no requests go to any first-party
server (there isn't one — Code IDE is GitHub Pages static hosting).

The model artifact itself is fetched once from
`huggingface.co/mlc-ai/Hermes-3-Llama-3.1-8B-q4f16_1-MLC` via WebLLM.
That fetch is the only network round-trip the AI feature makes after
boot.

## Keyboard shortcuts

| Shortcut                         | Action                       |
|----------------------------------|------------------------------|
| `Ctrl/Cmd + S`                   | Save                         |
| `Ctrl/Cmd + Shift + S`           | Save As                      |
| `Ctrl/Cmd + N`                   | New file (untitled tab)      |
| `Ctrl/Cmd + P`                   | Quick open file              |
| `Ctrl/Cmd + K`                   | ✨ AI: edit selection / file |
| `F1`                             | Monaco command palette       |
| `Shift + Alt + F`                | Format current file          |
| `F5`                             | Run JS                       |
| `Ctrl/Cmd + F` / `Ctrl/Cmd + H`  | Find / Replace               |

## Modes

- **Embedded inside [HeymingOS](https://joeheyming.github.io/os/)**:
  saves to the in-browser virtual filesystem; git is fully wired;
  files opened from the desktop appear in tabs.
- **Standalone** (`/code-ide/` directly): uses the File System Access
  API to read/write a real folder you pick. The AI assistant works in
  both modes — Cmd+K writes through the same `fs.writeFile` either way.

## Limitations

- The AI feature requires WebGPU. Chrome/Edge ≥ 113, Firefox ≥ 141,
  Safari ≥ 18. On Windows laptops with hybrid graphics you may need to
  set the browser to "high performance" in Windows graphics settings
  to get the dGPU instead of the iGPU.
- The first model download is large (~4.5 GB). After that it's cached
  in OPFS for the origin.
- The model has an effective context window of ~3,400 tokens after
  reserving room for the reply. Very large files (>~12 KB of source)
  get truncated when fed to the model; the IDE-side diff still shows
  the full proposed file via local edit replay.
- AI proposals can be wrong. Read the diff before clicking Apply.
