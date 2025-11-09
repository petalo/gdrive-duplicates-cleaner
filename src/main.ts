/**
 * Drive Duplicate Cleaner - Main Entry Point
 *
 * Automatically cleans duplicate files from Google Drive folders based on MD5 checksums.
 * Files are grouped by identical content and duplicates within a configurable time window
 * are moved to trash (oldest file is always preserved).
 */

/**
 * Sets up initial configuration in Script Properties.
 * Run this function once before the first execution.
 *
 * After running this, remember to:
 * 1. Update ROOT_FOLDER_IDS with your actual folder IDs
 * 2. Adjust EXCLUDED_FOLDER_IDS if needed
 * 3. Set DRY_RUN to 'false' when ready to delete files
 */
function setupConfig(): void {
  const props = PropertiesService.getScriptProperties();

  // Default configuration values
  const defaults: { [key: string]: string } = {
    'ROOT_FOLDER_IDS': JSON.stringify(['REPLACE_WITH_YOUR_FOLDER_ID']),
    'DUPLICATION_WINDOW_HOURS': '24',
    'MAX_EXECUTION_TIME_SECONDS': '300',
    'EXCLUDED_FOLDER_IDS': JSON.stringify([]),
    'EXCLUDED_EXTENSIONS': JSON.stringify([]),
    'FOLDER_SORT_MODE': 'LAST_UPDATED',
    'DRY_RUN': 'true'
  };

  // Only set properties that don't exist yet
  for (const [key, value] of Object.entries(defaults)) {
    if (props.getProperty(key) === null) {
      props.setProperty(key, value);
      Logger.log(`✅ Set ${key} = ${value}`);
    } else {
      Logger.log(`ℹ️  ${key} already exists, keeping current value: ${props.getProperty(key)}`);
    }
  }

  const scriptId = ScriptApp.getScriptId();
  const projectSettingsUrl = `https://script.google.com/home/projects/${scriptId}/settings`;

  Logger.log('');
  Logger.log('✅ Configuration setup completed');
  Logger.log('');
  Logger.log('⚠️  IMPORTANT: Enable Google Drive API Service');
  Logger.log('   This script requires the Advanced Drive Service.');
  Logger.log('   In the Apps Script editor:');
  Logger.log('   1. Click on "Services" (+) in the left sidebar');
  Logger.log('   2. Find "Google Drive API"');
  Logger.log('   3. Version: v3, Identifier: Drive');
  Logger.log('   4. Click "Add"');
  Logger.log('');
  Logger.log('═'.repeat(80));
  Logger.log('');
  Logger.log('⚠️  NEXT STEPS:');
  Logger.log('');
  Logger.log('1️⃣  UPDATE CONFIGURATION:');
  Logger.log('   Go to Project Settings and scroll to "Script Properties":');
  Logger.log(`   ${projectSettingsUrl}`);
  Logger.log('');
  Logger.log('   Edit these properties:');
  Logger.log('   • ROOT_FOLDER_IDS: ["your-folder-id-1", "your-folder-id-2"]');
  Logger.log('   • EXCLUDED_FOLDER_IDS: [] (folder IDs to exclude)');
  Logger.log('   • EXCLUDED_EXTENSIONS: [] (file extensions to exclude)');
  Logger.log('   • DUPLICATION_WINDOW_HOURS: 24');
  Logger.log('   • FOLDER_SORT_MODE: "LAST_UPDATED" (or "RANDOM")');
  Logger.log('   • DRY_RUN: true (change to false when ready to delete)');
  Logger.log('');
  Logger.log('   💡 To find a folder ID: Open folder in Drive, copy ID from URL');
  Logger.log('      https://drive.google.com/drive/folders/FOLDER_ID_HERE');
  Logger.log('');
  Logger.log('2️⃣  TEST IN DRY-RUN MODE:');
  Logger.log('   Run cleanDuplicateAttachments() and check the logs');
  Logger.log('');
  Logger.log('3️⃣  ACTIVATE:');
  Logger.log('   Set DRY_RUN=false in Project Settings when ready');
  Logger.log('');
  Logger.log('4️⃣  AUTOMATE (Optional):');
  Logger.log('   Set up a time-based trigger (every 10 minutes recommended)');
  Logger.log('   Triggers > Add Trigger > cleanDuplicateAttachments > Time-driven');
  Logger.log('');
  Logger.log('═'.repeat(80));
}

/**
 * Main function to clean duplicate attachments from Drive.
 *
 * This function should be triggered periodically (e.g., every 10 minutes).
 * It will:
 * - Process each root folder in ROOT_FOLDER_IDS
 * - Sort subfolders by last modification (recent first)
 * - Group files by MD5 checksum
 * - Delete duplicates created within DUPLICATION_WINDOW_HOURS
 * - Stop gracefully before MAX_EXECUTION_TIME_SECONDS
 *
 * The oldest file in each group is always preserved.
 */
