---
title: Admin Configuration Management
slug: admin-configuration
category:
  uri: uri-that-does-not-map-to-operations
content:
  excerpt: >-
    Manage runtime-editable system settings with full audit logging and
    environment variable override support
privacy:
  view: public
---

SkySpy's Admin Configuration Management system provides administrators with runtime-editable control over approximately 70 system settings across 12 functional categories. All configuration changes are stored in the database, fully audit-logged, and can be overridden by environment variables when needed.

## Overview

The configuration system enables admins to modify critical system settings without requiring code changes, deployments, or container restarts (for most settings). This provides operational flexibility while maintaining security through role-based access control and comprehensive audit trails.

### Key Features

- **Database-backed settings** with environment variable override capability
- **~70 runtime-editable settings** organized across 12 categories
- **Full audit logging** of all changes with user, timestamp, and IP tracking
- **Validation rules** prevent invalid configurations
- **Bulk operations** for efficient multi-setting updates
- **Export/Import** functionality for configuration backups and transfers
- **Sensitive value masking** with secure reveal mechanism
- **Web UI** with category navigation and pending changes tracking

> 📘 Admin Access Required
>
> All configuration endpoints require the `system.manage` permission, which is only available to admin and superadmin roles.

## Configuration Categories

The system organizes settings into 12 functional categories:

### 1. ADS-B Sources
Settings for aircraft data receivers and streaming:
- Ultrafeeder host and port configuration
- Dump978 UAT receiver settings
- Aircraft stream polling intervals
- Connection timeout settings

### 2. Location
Feeder location for distance calculations:
- Latitude coordinate
- Longitude coordinate
- Elevation settings

### 3. Safety Monitoring
Thresholds for safety event detection:
- Vertical speed change thresholds
- Proximity alert distances
- Altitude change thresholds
- Safety monitoring intervals

### 4. Alerts
Custom alert system configuration:
- Proximity alert settings
- Watch list alert rules
- Military aircraft alerts
- Custom alert thresholds

### 5. ACARS
ACARS and VDLM2 message decoding:
- ACARS decoder port settings
- VDLM2 decoder configuration
- Message processing settings

### 6. Storage
Data storage and caching settings:
- Photo cache directory paths
- Radio storage configuration
- Data retention settings
- Cache size limits

### 7. Transcription
Audio transcription settings:
- Whisper model configuration
- Transcription API endpoints
- Processing batch sizes

### 8. External APIs
Third-party API integrations:
- CheckWX weather API
- AVWX aviation weather
- OpenAIP airport data
- OpenSky Network integration
- API keys and endpoints

### 9. Monitoring
System monitoring and observability:
- Prometheus metrics configuration
- Sentry error tracking
- Health check settings

### 10. Notifications
Push notification delivery:
- Notification provider settings
- Push token management
- Delivery preferences

### 11. Aircraft Data
Aircraft enrichment data sources:
- Registration lookup services
- Aircraft database APIs
- Enrichment priorities

### 12. Display
UI display preferences:
- Default map settings
- Color schemes
- Display units

## API Reference

All configuration endpoints are available under `/api/v1/admin/config/`.

### Authentication

All requests require JWT authentication with the `system.manage` permission:

```bash
# Set your JWT token
export JWT_TOKEN="your-jwt-token-here"
```

### List All Configurations

Get all configurations grouped by category.

```http
GET /api/v1/admin/config/
```

**Query Parameters:**
- `category` (optional) - Filter by specific category

**Response:**
```json
{
  "categories": [
    {
      "category": "adsb_sources",
      "category_display": "ADS-B Sources",
      "has_changes": false,
      "configs": [
        {
          "key": "adsb.ultrafeeder_host",
          "category": "adsb_sources",
          "value": "ultrafeeder",
          "value_type": "string",
          "display_name": "Ultrafeeder Host",
          "description": "Hostname or IP address of the Ultrafeeder ADS-B receiver",
          "validation_rules": {
            "required": true
          },
          "env_var": "ULTRAFEEDER_HOST",
          "default_value": "ultrafeeder",
          "requires_restart": true,
          "is_sensitive": false,
          "is_readonly": false,
          "sort_order": 0,
          "has_env_override": false,
          "updated_at": "2026-01-15T10:30:00Z",
          "updated_by_username": "admin"
        }
      ]
    }
  ],
  "total_count": 68
}
```

