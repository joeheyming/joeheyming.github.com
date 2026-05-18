# jsh — what we claim vs bash / coreutils

**jsh** is the shell built into HeymingOS, a browser-resident OS simulation.
It is **not** bash, **not** dash, **not** BusyBox. It is a JS-hosted reimplementation
that runs entirely inside a single browser tab against the shared
[`FileSystemDB`](../os/README.md) VFS.

This document is organised into three sections so you always know which
column you're reading:

1. **What jsh does** — capabilities the runtime actually implements.
2. **What jsh promises about bash compatibility** — per-feature compatibility
   claims, with the deltas called out.
3. **What jsh cannot do in a browser, ever** — physics-imposed limits that
   no amount of code can remove.

For the working backlog and shipped notes, see
[`../unix-fidelity-plan.md`](../unix-fidelity-plan.md). For the deepening
roadmap that drove the current state, see the plan file referenced from chat.

---

## 1. What jsh does (capability matrix)

### 1.1 Shell language

| Capability | Status | Notes |
|---|---|---|
| Lists (`&&`, `\|\|`, `;`) | ✅ | Left-associative short-circuit. `$?` reflects the last executed pipeline. |
| Pipes (`\|`) | ✅ | Text streams between stages. |
| Redirects (`>`, `>>`, `<`, `2>`) | ✅ | Empty targets rejected. |
| Stderr merge `2>&1` | ⚠️ | Merges streams for the command; not full POSIX fd-dup semantics. |
| Heredocs (`<<TAG`, `<<-TAG`) | ✅ | Variable expansion inside non-quoted tags. |
| Brace expansion (`{a,b,c}`, `{1..5}`) | ✅ | Pure token rewrite before glob expansion. |
| Glob expansion (`*`, `?`, `[abc]`) | ✅ | Matches against the VFS; literal pass-through when no match (default `nullglob` off). |
| Parameter expansion `${VAR:-d}`, `${VAR:=d}`, `${VAR:+a}`, `${VAR%pat}`, `${VAR%%pat}`, `${VAR#pat}`, `${VAR##pat}`, `${#VAR}` | ✅ | Centralised in `ShellUtils.expandParam`. |
| Command substitution `$(…)` and backticks | ✅ | Inner pipeline runs via the same runner; trailing newlines trimmed. |
| Subshells `( … )` | ✅ | Forked `ProcessContext` (env, cwd, `$?`); mutations don't escape. |
| Background `&`, `jobs`, `fg %n`, `bg`, `disown` | ✅ | Cooperative — backed by the simulated `ProcessManager`. |
| Shell options: `set -e`, `set -u`, `set -o pipefail`, `set -x` | ✅ | Tracked on the `Terminal` instance. |
| Shell functions, positional params `$1..$@..$#` | ✅ | Stored on `Terminal.functions`. |
| Aliases | ✅ | Including alias-of-pipeline. |

### 1.2 Coreutils (highlights)

| Command | Status |
|---|---|
| `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `tr`, `cut`, `tee`, `seq`, `sleep`, `true`, `false`, `:` | ✅ |
| `grep` with `-E`, `-F`, `-w`, `-r`, `-l`, `-L`, `--color` | ✅ |
| `sed` with regex addresses, `s///gNi`, `y///`, `d`, `p`, `=`, `q`, `n`, `N`, `-i[SUFFIX]`, `-E`/`-r` | ✅ |
| `awk` — `BEGIN`/`END`, `/pat/ {…}`, `if`/`for`, arrays, `printf`, `getline` from FILE, `OFS`/`ORS`/`FS` | ✅ (subset) |
| `cp`, `mv` (multi-source into a directory) | ✅ |
| `find` — `-name`, `-iname`, `-type`, `-size`, `-mtime`, `-maxdepth`, `-mindepth`, `-empty`, `-path`, `-print`, `-print0`, `-delete`, `-exec`/`-execdir`, `-a`/`-o`/`!`/`()` | ✅ |
| `xargs` — `-I`, `-n`, `-0`, `-d DELIM` | ✅ (`-P` is documented stub) |
| `stat -c` / `--printf` mini-language (`%n %s %y %F %a %u %g %i …`) | ✅ |
| `tar` (USTAR), `gzip`, `gunzip` (via `pako`) | ✅ |
| `du`, `df` (uses `navigator.storage.estimate()`), `free` (uses `performance.memory` where available) | ✅ |
| `/proc/<pid>/{status,cmdline,environ}` and `/proc/self` | ✅ (virtual overlay on `FileSystemDB`) |
| `useradd`, `userdel`, `usermod`, `groupadd`, `groupdel`, `passwd`, `id`, `groups`, `su`, `sudo` | ✅ |
| `logger`, `dmesg`, `systemctl`, `journalctl` | ✅ |
| `curl`, `nc` (HTTP-shaped), `wget`, `ping` (HTTP HEAD) | ✅ |

