import { logger } from '../utils/logger';
import { FileProcessor, ProcessedFile } from './file-processor';
import { WorkdayApiService, WorkerDocument } from './workday-api';
import { OAuthService } from './oauth';
import { documentCategories } from '../config/categories';
import { EnvironmentConfig, WorkdayEnvironment, AppConfig } from '../config/environment';
import { ProgressTracker } from '../ui/progress';
import { promptConfirmation } from '../utils/prompts';

export interface UploadResult {
  filename: string;
  employeeId: string;
  success: boolean;
  error?: string;
  duration: number;
}

export interface UploadStats {
  totalFiles: number;
  successful: number;
  failed: number;
  duration: number;
  results: UploadResult[];
}

export interface ScanResults {
  totalFiles: number;
  uniqueWorkers: number;
}

// Cache for worker validations to avoid redundant API calls
interface WorkerCache {
  [employeeId: string]: {
    workerWid: string;
    validatedAt: Date;
  };
}

export class UploadOrchestrator {
  private fileProcessor: FileProcessor;
  private workdayApi: WorkdayApiService;
  private config: AppConfig;
  private semaphore: Array<Promise<void>> = [];
  private consecutiveFailures = 0;
  private shouldCheckForFailures = true;
  private workerCache: WorkerCache = {};
  private readonly WORKER_CACHE_TTL = 3600000; // 1 hour in milliseconds
  
  constructor(environment: WorkdayEnvironment) {
    this.config = EnvironmentConfig.getInstance().getAppConfig();
    this.fileProcessor = new FileProcessor(this.config);
    const oauthService = new OAuthService(environment);
    this.workdayApi = new WorkdayApiService(environment, oauthService);
  }
  
  async scanFiles(): Promise<ScanResults> {
    const filePaths = await this.fileProcessor.getFilesToProcess();
    
    // Extract unique employee IDs from filenames
    const uniqueWorkers = new Set<string>();
    
    for (const filePath of filePaths) {
      const filename = filePath.split('/').pop() || '';
      // Extract employee ID from filename (format: {employeeId}-{description}.pdf)
      const parts = filename.split('-');
      if (parts.length >= 2) {
        uniqueWorkers.add(parts[0]);
      }
    }
    
    return {
      totalFiles: filePaths.length,
      uniqueWorkers: uniqueWorkers.size
    };
  }
  
  async uploadAllDocuments(categoryWid: string): Promise<UploadStats> {
    const startTime = Date.now();
    
    logger.info('Starting document upload process', {
      environment: this.workdayApi['environment'].name,
      maxConcurrency: this.config.maxConcurrentUploads
    });
    
    try {
      // Pre-fetch OAuth token once before starting concurrent operations
      logger.info('Pre-fetching OAuth token...');
      await this.workdayApi.ensureAuthenticated();
      logger.info('OAuth token obtained successfully');
      
      // Get all files to process
      const filePaths = await this.fileProcessor.getFilesToProcess();
      
      if (filePaths.length === 0) {
        logger.info('No files found to process');
        return {
          totalFiles: 0,
          successful: 0,
          failed: 0,
          duration: Date.now() - startTime,
          results: []
        };
      }
      
      // Get category name for display
      const selectedCategory = documentCategories.find(cat => cat.wid === categoryWid);
      const categoryName = selectedCategory?.name || 'Unknown Category';
      
      // Show upload info
      console.log(`\nUploading ${filePaths.length} worker documents to ${this.workdayApi['environment'].name}`);
      console.log(`Category: ${categoryName}\n`);
      
      // Initialize progress tracker
      const progressTracker = new ProgressTracker(
        filePaths.length,
        this.workdayApi['environment'].name,
        categoryName
      );
      
      progressTracker.start();
      
      // Log cache status for debugging
      const cacheStatus = OAuthService.getCacheStatus();
      if (cacheStatus.length > 0) {
        logger.debug('OAuth cache status', { cacheStatus });
      }
      
      // Process files with concurrency control
      const results: UploadResult[] = [];
      const chunks = this.chunkArray(filePaths, this.config.maxConcurrentUploads);
      
      for (const chunk of chunks) {
        const chunkPromises = chunk.map(filePath => 
          this.processFile(filePath, progressTracker, categoryWid)
        );
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        
        // Check for consecutive failures after each chunk
        if (this.shouldCheckForFailures && await this.checkConsecutiveFailures(
          chunkResults, 
          results.length, 
          filePaths.length
        )) {
          // User chose to stop - mark remaining files as cancelled
          const remainingFiles = filePaths.slice(results.length);
          console.log(`\n❌ Upload cancelled by user. ${remainingFiles.length} files not processed.`);
          break;
        }
      }
      
      // Complete progress tracking
      progressTracker.complete();
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      const duration = Date.now() - startTime;
      
      logger.info('Upload process completed', {
        totalFiles: filePaths.length,
        successful,
        failed,
        duration: `${duration}ms`,
        avgTimePerFile: `${(duration / filePaths.length).toFixed(0)}ms`
      });
      
      return {
        totalFiles: filePaths.length,
        successful,
        failed,
        duration,
        results
      };
    } catch (error) {
      logger.error('Upload process failed', { error });
      throw error;
    }
  }
  