**Example:**
```bash
curl -X GET "https://skyspy.example.com/api/v1/admin/config/" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

### Get Single Configuration

Retrieve a specific configuration by key.

```http
GET /api/v1/admin/config/{key}/
```

**Query Parameters:**
- `reveal` (optional, boolean) - Set to `true` to reveal masked sensitive values

**Response:**
```json
{
  "key": "safety.vs_change_threshold",
  "category": "safety",
  "value": "2000",
  "value_type": "integer",
  "display_name": "VS Change Threshold",
  "description": "Vertical speed change threshold in feet/minute for safety alerts",
  "validation_rules": {
    "min": 500,
    "max": 10000
  },
  "env_var": "SAFETY_VS_THRESHOLD",
  "default_value": "2000",
  "requires_restart": false,
  "is_sensitive": false,
  "is_readonly": false,
  "sort_order": 1,
  "has_env_override": false,
  "updated_at": "2026-01-20T14:22:00Z",
  "updated_by_username": "admin",
  "actual_value": null
}
```

**Example:**
```bash
curl -X GET "https://skyspy.example.com/api/v1/admin/config/safety.vs_change_threshold/" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

### Update Configuration

Update a single configuration value.

```http
PATCH /api/v1/admin/config/{key}/
```

**Request Body:**
```json
{
  "value": "2500"
}
```

**Response:**
```json
{
  "key": "safety.vs_change_threshold",
  "category": "safety",
  "value": "2500",
  "value_type": "integer",
  "display_name": "VS Change Threshold",
  "description": "Vertical speed change threshold in feet/minute for safety alerts",
  "validation_rules": {
    "min": 500,
    "max": 10000
  },
  "env_var": "SAFETY_VS_THRESHOLD",
  "default_value": "2000",
  "requires_restart": false,
  "is_sensitive": false,
  "is_readonly": false,
  "sort_order": 1,
  "has_env_override": false,
  "updated_at": "2026-02-01T09:15:00Z",
  "updated_by_username": "admin"
}
```

**Example:**
```bash
curl -X PATCH "https://skyspy.example.com/api/v1/admin/config/safety.vs_change_threshold/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "2500"}'
```

> 🚧 Validation Errors
>
> If the provided value fails validation (e.g., outside min/max range, invalid type), the API will return a 400 error with details about the validation failure.

### Bulk Update Configurations

Update multiple configurations in a single request.

```http
POST /api/v1/admin/config/bulk_update/
```

**Request Body:**
```json
{
  "updates": {
    "safety.vs_change_threshold": "2500",
    "safety.proximity_distance": "5.0",
    "alerts.military_alerts_enabled": "true"
  }
}
```

**Response:**
```json
{
  "updated": [
    "safety.vs_change_threshold",
    "safety.proximity_distance",
    "alerts.military_alerts_enabled"
  ],
  "errors": {},
  "requires_restart": []
}
```

**Example:**
```bash
curl -X POST "https://skyspy.example.com/api/v1/admin/config/bulk_update/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "updates": {
      "safety.vs_change_threshold": "2500",
      "safety.proximity_distance": "5.0"
    }
  }'
```

> ✅ Partial Success
>
> Bulk updates process all configurations independently. If some fail validation, the successful updates are still applied, and errors are returned for the failed ones.

### Get Configuration Schema

Retrieve the complete configuration schema for form generation.

```http
GET /api/v1/admin/config/schema/
```

**Response:**
```json
{
  "categories": [
    {
      "value": "adsb_sources",
      "label": "ADS-B Sources"
    },
    {
      "value": "location",
      "label": "Location"
    }
  ],
  "value_types": [
    {
      "value": "string",
      "label": "String"
    },
    {
      "value": "integer",
      "label": "Integer"
    },
    {
      "value": "float",
      "label": "Float"
    },
    {
      "value": "boolean",
      "label": "Boolean"
    },
    {
      "value": "json",
      "label": "JSON"
    },
    {
      "value": "secret",
      "label": "Secret"
    }
  ],
  "configs": [
    // Array of all configuration objects
  ]
}
```

