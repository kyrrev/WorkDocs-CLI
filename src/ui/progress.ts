import * as cliProgress from 'cli-progress';
import { logger } from '../utils/logger';

export interface ProgressStats {
  total: number;
  successful: number;
  failed: number;
  processed: number;
  rate: number; // files per minute
  eta: number; // seconds remaining
}

export class ProgressTracker {
  private progressBar: cliProgress.SingleBar;
  private startTime: number;
  private stats: ProgressStats;
  private lastUpdateTime: number = 0;
  private isStarted: boolean = false;
  private recentRates: number[] = []; // For smoothing rate calculation
  
  constructor(total: number, environment: string, category: string) {
    this.startTime = Date.now();
    this.stats = {
      total,
      successful: 0,
      failed: 0,
      processed: 0,
      rate: 0,
      eta: 0
    };
    
    // Create progress bar with custom format matching design doc 9.2
    this.progressBar = new cliProgress.SingleBar({
      format: this.getProgressFormat(environment, category),
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: true,
      stopOnComplete: true,
      forceRedraw: false,
      fps: 5,
      synchronousUpdate: false,
      linewrap: false
    }, cliProgress.Presets.rect);
    
    logger.info('Progress tracker initialized', {
      total,
      environment,
      category
    });
  }
  
  start(): void {
    if (!this.isStarted) {
      this.progressBar.start(this.stats.total, 0, this.stats);
      this.isStarted = true;
    }
  }
  
  updateSuccess(filename: string): void {
    this.stats.successful++;
    this.stats.processed++;
    this.updateProgress();
  }
  
  updateFailure(filename: string): void {
    this.stats.failed++;
    this.stats.processed++;
    this.updateProgress();
  }
  
  private updateProgress(): void {
    this.calculateStats();
    
    if (this.isStarted) {
      this.progressBar.update(this.stats.processed, this.stats);
    }
    
    // Log progress occasionally
    const now = Date.now();
    if (now - this.lastUpdateTime > 5000) { // Every 5 seconds
      logger.info('Progress update', {
        processed: this.stats.processed,
        total: this.stats.total,
        successful: this.stats.successful,
        failed: this.stats.failed,
        rate: this.stats.rate,
        eta: this.stats.eta
      });
      this.lastUpdateTime = now;
    }
  }
  
  private calculateStats(): void {
    const elapsed = (Date.now() - this.startTime) / 1000; // seconds
    const elapsedMinutes = elapsed / 60;
    
    // Calculate rate (files per minute) and round to 1 decimal place
    this.stats.rate = elapsedMinutes > 0 ? Math.round((this.stats.processed / elapsedMinutes) * 10) / 10 : 0;
    
    // Calculate ETA (seconds) with minimum 1 second
    const remaining = this.stats.total - this.stats.processed;
    if (remaining <= 0) {
      this.stats.eta = 0;
    } else if (this.stats.rate > 0) {
      this.stats.eta = Math.max(1, Math.round((remaining / this.stats.rate) * 60));
    } else {
      this.stats.eta = 0;
    }
  }
  
  complete(): void {
    if (this.isStarted) {
      this.calculateStats();
      this.progressBar.update(this.stats.total, this.stats);
      this.progressBar.stop();
      
      logger.info('Progress tracking completed', {
        total: this.stats.total,
        successful: this.stats.successful,
        failed: this.stats.failed,
        duration: `${((Date.now() - this.startTime) / 1000).toFixed(1)}s`
      });
    }
  }
  
  getStats(): ProgressStats {
    return { ...this.stats };
  }
  
  private getProgressFormat(environment: string, category: string): string {
    return `[{bar}] {percentage}% | {value}/{total} files | Success: {successful} | Failed: {failed} | Rate: {rate}/min | ETA: {eta}s`;
  }
  
  private formatRate(rate: number): string {
    return rate.toFixed(1);
  }
  
  private formatEta(etaSeconds: number): string {
    if (etaSeconds <= 0) return '0s';
    
    const minutes = Math.floor(etaSeconds / 60);
    const seconds = Math.floor(etaSeconds % 60);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Custom format function to handle rate and ETA formatting
cliProgress.Format.Formatter.prototype.rate = function(options: any, params: any) {
  return Math.round(params.rate || 0).toString();
};

cliProgress.Format.Formatter.prototype.eta = function(options: any, params: any) {
  const etaSeconds = params.eta || 0;
  if (etaSeconds <= 0) return '0s';
  
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = Math.floor(etaSeconds % 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
};