### 1.3 OS simulation

| Capability | Status |
|---|---|
| Parent/child PIDs and `pstree` | ✅ |
| `kill` tree-walk for the shell PID's children | ✅ |
| Job control wired into `ProcessManager` (`%1`, etc.) | ✅ |
| Feature-flagged POSIX permission enforcement on the VFS (`mode`, `uid`, `gid`) | ✅ |
| `SecurityManager` reads users/groups from `/etc/passwd`, `/etc/group`, `/etc/shadow` on boot | ✅ |
| `/etc`, `/var/log` seeded at first boot via `os/filesystem-db-scaffold.js` | ✅ |
| Cooperative scheduler tick → believable `top` `%CPU` (scaled by `requestIdleCallback`-derived main-thread busy ratio) | ✅ |
| HTTP-only socket simulation in `NetworkManager` (`socket`/`connect`/`send`/`recv`) | ✅ |
| `FileSystemDB` schema v2 migration (backfills `mode`/`uid`/`gid` on legacy rows) | ✅ |

---

## 2. What jsh promises about bash compatibility

Each row says **what bash users can rely on**, and the **exact delta** where we
differ. If a feature is not listed here, treat the bash behaviour as
*aspirational only*.

| Feature | Promise | Known delta |
|---|---|---|
| `&&` / `\|\|` / `;` | Left-to-right, short-circuit, `$?` from last executed pipeline. | None significant. |
| Pipes | Stage stdout → next stage stdin; `pipefail` opt-in. | No SIGPIPE; closed stdin surfaces as empty read, not a signal. |
| Redirects | `>`, `>>`, `<`, `2>` work over the VFS. | `2>&1 > file` does **not** match bash's ordering for where stderr ends up. We merge streams at the command boundary. |
| Heredocs | `<<TAG` and `<<-TAG` with variable expansion (when tag is unquoted). | Quoted-tag suppression of expansion **is** supported. No process-substitution heredocs. |
| Brace / glob / param expansion | Order is: brace → param/cmdsubst → glob, like bash. | No `~user` (only bare `~` and `~/`). |
| Command substitution | `$(…)` and backticks; nesting allowed; inner `$?` does not leak. | Subshell semantics — env mutations inside `$(…)` do not escape. |
| Subshells | `( cmds )` clones env/cwd/`$?` and discards changes after. | Backed by an in-memory `ProcessContext`, not a real fork. |
| Background jobs | `&`, `jobs`, `fg %n`, `bg`, `disown`, `wait`, `kill %n`. | Cooperative scheduling; "stop" is `AbortSignal` cancellation, **not** SIGSTOP. |
| `set -e` / `-u` / `-o pipefail` / `-x` | Honoured by the runner. | `errexit` opts inside functions and conditionals follow bash 5.x. |
| Shell functions | Positional params `$1..$@..$#`, `return N`, `local` (in jsh `local` is no-op-safe but scopes via context clone). | No `declare -f`/`-p`. |
| Exit codes | `$?`, `0–255`, syntax errors exit `2`, "command not found" exits `127`, "not executable" exits `126`, signals (Ctrl+C) exit `130`. | Signal exit codes are synthetic since we have no real signals. |
| `grep`/`sed`/`awk`/`find`/`xargs` | The flags listed in §1.2 behave like GNU. | `awk` does not support user-defined functions or multi-dim associative arrays beyond the SUBSEP trick. `find -printf` is not implemented. |
| `tar`/`gzip` | USTAR archives interoperate with GNU `tar` for files/dirs (pax extended headers not written). | Sparse files, hardlinks, ACLs, xattrs are not preserved. |
| Users / permissions | `useradd`/`passwd`/`su`/`sudo` persist to `/etc/passwd`-shaped rows. With `enforceFsPermissions` on, `mode` / `uid` / `gid` are honoured on `getItem`/`createFile`/`unlink`. | This is **simulation, not a privilege boundary**. A malicious page in the same origin can bypass it. |
| `systemctl`/`journalctl` | Manages `HeymingOS.services` (`start`/`stop`/`restart`/`status`/`is-active`), reads `/var/log/messages` and per-unit logs. | Units are JS modules with `{start, stop, status}`; no socket/timer/path units. |
| `top` `%CPU` | Sliding-window CPU sample × `mainThreadBusyRatio`; clamped 0–100. | Numbers attribute *main-thread* time per simulated PID. Workers' CPU is not visible. |

