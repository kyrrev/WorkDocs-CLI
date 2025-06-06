# WorkDocs CLI 📄

A Node.js/TypeScript command-line tool for mass-uploading worker documents to Workday via SOAP web services. Features OAuth 2.0 authentication, interactive categorization, concurrent processing, and comprehensive reporting.

## ✨ Features

- 🔐 OAuth 2.0 authentication with API Client for Integrations
- 🚀 Concurrent uploads with configurable rate limiting and progress tracking
- 🏢 Multi-environment support (Production, Sandbox, Sandbox Preview)
- 🖥️ Interactive CLI with environment and category selection
- 📁 Automatic file organization (processed/failed directories)
- 🔄 Robust error handling with retry logic and circuit breaker
- 📈 Human-readable reports and comprehensive logging

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- TypeScript 5.0+
- Workday tenant with API access
- Workday user with permissions
    - GET access on Domain: Worker Data: Public Worker Reports
    - PUT access on Domain: Worker Data: Add Worker Documents
- API Client for Integrations configured in Workday
    - Scope: Personal Data, Staffing, Tenant Non-Configurable

### Installation

**⚠️ Important**: You should *always* test thoroughly in a non-production environment before using the app in production.  

```bash
git clone https://github.com/kyrrev/WorkDocs-CLI.git
cd workdocs-cli
npm install
cp sample-env.env .env
# Edit .env with your Workday API credentials and tenant URIs
# Edit src/config/categories.ts with your tenant's document category WIDs
npm run build
```

## 📋 Configuration

### Environment Variables

Create a `.env` file using `sample-env.env` as a template. Configure OAuth credentials for each environment (production, sandbox, sandbox_preview) and application settings like `MAX_CONCURRENT_UPLOADS` and `MAX_FILE_SIZE_MB`.

### File Naming Convention

Files must follow the pattern: `{employeeId}-{filename}.{extension}`

Examples: `123456-employment-contract.pdf`, `789012-performance-review.html`

### Document Categories

**⚠️ Important**: You must configure your tenant's document categories in `src/config/categories.ts` with the correct WIDs. The included sample categories are for reference only and will not work with other Workday tenants.

## 🎯 Usage

```bash
npm start upload     # Upload documents with interactive prompts
npm start validate   # Test configuration and authentication
npm start report     # Generate human-readable report from logs
npm start report -o filename.txt  # Save report to file
```

https://github.com/user-attachments/assets/0e5fc957-e71e-432f-8700-4dc886163d87

The upload process includes interactive environment selection, file scanning, category selection, and real-time progress tracking with detailed results.

## 🏗️ Architecture

```
src/
├── config/
│   ├── categories.ts           # Document category mappings
│   └── environment.ts          # Multi-environment configuration
├── services/
│   ├── oauth.ts               # OAuth 2.0 authentication
│   ├── workday-api.ts         # SOAP web service client
│   ├── file-processor.ts      # File validation & processing
│   ├── upload-orchestrator.ts # Concurrent upload management
│   └── report-generator.ts    # Human-readable report generation
├── templates/
│   ├── get-workers-request.xml     # Worker validation SOAP template
│   └── put-worker-document-request.xml # Document upload SOAP template
├── ui/
│   └── progress.ts            # Real-time progress display
├── utils/
│   ├── logger.ts              # Winston logging configuration
│   ├── retry.ts               # Retry logic & circuit breaker
│   ├── prompts.ts             # Interactive CLI prompts
│   └── template-loader.ts     # SOAP template processing
└── index.ts                   # CLI interface & commands
```

Processing pipeline: File discovery → Interactive selection → File validation → Worker validation → Document upload → File organization → Report generation

## 🔧 Development

```bash
npm run build      # Compile TypeScript and copy templates
npm run dev        # Development mode with ts-node
npm run clean      # Clean build artifacts
```

## ❗ Troubleshooting

| Issue | Solution |
|-------|----------|
| **Authentication Failed** | Verify OAuth credentials and refresh tokens |
| **Worker Not Found** | Check employee ID format and existence in Workday |
| **File Too Large** | Ensure files are under size limit (default: 25MB) |
| **Template Not Found** | Run `npm run build` to copy templates |
| **API Rate Limits** | Reduce `MAX_CONCURRENT_UPLOADS` setting |

The application includes automatic retry with exponential backoff, circuit breaker patterns, and detailed logging for troubleshooting.

## 📄 License

ISC License