**Example:**
```bash
curl -X GET "https://skyspy.example.com/api/v1/admin/config/schema/" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

### Reset Configurations to Default

Reset one or more configurations to their default values.

```http
POST /api/v1/admin/config/reset_to_default/
```

**Request Body:**
```json
{
  "keys": [
    "safety.vs_change_threshold",
    "safety.proximity_distance"
  ]
}
```

**Response:**
```json
{
  "reset": [
    "safety.vs_change_threshold",
    "safety.proximity_distance"
  ],
  "errors": {}
}
```

**Example:**
```bash
curl -X POST "https://skyspy.example.com/api/v1/admin/config/reset_to_default/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "keys": ["safety.vs_change_threshold"]
  }'
```

### View Audit Log

Retrieve the configuration change history.

```http
GET /api/v1/admin/config/audit_log/
```

**Query Parameters:**
- `config_key` (optional) - Filter by specific configuration key
- `hours` (optional) - Limit to changes within the last N hours
- `limit` (optional, default: 100, max: 500) - Maximum entries to return

**Response:**
```json
{
  "audit_log": [
    {
      "id": 1234,
      "config_key": "safety.vs_change_threshold",
      "config_display_name": "VS Change Threshold",
      "old_value": "2000",
      "new_value": "2500",
      "changed_by": 5,
      "changed_by_username": "admin",
      "changed_at": "2026-02-01T09:15:00Z",
      "ip_address": "192.168.1.100"
    }
  ],
  "count": 1
}
```

**Example:**
```bash
# View all changes in the last 24 hours
curl -X GET "https://skyspy.example.com/api/v1/admin/config/audit_log/?hours=24" \
  -H "Authorization: Bearer ${JWT_TOKEN}"

# View changes to a specific configuration
curl -X GET "https://skyspy.example.com/api/v1/admin/config/audit_log/?config_key=safety.vs_change_threshold" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

> 📘 Audit Log Retention
>
> Audit logs are retained indefinitely for compliance purposes. Sensitive values are automatically masked in the audit log responses.

### Export Configurations

Export all configurations as JSON for backup or transfer.

```http
GET /api/v1/admin/config/export/
```

**Query Parameters:**
- `include_sensitive` (optional, boolean) - Include sensitive values in export (default: false)

**Response:**
```json
{
  "configs": {
    "safety.vs_change_threshold": {
      "value": "2500",
      "category": "safety",
      "value_type": "integer"
    },
    "adsb.ultrafeeder_host": {
      "value": "ultrafeeder",
      "category": "adsb_sources",
      "value_type": "string"
    }
  },
  "exported_at": "2026-02-01T10:00:00Z",
  "version": "1.0",
  "include_sensitive": false
}
```

**Example:**
```bash
# Export non-sensitive configs
curl -X GET "https://skyspy.example.com/api/v1/admin/config/export/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -o config_backup.json

# Export including sensitive values
curl -X GET "https://skyspy.example.com/api/v1/admin/config/export/?include_sensitive=true" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -o config_backup_full.json
```

> ❗️ Security Warning
>
> When exporting with `include_sensitive=true`, the response will contain API keys, tokens, and other secrets in plain text. Store these exports securely and never commit them to version control.

### Import Configurations

Import configurations from a previously exported JSON file.

```http
POST /api/v1/admin/config/import_config/
```

**Request Body:**
```json
{
  "configs": {
    "safety.vs_change_threshold": {
      "value": "2500"
    },
    "adsb.ultrafeeder_host": "new-host"
  },
  "skip_readonly": true,
  "dry_run": false
}
```

**Response:**
```json
{
  "imported": 2,
  "skipped": 0,
  "errors": {},
  "dry_run": false
}
```

**Example:**
```bash
# Dry run to validate import
curl -X POST "https://skyspy.example.com/api/v1/admin/config/import_config/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "configs": {
      "safety.vs_change_threshold": "2500"
    },
    "dry_run": true
  }'

# Actual import
curl -X POST "https://skyspy.example.com/api/v1/admin/config/import_config/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @config_backup.json
```

