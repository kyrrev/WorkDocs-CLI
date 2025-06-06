#!/usr/bin/env node

import * as dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import { logger } from './utils/logger';
import { EnvironmentConfig } from './config/environment';
import { UploadOrchestrator } from './services/upload-orchestrator';
import { OAuthService } from './services/oauth';
import { ReportGenerator } from './services/report-generator';
import { 
  promptEnvironmentSelection, 
  promptProductionWarning, 
  displayEnvironmentInfo,
  promptCategorySelection,
  Environment 
} from './utils/prompts';

const program = new Command();

program
  .name('workdocs-cli')
  .description('Mass upload worker documents to Workday')
  .version('1.0.0');

program
  .command('upload')
  .description('Upload documents to Workday')
  .action(async () => {
    try {
      console.log('🚀 WorkDocs CLI - Document Upload\n');
      
      // Interactive environment selection
      const selectedEnvironment = await promptEnvironmentSelection();
      displayEnvironmentInfo(selectedEnvironment);
      
      // Production warning
      if (selectedEnvironment === 'production') {
        const confirmed = await promptProductionWarning();
        if (!confirmed) {
          console.log('Upload cancelled by user.');
          process.exit(0);
        }
        console.log('');
      }
      
      // Get environment configuration
      const envConfig = EnvironmentConfig.getInstance();
      const environment = envConfig.getEnvironment(selectedEnvironment);
      const appConfig = envConfig.getAppConfig();
      
      logger.info('Starting WorkDocs CLI upload process', {
        environment: selectedEnvironment,
        inputDir: appConfig.inputDir,
        maxConcurrency: appConfig.maxConcurrentUploads
      });
      
      // Create orchestrator and scan files
      const orchestrator = new UploadOrchestrator(environment);
      const scanResults = await orchestrator.scanFiles();
      
      if (scanResults.totalFiles === 0) {
        console.log('No files found to process in the input directory.');
        process.exit(0);
      }
      
      // Prompt for category selection
      const categoryWid = await promptCategorySelection(scanResults.totalFiles, scanResults.uniqueWorkers);
      
      // Start upload with selected category
      const results = await orchestrator.uploadAllDocuments(categoryWid);
      
      // Display results summary
      console.log('🎉 Upload Complete!\n');
      console.log('=== Final Results ===');
      console.log(`📊 Total files: ${results.totalFiles}`);
      console.log(`✅ Successful: ${results.successful}`);
      console.log(`❌ Failed: ${results.failed}`);
      console.log(`⏱️  Duration: ${(results.duration / 1000).toFixed(2)} seconds`);
      
      if (results.failed > 0) {
        console.log('\n❌ Failed uploads:');
        results.results
          .filter(r => !r.success)
          .forEach(result => {
            console.log(`   • ${result.filename} (${result.employeeId}): ${result.error}`);
          });
      }
      
      console.log(`\n📁 Processed files moved to: ${appConfig.processedDir}`);
      console.log(`📁 Failed files moved to: ${appConfig.failedDir}`);
      console.log(`📝 Logs written to: logs/`);
      
      // Generate summary report
      try {
        const reportGenerator = new ReportGenerator();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const reportFilename = `session-report-${timestamp}.txt`;
        await reportGenerator.generateReport(reportFilename);
        console.log(`📊 Detailed report saved to: logs/${reportFilename}`);
      } catch (reportError) {
        logger.warn('Failed to generate summary report', { error: reportError });
        console.log('⚠️  Could not generate summary report, but upload process completed');
      }
      
      process.exit(results.failed > 0 ? 1 : 0);
    } catch (error) {
      logger.error('Upload process failed', { error }); // Keep detailed logging for debugging
      console.error('Upload process failed. Check logs/combined.log for detailed error information.');
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate configuration and environment variables')
  .action(async () => {
    try {
      console.log('🔍 WorkDocs CLI - Configuration Validation\n');
      
      // Interactive environment selection
      const selectedEnvironment = await promptEnvironmentSelection();
      displayEnvironmentInfo(selectedEnvironment);
      
      const envConfig = EnvironmentConfig.getInstance();
      const environment = envConfig.getEnvironment(selectedEnvironment);
      const appConfig = envConfig.getAppConfig();
      
      console.log('✓ Environment configuration loaded successfully');
      console.log(`  - Environment: ${selectedEnvironment}`);
      console.log(`  - Client ID: ***CONFIGURED***`);
      console.log(`  - Refresh Token: ***CONFIGURED***`);
      
      console.log('\n✓ Application configuration:');
      console.log(`  - Input directory: ${appConfig.inputDir}`);
      console.log(`  - Processed directory: ${appConfig.processedDir}`);
      console.log(`  - Failed directory: ${appConfig.failedDir}`);
      console.log(`  - Max concurrent uploads: ${appConfig.maxConcurrentUploads}`);
      console.log(`  - Max file size: ${appConfig.maxFileSizeMB}MB`);
      
      // Test OAuth token retrieval
      console.log('\n🔑 Testing OAuth authentication...');
      try {
        const oauthService = new OAuthService(environment);
        const accessToken = await oauthService.getAccessToken();
        console.log(`✓ OAuth authentication successful`);
        console.log(`  - Access token: ***OBTAINED***`);
      } catch (error) {
        logger.error('OAuth authentication failed during validation', { error }); // Keep detailed logging
        console.error('❌ OAuth authentication failed. Check credentials and network connectivity.');
        process.exit(1);
      }
      
      console.log('\n✓ Configuration validation completed successfully');
    } catch (error) {
      logger.error('Configuration validation failed', { error }); // Keep detailed logging
      console.error('Configuration validation failed. Check logs/combined.log for details.');
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Generate human-readable report from logs')
  .option('-o, --output <filename>', 'Save report to file in logs directory')
  .action(async (options) => {
    try {
      console.log('📊 WorkDocs CLI - Generating Report\n');
      
      const reportGenerator = new ReportGenerator();
      const report = await reportGenerator.generateReport(options.output);
      
      if (options.output) {
        console.log(`✅ Report saved to logs/${options.output}`);
      } else {
        console.log(report);
      }
    } catch (error) {
      logger.error('Report generation failed', { error }); // Keep detailed logging
      console.error('Report generation failed. Check logs/combined.log for details.');
      process.exit(1);
    }
  });

program.parse();