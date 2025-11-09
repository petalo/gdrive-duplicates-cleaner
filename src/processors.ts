/**
 * Core processing logic for folders and files
 */

/**
 * File information for grouping duplicates
 */
interface FileInfo {
  id: string;
  name: string;
  created: number;
  size: number;
  fileObject: GoogleAppsScript.Drive.File;
}

/**
 * Folder information for sorting
 */
interface FolderInfo {
  folder: GoogleAppsScript.Drive.Folder;
  lastModified: number;
  name: string;
}

/**
 * Processing statistics
 */
interface ProcessingStats {
  foldersProcessed: number;
  totalFolders: number;
  filesAnalyzed: number;
  filesSkipped: number;
  filesDeleted: number;
  spaceFreed: number;
}

/**
 * Processes a single root folder and its subfolders
 * @param rootFolder The root folder to process
 * @param config Runtime configuration
 * @param globalStartTime Global execution start time
 * @returns Processing statistics
 */
function processRootFolder(
  rootFolder: GoogleAppsScript.Drive.Folder,
  config: RuntimeConfig,
  globalStartTime: number
): ProcessingStats {
  const rootName = rootFolder.getName();
  Logger.log(`\n📂 Processing root: ${rootName}`);

  const subFoldersIterator = rootFolder.getFolders();

  // Load all subfolders into array
  const folders: FolderInfo[] = [];
  while (subFoldersIterator.hasNext()) {
    const folder = subFoldersIterator.next();

    // Skip excluded folders
    if (isFolderExcluded(folder, config.EXCLUDED_FOLDER_IDS)) {
      Logger.log(`  ⏭️  Skipping excluded: ${folder.getName()}`);
      continue;
    }

    folders.push({
      folder: folder,
      lastModified: folder.getLastUpdated().getTime(),
      name: folder.getName()
    });
  }

  // Sort folders based on configured mode
  if (config.FOLDER_SORT_MODE === 'RANDOM') {
    // Fisher-Yates shuffle algorithm
    for (let i = folders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [folders[i], folders[j]] = [folders[j], folders[i]];
    }
    Logger.log(`  Found ${folders.length} subfolders (sorted randomly)`);
  } else {
    // Sort by last modified (most recent first)
    folders.sort((a, b) => b.lastModified - a.lastModified);
    Logger.log(`  Found ${folders.length} subfolders (sorted by recent activity)`);
  }

  // Process folders until timeout
  const stats: ProcessingStats = {
    foldersProcessed: 0,
    totalFolders: folders.length,
    filesAnalyzed: 0,
    filesSkipped: 0,
    filesDeleted: 0,
    spaceFreed: 0
  };

  for (const folderInfo of folders) {
    // Check timeout before processing next folder
    if (Date.now() - globalStartTime > config.MAX_EXECUTION_TIME_MS) {
      Logger.log(`  ⏱️  Timeout - processed ${stats.foldersProcessed}/${folders.length} folders`);
      break;
    }

    try {
      const folderStats = processFolder(folderInfo.folder, config);
      stats.foldersProcessed++;
      stats.filesAnalyzed += folderStats.filesAnalyzed;
      stats.filesSkipped += folderStats.filesSkipped;
      stats.filesDeleted += folderStats.filesDeleted;
      stats.spaceFreed += folderStats.spaceFreed;
    } catch (e: any) {
      Logger.log(`${getTimestamp()}   ❌ Error processing folder ${folderInfo.name}: ${e.message}`);
      Logger.log(`${getTimestamp()}   Skipping this folder and continuing...`);
      continue;
    }
  }

  Logger.log(`  ✓ Root completed: ${stats.foldersProcessed}/${folders.length} folders`);
  return stats;
}

/**
 * Processes a single folder for duplicate files
 * @param folder The folder to process
 * @param config Runtime configuration
 * @returns Processing statistics for this folder
 */
