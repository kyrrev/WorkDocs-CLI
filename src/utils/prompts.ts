import inquirer from 'inquirer';
import { logger } from './logger';
import { documentCategories, DocumentCategory } from '../config/categories';

export type Environment = 'production' | 'sandbox' | 'sandbox_preview';

export interface EnvironmentSelection {
  environment: Environment;
}

export interface ConfirmationPrompt {
  confirmed: boolean;
}

export interface CategorySelection {
  categoryWid: string;
}

export async function promptEnvironmentSelection(): Promise<Environment> {
  logger.debug('Prompting user for environment selection');
  
  const answers = await inquirer.prompt<EnvironmentSelection>([
    {
      type: 'list',
      name: 'environment',
      message: 'Select the Workday environment:',
      choices: [
        {
          name: '🧪 Sandbox',
          value: 'sandbox'
        },
        {
          name: '🔍 Sandbox Preview',
          value: 'sandbox_preview'
        },
        {
          name: '🚀 Production (Caution ⚠️ ) ',
          value: 'production'
        }
      ],
      default: 'sandbox'
    }
  ]);
  
  logger.info('Environment selected', { environment: answers.environment });
  return answers.environment;
}

export async function promptConfirmation(
  message: string,
  defaultValue: boolean = false
): Promise<boolean> {
  const answers = await inquirer.prompt<ConfirmationPrompt>([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue
    }
  ]);
  
  return answers.confirmed;
}

export async function promptProductionWarning(): Promise<boolean> {
  console.log('\n⚠️  WARNING: You are about to upload documents to the PRODUCTION environment!');
  console.log('   This will affect live data in your Workday tenant.');
  console.log('   Please ensure you have tested thoroughly in sandbox first.\n');
  
  return await promptConfirmation(
    'Are you absolutely sure you want to proceed with production upload?',
    false
  );
}

export async function promptCategorySelection(totalFiles: number, uniqueWorkers: number): Promise<string> {
  console.log(`\n📊 Scan Results:`);
  console.log(`   • ${totalFiles} documents found`);
  console.log(`   • ${uniqueWorkers} unique workers identified\n`);
  
  logger.debug('Prompting user for document category selection');
  
  const choices = documentCategories.map(category => ({
    name: category.name,
    value: category.wid
  }));
  
  const answers = await inquirer.prompt<CategorySelection>([
    {
      type: 'list',
      name: 'categoryWid',
      message: 'Select the document category for all files:',
      choices,
      pageSize: 10
    }
  ]);
  
  const selectedCategory = documentCategories.find(cat => cat.wid === answers.categoryWid);
  console.log(`\n📁 Selected category: ${selectedCategory?.name}\n`);
  
  logger.info('Document category selected', { 
    categoryName: selectedCategory?.name,
    categoryWid: answers.categoryWid 
  });
  
  return answers.categoryWid;
}

export function displayEnvironmentInfo(environment: Environment): void {
  const envInfo = {
    sandbox: {
      icon: '🧪',
      name: 'Sandbox',
      description: 'Safe testing environment - perfect for development and testing'
    },
    sandbox_preview: {
      icon: '🔍',
      name: 'Sandbox Preview', 
      description: 'Preview environment - for testing upcoming features'
    },
    production: {
      icon: '🚀',
      name: 'Production',
      description: 'Live environment - affects real data'
    }
  };
  
  const info = envInfo[environment];
  console.log(`\n${info.icon} Selected environment: ${info.name}`);
  console.log(`   ${info.description}\n`);
}