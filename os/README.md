# Heyming OS

A browser-based desktop environment built with vanilla JavaScript. Features a taskbar, app launcher, overlapping draggable/resizable windows, and a persistent virtual filesystem backed by IndexedDB.

Live at [joeheyming.github.io/os/](https://joeheyming.github.io/os/)

## Architecture

```
HeymingOS (orchestrator)
├── WindowManager     — window lifecycle, drag/resize, z-order, minimize/maximize
├── Taskbar           — running-app buttons, click to focus/minimize
├── Launcher          — start menu with search, categories from AppModule
├── Desktop           — app shortcuts, file icons, drag-select, drop targets
├── NotificationService — toast notifications
├── Clock             — taskbar clock (click to toggle seconds)
├── ContextMenu       — right-click menus for desktop and files
├── FileDialog        — OS-level Open / Save As dialogs
├── FileOperationService — copy/cut/paste/delete via ClipboardService
└── FileSystemDB      — IndexedDB virtual filesystem (singleton on window.top)
```

Apps are separate pages loaded in **iframes**. The shell communicates with them via `postMessage` using a shared protocol defined in `constants.js`.

### How apps are launched

1. `app.js` (at the site root) defines an app registry exposed as `window.AppModule`
2. `HeymingOS.launchApp(appId)` looks up the app and calls `WindowManager.createIframeWindow(app)`
3. The window manager creates a draggable/resizable window with an iframe pointing to the app's path
4. A taskbar button is created for the new window

### FileSystemDB

The virtual filesystem uses IndexedDB (`HeymingTerminalFS` database) with two object stores: `files` and `metadata`. It is loaded as a regular script (not an ES module) so that parent and iframe apps share one singleton instance via `window.top._fileSystemDBInstance`. Events (`create`, `delete`, `move`, `copy`, `change`) are broadcast to all subscribers through a listener bus on `window.top`.

## Files

| File | Description |
|------|-------------|
| `index.html` | Standalone OS page with GA tracking, desktop shell DOM |
| `index.js` | ES module entry point; assembles namespace, creates singleton |
| `HeymingOS.js` | Main orchestrator; wires subsystems, iframe RPC, filesystem subscriptions |
| `WindowManager.js` | Window chrome, iframe apps, drag/resize, z-order, viewport fitting |
| `Taskbar.js` | Running-app buttons in the taskbar |
| `Launcher.js` | App launcher menu with search filtering |
| `Desktop.js` | Desktop surface with app shortcuts and file icons |
| `NotificationService.js` | Toast notification system |
| `Clock.js` | Taskbar clock with seconds toggle |
| `ContextMenu.js` | Right-click context menus |
| `FileDialog.js` | Open / Save As dialog UI |
| `FileOperationService.js` | Copy/cut/paste/delete operations |
| `ClipboardService.js` | In-memory file clipboard shared across components |
| `DragService.js` | Cross-iframe drag payload with stale timeout |
| `QuickLookPreview.js` | Spacebar preview overlay for files |
| `InputHandler.js` | Mobile breakpoint detection, pointer helpers, Meta key handling |
| `Icons.js` | MIME type to emoji mapping |
| `config.js` | User config (HOME, DESKTOP paths), debug logging |
| `constants.js` | Layout constants, z-index values, message types, iframe actions |
| `filesystem-db.js` | IndexedDB virtual filesystem with event bus |

## Dependencies

No npm packages. All dependencies are loaded via CDN or from the parent site:

- **Tailwind CSS** — utility classes (CDN)
- **app.js** — app registry (`AppModule`, `AppFilter`)
- **analytics.js** — Google Analytics tracking
