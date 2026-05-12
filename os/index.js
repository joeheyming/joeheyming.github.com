/**
 * Heyming OS - ES Module Entry Point
 *
 * This is the main entry point for the OS. It imports all modules
 * and exports the assembled HeymingOS instance.
 *
 * Usage in HTML:
 *   <script type="module" src="os/index.js"></script>
 */

// Core utilities (no dependencies)
import {
  Config,
  debug,
  getConfig,
  isFirstRun,
  saveUsername,
  getSavedUsername,
  saveHostname,
  getSavedHostname
} from './config.js';
import { Constants, MessageTypes, IframeActions } from './constants.js';
import { Icons } from './Icons.js';
import { InputHandler } from './InputHandler.js';
import { DragService } from './DragService.js';
import { ClipboardService } from './ClipboardService.js';
import { FileOperationService } from './FileOperationService.js';
import { QuickLookPreview } from './QuickLookPreview.js';
import { FileSystemDB } from './filesystem-db.js';

// UI Components (depend on utilities)
import { WindowManager } from './WindowManager.js';
import { Taskbar } from './Taskbar.js';
import { NotificationService } from './NotificationService.js';
import { Launcher } from './Launcher.js';
import { Desktop } from './Desktop.js';
import { Clock } from './Clock.js';
import { ContextMenu } from './ContextMenu.js';
import { FileDialog } from './FileDialog.js';

// Main orchestrator
import { HeymingOS } from './HeymingOS.js';

// Assemble the HeymingOS namespace
const OS = {
  Config,
  Constants,
  MessageTypes,
  IframeActions,
  Icons,
  InputHandler,
  DragService,
  ClipboardService,
  FileOperationService,
  QuickLookPreview,
  FileSystemDB,
  WindowManager,
  Taskbar,
  NotificationService,
  Launcher,
  Desktop,
  Clock,
  ContextMenu,
  FileDialog,
  HeymingOS,

  // Utilities
  debug,
  getConfig
};

// Expose on window for:
// 1. Iframe access (apps access window.parent.HeymingOS)
// 2. Console debugging
// 3. Legacy compatibility
window.HeymingOS = /** @type {HeymingOSNamespace} */ (OS);
window.FileSystemDB = FileSystemDB;

// Create and expose the singleton instance
const instance = new HeymingOS();
window.heymingOS = instance;
OS.instance = instance;

// Export for ES module consumers
export {
  Config,
  Constants,
  MessageTypes,
  IframeActions,
  Icons,
  InputHandler,
  DragService,
  ClipboardService,
  FileOperationService,
  QuickLookPreview,
  FileSystemDB,
  WindowManager,
  Taskbar,
  NotificationService,
  Launcher,
  Desktop,
  Clock,
  ContextMenu,
  FileDialog,
  HeymingOS,
  debug,
  getConfig,
  instance
};

export default OS;
