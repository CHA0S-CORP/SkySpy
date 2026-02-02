# Socket.IO Documentation Structure

This directory contains the multi-page Socket.IO API documentation for SkySpy, formatted for ReadMe's documentation platform.

## File Structure

```
socketio/
├── 00-overview.md                    # Introduction, architecture, key features
├── 01-connection.md                  # Connection, namespaces, authentication
├── 02-message-protocol.md            # Events, payloads, request/response pattern
├── 03-main-namespace.md              # Aircraft tracking, safety, alerts, stats
├── 04-specialized-namespaces.md      # Audio, Cannonball, ACARS namespaces
├── 05-client-implementation.md       # Complete JavaScript and Python examples
└── 06-troubleshooting.md             # Debugging, rate limits, security, errors
```

## ReadMe Integration

Each file includes:
- **Frontmatter** with title, slug, excerpt, category, and position
- **ReadMe MDX components** for enhanced visual presentation:
  - Callouts (Info, Warning, Success, Danger)
  - Code blocks with language tags and titles
  - Parameter tables using `[block:parameters]`
  - Tabbed code examples for multiple languages
  - Mermaid diagrams for architecture and flows
  - Navigation cards and links

## Importing to ReadMe

1. Create a new category "Socket.IO API" in ReadMe
2. Upload files in order (00 → 06) to maintain proper navigation
3. Verify frontmatter slugs match your URL structure
4. Adjust `category` field if your ReadMe uses different category identifiers

## Key Features

- **Progressive disclosure**: Overview → Connection → Protocol → Implementation
- **Multi-language support**: JavaScript and Python examples throughout
- **Visual design**: Extensive use of callouts, tables, and diagrams
- **Developer-friendly**: Complete working examples, troubleshooting guides
- **Production-ready**: Security best practices, error handling, performance tips

## Content Highlights

### 00-overview.md
- Architecture diagram
- Feature comparison table
- What you can stream (8 topics/namespaces)
- Performance characteristics
- Navigation cards to other sections

### 01-connection.md
- Namespace comparison table
- Authentication flow diagram
- Token types and formats
- Connection lifecycle
- Complete connection examples (JS + Python)

### 02-message-protocol.md
- Client → Server events reference
- Server → Client events reference
- Batch message handling
- Request/response pattern with helper functions
- Rate limits table

### 03-main-namespace.md
- Topic subscription guide
- Aircraft events and payload fields (13+ fields documented)
- Safety events with severity levels
- Custom alerts
- Request types (20+ types documented)
- Complete examples for all event types

### 04-specialized-namespaces.md
- Audio namespace (transmissions, transcriptions)
- Cannonball namespace (mobile threat detection)
- ACARS namespace (optional dedicated stream)
- Threat detection logic and levels
- Flow diagrams for each namespace

### 05-client-implementation.md
- Complete SkySpyClient class (JavaScript)
- Complete SkySpyClient class (Python with async/await)
- Installation instructions
- Best practices tables (5 categories)
- Unit test examples
- Production deployment guidelines

### 06-troubleshooting.md
- Common issues tables (4 categories)
- Debugging techniques (client + server)
- Network inspection with DevTools
- Rate limits and batching
- Security checklist (7 best practices)
- Error messages reference (8+ errors)
- Performance optimization tips

## Maintenance

- Keep code examples synchronized with actual API changes
- Update version numbers in frontmatter when making significant changes
- Test all code examples before publishing
- Verify links between pages remain valid

## Migration Notes

This structure replaces the single `06-websocket-api.md` file with a comprehensive multi-page chapter. The original file has been deleted.

### Changes from Original:
- ✅ Split into 7 focused pages for better navigation
- ✅ Added extensive ReadMe MDX components
- ✅ Enhanced visual presentation with callouts and tables
- ✅ Added complete client implementation examples
- ✅ Added troubleshooting and debugging section
- ✅ Added architecture diagrams
- ✅ Added best practices and security guidelines
- ✅ Added navigation links between sections

## Contact

For questions or improvements, see the project README or GitHub issues.
