/**
 * Folder Merger - Detects and merges duplicate folders
 *
 * This module handles the detection and merging of folders with identical names
 * at the same hierarchy level. Common scenario: automated processes (email->Drive)
 * creating duplicate folders when they can't find the existing one.
 */

/**
 * Folder node in the tree structure
 */
interface FolderNode {
  folder: GoogleAppsScript.Drive.Folder;
  id: string;
  name: string;
  parentId: string;
  level: number;
  path: string;
}

/**
 * Statistics for folder merge operations
 */
interface MergeStats {
  foldersScanned: number;
  duplicateGroupsFound: number;
  foldersMerged: number;
  filesMovedDuringMerge: number;
  filesDuplicatedDuringMerge: number;
  filesRenamedDuringMerge: number;
  emptyFoldersDeleted: number;
}

/**
 * File conflict resolution result
 */
interface FileConflictResolution {
  existingFile: GoogleAppsScript.Drive.File;
  incomingFile: GoogleAppsScript.Drive.File;
  existingMd5: string | null;
  incomingMd5: string | null;
  resolution: 'KEEP_EXISTING' | 'KEEP_INCOMING' | 'RENAME_INCOMING' | 'ERROR';
  reason: string;
}

/**
 * Main function: Merges duplicate folders in a root folder
 */
function mergeDuplicateFolders(
  rootFolder: GoogleAppsScript.Drive.Folder,
  config: RuntimeConfig,
  globalStartTime: number
): MergeStats {

  const stats: MergeStats = {
    foldersScanned: 0,
    duplicateGroupsFound: 0,
    foldersMerged: 0,
    filesMovedDuringMerge: 0,
    filesDuplicatedDuringMerge: 0,
    filesRenamedDuringMerge: 0,
    emptyFoldersDeleted: 0
  };

  Logger.log(`${getTimestamp()} 🔀 Starting folder merge scan...`);

  // 1. Build complete folder tree
  const folderTree = buildFolderTree(rootFolder, config);
  stats.foldersScanned = folderTree.length;
  Logger.log(`${getTimestamp()}    Found ${stats.foldersScanned} folders total`);

  // 2. Group folders by (parentId + name)
  const duplicateGroups = groupDuplicateFolders(folderTree);

  // Count only groups with actual duplicates
  for (const [key, folders] of duplicateGroups) {
    if (folders.length > 1) {
      stats.duplicateGroupsFound++;
    }
  }

  Logger.log(`${getTimestamp()}    Found ${stats.duplicateGroupsFound} duplicate groups`);

  if (stats.duplicateGroupsFound === 0) {
    Logger.log(`${getTimestamp()} ✓ No duplicate folders found`);
    return stats;
  }

  // 3. Process each duplicate group
  for (const [key, folders] of duplicateGroups) {
    if (folders.length < 2) continue;

    // Timeout check
    if (Date.now() - globalStartTime > config.MAX_EXECUTION_TIME_MS) {
      Logger.log(`${getTimestamp()} ⏱️  Timeout reached during folder merge`);
      break;
    }

    // 4. Select target folder (the one to keep)
    const targetFolder = selectTargetFolder(folders, config);
    const sourceFolders = folders.filter(f => f.id !== targetFolder.id);

    Logger.log(`${getTimestamp()} 📁 Merging "${targetFolder.name}" (${folders.length} instances)`);
    Logger.log(`${getTimestamp()}    Target: ${targetFolder.path}`);

    // 5. Merge each source folder into target
    for (const sourceFolder of sourceFolders) {
      Logger.log(`${getTimestamp()}    Source: ${sourceFolder.path}`);

      const mergeResult = mergeFolder(sourceFolder, targetFolder, config);

      stats.filesMovedDuringMerge += mergeResult.filesMoved;
      stats.filesDuplicatedDuringMerge += mergeResult.duplicatesHandled;
      stats.filesRenamedDuringMerge += mergeResult.filesRenamed;

      // 6. Delete empty source folder
      if (isFolderEmpty(sourceFolder.folder)) {
        if (!config.DRY_RUN) {
          sourceFolder.folder.setTrashed(true);
        }
        stats.emptyFoldersDeleted++;
        Logger.log(`${getTimestamp()}    🗑️  ${config.DRY_RUN ? 'Would delete' : 'Deleted'} empty folder`);
      } else {
        Logger.log(`${getTimestamp()}    ⚠️  Folder not empty after merge, keeping it`);
      }

      stats.foldersMerged++;
    }
  }

  Logger.log(`${getTimestamp()} ✓ Folder merge completed`);
  return stats;
}

/**
 * Builds complete folder tree using breadth-first search
 */