function cleanDuplicateAttachments(): void {
  const startTime = Date.now();

  try {
    const config = getConfig();

    Logger.log('='.repeat(80));
    Logger.log(`${getTimestamp()} 🚀 Drive Duplicate Cleaner - Starting`);
    Logger.log('='.repeat(80));
    Logger.log(`Mode: ${config.DRY_RUN ? '🧪 DRY RUN (no files will be deleted)' : '🗑️  LIVE (files will be deleted)'}`);
    Logger.log(`Root folders: ${config.ROOT_FOLDER_IDS.length}`);
    Logger.log(`Duplication window: ${config.DUPLICATION_WINDOW_HOURS} hours`);
    Logger.log(`Max execution time: ${config.MAX_EXECUTION_TIME_SECONDS} seconds`);
    Logger.log(`Folder sort mode: ${config.FOLDER_SORT_MODE}`);
    Logger.log(`Excluded folders: ${config.EXCLUDED_FOLDER_IDS.length}`);
    Logger.log(`Excluded extensions: ${config.EXCLUDED_EXTENSIONS.length > 0 ? config.EXCLUDED_EXTENSIONS.join(', ') : 'none'}`);
    Logger.log('');

    // Aggregate statistics across all roots
    const totalStats: ProcessingStats = {
      foldersProcessed: 0,
      totalFolders: 0,
      filesAnalyzed: 0,
      filesSkipped: 0,
      filesDeleted: 0,
      spaceFreed: 0
    };

    // Process each root folder
    for (const rootFolderId of config.ROOT_FOLDER_IDS) {
      // Check global timeout
      if (Date.now() - startTime > config.MAX_EXECUTION_TIME_MS) {
        Logger.log(`${getTimestamp()} ⏱️  Global timeout reached`);
        break;
      }

      try {
        const rootFolder = DriveApp.getFolderById(rootFolderId);
        const stats = processRootFolder(rootFolder, config, startTime);

        // Aggregate stats
        totalStats.foldersProcessed += stats.foldersProcessed;
        totalStats.totalFolders += stats.totalFolders;
        totalStats.filesAnalyzed += stats.filesAnalyzed;
        totalStats.filesSkipped += stats.filesSkipped;
        totalStats.filesDeleted += stats.filesDeleted;
        totalStats.spaceFreed += stats.spaceFreed;

      } catch (e: any) {
        Logger.log(`${getTimestamp()} ❌ Error accessing root folder ${rootFolderId}:`);
        Logger.log(`   ${e.message}`);
        Logger.log(`   Make sure the script has access to this folder/Shared Drive`);
        continue;
      }
    }

    // Final summary
    const totalDuration = Date.now() - startTime;
    Logger.log('');
    Logger.log('='.repeat(80));
    Logger.log(`${getTimestamp()} ✅ Execution Completed`);
    Logger.log('='.repeat(80));
    Logger.log(`Duration: ${formatDuration(totalDuration)}`);
    Logger.log(`Folders processed: ${totalStats.foldersProcessed} / ${totalStats.totalFolders}`);
    Logger.log(`Files analyzed: ${totalStats.filesAnalyzed}`);
    Logger.log(`Files skipped: ${totalStats.filesSkipped}`);
    Logger.log(`Files ${config.DRY_RUN ? 'that would be deleted' : 'deleted'}: ${totalStats.filesDeleted}`);
    Logger.log(`Space ${config.DRY_RUN ? 'that would be freed' : 'freed'}: ${formatBytes(totalStats.spaceFreed)}`);
    Logger.log('='.repeat(80));

    if (config.DRY_RUN) {
      Logger.log('');
      Logger.log('ℹ️  This was a DRY RUN - no files were actually deleted');
      Logger.log('   Set DRY_RUN=false in configuration when ready to delete files');
    }

  } catch (e: any) {
    Logger.log('');
    Logger.log(`${getTimestamp()} ❌ Critical error during execution:`);
    Logger.log(`   ${e.message}`);
    Logger.log(`   ${e.stack}`);

    if (e.message && e.message.includes('ROOT_FOLDER_IDS is empty')) {
      Logger.log('');
      Logger.log('💡 Run setupConfig() first to initialize configuration');
    }
  }
}

/**
 * Helper function to view current configuration.
 * Useful for debugging and verification.
 */
function viewConfig(): void {
  try {
    const config = getConfig();
    Logger.log('Current Configuration:');
    Logger.log('─'.repeat(80));
    Logger.log(`ROOT_FOLDER_IDS: ${JSON.stringify(config.ROOT_FOLDER_IDS, null, 2)}`);
    Logger.log(`DUPLICATION_WINDOW_HOURS: ${config.DUPLICATION_WINDOW_HOURS}`);
    Logger.log(`MAX_EXECUTION_TIME_SECONDS: ${config.MAX_EXECUTION_TIME_SECONDS}`);
    Logger.log(`EXCLUDED_FOLDER_IDS: ${JSON.stringify(config.EXCLUDED_FOLDER_IDS, null, 2)}`);
    Logger.log(`EXCLUDED_EXTENSIONS: ${JSON.stringify(config.EXCLUDED_EXTENSIONS, null, 2)}`);
    Logger.log(`FOLDER_SORT_MODE: ${config.FOLDER_SORT_MODE}`);
    Logger.log(`DRY_RUN: ${config.DRY_RUN}`);
    Logger.log('─'.repeat(80));
  } catch (e: any) {
    Logger.log(`Error: ${e.message}`);
    Logger.log('Run setupConfig() first to initialize configuration');
  }
}
