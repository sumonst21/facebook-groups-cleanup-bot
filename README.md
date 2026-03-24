# Facebook Groups Cleanup Bot

An automated script that uses `puppeteer-core` to connect to an active Chrome browser session and clean up your Facebook group memberships programmatically.

## Features

- **Profile Scraping**: Automatically scrolls through your `facebook.com/[username]/groups` page to find groups with fewer than 10,000 members.
- **Concurrent Cleanup**: Dispatches multiple asynchronous browser tabs to independently visit and leave groups in parallel, drastically speeding up the cleanup.
- **Robust Execution**: Navigates directly to group URLs and mechanically clicks the confirmation buttons rather than relying on unreliable React UI hover interactions.
- **State Preservation**: Logs completed processes to `cleanup_report.json`.

## Requirements

1. A running instance of Google Chrome launched with a remote debugging port:
   ```bash
   google-chrome --remote-debugging-port=9222
   ```
2. Node.js and the `puppeteer-core` library installed.

## Usage

Start the bot locally:
```bash
node leave_bot.js
```
The script will run continuously until all groups under the target member limit are processed.

## Note
Ensure your terminal session has active permissions to the debugging port, and avoid interfering with the spawned background tabs during execution.
