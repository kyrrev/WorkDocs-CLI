import fs from 'fs';
import path from 'path';

export class TemplateLoader {
  private static templateCache = new Map<string, string>();

  /**
   * Escapes XML special characters to prevent injection attacks
   */
  private static escapeXml(unsafe: string): string {
    if (typeof unsafe !== 'string') {
      return String(unsafe);
    }
    
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Validates template name to prevent directory traversal attacks
   */
  private static validateTemplateName(templateName: string): boolean {
    // Only allow alphanumeric characters, hyphens, and underscores
    return /^[a-zA-Z0-9_-]+$/.test(templateName) && 
           !templateName.includes('..') && 
           templateName.length <= 50;
  }

  static loadTemplate(templateName: string): string {
    // Validate template name for security
    if (!this.validateTemplateName(templateName)) {
      throw new Error(`Invalid template name: ${templateName}`);
    }

    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.xml`);
    
    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      this.templateCache.set(templateName, template);
      return template;
    } catch (error) {
      throw new Error(`Failed to load template: Template not found`);
    }
  }

  static processTemplate(templateName: string, variables: Record<string, string>): string {
    let template = this.loadTemplate(templateName);
    
    // Replace all {{variableName}} placeholders with XML-escaped values
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const escapedValue = this.escapeXml(value);
      template = template.replace(new RegExp(placeholder, 'g'), escapedValue);
    }
    
    return template;
  }
}