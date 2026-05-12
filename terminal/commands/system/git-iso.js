const ISO_GIT_URL = 'https://esm.sh/isomorphic-git@1.25.10?bundle';

let isoGitLoadPromise = null;

export async function loadIsoGit() {
  if (window.__jshIsoGit) {
    return window.__jshIsoGit;
  }
  if (!isoGitLoadPromise) {
    isoGitLoadPromise = import(ISO_GIT_URL).then((m) => {
      window.__jshIsoGit = m;
      return m;
    });
  }
  return isoGitLoadPromise;
}
