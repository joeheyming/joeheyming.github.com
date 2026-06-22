# Heyming Terminal

A browser-based shell emulator ("jsh") with a simulated OS kernel, process management, and 80+ commands. Built with vanilla JavaScript — no build step, no frameworks.

Live at [joeheyming.github.io/terminal/](https://joeheyming.github.io/terminal/)

## jsh vs bash / coreutils

jsh is **not** bash. For a short, user-facing statement of what the shell **claims** versus common **bash** and **GNU coreutils** behavior (and honest gaps), see **[`JSH-SPEC.md`](JSH-SPEC.md)**. The living gap list lives in [`../unix-fidelity-plan.md`](../unix-fidelity-plan.md).

## Architecture

```
HeymingOS (boot)
└── HeymingKernel (syscall dispatch)
    ├── FileSystemManager   — VFS layer (stat, readdir, open, write)
    ├── ProcessManager      — process model, PIDs, worker isolation
    ├── MemoryManager       — memory subsystem
    ├── IPCManager          — inter-process communication
    ├── DeviceManager       — devices + NetworkManager
    └── SchedulerManager    — scheduling

Terminal (UX + shell)
├── Input parsing     — tokenization, pipes (|), redirections (>, >>, <, 2>)
├── Command execution — aliases, history (!!, !n), heredocs, tab completion
├── Signal handling   — Ctrl+C, Ctrl+D, Ctrl+L
└── CommandRegistry   — lazy-loaded command scripts via dynamic <script> injection

FileSystemDB (shared)
└── IndexedDB virtual filesystem (singleton on window.top, shared with OS)
```

### How commands work

1. `commands.js` defines `commandMap` — a mapping of command names to script paths
2. When a command is first used, `CommandRegistry.get(name)` dynamically injects a `<script>` tag to load it
3. Each command file is an IIFE that calls `registerCommand(name, handler, description, category)`
4. The handler receives `(terminal, args)` and returns output as a string
5. Pipes chain stdout of one command as stdin to the next

### Shell features

- **Pipes**: `ls | grep foo | wc -l`
- **Redirections**: `echo hello > file.txt`, `cat < input.txt`, `cmd 2> errors.txt`
- **Heredocs**: `cat <<EOF ... EOF`
- **Aliases**: `alias ll='ls -la'`
- **History**: arrow keys, `!!` (last command), `!n` (nth command)
- **Tab completion**: commands and file paths
- **Environment variables**: `export`, `unset`, `$VAR` expansion

## Directory structure

```
terminal/
├── index.html              — page shell, script loading order, boot sequence
├── terminal.js             — Terminal class (input, parsing, execution, UI)
├── commands.js             — CommandRegistry, commandMap, lazy loading
├── lib/
│   └── shell-utils.js      — shared exit / $VAR / $? helpers (browser + Node tests)
├── test/
│   ├── shell-utils.test.js       — jsh helpers (`npm test`)
│   └── filesystem-db-static.test.js — FileSystemDB UTF-8 / getContentForApp (Node + fake `window`)
├── style.css               — terminal layout and styling
├── core/
│   ├── heyming-os.js       — boot orchestration, terminal lifecycle
│   ├── kernel.js           — HeymingKernel: syscall table, subsystem init
│   ├── filesystem-manager.js
│   ├── process-manager.js
│   ├── process-worker.js   — Web Worker for isolated execution
│   ├── memory-manager.js
│   ├── ipc-manager.js
│   ├── device-manager.js
│   ├── scheduler-manager.js
│   └── security-manager.js
├── commands/
│   ├── filesystem/         — ls, cd, pwd, cat, echo, mkdir, touch, rm, cp, mv,
│   │                         grep, find, head, tail, wc, sort, uniq, df, hexdump
│   ├── system/             — alias, unalias, export, unset, env, whoami, hostname,
│   │                         date, uptime, uname, history, clear, reset, exit,
│   │                         version, which, type, ps, top, kill, ping, curl,
│   │                         cmdcount, debug, neofetch, osinfo, fsck, clearfs,
│   │                         genbin, proxy-stats, vi, less, node, spawn, launch,
│   │                         open, heyming-desktop
│   ├── fun/                — npm, sudo, hack, matrix, sl, cowsay, fortune, rick,
│   │                         coffee, pizza, joke
│   └── speech/             — say, hollywood
└── terminal-preview.png    — OG image for social sharing
```

## Adding a command

1. Create a file in `commands/<category>/` (e.g. `commands/fun/mycommand.js`)
2. Use the standard registration pattern:

```javascript
(function () {
  'use strict';
  registerCommand(
    'mycommand',
    (terminal, args) => {
      return 'Hello from mycommand!';
    },
    'Short description for help text',
    'Fun'
  );
})();
```

3. Add an entry to `commandMap` in `commands.js`:

```javascript
mycommand: { path: 'commands/fun/mycommand.js', category: 'Fun' }
```

## Testing

From this directory:

```bash
npm test
```

Runs Node’s built-in test runner on pure shell helpers in [`lib/shell-utils.js`](lib/shell-utils.js). Extend `test/` when you add more testable, non-DOM logic.

## Dependencies

No npm packages. All dependencies are loaded via CDN or from the parent site:

- **Tailwind CSS 2.2.19** — utility classes (CDN)
- **../os/filesystem-db.js** — shared IndexedDB virtual filesystem
- **analytics.js, feedback.js, share.js, nav.js, proxy.js** — site-wide utilities