> 🚧 Import Behavior
>
> - By default, read-only configurations are skipped during import
> - Use `dry_run: true` to validate the import without making changes
> - Each configuration is validated against its rules before import
> - Failed imports are reported in the `errors` object without rolling back successful imports

### Validate Configuration Value

Validate a configuration value without saving it.

```http
POST /api/v1/admin/config/validate/
```

**Request Body:**
```json
{
  "key": "safety.vs_change_threshold",
  "value": "15000"
}
```

**Response:**
```json
{
  "valid": false,
  "errors": [
    "Value must be at most 10000"
  ]
}
```

**Example:**
```bash
curl -X POST "https://skyspy.example.com/api/v1/admin/config/validate/" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "safety.vs_change_threshold",
    "value": "2500"
  }'
```

### Get Configurations by Category

Retrieve all configurations for a specific category.

```http
GET /api/v1/admin/config/category/{category}/
```

**Path Parameters:**
- `category` - One of: `adsb_sources`, `location`, `safety`, `alerts`, `acars`, `storage`, `transcription`, `external_apis`, `monitoring`, `notifications`, `aircraft_data`, `display`, `advanced`

**Response:**
```json
{
  "category": "safety",
  "category_display": "Safety Monitoring",
  "has_changes": false,
  "configs": [
    // Array of configuration objects in this category
  ]
}
```

**Example:**
```bash
curl -X GET "https://skyspy.example.com/api/v1/admin/config/category/safety/" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

### Reveal Sensitive Value

Retrieve the unmasked value of a sensitive configuration.

```http
POST /api/v1/admin/config/{key}/reveal/
```

**Response:**
```json
{
  "key": "external_apis.checkwx_api_key",
  "value": "sk_live_abc123def456...",
  "revealed_at": "2026-02-01T10:30:00Z"
}
```

**Example:**
```bash
curl -X POST "https://skyspy.example.com/api/v1/admin/config/external_apis.checkwx_api_key/reveal/" \
  -H "Authorization: Bearer ${JWT_TOKEN}"
```

> 📘 Audit Trail
>
> All reveal operations are logged in the system logs for security auditing. This action requires the `system.manage` permission and is tracked with the requesting user's identity.

## Frontend Access

The Admin Configuration interface is accessible through the web dashboard for authorized users.

### Accessing the Configuration UI

1. **Navigate to Admin Panel**: Click the "Admin" tab in the sidebar (only visible to admin/superadmin users)
2. **Select Configuration**: Choose "System Configuration" from the admin menu
3. **Browse by Category**: Use the category navigation to explore different setting groups

### Key UI Features

**Category Navigation**
- Settings are organized by category for easy browsing
- Each category displays the count of settings it contains
- Categories with pending changes are highlighted

**Pending Changes Tracking**
- Modified values are tracked until saved
- "Save All" button applies all pending changes at once
- Individual save buttons available for each setting

**Restart Warning**
- Settings marked with `requires_restart: true` display a warning icon
- After saving such settings, a notification reminds admins to restart the service
- Restart requirement is clearly indicated in the UI

**Audit Log Viewer**
- Access full change history from the UI
- Filter by configuration key, user, or time range
- View old and new values for each change

**Export/Import Tools**
- Export current configuration as JSON
- Import configuration from file
- Dry-run validation before actual import

**Sensitive Value Management**
- Sensitive fields show masked values (****)
- "Reveal" button available for authorized viewing
- Reveals are logged for security auditing

## Environment Variable Override

Environment variables always take precedence over database-stored values. This design ensures that critical settings can be controlled at the infrastructure level without risk of being modified through the UI.

### How It Works

1. When a configuration value is requested, the system first checks for an environment variable
2. If the environment variable exists, its value is used
3. If no environment variable is set, the database value is used
4. If neither exists, the default value is returned

### Checking for Overrides

The API response includes a `has_env_override` field indicating whether an environment variable is currently overriding the database value:

```json
{
  "key": "adsb.ultrafeeder_host",
  "value": "ultrafeeder-prod",
  "has_env_override": true,
  "env_var": "ULTRAFEEDER_HOST"
}
```

> 📘 Override Behavior
>
> When `has_env_override` is `true`, changes to the configuration via the API will be saved to the database but won't take effect until the environment variable is removed or the service is restarted.

### Common Use Cases

**Production Safety**
```bash
# Prevent accidental changes to critical production settings
export ULTRAFEEDER_HOST="ultrafeeder-prod.internal"
export DATABASE_URL="postgresql://..."
```

**Environment-Specific Settings**
```bash
# Development
export SENTRY_ENABLED="false"
export DEBUG_MODE="true"

