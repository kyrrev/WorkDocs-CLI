import { logger } from './logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldRetry?: (error: any) => boolean;
}

export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  shouldRetry: (error) => {
    // Retry on network errors, timeouts, and 5xx status codes
    if (error?.code === 'ECONNRESET' || 
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ENOTFOUND') {
      return true;
    }
    
    if (error?.response?.status >= 500) {
      return true;
    }
    
    // Retry on rate limit errors
    if (error?.response?.status === 429) {
      return true;
    }
    
    return false;
  }
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  operationName: string = 'operation'
): Promise<T> {
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: any;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      logger.debug(`Attempting ${operationName}`, { attempt, maxAttempts: opts.maxAttempts });
      
      const result = await operation();
      
      if (attempt > 1) {
        logger.info(`${operationName} succeeded after ${attempt} attempts`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      logger.warn(`${operationName} failed`, { 
        attempt, 
        maxAttempts: opts.maxAttempts, 
        error: (error as any)?.message || error 
      });
      
      // Don't retry if this is the last attempt
      if (attempt >= opts.maxAttempts) {
        break;
      }
      
      // Don't retry if the error is not retryable
      if (opts.shouldRetry && !opts.shouldRetry(error)) {
        logger.warn(`${operationName} failed with non-retryable error`, { error });
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelay
      );
      
      logger.info(`Retrying ${operationName} in ${delay}ms`, { 
        attempt: attempt + 1, 
        maxAttempts: opts.maxAttempts 
      });
      
      await sleep(delay);
    }
  }
  
  logger.error(`${operationName} failed after ${opts.maxAttempts} attempts`, { error: lastError });
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(operation: () => Promise<T>, operationName: string = 'operation'): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        throw new Error(`Circuit breaker is OPEN for ${operationName}`);
      } else {
        this.state = 'HALF_OPEN';
        logger.info(`Circuit breaker transitioning to HALF_OPEN for ${operationName}`);
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName);
      throw error;
    }
  }
  
  private onSuccess(operationName: string): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info(`Circuit breaker CLOSED for ${operationName}`);
    }
  }
  
  private onFailure(operationName: string): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      logger.warn(`Circuit breaker OPEN for ${operationName}`, { 
        failures: this.failures, 
        threshold: this.threshold 
      });
    }
  }
  
  getState(): string {
    return this.state;
  }
}