---

## 3. What jsh cannot do in a browser, ever

These are not roadmap items. They are constraints of the browser sandbox.
We document them so users stop hoping for them.

- **Real processes, fds, signals.** Everything in `ProcessManager` is a
  cooperative simulation. There is no `fork(2)`, no `SIGSTOP`/`SIGCONT`, no
  process group whose membership the kernel can enforce.
- **Raw TCP/UDP/ICMP sockets.** The `socket`/`connect`/`send`/`recv`
  syscalls in `NetworkManager` route to `fetch()` (optionally via the
  project's CORS proxy). `nc host port` is therefore HTTP-shaped only.
  `listen()` throws `EOPNOTSUPP` because a tab cannot accept inbound
  connections. `ping` is an HTTP HEAD, not ICMP.
- **A real TTY.** `vi` and `less` cannot get raw-mode keystrokes, `SIGWINCH`,
  or a separate stderr device. Terminal control codes that depend on a real
  TTY (e.g. mouse reporting, bracketed paste from the host PTY layer) do
  not work.
- **A privilege boundary.** `sudo`, `chmod`, `chown`, and group membership
  are simulations on top of a JS object. They are useful for **teaching**
  Unix permissions and for **app-level** consistency, but they do not protect
  data from any code running in the same origin.
- **Multi-tab IPC pretending to be SysV.** `IPCManager` is in-tab only.
  Cross-tab IPC would need `BroadcastChannel` or `SharedWorker`, and would
  still not be SysV semantics.
- **Persistent inodes across origins.** Storage is per-origin IndexedDB.
  Clearing site data wipes the VFS.
- **`mmap`, `ptrace`, `cgroups`, `eBPF`, `epoll`, FUSE.** None of these
  primitives exist in the browser sandbox.
- **Real concurrent processes from `xargs -P`.** Web Workers can run code
  in parallel, but `xargs -P N` is currently a documented stub that runs
  serially.
- **bash itself.** Bringing bash/dash/BusyBox to WASM is explicitly out of
  scope.

---

## 4. When in doubt

1. Run `command --help` first. The shipped help text is the canonical
   contract for each builtin's flags.
2. If you need ground truth, compare against macOS/Linux — but only for
   the flags this document or `--help` claims to support.
3. Open an issue (or extend `unix-fidelity-plan.md`) before assuming a gap
   is a bug.

## 5. Troubleshooting

### "The terminal won't boot / I see weird errors after an update"

jsh persists everything (VFS rows, users, history, env) in your browser's
**IndexedDB** and **localStorage** for `joeheyming.github.io` (or whatever
origin you're using).

The roadmap that produced jsh's current shape bumped the `FileSystemDB`
schema to v2 and added a one-shot migration that backfills `mode`/`uid`/`gid`
on legacy rows. The migration is **idempotent** and **non-destructive**, but
if your DB was created by an older snapshot that predates either the
migration or the `/etc/passwd` seeding, you can occasionally see boot errors
where `SecurityManager` is unable to load the user table from a stale
`/etc/passwd` row, or where the `/proc` overlay collides with a pre-existing
`/proc` directory.

If that happens, the safest fix is to clear site data for this origin:

- **Chrome/Edge:** DevTools → Application → Storage → "Clear site data"
- **Firefox:** DevTools → Storage → right-click the origin → "Delete All"
- **Safari:** Develop → Empty Caches, then Settings → Privacy → Manage
  Website Data → remove this origin

Your VFS contents (created files, custom users, etc.) will be re-seeded
from the defaults on next load. Nothing on the server is affected; the VFS
only ever existed in your browser.
