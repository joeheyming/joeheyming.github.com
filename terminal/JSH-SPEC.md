# jsh — what we claim vs bash / coreutils

**jsh** is the Heyming Terminal shell: a browser emulator, not POSIX bash. This page states **what users can rely on** and **where we diverge** from common GNU/bash expectations.

For the live backlog and shipped notes, see [`../unix-fidelity-plan.md`](../unix-fidelity-plan.md).

---

## Shared virtual filesystem

- Paths are Unix-style (`/`, `.`, `..`); resolution uses the same **`FileSystemDB`** keys as the desktop, file manager, and apps (see [`../os/README.md`](../os/README.md)).
- Symlinks exist in the VFS; jsh path resolution does **not** walk symlinks the way GNU `realpath -s` might — behavior is documented in-code where it matters.

---

## Shell language (vs bash)

| Area | jsh behavior | Typical bash gap |
|------|----------------|-------------------|
| **Lists** | `&&`, <code>&#124;&#124;</code>, `;` with left-associative short-circuit; `$?` reflects the last **executed** pipeline in the list | No `&` background jobs, no subshells `( )` |
| **Pipes** | <code>&#124;</code> chains commands; stdin/stdout between stages | Same rough model; not full POSIX fd plumbing |
| **Redirects** | `>`, `>>`, `<`, `2>`; empty targets rejected | **`2>&1`** merges stderr into the stdout **stream** for that command — not full fd dup semantics; e.g. `2>&1 > file` does **not** match bash’s ordering for where stderr ends up |
| **Quoting** | Common quoting for words and many contexts | Not full bash quoting / expansion |
| **Expansion** | `$VAR`, `$?`, positional params where implemented | No globs, no `$(...)`, limited `${...}` |
| **Syntax errors** | Many list/parse failures exit **`2`** | Align where we document it |

---

## Commands (vs GNU coreutils / POSIX utilities)

- Individual tools aim for **credible** stdout/stderr and **exit codes** on failure; many are **subsets** of GNU (flags, operands). Prefer **`command --help`** in jsh over assuming full GNU parity.
- **Pipelines** pass **text**; binary-heavy paths use shared FS helpers (`contentBytes` / display helpers) — see [`README.md`](README.md) and the plan file.
- **Process-related** commands (`ps`, `kill`, `top`, `spawn`) use a **simulated** process table — not the host OS. **`kill --help`** / **`ps --help`** describe limits.

---

## Signals and I/O

- **Ctrl+C** aborts the current line via an internal **`AbortSignal`** merged into supported network paths (`curl`, `git`, `ping`, proxy); exit **`130`** when the handler surfaces interrupt — not a POSIX signal to arbitrary “processes.”
- **Interactive** tools (`vi`, `less`) cannot provide a real TTY (raw mode, `SIGWINCH`, separate stderr stream like vim’s). Limitations are called out in the fidelity plan.

---

## When in doubt

1. Run the same command in jsh and, if you need ground truth, on macOS/Linux — **compare** stdout, stderr shape, and exit status **for that command** only when we claim compatibility.
2. Prefer **documented** limitations over silent wrong behavior; gaps belong in [`../unix-fidelity-plan.md`](../unix-fidelity-plan.md).
