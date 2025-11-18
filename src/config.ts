/**
 * Configuration interface for the Drive Duplicate Cleaner
 */
interface Config {
  ROOT_FOLDER_IDS: string[];
  DUPLICATION_WINDOW_HOURS: number;
  MAX_EXECUTION_TIME_SECONDS: number;
  EXCLUDED_FOLDER_IDS: string[];
  EXCLUDED_EXTENSIONS: string[];
  FOLDER_SORT_MODE: 'LAST_UPDATED' | 'RANDOM';
  FILE_AGE_FILTER_DAYS: number;
  MERGE_DUPLICATE_FOLDERS: boolean;
  MERGE_FOLDERS_RECURSIVE: boolean;
  MERGE_KEEP_FOLDER_STRATEGY: 'OLDEST' | 'NEWEST' | 'MOST_FILES';
  DRY_RUN: boolean;
}

/**
 * Extended configuration with computed values
 */
interface RuntimeConfig extends Config {
  DUPLICATION_WINDOW_MS: number;
  MAX_EXECUTION_TIME_MS: number;
  FILE_AGE_FILTER_MS: number;
}

/**
 * Retrieves configuration from Script Properties
 * @returns Runtime configuration object
 */
function getConfig(): RuntimeConfig {
  const props = PropertiesService.getScriptProperties();

  const config: Config = {
    ROOT_FOLDER_IDS: JSON.parse(props.getProperty('ROOT_FOLDER_IDS') || '[]'),
    DUPLICATION_WINDOW_HOURS: parseFloat(props.getProperty('DUPLICATION_WINDOW_HOURS') || '24'),
    MAX_EXECUTION_TIME_SECONDS: parseFloat(props.getProperty('MAX_EXECUTION_TIME_SECONDS') || '300'),
    EXCLUDED_FOLDER_IDS: JSON.parse(props.getProperty('EXCLUDED_FOLDER_IDS') || '[]'),
    EXCLUDED_EXTENSIONS: JSON.parse(props.getProperty('EXCLUDED_EXTENSIONS') || '[]'),
    FOLDER_SORT_MODE: (props.getProperty('FOLDER_SORT_MODE') || 'LAST_UPDATED') as 'LAST_UPDATED' | 'RANDOM',
    FILE_AGE_FILTER_DAYS: parseFloat(props.getProperty('FILE_AGE_FILTER_DAYS') || '0'),
    MERGE_DUPLICATE_FOLDERS: props.getProperty('MERGE_DUPLICATE_FOLDERS') === 'true',
    MERGE_FOLDERS_RECURSIVE: props.getProperty('MERGE_FOLDERS_RECURSIVE') !== 'false',
    MERGE_KEEP_FOLDER_STRATEGY: (props.getProperty('MERGE_KEEP_FOLDER_STRATEGY') || 'OLDEST') as 'OLDEST' | 'NEWEST' | 'MOST_FILES',
    DRY_RUN: props.getProperty('DRY_RUN') === 'true'
  };

  // Validate required fields
  if (config.ROOT_FOLDER_IDS.length === 0) {
    throw new Error('ROOT_FOLDER_IDS is empty. Please run setupConfig() first.');
  }

  // Compute derived values
  const runtimeConfig: RuntimeConfig = {
    ...config,
    DUPLICATION_WINDOW_MS: config.DUPLICATION_WINDOW_HOURS * 60 * 60 * 1000,
    MAX_EXECUTION_TIME_MS: config.MAX_EXECUTION_TIME_SECONDS * 1000,
    FILE_AGE_FILTER_MS: config.FILE_AGE_FILTER_DAYS * 24 * 60 * 60 * 1000
  };

  return runtimeConfig;
}
