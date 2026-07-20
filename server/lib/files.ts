import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from 'crypto';
import { getGlobalConfig } from "../routerTrpc/config";
import { UPLOAD_FILE_PATH, TEMP_PATH } from "@shared/lib/pathConstant";
import fs, { unlink, writeFile } from 'fs/promises';
import path from 'path';
import { cache } from "@shared/lib/cache";
import { prisma } from "../prisma";
import { Readable } from 'stream';
import { Upload } from "@aws-sdk/lib-storage";
import { PassThrough } from 'stream';
import { createWriteStream } from "fs";
import pathIsInside from 'path-is-inside';
import sanitizeFilename from 'sanitize-filename';
import { attachmentPortableIdFromPath, stableAttachmentPath } from './attachmentPaths';

/**
 * Sanitize a filename for safe filesystem storage.
 * Removes control characters, reserved characters, truncates to safe length,
 * and replaces whitespace with underscores.
 */
export function sanitizeUploadFileName(name: string): string {
  let sanitized = name
    // Replace whitespace (including tabs) with underscores BEFORE removing control chars
    .replace(/\s+/g, '_')
    // Remove control characters (0x00-0x1f, 0x7f, 0x80-0x9f)
    .replace(/[\x00-\x1f\x7f\x80-\x9f]/g, '')
    // Replace reserved filesystem characters
    .replace(/[<>:"/\\|?*]/g, '_')
    // Collapse consecutive dots to single dot (prevents path traversal false positives)
    .replace(/\.{2,}/g, '.')
    // Collapse multiple consecutive underscores
    .replace(/_+/g, '_')
    // Remove leading/trailing dots, spaces, and underscores
    .replace(/^[.\s_]+|[.\s_]+$/g, '');

  // Truncate to 200 characters to stay well under filesystem limits (255)
  // while leaving room for timestamp suffix and extension
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  // Fallback if the name is empty after sanitization
  if (!sanitized) {
    sanitized = 'unnamed_file';
  }

  return sanitized;
}

/** Keep the readable stem while making collisions effectively impossible. */
export function buildStoredFileName(originalName: string): string {
  const truncateUtf8 = (value: string, maxBytes: number) => {
    let output = '';
    for (const character of value) {
      if (Buffer.byteLength(output + character, 'utf8') > maxBytes) break;
      output += character;
    }
    return output;
  };
  const rawExtension = path.extname(originalName);
  const extensionBody = rawExtension
    ? truncateUtf8(sanitizeUploadFileName(rawExtension.slice(1)).replace(/\./g, '_'), 24)
    : '';
  const extension = extensionBody ? `.${extensionBody}` : '';
  const rawBaseName = path.basename(originalName, rawExtension);
  const baseName = truncateUtf8(sanitizeUploadFileName(rawBaseName), 170) || 'attachment';
  return `${baseName}-${randomUUID()}${extension}`;
}

export function attachmentStorageProvider(filePath: string): 'local' | 's3' {
  return filePath.startsWith('/api/s3file/') ? 's3' : 'local';
}

export class FileService {
  /** Resolve a provider-neutral attachment URL to its current physical path. */
  static async resolveStoredPath(filePath: string): Promise<string> {
    const portableId = attachmentPortableIdFromPath(filePath);
    if (!portableId) return filePath.split('?')[0]!;
    const attachment = await prisma.attachments.findUnique({
      where: { portableId },
      select: { path: true },
    });
    if (!attachment) throw new Error('Attachment not found');
    return attachment.path;
  }

  /**
   * Validates and sanitizes a file path to prevent path traversal attacks
   * @param inputPath - The input path to validate (relative path from API endpoint)
   * @param baseDir - The base directory that the path must be within (default: UPLOAD_FILE_PATH)
   * @param allowTemp - Whether to allow paths in the temp directory
   * @returns The validated and sanitized absolute file path
   * @throws Error if the path is invalid or outside the allowed directory
   */
  public static validateAndResolvePath(
    inputPath: string,
    baseDir: string = UPLOAD_FILE_PATH,
    allowTemp: boolean = false
  ): string {
    // Check for path traversal attempts
    if (inputPath.includes('..') || inputPath.includes('\\..') || inputPath.includes('/..')) {
      throw new Error('Invalid path: path traversal detected');
    }

    // Sanitize each path component (filename) separately
    const pathParts = inputPath.split(/[/\\]/);
    const sanitizedParts = pathParts.map(part => {
      if (part === '' || part === '.') return part;
      return sanitizeFilename(part, { replacement: '_' });
    });
    const sanitizedPath = sanitizedParts.join('/');
    
    // Check if sanitization changed the path (indicates dangerous characters)
    if (sanitizedPath !== inputPath.replace(/\\/g, '/')) {
      throw new Error('Invalid path: contains dangerous characters');
    }

    // Remove leading slashes and normalize
    const cleanedPath = sanitizedPath.replace(/^[./\\]+/, '');
    const resolvedBaseDir = path.resolve(baseDir);
    const resolvedFilePath = path.resolve(baseDir, cleanedPath);

    // Validate path is within allowed directory
    if (!pathIsInside(resolvedFilePath, resolvedBaseDir)) {
      throw new Error('Invalid path: outside allowed directory');
    }

    // For temp/ paths, ensure they are within the temp directory
    if (cleanedPath.includes('temp/') || cleanedPath.startsWith('temp/')) {
      if (!allowTemp) {
        throw new Error('Invalid path: temp directory access not allowed');
      }
      const resolvedTempDir = path.resolve(TEMP_PATH);
      if (!pathIsInside(resolvedFilePath, resolvedTempDir)) {
        throw new Error('Invalid path: temp path outside temp directory');
      }
    }

    return resolvedFilePath;
  }

  /**
   * Extracts and validates file path from API path
   * @param apiPath - API path like '/api/file/path/to/file.jpg' or '/api/s3file/path/to/file.jpg'
   * @param baseDir - Base directory for validation
   * @param allowTemp - Whether to allow temp directory access
   * @returns The validated absolute file path
   */
  public static extractAndValidatePath(
    apiPath: string,
    baseDir: string = UPLOAD_FILE_PATH,
    allowTemp: boolean = false
  ): string {
    let filePath = apiPath;
    if (apiPath.includes('/api/file/')) {
      filePath = apiPath.replace('/api/file/', '');
    } else if (apiPath.includes('/api/s3file/')) {
      // For S3 files, we only validate the path structure, not the actual file location
      filePath = apiPath.replace('/api/s3file/', '');
      // Basic validation for S3 paths
      if (filePath.includes('..') || filePath.includes('\\..') || filePath.includes('/..')) {
        throw new Error('Invalid S3 path: path traversal detected');
      }
      return filePath; // Return relative path for S3
    }

    return this.validateAndResolvePath(filePath, baseDir, allowTemp);
  }
  
  public static async getS3Client() {
    const config = await getGlobalConfig({ useAdmin: true });
    return cache.wrap(`${config.s3Endpoint}-${config.s3Region}-${config.s3Bucket}-${config.s3AccessKeyId}-${config.s3AccessKeySecret}-${config.s3ForcePathStyle !== false}`, async () => {
      const s3ClientInstance = new S3Client({
        ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
        region: config.s3Region,
        ...(config.s3AccessKeyId && config.s3AccessKeySecret ? {
          credentials: {
            accessKeyId: config.s3AccessKeyId,
            secretAccessKey: config.s3AccessKeySecret,
          },
        } : {}),
        forcePathStyle: config.s3ForcePathStyle !== false,
      });
      return { s3ClientInstance, config };
    }, { ttl: 60 * 60 * 86400 * 1000 })
  }

  private static async writeFileSafe(baseName: string, extension: string, buffer: Buffer, attempt: number = 0) {
    const MAX_ATTEMPTS = 20;
    const config = await getGlobalConfig({ useAdmin: true });

    if (attempt >= MAX_ATTEMPTS) {
      throw new Error('MAX_ATTEMPTS_REACHED');
    }

    const sanitizeFileName = (name: string) => {
      try {
        const decodedName = decodeURIComponent(name);
        return decodedName
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_');
      } catch (error) {
        return name
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_');
      }
    };

    let filename = attempt === 0 ?
      `${sanitizeFileName(baseName)}${extension}` :
      `${sanitizeFileName(baseName)}_${Date.now()}${extension}`;

    let customPath = config.localCustomPath || '/';
    if (customPath) {
      customPath = customPath.startsWith('/') ? customPath : '/' + customPath;
      customPath = customPath.endsWith('/') ? customPath : customPath + '/';
    }

    try {
      const relativePath = `${customPath}${filename}`.replace(/^\//, '');
      const filePath = this.validateAndResolvePath(relativePath);
      await fs.access(filePath);
      return this.writeFileSafe(baseName, extension, buffer, attempt + 1);
    } catch (error) {
      const relativePath = `${customPath}${filename}`.replace(/^\//, '');
      const filePath = this.validateAndResolvePath(relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        //@ts-ignore
        await writeFile(filePath, buffer);
      } catch (error) {
        console.error('Error writing file:', error);
        throw error;
      }
      return relativePath;
    }
  }

  static async uploadFile({
    buffer, originalName, type, withOutAttachment = false, accountId, metadata
  }: {
    buffer: Buffer, originalName: string, type: string, withOutAttachment?: boolean, accountId: number, metadata?: any
  }) {
    const extension = path.extname(originalName);
    const rawBaseName = path.basename(originalName, extension);
    const baseName = sanitizeUploadFileName(rawBaseName);
    const displayName = `${baseName}${extension}`;
    const storedFileName = buildStoredFileName(originalName);
    const config = await getGlobalConfig({ useAdmin: true });

    if (config.objectStorage === 's3') {
      const { s3ClientInstance } = await this.getS3Client();

      let customPath = config.s3CustomPath || '';
      if (customPath) {
        customPath = customPath.startsWith('/') ? customPath : '/' + customPath;
        customPath = customPath.endsWith('/') ? customPath : customPath + '/';
      }

      const s3Key = `${customPath}${storedFileName}`.replace(/^\//, '');

      const command = new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: type || 'application/octet-stream',
      });

      await s3ClientInstance.send(command);
      const s3Url = `/api/s3file/${s3Key}`;
      let publicPath = s3Url;
      if (!withOutAttachment) {
        const attachment = await FileService.createAttachment({
          path: s3Url,
          name: displayName,
          size: buffer.length,
          type,
          accountId,
          metadata
        });
        publicPath = stableAttachmentPath(attachment.portableId);
      }
      return { filePath: publicPath, storedPath: s3Url, fileName: displayName };
    } else {
      const storedExtension = path.extname(storedFileName);
      const filename = await this.writeFileSafe(path.basename(storedFileName, storedExtension), storedExtension, buffer);
      const storedPath = `/api/file/${filename}`;
      let publicPath = storedPath;
      if (!withOutAttachment) {
        const attachment = await FileService.createAttachment({
          path: storedPath,
          name: displayName,
          size: buffer.length,
          type,
          accountId,
          metadata
        });
        publicPath = stableAttachmentPath(attachment.portableId);
      }
      return { filePath: publicPath, storedPath, fileName: displayName };
    }
  }

  static getOriginFilename(name: string) {
    const match = name.match(/-[^-]+(\.[^.]+)$/);
    return match ? match[0].substring(1) : name;
  }

  static async deleteFile(api_attachment_path: string) {
    const storedPath = await this.resolveStoredPath(api_attachment_path);
    await this.deleteStoredObject(storedPath);
    const portableId = attachmentPortableIdFromPath(api_attachment_path);
    const attachmentPath = await prisma.attachments.findFirst({
      where: portableId ? { portableId } : { path: storedPath },
    });
    if (attachmentPath) {
      await prisma.attachments.delete({ where: { id: attachmentPath.id } });
    }
  }

  /** Delete only the binary object, leaving its PostgreSQL metadata untouched. */
  static async deleteStoredObject(filePath: string) {
    const storedPath = await this.resolveStoredPath(filePath);
    if (attachmentStorageProvider(storedPath) === 's3') {
      const config = await getGlobalConfig({ useAdmin: true });
      const { s3ClientInstance } = await this.getS3Client();
      await s3ClientInstance.send(new DeleteObjectCommand({
        Bucket: config.s3Bucket,
        Key: this.extractAndValidatePath(storedPath),
      }));
      return;
    }
    await unlink(this.extractAndValidatePath(storedPath));
  }

  static async getStoredObjectSize(filePath: string): Promise<number> {
    const storedPath = await this.resolveStoredPath(filePath);
    if (attachmentStorageProvider(storedPath) === 's3') {
      const config = await getGlobalConfig({ useAdmin: true });
      const { s3ClientInstance } = await this.getS3Client();
      const result = await s3ClientInstance.send(new HeadObjectCommand({
        Bucket: config.s3Bucket,
        Key: this.extractAndValidatePath(storedPath),
      }));
      return Number(result.ContentLength ?? 0);
    }
    return (await fs.stat(this.extractAndValidatePath(storedPath))).size;
  }


  /**
   * Get file buffer from S3 or local storage without creating temporary files
   */
  static async getFileBuffer(filePath: string): Promise<Buffer> {
    const storedPath = await this.resolveStoredPath(filePath);
    if (attachmentStorageProvider(storedPath) === 's3') {
      const config = await getGlobalConfig({ useAdmin: true });
      const { s3ClientInstance } = await this.getS3Client();
      const fileName = this.extractAndValidatePath(storedPath);
      const command = new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: fileName,
      });

      const response = await s3ClientInstance.send(command);
      const chunks: any[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } else {
      const localPath = this.extractAndValidatePath(storedPath);
      return await fs.readFile(localPath);
    }
  }

  /**
   * Get temporary file path (creates local copy for S3 files)
   * WARNING: This method creates temporary files for S3 storage. Use getFileBuffer() when possible.
   * Remember to clean up the returned path for S3 files after use.
   */
  static async getFile(filePath: string): Promise<{ path: string; isTemporary: boolean; cleanup?: () => Promise<void> }> {
    const storedPath = await this.resolveStoredPath(filePath);
    if (attachmentStorageProvider(storedPath) === 's3') {
      const fileName = this.extractAndValidatePath(storedPath);
      const tempFileName = `${Date.now()}_${path.basename(fileName)}`;
      const tempPath = this.validateAndResolvePath(`temp/${tempFileName}`, UPLOAD_FILE_PATH, true);
      await fs.mkdir(path.dirname(tempPath), { recursive: true });

      const buffer = await this.getFileBuffer(storedPath);
      await fs.writeFile(tempPath, new Uint8Array(buffer));

      return {
        path: tempPath,
        isTemporary: true,
        cleanup: async () => {
          try {
            await fs.unlink(tempPath);
            // Try to remove temp directory if empty
            try {
              await fs.rmdir(path.dirname(tempPath));
            } catch {
              // Ignore if directory is not empty
            }
          } catch (error) {
            console.warn('Failed to cleanup temporary file:', tempPath, error);
          }
        }
      };
    } else {
      return {
        path: this.extractAndValidatePath(storedPath),
        isTemporary: false
      };
    }
  }

  static async uploadFileStream(
    {
      stream, originalName, fileSize, type, accountId = null, metadata
    }: {
      stream: ReadableStream, originalName: string, fileSize: number, type: string, accountId?: number | null, metadata?: any
    }) {
    const config = await getGlobalConfig({ useAdmin: true });
    const extension = path.extname(originalName);
    const rawBaseName = path.basename(originalName, extension);
    const baseName = sanitizeUploadFileName(rawBaseName);
    const displayName = `${baseName}${extension}`;
    const storedFileName = buildStoredFileName(originalName);

    try {
      if (config.objectStorage === 's3') {
        const { s3ClientInstance } = await this.getS3Client();

        let customPath = config.s3CustomPath || '';
        if (customPath) {
          customPath = customPath.startsWith('/') ? customPath : '/' + customPath;
          customPath = customPath.endsWith('/') ? customPath : customPath + '/';
        }

        const s3Key = `${customPath}${storedFileName}`.replace(/^\//, '');

        const passThrough = new PassThrough();
        const nodeReadable = Readable.fromWeb(stream as any);
        
        // Setup proper error handling
        nodeReadable.on('error', (err) => {
          passThrough.destroy(err);
        });

        nodeReadable.pipe(passThrough);

        const upload = new Upload({
          client: s3ClientInstance as any,
          params: {
            Bucket: config.s3Bucket,
            Key: s3Key,
            Body: passThrough,
            ContentType: type || 'application/octet-stream',
          },
        });

        try {
          await upload.done();
        } catch (error) {
          // Ensure streams are destroyed on error
          passThrough.destroy();
          nodeReadable.destroy();
          throw error;
        }
        
        // Explicitly destroy streams after upload completes
        passThrough.destroy();
        nodeReadable.destroy();
        
        const s3Url = `/api/s3file/${s3Key}`;

        const attachment = await FileService.createAttachment({
          path: s3Url,
          name: displayName,
          size: fileSize,
          type,
          accountId,
          metadata
        });
        return { filePath: stableAttachmentPath(attachment.portableId), storedPath: s3Url, fileName: displayName };

      } else {
        let customPath = config.localCustomPath || '';
        if (customPath) {
          customPath = customPath.startsWith('/') ? customPath : '/' + customPath;
          customPath = customPath.endsWith('/') ? customPath : customPath + '/';
        }

        const relativePath = `${customPath}${storedFileName}`.replace(/^\//, '');
        const fullPath = this.validateAndResolvePath(relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        const writeStream = createWriteStream(fullPath);
        const nodeReadable = Readable.fromWeb(stream as any);

        // Setup proper error handling
        nodeReadable.on('error', (err) => {
          writeStream.destroy(err);
        });
        
        writeStream.on('error', (err) => {
          nodeReadable.destroy();
          throw err;
        });

        await new Promise((resolve, reject) => {
          nodeReadable.pipe(writeStream)
            .on('finish', () => {
              // Ensure writeStream is properly closed
              writeStream.end();
              resolve(null);
            })
            .on('error', (err) => {
              // Clean up both streams on error
              writeStream.destroy();
              nodeReadable.destroy();
              reject(err);
            });
        });
        const storedPath = `/api/file/${relativePath}`;
        const attachment = await FileService.createAttachment({
          path: storedPath,
          name: displayName,
          size: fileSize,
          type,
          noteId: null,
          accountId,
          metadata
        });
        return {
          filePath: stableAttachmentPath(attachment.portableId),
          storedPath,
          fileName: displayName
        };
      }
    } catch (error) {
      console.error('Failed to upload file stream:', error);
      throw error;
    }
  }

  // path: /api/file/123/456/789.jpg
  static async createAttachment({
    path, name, size, type, noteId, accountId = null, metadata
  }: {
    path: string, name: string, size: number, type: string, noteId?: number | null, accountId?: number | null, metadata?: any
  }) {
    const pathParts = (path as string)
      .replace('/api/file/', '')
      .replace('/api/s3file/', '')
      .split('/');

    const prefixPath = pathParts.slice(0, -1).join(',');

    return prisma.attachments.create({
      data: {
        path,
        name,
        size,
        type,
        depth: pathParts.length - 1,
        perfixPath: prefixPath.startsWith(',') ? prefixPath.substring(1) : prefixPath,
        ...(noteId ? { noteId } : {}),
        accountId,
        ...(metadata ? { metadata } : {})
      }
    })
  }

  static async renameFile(oldPath: string, newName: string) {
    const config = await getGlobalConfig({ useAdmin: true });

    await prisma.$transaction(async (prisma) => {
      if (oldPath.includes('/api/s3file/')) {
        const { s3ClientInstance } = await this.getS3Client();
        const oldKey = oldPath.replace('/api/s3file/', '');
        const dirPath = path.dirname(oldKey);

        const normalizedDirPath = dirPath === '.' ? '' : dirPath.replace(/\\/g, '/');
        const normalizedNewName = newName.replace(/\\/g, '/');
        const newKey = normalizedDirPath ? `${normalizedDirPath}/${normalizedNewName}` : normalizedNewName;

        try {
          await s3ClientInstance.send(new CopyObjectCommand({
            Bucket: config.s3Bucket,
            CopySource: encodeURIComponent(`${config.s3Bucket}/${decodeURIComponent(oldKey)}`),
            Key: decodeURIComponent(newKey)
          }));

          await s3ClientInstance.send(new DeleteObjectCommand({
            Bucket: config.s3Bucket,
            Key: decodeURIComponent(oldKey)
          }));
        } catch (error) {
          console.error('S3 rename operation failed:', error);
          throw new Error(`Failed to rename file in S3: ${error.message}`);
        }
      } else {
        const oldFilePath = this.extractAndValidatePath(oldPath);
        const sanitizedNewName = sanitizeFilename(newName, { replacement: '_' });
        if (sanitizedNewName !== newName) {
          throw new Error('Invalid new filename: contains dangerous characters');
        }
        const newFilePath = path.join(path.dirname(oldFilePath), sanitizedNewName);
        
        // Validate the new path is still within allowed directory
        const resolvedBaseDir = path.resolve(UPLOAD_FILE_PATH);
        const resolvedNewPath = path.resolve(newFilePath);
        if (!pathIsInside(resolvedNewPath, resolvedBaseDir)) {
          throw new Error('Invalid new path: outside allowed directory');
        }

        await fs.rename(oldFilePath, newFilePath);
      }
    });
  }

  static async moveFile(oldPath: string, newPath: string) {
    const config = await getGlobalConfig({ useAdmin: true });

    if (oldPath.includes('/api/s3file/')) {
      const { s3ClientInstance } = await this.getS3Client();
      const oldKey = oldPath.replace('/api/s3file/', '');
      let newKey = newPath.replace('/api/s3file/', '');

      if (newKey.startsWith('/')) {
        newKey = newKey.substring(1);
      }

      try {
        await s3ClientInstance.send(new GetObjectCommand({
          Bucket: config.s3Bucket,
          Key: decodeURIComponent(oldKey)
        }));
      } catch (error) {
        console.error('Source file check failed:', error);
        throw new Error(`Source file does not exist: ${decodeURIComponent(oldKey)}`);
      }

      try {
        await s3ClientInstance.send(new CopyObjectCommand({
          Bucket: config.s3Bucket,
          CopySource: encodeURIComponent(`${config.s3Bucket}/${decodeURIComponent(oldKey)}`),
          Key: decodeURIComponent(newKey)
        }));

        await s3ClientInstance.send(new DeleteObjectCommand({
          Bucket: config.s3Bucket,
          Key: decodeURIComponent(oldKey)
        }));
      } catch (error) {
        console.error('S3 operation failed:', error);
        throw new Error(`Failed to move file in S3: ${error.message}`);
      }
    } else {
      const oldFilePath = this.extractAndValidatePath(oldPath);
      const newFilePath = this.extractAndValidatePath(newPath);

      await fs.mkdir(path.dirname(newFilePath), { recursive: true });
      await fs.rename(oldFilePath, newFilePath);

      try {
        const oldDir = path.dirname(oldFilePath);
        const files = await fs.readdir(oldDir);

        if (files.length === 0) {
          await fs.rmdir(oldDir);

          let parentDir = path.dirname(oldDir);
          const uploadPath = path.join(UPLOAD_FILE_PATH);
          while (parentDir !== uploadPath) {
            const parentFiles = await fs.readdir(parentDir);
            if (parentFiles.length === 0) {
              await fs.rmdir(parentDir);
              parentDir = path.dirname(parentDir);
            } else {
              break;
            }
          }
        }
      } catch (error) {
        console.error('Failed to cleanup old directories:', error);
      }
    }
  }
}
