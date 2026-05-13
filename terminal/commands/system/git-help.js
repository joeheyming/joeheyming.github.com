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
    fails for github.com from the browser). For a persistent change that survives
    page reload, use:  git config --jsh cors-proxy https://my-proxy.example.com

  • curl-style proxy.js is only used for non-corsProxy URLs (raw GETs).

  • Huge packs: default max download size is 256 MiB per fetch (abs max 512 MiB).
    Override per tab via window.JSH_GIT_MAX_PACK_BYTES = 384000000, or persist with:
        git config --jsh max-pack-mib 384

  • IndexedDB vs OOM: Application → Storage shows on-disk usage (e.g. 100+ MiB for packs).
    "Aw, Snap" is the tab's JavaScript heap while parsing or checkout — not the same limit.
    For big repos try: git clone --depth 1 --no-checkout <url> then git checkout <branch>
    later; rm -rf old clone dirs to shrink IndexedDB.

Commands:
  init [path]              Create a repository (default: current directory)
  clone [--full] [--depth N] [--no-checkout|--force-checkout] [--all-branches] <url> [path]
                           Default: shallow (--depth 1). The checkout phase uses a
                           streaming algorithm (single tree walk + sequential per-blob
                           writes) so 10k-file trees materialize in ~30-90 s with
                           bounded heap. Trees with > 30000 files still auto-skip
                           checkout as a final safety net — the .git is fully written
                           and the command prints a follow-up 'git checkout <branch>'.
                           --no-checkout      Only write .git, no working tree.
                           --force-checkout   Override the auto-OOM safety on huge repos.
                           --full             Full history (heavier; may crash on big repos).
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
  config --jsh [...]       Inspect / persist jsh-git advanced settings
                           (cors-proxy, max-pack-mib). Run 'git config --jsh --help'.

See also: curl (HTTP), proxy-stats (proxy health).`;

export const GIT_CONFIG_JSH_HELP = `Usage: git config --jsh [<key> [<value> | --unset]]

Persist jsh-only git defaults in localStorage (per browser origin). These keys
are NOT understood by upstream git; they only affect the in-browser jsh client.
Tokens (git login) are deliberately session-only and are not managed here.

Settings:
  cors-proxy      Base URL of the CORS proxy used for clone/fetch/pull/push.
                  Pass 'off' (or '0' / 'false') to skip the proxy and hit remotes
                  directly — usually fails for github.com from the browser.
                  Default: https://cors.isomorphic-git.org
  max-pack-mib    Max pack size accepted from upload-pack, in MiB. Range 8..512.
                  Raise this if a clone fails with "upload-pack response too
                  large". Default: 256.
  checkout-batch  Legacy: files written per batch under the old batched checkout
                  path. Now retained only for tooling compatibility — the default
                  checkout uses a streaming walker that doesn't batch. Default: 25.

Examples:
  git config --jsh                           # show effective settings + source
  git config --jsh max-pack-mib              # show one setting
  git config --jsh max-pack-mib 384          # persist a higher cap
  git config --jsh max-pack-mib --unset      # back to default
  git config --jsh cors-proxy https://my-proxy.example.com
  git config --jsh cors-proxy off            # disable proxy
  git config --jsh checkout-batch 10         # smaller batches (less RAM, slower)

Precedence (highest first):
  1. env var JSH_GIT_*       (per shell session)
  2. window.JSH_GIT_*        (per browser tab)
  3. localStorage value      (set here; survives reload)
  4. built-in default
`;
