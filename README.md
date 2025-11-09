# Drive Duplicate Cleaner

Automatically clean duplicate files from Google Drive folders based on MD5 checksums. Designed to handle duplicate attachments that occur when multiple users receive the same email and their respective Flows save attachments simultaneously to shared Drive folders.

## Features

- **MD5-based Detection**: Uses cryptographic hashes to identify truly identical files
- **Smart Prioritization**: Processes recently modified folders first
- **Multiple Root Folders**: Support for multiple Drive folders and Shared Drives
- **Configurable Time Window**: Only delete duplicates created within a specific timeframe
- **Folder Exclusions**: Exclude sensitive folders (and their subfolders) by ID
- **Extension Filtering**: Optionally exclude specific file types
- **Dry-Run Mode**: Test without deleting anything
- **Safe Deletion**: Moves files to trash (recoverable for 30 days) instead of permanent deletion
- **Graceful Timeout Handling**: Stops cleanly before Apps Script execution limits

## How It Works

1. **Selection**: Sorts folders by last modification date (most recent first)
2. **Grouping**: Groups files by MD5 checksum (identical content = same MD5)
3. **Preservation**: Always keeps the oldest file in each group
4. **Deletion**: Removes duplicates created within the configured time window (default: 24 hours)
5. **Safety**: Moves duplicates to trash, not permanent deletion

## Installation

### Prerequisites

- Node.js and npm installed
- Google account with access to target Drive folders
- clasp CLI installed globally: `npm install -g @google/clasp`

### Setup Steps

1. **Clone or download this repository**

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Login to clasp**

   ```bash
   npm run login
   ```

4. **Create a new Apps Script project**

   ```bash
   npm run create
   ```

   This will create a new standalone Apps Script project and generate `.clasp.json`

5. **Compile TypeScript and push to Google**

   ```bash
   npm run push
   ```

6. **Open the Apps Script editor**

   ```bash
   npm run open
   ```

7. **Enable Google Drive API Service** (REQUIRED)

   - In the Apps Script editor, click on **Services** (+ icon) in the left sidebar
   - Find **"Google Drive API"**
   - Set:
     - **Version**: v3
     - **Identifier**: `Drive`
   - Click **Add**

   > ⚠️ **Important**: This step is required for the script to access MD5 checksums. Without it, you'll get errors like "Drive.Files.get is not a function".

8. **Grant Permissions** (First Run)

   When you run the script for the first time, Google will ask for permissions:

   ![Permissions Screenshot](assets/permissions.png)

   You need to authorize:
   - ✅ **See, edit, create, and delete all of your Google Drive files** - Required to analyze files and move duplicates to trash
   - ⚠️ **Allow this application to run when you are not present** - Optional, only needed if you want automated triggers

## Configuration

### Initial Setup

1. In the Apps Script editor, run the `setupConfig` function once
2. This creates the configuration in Script Properties
3. Follow the instructions in the execution log to:
   - Enable Drive API Service (if not done already)
   - Configure your folder IDs
   - Set up Script Properties

### Update Configuration

Update configuration values using Script Properties:

```javascript
// Set your root folder ID(s)
PropertiesService.getScriptProperties().setProperty(
  "ROOT_FOLDER_IDS",
  JSON.stringify(["YOUR_FOLDER_ID_1", "YOUR_FOLDER_ID_2"])
);

// Set duplication window (hours)
PropertiesService.getScriptProperties().setProperty(
  "DUPLICATION_WINDOW_HOURS",
  "24"
);

// Set maximum execution time (seconds)
PropertiesService.getScriptProperties().setProperty(
  "MAX_EXECUTION_TIME_SECONDS",
  "300"
);

// Exclude specific folders by ID
PropertiesService.getScriptProperties().setProperty(
  "EXCLUDED_FOLDER_IDS",
  JSON.stringify(["FOLDER_ID_TO_EXCLUDE"])
);

// Exclude specific file extensions
PropertiesService.getScriptProperties().setProperty(
  "EXCLUDED_EXTENSIONS",
  JSON.stringify(["tmp", "log"])
);

// Set folder sort mode
PropertiesService.getScriptProperties().setProperty(
  "FOLDER_SORT_MODE",
  "LAST_UPDATED"
);

// Enable/disable dry-run mode
PropertiesService.getScriptProperties().setProperty("DRY_RUN", "false");
```

### Configuration Options

| Option                       | Type     | Default         | Description                                                           |
| ---------------------------- | -------- | --------------- | --------------------------------------------------------------------- |
| `ROOT_FOLDER_IDS`            | string[] | `[]`            | Array of folder IDs to process (supports My Drive and Shared Drives)  |
| `DUPLICATION_WINDOW_HOURS`   | number   | `24`            | Only delete duplicates created within this many hours of the original |
| `MAX_EXECUTION_TIME_SECONDS` | number   | `300`           | Stop execution before this limit (Apps Script limit is 360 seconds)   |
| `EXCLUDED_FOLDER_IDS`        | string[] | `[]`            | Folders to skip (automatically excludes subfolders too)               |
| `EXCLUDED_EXTENSIONS`        | string[] | `[]`            | File extensions to skip (e.g., `['exe', 'dmg']`)                      |
| `FOLDER_SORT_MODE`           | string   | `LAST_UPDATED`  | Folder processing order: `LAST_UPDATED` (recent first) or `RANDOM`   |
| `DRY_RUN`                    | boolean  | `true`          | If `true`, no files are deleted (test mode)                           |

