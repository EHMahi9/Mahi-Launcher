export interface DriveInfo {
  letter: string;
  path: string;
  volumeLabel: string;
  fileSystem: string;
  driveType: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercentage: number;
  isReady: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size?: number | null;
  modifiedDate?: number | null;
  extension?: string | null;
  fileType: string;
}

export interface DirectoryResult {
  path: string;
  parentPath?: string | null;
  entries: FileEntry[];
  totalCount: number;
  dirCount: number;
  fileCount: number;
}

export interface UserLocations {
  desktop: string;
  downloads: string;
  documents: string;
  pictures: string;
  userProfile: string;
}

export interface FileOperationResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  errors: string[];
  affectedPaths: string[];
}

export interface DetailedProperties {
  name: string;
  path: string;
  location: string;
  fileType: string;
  isDirectory: boolean;
  size?: number | null;
  createdDate?: number | null;
  modifiedDate?: number | null;
  accessedDate?: number | null;
  itemCount?: number | null;
  isReadOnly: boolean;
  isHidden: boolean;
}

export type ClipboardOperation = 'copy' | 'cut';

export interface ClipboardState {
  items: string[];
  operation: ClipboardOperation;
}

export interface TextPreviewResult {
  content: string;
  totalBytes: number;
  isTruncated: boolean;
  lineCount: number;
  language: string;
}

export interface ImagePreviewResult {
  dataUrl: string;
  mimeType: string;
  size: number;
}

export interface SystemClipboardFiles {
  paths: string[];
  isCut: boolean;
}


