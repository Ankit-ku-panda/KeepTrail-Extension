# TrailMind – Web Activity Memory

TrailMind is a privacy-first Chrome and Edge extension that creates a searchable local timeline of your browsing activity. It remembers the website, page title, exact URL, date, time, focused duration, navigation method, and the meaningful controls you used in their exact order. You can replay your process or attach a note describing what you completed on any page.

## Features

- Timeline grouped by date and website
- Exact URL, title, visit time, and focused-duration memory
- Detects normal page loads, reloads, back/forward navigation, hash changes, and History API navigation used by GitHub and other single-page apps
- GitHub-aware labels for repositories, issues, pull requests, commits, Actions, and settings
- Manual “what I did” notes and favorites
- Ordered process capture for links, buttons, tabs, menus, checkboxes, selections, and form submissions
- Expandable process steps for each page plus a full start-to-finish Process Replay view
- Search plus date, website, and favorites filters
- Click, keyboard-action, and scroll-depth counters without storing typed text
- Per-domain exclusion list and one-click pause
- Local-only storage with JSON and CSV export

## Install in Chrome

1. Extract the ZIP file.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `TrailMind` folder.
6. Pin TrailMind from the extensions menu.

## Install in Microsoft Edge

1. Extract the ZIP file.
2. Open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.

## Upgrade from TrailMind 1.0

1. Extract the new ZIP and replace your old `TrailMind` source folder.
2. Open the browser's extensions page and click **Reload** on TrailMind.
3. Reload any website tabs that were already open.

Your existing locally stored visit history, notes, and favorites are preserved. New process steps begin recording after the extension and page are reloaded.

## Privacy model

TrailMind does not send browsing data anywhere. It never stores passwords, uploaded file names, or the text entered into forms. Process memory saves only the visible label of a meaningful control, its time, its type, and the target URL when a link was opened. Activity counters record only the number of click/key interactions and maximum scroll percentage. Browser-protected pages such as `chrome://` and `edge://` cannot be tracked.

## Notes

- Focused time is counted while the page is visible and you have been active recently.
- Ordinary entries follow the selected retention period. Favorites and entries with notes are preserved.
- Because data is browser-local, uninstalling the extension removes its stored history unless you export it first.

## License

MIT
