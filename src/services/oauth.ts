import axios from 'axios';
import { logger } from '../utils/logger';
import { WorkdayEnvironment } from '../config/environment';
import { withRetry } from '../utils/retry';

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export class OAuthService {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<string> | null = null;
  
  // Add a static instance cache to share tokens across service instances
  private static tokenCache: Map<string, { token: string; expiry: Date }> = new Map();
  private static refreshPromises: Map<string, Promise<string>> = new Map();
  
  constructor(private environment: WorkdayEnvironment) {}
  
  async getAccessToken(): Promise<string> {
    const cacheKey = this.environment.name;
    
    // Check static cache first
    const cached = OAuthService.tokenCache.get(cacheKey);
    if (cached && new Date() < cached.expiry) {
      logger.debug('Reusing cached access token from static cache', { 
        environment: this.environment.name,
        expiresIn: Math.round((cached.expiry.getTime() - Date.now()) / 1000) + 's'
      });
      return cached.token;
    }
    
    // Check if refresh is already in progress for this environment
    const existingRefresh = OAuthService.refreshPromises.get(cacheKey);
    if (existingRefresh) {
      logger.debug('Token refresh already in progress, waiting...', { 
        environment: this.environment.name 
      });
      return await existingRefresh;
    }
    
    // Start refresh process
    const refreshPromise = this.doRefresh();
    OAuthService.refreshPromises.set(cacheKey, refreshPromise);
    
    try {
      const token = await refreshPromise;
      return token;
    } finally {
      // Clean up the refresh promise after a short delay to handle 
      // any requests that started just as this one finished
      setTimeout(() => {
        OAuthService.refreshPromises.delete(cacheKey);
      }, 100);
    }
  }
  
  private async doRefresh(): Promise<string> {
    logger.info('Getting new access token using refresh token', { 
      environment: this.environment.name 
    });
    
    if (!this.environment.refreshToken) {
      throw new Error(`Refresh token not found for environment: ${this.environment.name}`);
    }
    
    return await this.fetchNewToken();
  }
  
  private async fetchNewToken(): Promise<string> {
    try {
      const credentials = Buffer.from(
        `${this.environment.clientId}:${this.environment.clientSecret}`
      ).toString('base64');
      
      const response = await withRetry(
        async () => axios.post<OAuthTokenResponse>(
          this.environment.tokenUrl,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.environment.refreshToken!
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${credentials}`
            },
            timeout: 30000 // 30 second timeout
          }
        ),
        { maxAttempts: 3 },
        'OAuth token request'
      );
      
      // Validate response data before using it
      if (!response.data.access_token) {
        throw new Error('Invalid OAuth response: missing access_token');
      }
      
      const token = response.data.access_token;
      // Set token expiry to 55 minutes from now
      const expiry = new Date(Date.now() + (55 * 60 * 1000));
      
      // Update both instance and static cache
      this.accessToken = token;
      this.tokenExpiry = expiry;
      OAuthService.tokenCache.set(this.environment.name, { token, expiry });
      
      logger.info('Successfully obtained access token', {
        environment: this.environment.name,
        expiresIn: '55 minutes',
        tokenType: response.data.token_type,
        validUntil: expiry.toISOString()
      });
      
      return token;
    } catch (error: any) {
      // Log detailed error for debugging
      logger.error('Failed to obtain access token', { 
        environment: this.environment.name,
        errorType: error?.constructor?.name || 'Unknown',
        statusCode: error?.response?.status,
        errorMessage: error?.message,
        url: this.environment.tokenUrl
      });
      throw new Error('OAuth authentication failed - check credentials and network connectivity');
    }
  }
  
  // Clear token cache for testing or forced refresh
  static clearCache(environment?: string): void {
    if (environment) {
      OAuthService.tokenCache.delete(environment);
      OAuthService.refreshPromises.delete(environment);
    } else {
      OAuthService.tokenCache.clear();
      OAuthService.refreshPromises.clear();
    }
  }
  
  // Get cache status for debugging
  static getCacheStatus(): { environment: string; expiresIn: string }[] {
    const now = new Date();
    return Array.from(OAuthService.tokenCache.entries()).map(([env, cache]) => ({
      environment: env,
      expiresIn: cache.expiry > now 
        ? `${Math.round((cache.expiry.getTime() - now.getTime()) / 1000)}s`
        : 'expired'
    }));
  }
}