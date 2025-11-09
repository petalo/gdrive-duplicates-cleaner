/**
 * Utility functions for file and folder operations
 */

/**
 * Returns a formatted timestamp for logging
 * @returns Timestamp string in format [YYYY-MM-DD HH:MM:SS]
 */
function getTimestamp(): string {
  return '[' + new Date().toLocaleString() + ']';
}

/**
 * Extracts the file extension from a filename
 * @param filename The name of the file
 * @returns The lowercase file extension without the dot
 */
function getFileExtension(filename: string): string {
  return filename
    .slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2)
    .toLowerCase();
}

/**
 * Checks if a folder should be excluded from processing
 * Recursively checks if the folder or any of its parents are in the exclusion list
 * @param folder The folder to check
 * @param excludedFolderIds Array of folder IDs to exclude
 * @returns True if the folder should be excluded
 */
function isFolderExcluded(folder: GoogleAppsScript.Drive.Folder, excludedFolderIds: string[]): boolean {
  if (excludedFolderIds.length === 0) {
    return false;
  }

  const folderId = folder.getId();

  // Check if this folder is directly excluded
  if (excludedFolderIds.includes(folderId)) {
    return true;
  }

  // Check if any parent folder is excluded (recursive check)
  let current = folder;
  while (true) {
    const parents = current.getParents();
    if (!parents.hasNext()) {
      break;
    }

    current = parents.next();
    if (excludedFolderIds.includes(current.getId())) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a file should be excluded based on its extension
 * @param file The file to check
 * @param excludedExtensions Array of extensions to exclude
 * @returns True if the file should be excluded
 */
function isFileExcluded(file: GoogleAppsScript.Drive.File, excludedExtensions: string[]): boolean {
  if (excludedExtensions.length === 0) {
    return false;
  }

  const extension = getFileExtension(file.getName());
  return excludedExtensions.includes(extension);
}

/**
 * Formats bytes to human-readable format
 * @param bytes Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats milliseconds to human-readable duration
 * @param ms Duration in milliseconds
 * @returns Formatted string (e.g., "2m 30s")
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
