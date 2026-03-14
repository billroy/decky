/**
 * Filesystem compatibility helpers for cross-platform support.
 */
import { renameSync, unlinkSync } from "node:fs";

/**
 * Rename a file, handling the Windows EPERM case where renameSync throws
 * if the destination already exists (unlike POSIX where it atomically replaces).
 *
 * On macOS/Linux this is just renameSync. On Windows it falls back to
 * unlink-then-rename when EPERM is encountered.
 */
export function portableRenameSync(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") {
      // Non-atomic: dest is briefly absent between unlink and rename.
      // Acceptable for gate files (polled) and config (rare writes).
      unlinkSync(dest);
      renameSync(src, dest);
    } else {
      throw err;
    }
  }
}
