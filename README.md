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

By default, the script targets groups with **fewer than 10,000 members**. You can control this behavior using command line parameters:

- **Leave all groups**:
  ```bash
  node leave_bot.js --all
  ```
- **Leave groups with fewer than X members**:
  ```bash
  node leave_bot.js --less-than 5000
  ```
  *(or use `-l 5000`)*
- **Leave groups with more than X members**:
  ```bash
  node leave_bot.js --greater-than 100000
  ```
  *(or use `-g 100000`)*

The script will run continuously using 3 concurrent tabs until all matching groups are processed and will log progress to `cleanup.log`.

## Alternative Modal Script (Anti-Ban)

If Facebook temporarily limits your account from leaving groups via individual group pages, you can use the centralized Membership Settings Modal script:
```bash
node leave_modal_bot.js
```
This single-tab script automatically navigates to `https://www.facebook.com/groups/feed`, opens the `Groups Settings -> Membership` modal, and processes all your groups natively.

## Unfollowing Groups (Manual Console Snippet)

If you wish to stop seeing posts from groups without leaving them entirely, use the following manual snippet:

1. Navigate to `https://www.facebook.com/groups/joins/`
2. Click the **Settings Gear** icon in the sidebar.
3. Select **Following**.
4. Scroll the modal to load all groups you wish to unfollow.
5. Open the Browser Console (F12) and paste the contents of `unfollow_snippet.js`.

This script will sequentially click the "Unfollow" button for every group currently visible in the modal.

## Note
Ensure your terminal session has active permissions to the debugging port, and avoid interfering with the spawned background tabs during execution.
