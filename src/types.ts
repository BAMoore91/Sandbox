export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

export interface UserSession {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  orgId?: string; // default / last used org
}

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  license_number: string | null;
  timezone: string;
  settings: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface OrgMemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface PatronScanRow {
  id: string;
  org_id: string;
  scanned_by: string;
  dl_number_hash: string;
  dl_state: string;
  dl_country: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  date_of_birth: string;
  expiration_date: string | null;
  age_at_scan: number;
  is_of_age: number;
  is_expired: number;
  checked_in_at: string;
  checked_out_at: string | null;
  status: 'inside' | 'left' | 'denied';
  created_at: string;
}
