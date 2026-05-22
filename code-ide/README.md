# Code IDE

A Monaco-powered code editor that runs entirely in the browser. No
backend, no API key, no telemetry.

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

## Keyboard shortcuts

| Shortcut                        | Action                  |
| ------------------------------- | ----------------------- |
| `Ctrl/Cmd + S`                  | Save                    |
| `Ctrl/Cmd + Shift + S`          | Save As                 |
| `Ctrl/Cmd + N`                  | New file (untitled tab) |
| `Ctrl/Cmd + P`                  | Quick open file         |
| `F1`                            | Monaco command palette  |
| `Shift + Alt + F`               | Format current file     |
| `F5`                            | Run JS                  |
| `Ctrl/Cmd + F` / `Ctrl/Cmd + H` | Find / Replace          |

## Modes

- **Embedded inside [HeymingOS](https://joeheyming.github.io/os/)**:
  saves to the in-browser virtual filesystem; git is fully wired;
  files opened from the desktop appear in tabs.
- **Standalone** (`/code-ide/` directly): uses the File System Access
  API to read/write a real folder you pick.
