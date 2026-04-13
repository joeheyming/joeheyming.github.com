/**
 * Type declarations for the desktop OS layer (os/ directory).
 *
 * NOTE: FileSystemDB is NOT declared here because it is defined in
 * os/filesystem-db.js which TypeScript checks directly. These are
 * supplementary interfaces used by both os/ and terminal/ layers.
 */

// ---------------------------------------------------------------------------
// FileSystemDB entry shape (used by many files)
// ---------------------------------------------------------------------------

interface FileSystemEntry {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  content?: string | Uint8Array;
  target?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  size?: number;
  atime?: number;
  mtime?: number;
  ctime?: number;
  [key: string]: unknown;
}

interface FileSystemEventDetails {
  event: string;
  [key: string]: unknown;
}
