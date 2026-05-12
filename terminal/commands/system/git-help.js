export const GIT_HELP = `Usage: git [--help] [-h] <command> [<args>]

jsh git uses isomorphic-git in your browser with the same virtual filesystem as
ls/touch (IndexedDB). Network / CORS:

  • clone, fetch, pull, and push default to corsProxy https://cors.isomorphic-git.org
    (the @isomorphic-git/cors-proxy service). It forwards git smart HTTP (GET
    info/refs, POST git-upload-pack / git-receive-pack) with CORS. Public clone/fetch
    work without login. push needs a GitHub PAT (see below); tokens in the browser
    are visible on this machine — use a fine-scoped PAT.

  • Set JSH_GIT_CORS_PROXY (env or window.JSH_GIT_CORS_PROXY) to your own proxy
    base URL, or to 0 / false / off to disable and hit remotes directly (usually
    fails for github.com from the browser).

  • curl-style proxy.js is only used for non-corsProxy URLs (raw GETs).

  • Huge packs: default max download size is 128 MiB per fetch. Override with
    window.JSH_GIT_MAX_PACK_BYTES = 200000000 (example); very large values can
    crash the tab (Aw, Snap).

  • IndexedDB vs OOM: Application → Storage shows on-disk usage (e.g. 100+ MiB for packs).
    "Aw, Snap" is the tab’s JavaScript heap while parsing or checkout — not the same limit.
    For big repos try: git clone --depth 1 --no-checkout <url> then git checkout <branch>
    later; rm -rf old clone dirs to shrink IndexedDB.

Commands:
  init [path]              Create a repository (default: current directory)
  clone [--full] [--depth N] [--no-checkout] [--all-branches] <url> [path]
                           Default: shallow (--depth 1). --no-checkout: only .git (no files);
                           run git checkout <branch> after (lowers peak RAM during clone).
                           --full = full history (may crash on big projects).
  status                   Working tree status
  log [--oneline]          Recent commits
  branch                   List branches
  checkout <ref>           Checkout branch or commit
  add [-A] [file...]       Stage files (use "." or -A for all)
  commit -m <msg>          Create a commit
  pull [remote] [branch]   Fetch and merge (same network limits as clone)
  fetch [remote]           Fetch refs only
  push [-f|--force] [remote] [branch]
                           Upload commits (run git login first, or set GITHUB_TOKEN / GIT_TOKEN).
  login <token>            Store a GitHub PAT for this session (then git push works).
                           Create one at: https://github.com/settings/personal-access-tokens/new
                           (fine-grained: pick this repo, Contents + Metadata read/write) or classic:
                           https://github.com/settings/tokens (repo scope).
  logout                   Clear stored PAT from this tab.

See also: curl (HTTP), proxy-stats (proxy health).`;