function buildFolderTree(
  rootFolder: GoogleAppsScript.Drive.Folder,
  config: RuntimeConfig
): FolderNode[] {

  const allFolders: FolderNode[] = [];
  const queue: Array<{folder: GoogleAppsScript.Drive.Folder, level: number, path: string}> = [];

  // Initialize with root
  queue.push({
    folder: rootFolder,
    level: 0,
    path: rootFolder.getName()
  });

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Get subfolders
    const subFoldersIterator = current.folder.getFolders();
    while (subFoldersIterator.hasNext()) {
      const subFolder = subFoldersIterator.next();

      // Skip excluded folders
      if (isFolderExcluded(subFolder, config.EXCLUDED_FOLDER_IDS)) {
        continue;
      }

      const node: FolderNode = {
        folder: subFolder,
        id: subFolder.getId(),
        name: subFolder.getName(),
        parentId: current.folder.getId(),
        level: current.level + 1,
        path: `${current.path}/${subFolder.getName()}`
      };

      allFolders.push(node);

      // Only recurse if recursive mode is enabled
      if (config.MERGE_FOLDERS_RECURSIVE) {
        queue.push({
          folder: subFolder,
          level: node.level,
          path: node.path
        });
      }
    }
  }

  return allFolders;
}

/**
 * Groups folders by parentId + name (case-insensitive)
 */
