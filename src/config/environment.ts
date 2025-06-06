export interface WorkdayEnvironment {
  name: string;
  tokenUrl: string;
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AppConfig {
  maxConcurrentUploads: number;
  maxFileSizeMB: number;
  inputDir: string;
  processedDir: string;
  failedDir: string;
  logLevel: string;
}

export class EnvironmentConfig {
  private static instance: EnvironmentConfig;
  
  private constructor() {}
  
  static getInstance(): EnvironmentConfig {
    if (!EnvironmentConfig.instance) {
      EnvironmentConfig.instance = new EnvironmentConfig();
    }
    return EnvironmentConfig.instance;
  }
  
  getEnvironment(env: 'production' | 'sandbox' | 'sandbox_preview'): WorkdayEnvironment {
    const envPrefix = env.toUpperCase();
    
    return {
      name: env,
      tokenUrl: this.getRequiredEnvVar(`${envPrefix}_TOKEN_URL`),
      apiUrl: this.getRequiredEnvVar(`${envPrefix}_API_URL`),
      clientId: this.getRequiredEnvVar(`${envPrefix}_CLIENT_ID`),
      clientSecret: this.getRequiredEnvVar(`${envPrefix}_CLIENT_SECRET`),
      refreshToken: this.getRequiredEnvVar(`${envPrefix}_REFRESH_TOKEN`)
    };
  }
  
  getAppConfig(): AppConfig {
    return {
      maxConcurrentUploads: parseInt(process.env.MAX_CONCURRENT_UPLOADS || '5'),
      maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '25'),
      inputDir: process.env.INPUT_DIR || 'input',
      processedDir: process.env.PROCESSED_DIR || 'processed',
      failedDir: process.env.FAILED_DIR || 'failed',
      logLevel: process.env.LOG_LEVEL || 'info'
    };
  }
  
  private getRequiredEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
  }
}