  private async processFile(
    filePath: string, 
    progressTracker: ProgressTracker, 
    categoryWid: string
  ): Promise<UploadResult> {
    const startTime = Date.now();
    const filename = filePath.split('/').pop() || 'unknown';
    
    try {
      
      logger.debug('Processing file', { filename });
      
      // Process and validate file
      const processedFile = await this.fileProcessor.processFile(filePath);
      
      if (!processedFile.isValid) {
        await this.fileProcessor.moveToFailed(filePath, processedFile.error || 'Unknown error');
        progressTracker.updateFailure(filename);
        this.consecutiveFailures++;
        return {
          filename,
          employeeId: processedFile.employeeId,
          success: false,
          error: processedFile.error,
          duration: Date.now() - startTime
        };
      }
      
      // Check worker cache first
      let workerWid: string | undefined;
      const cachedWorker = this.getFromWorkerCache(processedFile.employeeId);
      
      if (cachedWorker) {
        logger.debug('Using cached worker validation', { 
          employeeId: processedFile.employeeId 
        });
        workerWid = cachedWorker.workerWid;
      } else {
        // Validate worker exists in Workday
        const workerValidation = await this.workdayApi.validateWorker(processedFile.employeeId);
        
        if (!workerValidation.isValid) {
          await this.fileProcessor.moveToFailed(
            filePath, 
            workerValidation.error || 'Worker validation failed'
          );
          progressTracker.updateFailure(filename);
          this.consecutiveFailures++;
          return {
            filename,
            employeeId: processedFile.employeeId,
            success: false,
            error: workerValidation.error,
            duration: Date.now() - startTime
          };
        }
        
        workerWid = workerValidation.workerWid!;
        // Cache the worker validation
        this.addToWorkerCache(processedFile.employeeId, workerWid);
      }
      
      // Create worker document
      const workerDocument: WorkerDocument = {
        employeeId: processedFile.employeeId,
        filename: processedFile.filename,
        categoryWid,
        fileContent: processedFile.fileContent,
        mimeType: 'application/pdf'
      };
      
      // Upload document to Workday
      const uploadSuccess = await this.workdayApi.uploadDocument(
        workerDocument,
        workerWid
      );
      
      if (uploadSuccess) {
        await this.fileProcessor.moveToProcessed(filePath);
        progressTracker.updateSuccess(filename);
        this.consecutiveFailures = 0; // Reset failure counter on success
        return {
          filename,
          employeeId: processedFile.employeeId,
          success: true,
          duration: Date.now() - startTime
        };
      } else {
        await this.fileProcessor.moveToFailed(filePath, 'Document upload failed');
        progressTracker.updateFailure(filename);
        this.consecutiveFailures++;
        return {
          filename,
          employeeId: processedFile.employeeId,
          success: false,
          error: 'Document upload failed',
          duration: Date.now() - startTime
        };
      }
    } catch (error) {
      logger.error('File processing error', { filename, error });
      
      try {
        await this.fileProcessor.moveToFailed(filePath, `Processing error: ${error}`);
      } catch (moveError) {
        logger.error('Failed to move file to failed directory', { filename, moveError });
      }
      
      progressTracker.updateFailure(filename);
      this.consecutiveFailures++;
      return {
        filename,
        employeeId: '',
        success: false,
        error: `Processing error: ${error}`,
        duration: Date.now() - startTime
      };
    }
  }
  
  private getFromWorkerCache(employeeId: string): { workerWid: string } | null {
    const cached = this.workerCache[employeeId];
    if (!cached) return null;
    
    // Check if cache entry is still valid
    const age = Date.now() - cached.validatedAt.getTime();
    if (age > this.WORKER_CACHE_TTL) {
      delete this.workerCache[employeeId];
      return null;
    }
    
    return { workerWid: cached.workerWid };
  }
  
  private addToWorkerCache(employeeId: string, workerWid: string): void {
    this.workerCache[employeeId] = {
      workerWid,
      validatedAt: new Date()
    };
  }
  
  private async checkConsecutiveFailures(
    chunkResults: UploadResult[], 
    totalProcessed: number, 
    totalFiles: number
  ): Promise<boolean> {
    // Check if all files in chunk failed
    const chunkFailures = chunkResults.filter(r => !r.success).length;
    
    // If we've processed at least 10 files and all recent files are failing
    if (totalProcessed >= 10 && this.consecutiveFailures >= 10) {
      console.log('\n⚠️  WARNING: All uploads are failing!');
      console.log(`   • ${this.consecutiveFailures} consecutive failures detected`);
      console.log(`   • ${totalProcessed}/${totalFiles} files processed so far`);
      console.log(`   • ${totalFiles - totalProcessed} files remaining`);
      
      const shouldContinue = await promptConfirmation(
        'All recent uploads have failed. Do you want to continue uploading the remaining files?',
        false
      );
      
      if (!shouldContinue) {
        this.shouldCheckForFailures = false; // Don't ask again
        return true; // Signal to stop
      } else {
        this.consecutiveFailures = 0; // Reset counter if user wants to continue
        console.log('Continuing with remaining uploads...\n');
      }
    }
    
    return false; // Continue processing
  }
  
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}