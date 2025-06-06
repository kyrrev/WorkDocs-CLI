import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { AppConfig } from '../config/environment';

export interface ProcessedFile {
  employeeId: string;
  filename: string;
  fullPath: string;
  fileContent: string; // Base64 encoded
  size: number;
  isValid: boolean;
  error?: string;
}

export class FileProcessor {
  constructor(private config: AppConfig) {}
  
  async getFilesToProcess(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.config.inputDir);
      const allFiles = files.filter(file => !file.startsWith('.'));
      
      logger.info(`Found ${allFiles.length} files to process`, { 
        inputDir: this.config.inputDir 
      });
      
      return allFiles.map(file => path.join(this.config.inputDir, file));
    } catch (error) {
      logger.error('Failed to read input directory', { 
        inputDir: this.config.inputDir,
        error 
      });
      throw new Error('Cannot read input directory. Check that the directory exists and you have read permissions.');
    }
  }
  
  async processFile(filePath: string): Promise<ProcessedFile> {
    const filename = path.basename(filePath);
    
    try {
      // Validate filename format and security
      const filenameValidation = this.validateFilename(filename);
      if (!filenameValidation.isValid) {
        return {
          employeeId: '',
          filename,
          fullPath: filePath,
          fileContent: '',
          size: 0,
          isValid: false,
          error: filenameValidation.error || 'Invalid filename format'
        };
      }

      // Extract employee ID from filename
      const employeeId = this.extractEmployeeId(filename);
      if (!employeeId) {
        return {
          employeeId: '',
          filename,
          fullPath: filePath,
          fileContent: '',
          size: 0,
          isValid: false,
          error: 'Invalid employee ID format. Must be 4-12 digits'
        };
      }
      
      // Get file stats
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      // Validate file size
      if (fileSizeMB > this.config.maxFileSizeMB) {
        return {
          employeeId,
          filename,
          fullPath: filePath,
          fileContent: '',
          size: stats.size,
          isValid: false,
          error: `File size (${fileSizeMB.toFixed(2)}MB) exceeds maximum allowed size (${this.config.maxFileSizeMB}MB)`
        };
      }
      
      // Read and encode file content
      const fileBuffer = await fs.readFile(filePath);
      const fileContent = fileBuffer.toString('base64');
      
      // Note: File type validation removed to allow all file types
      
      logger.debug('File processed successfully', { 
        filename,
        employeeId,
        size: stats.size
      });
      
      return {
        employeeId,
        filename,
        fullPath: filePath,
        fileContent,
        size: stats.size,
        isValid: true
      };
    } catch (error) {
      logger.error('File processing failed', { filename, error });
      
      return {
        employeeId: '',
        filename,
        fullPath: filePath,
        fileContent: '',
        size: 0,
        isValid: false,
        error: `File processing error: ${error}`
      };
    }
  }
  
  async moveToProcessed(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const destinationPath = path.join(this.config.processedDir, filename);
    
    try {
      // Ensure processed directory exists
      await this.ensureDirectoryExists(this.config.processedDir);
      
      // Move file to processed directory
      await fs.rename(filePath, destinationPath);
      
      logger.info('File moved to processed directory', { 
        filename,
        destination: destinationPath
      });
    } catch (error) {
      logger.error('Failed to move file to processed directory', { 
        filename,
        error 
      });
      throw error;
    }
  }
  
  async moveToFailed(filePath: string, reason: string): Promise<void> {
    const filename = path.basename(filePath);
    const destinationPath = path.join(this.config.failedDir, filename);
    
    try {
      // Ensure failed directory exists
      await this.ensureDirectoryExists(this.config.failedDir);
      
      // Move file to failed directory
      await fs.rename(filePath, destinationPath);
      
      // Create error log file
      const errorLogPath = path.join(this.config.failedDir, `${filename}.error.txt`);
      await fs.writeFile(errorLogPath, `Failed at: ${new Date().toISOString()}\nReason: ${reason}\n`);
      
      logger.warn('File moved to failed directory', { 
        filename,
        reason,
        destination: destinationPath
      });
    } catch (error) {
      logger.error('Failed to move file to failed directory', { 
        filename,
        error 
      });
      throw error;
    }
  }
  
  private extractEmployeeId(filename: string): string | null {
    // Extract employee ID from filename pattern: {employeeId}-{filename}.{extension}
    const match = filename.match(/^(\d+)-.*\./);
    if (!match) return null;
    
    const employeeId = match[1];
    
    // Validate employee ID format and length
    if (!this.validateEmployeeId(employeeId)) {
      return null;
    }
    
    return employeeId;
  }

  /**
   * Validates employee ID format for security and business rules
   */
  private validateEmployeeId(employeeId: string): boolean {
    // Employee ID should be numeric, between 4-12 digits
    return /^\d{4,12}$/.test(employeeId) && 
           employeeId.length >= 4 && 
           employeeId.length <= 12;
  }

  /**
   * Validates and sanitizes filename for security
   */
  private validateFilename(filename: string): { isValid: boolean; error?: string } {
    // Check for basic filename requirements
    if (!filename || filename.length === 0) {
      return { isValid: false, error: 'Filename is empty' };
    }
    
    // Check filename length (reasonable limit)
    if (filename.length > 255) {
      return { isValid: false, error: 'Filename too long (max 255 characters)' };
    }
    
    // Check for dangerous characters that could cause issues
    const dangerousChars = /[<>:"|?*\x00-\x1f]/;
    if (dangerousChars.test(filename)) {
      return { isValid: false, error: 'Filename contains invalid characters' };
    }
    
    // Check if filename follows expected pattern: {employeeId}-{description}.{ext}
    if (!/^\d+-[^-]+\.[a-zA-Z0-9]+$/.test(filename)) {
      return { isValid: false, error: 'Filename must follow pattern: {employeeId}-{description}.{extension}' };
    }
    
    return { isValid: true };
  }
  
  private isPdfFile(buffer: Buffer): boolean {
    // Check PDF magic number
    return buffer.length >= 4 && 
           buffer[0] === 0x25 && // %
           buffer[1] === 0x50 && // P
           buffer[2] === 0x44 && // D
           buffer[3] === 0x46;   // F
  }
  
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}