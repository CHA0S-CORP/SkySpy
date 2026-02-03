export interface AdminConfig {
  id: string;
  category: string;
  key: string;
  value: string | number | boolean | Record<string, unknown>;
  type: 'string' | 'number' | 'boolean' | 'json';
  description: string;
  updated_at: string;
}

export interface ConfigCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface AuditLogEntry {
  id: string;
  user: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface ConfigExport {
  version: string;
  timestamp: string;
  configs: AdminConfig[];
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  permissions: string[];
}