# Production
export SENTRY_ENABLED="true"
export DEBUG_MODE="false"
```

**Secrets Management**
```bash
# Store sensitive values in environment (from secrets manager)
export CHECKWX_API_KEY="${VAULT_CHECKWX_KEY}"
export OPENSKY_API_KEY="${VAULT_OPENSKY_KEY}"
```

## Permissions and Security

### Required Permissions

All configuration endpoints require the `system.manage` permission, which is granted only to:
- **Superadmin** - Full system access
- **Admin** - System administration rights

Regular users and viewers cannot access or modify system configuration.

### Security Features

**Audit Logging**
- Every configuration change is logged with:
  - User who made the change
  - Timestamp of the change
  - Old and new values
  - IP address of the client
- Audit logs are immutable and retained indefinitely

**Sensitive Value Masking**
- Configurations marked as `is_sensitive` have their values masked in API responses
- Masked values display as `****` in list and detail endpoints
- Explicit "reveal" action required to view actual values
- Reveal actions are logged for security auditing

**Validation Rules**
- All values are validated against defined rules before saving
- Validation includes type checking, range validation, pattern matching, and custom rules
- Invalid values are rejected with detailed error messages

**Read-Only Configurations**
- Some configurations are marked as `is_readonly`
- Read-only configs can only be modified via environment variables
- Attempts to modify read-only configs via API return 403 Forbidden

**IP Address Tracking**
- All changes include the client IP address in the audit log
- Useful for investigating unauthorized access or suspicious changes

## Configuration Value Types

The system supports six value types with automatic serialization and validation:

### String
Basic text values with optional pattern validation.

```json
{
  "key": "adsb.ultrafeeder_host",
  "value_type": "string",
  "value": "ultrafeeder",
  "validation_rules": {
    "pattern": "^[a-z0-9.-]+$"
  }
}
```

### Integer
Whole numbers with optional min/max constraints.

```json
{
  "key": "safety.vs_change_threshold",
  "value_type": "integer",
  "value": "2500",
  "validation_rules": {
    "min": 500,
    "max": 10000
  }
}
```

### Float
Decimal numbers with optional min/max constraints.

```json
{
  "key": "safety.proximity_distance",
  "value_type": "float",
  "value": "5.0",
  "validation_rules": {
    "min": 0.1,
    "max": 50.0
  }
}
```

### Boolean
True/false values (accepts various formats: true/false, 1/0, yes/no, on/off).

```json
{
  "key": "alerts.military_alerts_enabled",
  "value_type": "boolean",
  "value": "true"
}
```

### JSON
Complex structured data stored as JSON.

```json
{
  "key": "display.default_map_settings",
  "value_type": "json",
  "value": "{\"zoom\": 9, \"center\": [37.7749, -122.4194]}"
}
```

### Secret
Sensitive values that are masked in responses.

```json
{
  "key": "external_apis.checkwx_api_key",
  "value_type": "secret",
  "value": "****",
  "is_sensitive": true
}
```

## Validation Rules

Configurations can define validation rules to ensure data integrity:

### Required
```json
{
  "validation_rules": {
    "required": true
  }
}
```

### Min/Max (for numbers)
```json
{
  "validation_rules": {
    "min": 0,
    "max": 100
  }
}
```

### Pattern (regex for strings)
```json
{
  "validation_rules": {
    "pattern": "^https?://"
  }
}
```

### Choices (enum values)
```json
{
  "validation_rules": {
    "choices": ["production", "staging", "development"]
  }
}
```

## Best Practices

### Configuration Management

**Use Categories Effectively**
- Keep related settings together in appropriate categories
- Use the category filter to focus on specific functional areas

**Leverage Bulk Updates**
- When making multiple related changes, use bulk update for atomicity
- Reduces audit log clutter compared to individual updates

**Test with Validation Endpoint**
- Use the validation endpoint before updating critical settings
- Prevents failed updates and unnecessary audit log entries

**Export Regular Backups**
- Export configuration regularly for disaster recovery
- Store exports securely outside the application
- Document the purpose and date of each export

**Use Dry-Run for Imports**
- Always test imports with `dry_run: true` first
- Validates the import without making changes
- Identifies issues before committing changes

### Security Best Practices

**Protect Sensitive Exports**
- Never commit exports with sensitive data to version control
- Encrypt sensitive exports when storing or transferring
- Use `include_sensitive: false` unless absolutely necessary

**Review Audit Logs Regularly**
- Monitor for unexpected configuration changes
- Investigate changes from unusual IP addresses
- Track who is revealing sensitive values

**Use Environment Variables for Critical Settings**
- Override critical production settings with environment variables
- Prevents accidental modification through the UI
- Provides infrastructure-level control

**Minimize Sensitive Value Reveals**
- Only reveal sensitive values when absolutely necessary
- Remember that reveals are logged and auditable
- Consider using environment variables instead of storing secrets in the database

### Operational Best Practices

**Plan for Restarts**
- Review which settings require restart before making changes
- Batch restart-required changes together when possible
- Schedule restarts during maintenance windows

**Document Configuration Changes**
- Add notes about why changes were made
- Reference related issues or tickets in commit messages
- Maintain a changelog for significant configuration updates

**Test in Non-Production First**
- Test configuration changes in development/staging environments
- Use export/import to promote tested configs to production
- Validate impact before applying to production

## Error Handling

The API uses standard HTTP status codes and provides detailed error messages:

### 400 Bad Request
Invalid input or validation failure.

```json
{
  "value": [
    "Value must be at least 500",
    "Value must be at most 10000"
  ]
}
```

### 403 Forbidden
Attempting to modify a read-only configuration.

```json
{
  "error": "Configuration is read-only"
}
```

### 404 Not Found
Configuration key does not exist.

```json
{
  "error": "Configuration not found"
}
```

### 401 Unauthorized
Missing or invalid authentication token.

```json
{
  "detail": "Authentication credentials were not provided."
}
```

## Troubleshooting

### Changes Not Taking Effect

**Check for Environment Variable Override**
- Verify `has_env_override` field in the API response
- If true, the environment variable is taking precedence
- Remove or update the environment variable and restart the service

**Verify Restart Requirement**
- Check if the configuration has `requires_restart: true`
- If so, restart the service for changes to take effect
- The UI displays a restart warning for such settings

### Validation Errors

**Review Validation Rules**
- Check the `validation_rules` field for constraints
- Ensure the value meets all requirements (type, min/max, pattern, choices)
- Use the validation endpoint to test values before updating

**Type Conversion Issues**
- Ensure string values match the expected format for the type
- For booleans, use: "true", "false", "1", "0", "yes", "no"
- For JSON, ensure valid JSON syntax

### Import Failures

**Check Configuration Keys**
- Ensure all keys in the import exist in the system
- Non-existent keys will be reported in the errors object

**Validate Against Rules**
- Run a dry-run import first to identify validation issues
- Fix any reported errors before actual import
- Check that value types match the configuration definitions

### Permission Denied

**Verify User Role**
- Configuration access requires admin or superadmin role
- Check that your account has the `system.manage` permission
- Contact a system administrator if you need access

## Next Steps

- [User and Role Management](/docs/user-management) - Learn about managing user permissions
- [API Authentication](/docs/authentication) - Understand authentication methods
- [Audit Logging](/docs/audit-logging) - Explore system-wide audit capabilities
- [Backup and Recovery](/docs/backup-recovery) - Configuration backup strategies

---

🤖 For questions or issues with the Configuration Management system, please contact your system administrator or refer to the [SkySpy Documentation](/).