function processFolder(
  folder: GoogleAppsScript.Drive.Folder,
  config: RuntimeConfig
): Omit<ProcessingStats, 'foldersProcessed' | 'totalFolders'> {
  const folderName = folder.getName();
  const folderStartTime = Date.now();

  Logger.log(`${getTimestamp()} 📁 Processing: ${folderName}`);

  const filesIterator = folder.getFiles();
  const fileGroups: { [md5: string]: FileInfo[] } = {};

  let filesAnalyzed = 0;
  let filesSkipped = 0;

  // Group files by MD5 checksum
  while (filesIterator.hasNext()) {
    const file = filesIterator.next();

    if (file.isTrashed()) {
      continue;
    }

    // Check if file extension is excluded
    if (isFileExcluded(file, config.EXCLUDED_EXTENSIONS)) {
      Logger.log(`${getTimestamp()}   ⏭️  Skipping ${file.getName()} - excluded extension`);
      filesSkipped++;
      continue;
    }

    // Get MD5 checksum using Advanced Drive Service
    let md5: string | null = null;
    try {
      const fileMetadata = Drive.Files!.get(file.getId(), {
        fields: 'md5Checksum',
        supportsAllDrives: true
      });
      md5 = fileMetadata.md5Checksum || null;
    } catch (e: any) {
      Logger.log(`${getTimestamp()}   ⚠️  Could not get MD5 for ${file.getName()}: ${e.message}`);
      filesSkipped++;
      continue;
    }

    // Skip files without MD5 (Google Docs native formats)
    if (!md5) {
      Logger.log(`${getTimestamp()}   ⏭️  Skipping ${file.getName()} - no MD5 available`);
      filesSkipped++;
      continue;
    }

    // Group by MD5
    if (!fileGroups[md5]) {
      fileGroups[md5] = [];
    }

    fileGroups[md5].push({
      id: file.getId(),
      name: file.getName(),
      created: file.getDateCreated().getTime(),
      size: file.getSize(),
      fileObject: file
    });

    filesAnalyzed++;
  }

  // Process duplicate groups
  let filesDeleted = 0;
  let spaceFreed = 0;

  for (const md5 in fileGroups) {
    const group = fileGroups[md5];

    // Only process if there are duplicates
    if (group.length > 1) {
      // Sort by creation date (oldest first)
      group.sort((a, b) => a.created - b.created);

      const oldest = group[0];
      Logger.log(`${getTimestamp()}   🔍 Found ${group.length} files with same MD5:`);

      // Check each potential duplicate
      for (let i = 1; i < group.length; i++) {
        const duplicate = group[i];

        // Only delete if within duplication window
        if (duplicate.created - oldest.created < config.DUPLICATION_WINDOW_MS) {
          Logger.log(`${getTimestamp()}      - ${oldest.name} (${new Date(oldest.created).toISOString()}) [KEPT]`);
          Logger.log(`${getTimestamp()}      - ${duplicate.name} (${new Date(duplicate.created).toISOString()}) [${config.DRY_RUN ? 'WOULD DELETE' : 'DELETING'}]`);

          if (!config.DRY_RUN) {
            duplicate.fileObject.setTrashed(true);
          }

          filesDeleted++;
          spaceFreed += duplicate.size;
        } else {
          Logger.log(`${getTimestamp()}      - ${duplicate.name} - kept (outside ${config.DUPLICATION_WINDOW_HOURS}h window)`);
        }
      }
    }
  }

  const duration = ((Date.now() - folderStartTime) / 1000).toFixed(2);
  Logger.log(
    `${getTimestamp()}   ✓ ${folderName}: ${filesAnalyzed} analyzed, ${filesSkipped} skipped, ` +
    `${filesDeleted} ${config.DRY_RUN ? 'would be deleted' : 'deleted'}, ${formatBytes(spaceFreed)} freed (${duration}s)`
  );

  return {
    filesAnalyzed,
    filesSkipped,
    filesDeleted,
    spaceFreed
  };
}
