import axios, { AxiosResponse } from 'axios';
import { logger } from '../utils/logger';
import { OAuthService } from './oauth';
import { WorkdayEnvironment } from '../config/environment';
import { withRetry } from '../utils/retry';
import { TemplateLoader } from '../utils/template-loader';

export interface WorkerDocument {
  employeeId: string;
  filename: string;
  categoryWid: string;
  fileContent: string; // Base64 encoded
  mimeType: string;
}

export interface WorkerValidationResult {
  isValid: boolean;
  workerWid?: string;
  error?: string;
}

export class WorkdayApiService {
  private oauthService: OAuthService;
  
  constructor(private environment: WorkdayEnvironment, oauthService?: OAuthService) {
    this.oauthService = oauthService || new OAuthService(environment);
  }

  async ensureAuthenticated(): Promise<void> {
    await this.oauthService.getAccessToken();
  }

  /**
   * Validates employee ID format for security
   */
  private validateEmployeeId(employeeId: string): boolean {
    return /^\d{3,12}$/.test(employeeId) && 
           employeeId.length >= 3 && 
           employeeId.length <= 12;
  }

  /**
   * Validates Workday WID format (GUID: 32 hexadecimal characters)
   * Example: 81f5373f398e4550a111264703c3f689
   */
  private validateWid(wid: string): boolean {
    return /^[a-f0-9]{32}$/.test(wid);
  }
  
  async validateWorker(employeeId: string): Promise<WorkerValidationResult> {
    // Validate employee ID format first
    if (!this.validateEmployeeId(employeeId)) {
      return { 
        isValid: false, 
        error: 'Invalid employee ID format. Must be 3-12 digits.' 
      };
    }

    logger.info('Validating worker', { employeeId });
    
    try {
      const accessToken = await this.oauthService.getAccessToken();
      
      const soapEnvelope = this.buildGetWorkersRequest(employeeId);
      
      const response = await withRetry(
        () => this.makeSOAPRequest(soapEnvelope, accessToken),
        { maxAttempts: 3 },
        `Worker validation for ${employeeId}`
      );
      
      // Parse response to extract worker WID
      logger.debug('Worker validation response received', { employeeId });
      const workerWid = this.extractWorkerWid(response.data);
      
      if (workerWid) {
        logger.info('Worker validation successful', { employeeId });
        return { isValid: true, workerWid };
      } else {
        logger.warn('Worker not found', { employeeId });
        return { isValid: false, error: 'Worker not found' };
      }
    } catch (error) {
      logger.error('Worker validation failed', { employeeId, error });
      return { isValid: false, error: `Validation failed: ${error}` };
    }
  }
  
  async uploadDocument(document: WorkerDocument, workerWid: string): Promise<boolean> {
    // Validate inputs before processing
    if (!this.validateEmployeeId(document.employeeId)) {
      logger.error('Invalid employee ID for document upload', { employeeId: document.employeeId });
      return false;
    }

    if (!this.validateWid(workerWid)) {
      logger.error('Invalid worker WID for document upload', { employeeId: document.employeeId });
      return false;
    }

    if (!this.validateWid(document.categoryWid)) {
      logger.error('Invalid category WID for document upload', { employeeId: document.employeeId });
      return false;
    }

    logger.info('Uploading document', { 
      employeeId: document.employeeId,
      filename: document.filename,
      categoryWid: document.categoryWid
    });
    
    try {
      const accessToken = await this.oauthService.getAccessToken();
      
      const soapEnvelope = this.buildPutWorkerDocumentRequest(document, workerWid);
      
      const response = await withRetry(
        () => this.makeSOAPRequest(soapEnvelope, accessToken),
        { maxAttempts: 3 },
        `Document upload for ${document.employeeId}-${document.filename}`
      );
      
      // Check if upload was successful
      if (this.isUploadSuccessful(response.data)) {
        logger.info('Document upload successful', { 
          employeeId: document.employeeId,
          filename: document.filename
        });
        return true;
      } else {
        logger.error('Document upload failed', { 
          employeeId: document.employeeId,
          filename: document.filename
        });
        return false;
      }
    } catch (error) {
      logger.error('Document upload error', { 
        employeeId: document.employeeId,
        filename: document.filename,
        error
      });
      return false;
    }
  }
  
  private async makeSOAPRequest(soapEnvelope: string, accessToken: string): Promise<AxiosResponse> {
    try {
      return await axios.post(
        this.environment.apiUrl,
        soapEnvelope,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Authorization': `Bearer ${accessToken}`,
            'SOAPAction': ''
          },
          timeout: 30000 // 30 second timeout
        }
      );
    } catch (error: any) {
      // Log 500 errors without exposing sensitive data
      if (error.response?.status === 500) {
        logger.error('SOAP request failed with server error', {
          status: error.response.status,
          statusText: error.response.statusText,
          environment: this.environment.name
        });
      }
      throw error;
    }
  }
  
  private buildGetWorkersRequest(employeeId: string): string {
    return TemplateLoader.processTemplate('get-workers-request', {
      employeeId
    });
  }
  
  private buildPutWorkerDocumentRequest(document: WorkerDocument, workerWid: string): string {
    return TemplateLoader.processTemplate('put-worker-document-request', {
      workerWid,
      categoryWid: document.categoryWid,
      mimeType: document.mimeType,
      filename: document.filename,
      fileContent: document.fileContent
    });
  }
  
  private extractWorkerWid(soapResponse: string): string | null {
    // Parse SOAP response to extract worker WID - try both namespace patterns
    const bsvcMatch = soapResponse.match(/<bsvc:ID bsvc:type="WID">([^<]+)<\/bsvc:ID>/);
    const wdMatch = soapResponse.match(/<wd:ID wd:type="WID">([^<]+)<\/wd:ID>/);
    return bsvcMatch ? bsvcMatch[1] : (wdMatch ? wdMatch[1] : null);
  }
  
  private isUploadSuccessful(soapResponse: string): boolean {
    // Check for successful response indicators in SOAP response
    return !soapResponse.includes('soap:Fault') && 
           !soapResponse.includes('bsvc:Validation_Error') &&
           (soapResponse.includes('Put_Worker_Document_Response') || 
            soapResponse.includes('bsvc:Worker_Document_Reference'));
  }
}