### Finding Folder IDs

1. Open the folder in Google Drive
2. The URL will be: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
3. Copy the `FOLDER_ID_HERE` part

## Usage

### Manual Execution

In the Apps Script editor, run the `cleanDuplicateAttachments` function.

### Automated Execution (Recommended)

1. In Apps Script editor, go to **Triggers** (clock icon on left sidebar)
2. Click **Add Trigger**
3. Configure:
   - Function: `cleanDuplicateAttachments`
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 10 minutes**

This ensures the script runs continuously, processing folders in order of recent activity.

### Testing Before Live Run

1. Keep `DRY_RUN=true` initially
2. Run `cleanDuplicateAttachments` manually
3. Check logs (View > Logs or Ctrl+Enter)
4. Verify the files it would delete are correct
5. Set `DRY_RUN=false` when ready

### Viewing Configuration

Run the `viewConfig` function to see current settings.

## How Duplicates Are Identified

1. **Files are grouped by MD5 checksum** - Only files with identical content are considered duplicates
2. **Within each group, files are sorted by creation date** (oldest first)
3. **The oldest file is always preserved**
4. **Newer files are only deleted if created within the duplication window** (e.g., within 24 hours of the oldest)

This ensures:

- ✅ No false positives (MD5 collision is virtually impossible)
- ✅ Original files are never deleted
- ✅ Old duplicates outside the window are preserved (may be intentional copies)

## Folder Prioritization

You can configure how folders are prioritized using `FOLDER_SORT_MODE`:

### LAST_UPDATED (Default)

Folders are sorted by **last modification date** before processing:

- ✅ Recently active folders are processed first (where duplicates are most likely)
- ✅ After initial cleanup, executions complete quickly (only a few active folders)
- ✅ All folders are eventually covered across multiple executions
- ✅ **Best for automated/scheduled runs** - naturally prioritizes active areas

### RANDOM

Folders are processed in **random order** each execution:

- ✅ Provides even distribution across all folders over time
- ✅ Useful for large folder structures with sporadic activity patterns
- ✅ Prevents any folder from being consistently skipped
- ✅ **Best for one-time cleanups** or when activity patterns are unpredictable

## Exclusions

### Folder Exclusions

- Specified by **Folder ID** (not name)
- **Automatically excludes all subfolders**
- Example: Exclude `/legal/` also excludes `/legal/contracts/2024/`

### Extension Exclusions

- Useful for policy reasons (e.g., never delete executables)
- Applied before MD5 check (performance optimization)

## Project Structure

```text
drive-delete-duplicated-files/
├── src/
│   ├── main.ts           # Entry points (cleanDuplicateAttachments, setupConfig)
│   ├── config.ts         # Configuration management
│   ├── processors.ts     # Core processing logic
│   └── utils.ts          # Helper functions
├── appsscript.json       # Apps Script manifest
├── package.json          # Node dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## Development

### Local Development

1. Make changes to TypeScript files in `src/`
2. Push changes: `npm run push`
3. Test in Apps Script editor

### Viewing Logs

```bash
npm run logs
```

Or in Apps Script editor: **View > Logs** (Ctrl+Enter)

### Pull Changes from Apps Script

If you make changes in the web editor:

```bash
npm run pull
```

## Troubleshooting

### "Drive.Files.get is not a function" or "Drive is not defined"

**Cause**: Google Drive API Service is not enabled.

**Solution**:

1. Open the Apps Script editor (`npm run open`)
2. Click **Services** (+ icon) in the left sidebar
3. Find **"Drive API"**
4. Version: **v3**, Identifier: **Drive**
5. Click **Add**

### "ROOT_FOLDER_IDS is empty"

Run `setupConfig()` first, then update the folder IDs in Project Settings > Script Properties.

### "Cannot access folder X"

- Verify the folder ID is correct
- Ensure the script has permission to access the folder
- For Shared Drives, ensure you have access
- Check that the folder hasn't been deleted or moved

### Script times out

- Reduce `MAX_EXECUTION_TIME_SECONDS` to stop earlier
- The script will resume on the next trigger execution
- With 10-minute triggers, all folders will be covered eventually

### Too many duplicates deleted

- Increase `DUPLICATION_WINDOW_HOURS` to be more conservative
- Use `DRY_RUN=true` to test first

### Files not being detected as duplicates

- Check if files have MD5 checksums (Google Docs native formats don't)
- Verify files are truly identical (same content byte-for-byte)

## Limitations

- **Apps Script execution limit**: 6 minutes per execution (script stops at 5 minutes by default)
- **Google Docs native formats**: Files without MD5 checksums are skipped (Docs, Sheets, Slides)
- **Trash retention**: Files in trash are auto-deleted after 30 days

## Safety Features

- ✅ **Dry-run mode** for testing
- ✅ **Trash instead of permanent deletion** (30-day recovery window)
- ✅ **Always preserves oldest file** in each group
- ✅ **Time window filter** prevents deleting old intentional copies
- ✅ **Graceful timeout handling** prevents incomplete operations

## License

MIT

## Support

For issues or questions, please check the logs first using `viewConfig()` and reviewing execution logs.
