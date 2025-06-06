import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  service?: string;
  [key: string]: any;
}

interface SessionReport {
  sessionId: string;
  startTime: string;
  endTime?: string;
  environment?: string;
  category?: string;
  totalFiles: number;
  successful: number;
  failed: number;
  duration?: number;
  errors: string[];
  fileDetails: {
    filename: string;
    employeeId: string;
    status: 'success' | 'failed';
    error?: string;
  }[];
}

export class ReportGenerator {
  private logsDir: string;

  constructor(logsDir: string = 'logs') {
    this.logsDir = logsDir;
  }

  async generateReport(outputFile?: string): Promise<string> {
    const logPath = path.join(this.logsDir, 'combined.log');
    
    if (!fs.existsSync(logPath)) {
      throw new Error('Log file not found. Run an upload process first.');
    }

    const logEntries = this.parseLogFile(logPath);
    const sessions = this.groupLogsBySessions(logEntries);
    const report = this.generateHumanReadableReport(sessions);

    if (outputFile) {
      const outputPath = path.join(this.logsDir, outputFile);
      fs.writeFileSync(outputPath, report);
      logger.info('Report generated', { outputPath });
    }

    return report;
  }

  private parseLogFile(logPath: string): LogEntry[] {
    const logContent = fs.readFileSync(logPath, 'utf-8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    return lines.map(line => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch (error) {
        // Skip malformed JSON lines
        return null;
      }
    }).filter(entry => entry !== null) as LogEntry[];
  }

  private groupLogsBySessions(logEntries: LogEntry[]): SessionReport[] {
    const sessions: SessionReport[] = [];
    let currentSession: Partial<SessionReport> | null = null;

    for (const entry of logEntries) {
      // Start new session on environment selection or upload start
      if (entry.message === 'Environment selected' || 
          entry.message === 'Starting WorkDocs CLI upload process') {
        
        if (currentSession) {
          // Finalize previous session
          sessions.push(this.finalizeSession(currentSession));
        }

        currentSession = {
          sessionId: this.generateSessionId(entry.timestamp),
          startTime: entry.timestamp,
          environment: entry.environment,
          totalFiles: 0,
          successful: 0,
          failed: 0,
          errors: [],
          fileDetails: []
        };
      }

      if (!currentSession) continue;

      // Capture session details
      if (entry.message === 'Document category selected') {
        currentSession.category = entry.categoryName;
      }

      if (entry.message === 'Found 2 files to process' || entry.message?.includes('files to process')) {
        const match = entry.message.match(/Found (\d+) files to process/);
        if (match) {
          currentSession.totalFiles = parseInt(match[1]);
        }
      }

      // Track file processing results
      if (entry.message === 'Document upload successful') {
        currentSession.successful = (currentSession.successful || 0) + 1;
        currentSession.fileDetails?.push({
          filename: entry.filename,
          employeeId: entry.employeeId,
          status: 'success'
        });
      }

      if (entry.message === 'Document upload error' || 
          entry.message === 'File moved to failed directory') {
        currentSession.failed = (currentSession.failed || 0) + 1;
        currentSession.fileDetails?.push({
          filename: entry.filename || 'unknown',
          employeeId: entry.employeeId || 'unknown',
          status: 'failed',
          error: entry.error?.message || entry.reason || 'Unknown error'
        });
      }

      // Collect errors
      if (entry.level === 'error' && entry.message !== 'Upload process failed') {
        const errorMsg = `${entry.message}${entry.error?.message ? ': ' + entry.error.message : ''}`;
        if (!currentSession.errors?.includes(errorMsg)) {
          currentSession.errors?.push(errorMsg);
        }
      }

      // Update end time
      currentSession.endTime = entry.timestamp;
    }

    // Finalize last session
    if (currentSession) {
      sessions.push(this.finalizeSession(currentSession));
    }

    return sessions;
  }

  private finalizeSession(session: Partial<SessionReport>): SessionReport {
    const startTime = new Date(session.startTime!);
    const endTime = session.endTime ? new Date(session.endTime) : startTime;
    const duration = endTime.getTime() - startTime.getTime();

    return {
      sessionId: session.sessionId!,
      startTime: session.startTime!,
      endTime: session.endTime,
      environment: session.environment,
      category: session.category,
      totalFiles: session.totalFiles || 0,
      successful: session.successful || 0,
      failed: session.failed || 0,
      duration,
      errors: session.errors || [],
      fileDetails: session.fileDetails || []
    };
  }

  private generateSessionId(timestamp: string): string {
    return new Date(timestamp).toISOString().replace(/[:.]/g, '-').slice(0, -5);
  }

  private generateHumanReadableReport(sessions: SessionReport[]): string {
    let report = '';
    
    report += '==================================================\n';
    report += '           WORKDOCS CLI - EXECUTION REPORT       \n';
    report += '==================================================\n\n';

    if (sessions.length === 0) {
      report += 'No upload sessions found in logs.\n';
      return report;
    }

    // Overall summary
    const totalFiles = sessions.reduce((sum, s) => sum + s.totalFiles, 0);
    const totalSuccessful = sessions.reduce((sum, s) => sum + s.successful, 0);
    const totalFailed = sessions.reduce((sum, s) => sum + s.failed, 0);

    report += 'OVERALL SUMMARY\n';
    report += '---------------\n';
    report += `Sessions: ${sessions.length}\n`;
    report += `Total Files Processed: ${totalFiles}\n`;
    report += `Successful Uploads: ${totalSuccessful}\n`;
    report += `Failed Uploads: ${totalFailed}\n`;
    report += `Success Rate: ${totalFiles > 0 ? ((totalSuccessful / totalFiles) * 100).toFixed(1) : 0}%\n\n`;

    // Session details
    sessions.forEach((session, index) => {
      report += `SESSION ${index + 1}: ${session.sessionId}\n`;
      report += ''.padEnd(50, '-') + '\n';
      report += `Start Time: ${new Date(session.startTime).toLocaleString()}\n`;
      if (session.endTime) {
        report += `End Time: ${new Date(session.endTime).toLocaleString()}\n`;
        report += `Duration: ${this.formatDuration(session.duration || 0)}\n`;
      }
      report += `Environment: ${session.environment || 'Unknown'}\n`;
      report += `Category: ${session.category || 'Not specified'}\n`;
      report += `Files: ${session.totalFiles} total, ${session.successful} successful, ${session.failed} failed\n`;
      
      if (session.totalFiles > 0) {
        const rate = ((session.successful / session.totalFiles) * 100).toFixed(1);
        report += `Success Rate: ${rate}%\n`;
      }

      if (session.duration && session.totalFiles > 0) {
        const avgTime = (session.duration / session.totalFiles / 1000).toFixed(1);
        report += `Average Time per File: ${avgTime}s\n`;
      }

      // File details
      if (session.fileDetails.length > 0) {
        report += '\nFile Processing Details:\n';
        session.fileDetails.forEach(file => {
          const status = file.status === 'success' ? '✅' : '❌';
          report += `  ${status} ${file.filename} (Employee: ${file.employeeId})\n`;
          if (file.error) {
            report += `     Error: ${file.error}\n`;
          }
        });
      }

      // Errors
      if (session.errors.length > 0) {
        report += '\nErrors Encountered:\n';
        session.errors.forEach(error => {
          report += `  • ${error}\n`;
        });
      }

      report += '\n';
    });

    report += '==================================================\n';
    report += `Report generated on: ${new Date().toLocaleString()}\n`;
    report += '==================================================\n';

    return report;
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }
}