function groupDuplicateFolders(
  folderTree: FolderNode[]
): Map<string, FolderNode[]> {

  const groups = new Map<string, FolderNode[]>();

  for (const node of folderTree) {
    // Key: parentId::name (case-insensitive)
    const key = `${node.parentId}::${node.name.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(node);
  }

  return groups;
}

/**
 * Selects which folder to keep based on configured strategy
 */
function selectTargetFolder(
  folders: FolderNode[],
  config: RuntimeConfig
): FolderNode {

  switch (config.MERGE_KEEP_FOLDER_STRATEGY) {
    case 'OLDEST':
      // The folder created first
      return folders.reduce((oldest, current) =>
        current.folder.getDateCreated().getTime() < oldest.folder.getDateCreated().getTime()
          ? current : oldest
      );

    case 'NEWEST':
      // The folder modified most recently
      return folders.reduce((newest, current) =>
        current.folder.getLastUpdated().getTime() > newest.folder.getLastUpdated().getTime()
          ? current : newest
      );

    case 'MOST_FILES':
      // The folder with most files (recursive count)
      const counts = folders.map(f => ({
        node: f,
        fileCount: countFilesRecursive(f.folder)
      }));
      return counts.reduce((max, current) =>
        current.fileCount > max.fileCount ? current : max
      ).node;

    default:
      return folders[0];
  }
}

/**
 * Merges files from sourceFolder into targetFolder
 */
function mergeFolder(
  sourceNode: FolderNode,
  targetNode: FolderNode,
  config: RuntimeConfig
): {filesMoved: number, duplicatesHandled: number, filesRenamed: number} {

  const stats = {filesMoved: 0, duplicatesHandled: 0, filesRenamed: 0};

  const sourceFiles = sourceNode.folder.getFiles();

  while (sourceFiles.hasNext()) {
    const sourceFile = sourceFiles.next();

    // Skip trashed files
    if (sourceFile.isTrashed()) {
      continue;
    }

    // Check if file with same name exists in target
    const existingFiles = targetNode.folder.getFilesByName(sourceFile.getName());

    if (!existingFiles.hasNext()) {
      // NO CONFLICT: Move directly
      if (!config.DRY_RUN) {
        sourceFile.moveTo(targetNode.folder);
      }
      stats.filesMoved++;
      Logger.log(`${getTimestamp()}      📦 ${config.DRY_RUN ? 'Would move' : 'Moved'}: ${sourceFile.getName()}`);

    } else {
      // CONFLICT: Apply duplicate resolution logic
      const existingFile = existingFiles.next();
      const conflict = resolveFileConflict(existingFile, sourceFile, config);

      switch (conflict.resolution) {
        case 'KEEP_EXISTING':
          // Same file (MD5 match) - delete incoming
          if (!config.DRY_RUN) {
            sourceFile.setTrashed(true);
          }
          stats.duplicatesHandled++;
          Logger.log(`${getTimestamp()}      🗑️  ${config.DRY_RUN ? 'Would delete' : 'Deleted'} duplicate: ${sourceFile.getName()} (${conflict.reason})`);
          break;

        case 'KEEP_INCOMING':
          // Same file but incoming is newer - replace
          if (!config.DRY_RUN) {
            existingFile.setTrashed(true);
            sourceFile.moveTo(targetNode.folder);
          }
          stats.duplicatesHandled++;
          Logger.log(`${getTimestamp()}      🔄 ${config.DRY_RUN ? 'Would replace' : 'Replaced'}: ${sourceFile.getName()} (${conflict.reason})`);
          break;

        case 'RENAME_INCOMING':
          // Different files - rename incoming
          const newName = generateUniqueName(sourceFile.getName(), targetNode.folder);
          if (!config.DRY_RUN) {
            sourceFile.setName(newName);
            sourceFile.moveTo(targetNode.folder);
          }
          stats.filesRenamed++;
          Logger.log(`${getTimestamp()}      📝 ${config.DRY_RUN ? 'Would rename' : 'Renamed'}: ${sourceFile.getName()} → ${newName} (${conflict.reason})`);
          break;

        case 'ERROR':
          Logger.log(`${getTimestamp()}      ❌ Error resolving conflict: ${sourceFile.getName()} (${conflict.reason})`);
          break;
      }
    }
  }

  return stats;
}

/**
 * Resolves conflict when two files have the same name
 * Uses MD5 comparison and duplication window logic
 */
function resolveFileConflict(
  existingFile: GoogleAppsScript.Drive.File,
  incomingFile: GoogleAppsScript.Drive.File,
  config: RuntimeConfig
): FileConflictResolution {

  // 1. Get MD5 of both files
  const existingMd5 = getMd5Checksum(existingFile);
  const incomingMd5 = getMd5Checksum(incomingFile);

  // 2. If either has no MD5 (Google Docs, etc), rename incoming
  if (!existingMd5 || !incomingMd5) {
    return {
      existingFile,
      incomingFile,
      existingMd5,
      incomingMd5,
      resolution: 'RENAME_INCOMING',
      reason: 'no MD5 available'
    };
  }

  // 3. Different MD5 = different files → rename
  if (existingMd5 !== incomingMd5) {
    return {
      existingFile,
      incomingFile,
      existingMd5,
      incomingMd5,
      resolution: 'RENAME_INCOMING',
      reason: 'different content'
    };
  }

  // 4. Same MD5 = duplicates → apply duplication window
  const existingCreated = existingFile.getDateCreated().getTime();
  const incomingCreated = incomingFile.getDateCreated().getTime();
  const timeDiff = Math.abs(incomingCreated - existingCreated);

  if (timeDiff > config.DUPLICATION_WINDOW_MS) {
    // Outside window → intentional copies → rename
    return {
      existingFile,
      incomingFile,
      existingMd5,
      incomingMd5,
      resolution: 'RENAME_INCOMING',
      reason: `same MD5 but outside ${config.DUPLICATION_WINDOW_HOURS}h window`
    };
  }

  // 5. Within window → true duplicate → keep oldest
  if (existingCreated <= incomingCreated) {
    return {
      existingFile,
      incomingFile,
      existingMd5,
      incomingMd5,
      resolution: 'KEEP_EXISTING',
      reason: 'same MD5, existing is older'
    };
  } else {
    return {
      existingFile,
      incomingFile,
      existingMd5,
      incomingMd5,
      resolution: 'KEEP_INCOMING',
      reason: 'same MD5, incoming is older'
    };
  }
}

/**
 * Generates unique filename by adding (2), (3), etc.
 */
function generateUniqueName(
  baseName: string,
  targetFolder: GoogleAppsScript.Drive.Folder
): string {

  // Split name and extension
  const lastDot = baseName.lastIndexOf('.');
  let name: string;
  let ext: string;

  if (lastDot > 0) {
    name = baseName.substring(0, lastDot);
    ext = baseName.substring(lastDot);
  } else {
    name = baseName;
    ext = '';
  }

  let counter = 2;
  let newName = `${name} (${counter})${ext}`;

  while (targetFolder.getFilesByName(newName).hasNext()) {
    counter++;
    newName = `${name} (${counter})${ext}`;
  }

  return newName;
}

/**
 * Checks if folder is empty (no files, no subfolders)
 */
function isFolderEmpty(folder: GoogleAppsScript.Drive.Folder): boolean {
  return !folder.getFiles().hasNext() && !folder.getFolders().hasNext();
}

/**
 * Counts files recursively in a folder
 */
function countFilesRecursive(folder: GoogleAppsScript.Drive.Folder): number {
  let count = 0;

  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next();
    count++;
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    count += countFilesRecursive(subFolders.next());
  }

  return count;
}

/**
 * Gets MD5 checksum of a file (reuses Drive API)
 */
function getMd5Checksum(file: GoogleAppsScript.Drive.File): string | null {
  try {
    const metadata = Drive.Files!.get(file.getId(), {
      fields: 'md5Checksum',
      supportsAllDrives: true
    });
    return metadata.md5Checksum || null;
  } catch (e: any) {
    return null;
  }
}
