# Doorman – Setup & Deployment Guide

Age verification and patron tracking for bars/venues. Hosted on Cloudflare.

---

## Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages + Workers |
| API runtime | Cloudflare Workers (Hono.js) |
| Database | Cloudflare D1 (SQLite) |
| Sessions | Cloudflare KV |
| Frontend | React 18 + Vite |
| Barcode scanning | @zxing/browser (PDF417) |
| Auth | PBKDF2 password hashing + HS256 JWT |

---

## Prerequisites

- Node.js 18+
- A Cloudflare account (free tier works)
- `wrangler` CLI: `npm install -g wrangler`

---

## Local Development

### 1. Install dependencies

```bash
npm install
cd client && npm install && cd ..
```

### 2. Configure secrets

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set JWT_SECRET to a random 32+ char string
```

### 3. Create D1 database (local)

```bash
# Create the database
wrangler d1 create doorman-db

# Copy the database_id from the output into wrangler.toml
# Then run migrations locally:
npm run db:migrate:local

# Seed with demo data (optional)
npm run db:seed:local
```

### 4. Create KV namespace (local uses auto namespace)

```bash
wrangler kv:namespace create SESSIONS
# Copy the id into wrangler.toml
```

### 5. Start dev server

```bash
# Terminal 1: build & watch client
cd client && npm run dev

# Terminal 2: start Worker (proxies /api to Worker, / to Vite)
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Production Deployment

### 1. Create production D1 database

```bash
wrangler d1 create doorman-db
# Update wrangler.toml with the database_id
npm run db:migrate
```

### 2. Create KV namespace

```bash
wrangler kv:namespace create SESSIONS
# Update wrangler.toml with the id
```

### 3. Set JWT_SECRET

```bash
wrangler secret put JWT_SECRET
# Paste a 32+ char random string
```

### 4. Build frontend

```bash
cd client && npm run build
```

### 5. Deploy

```bash
npm run deploy
```

---

## First-Time Setup

1. Visit your deployed URL
2. Click **Register** – create your admin account
3. Enter your bar's name to create the organization
4. Go to **Admin → Team Members** to add staff
5. Staff log in on their mobile devices and go to **Scan**

---

## Multi-Tenant Architecture

```
Organization (Tenant)
├── Members (users with roles)
│   ├── owner   – full access, billing
│   ├── admin   – manage settings & staff
│   └── staff   – scan IDs, view counts
├── Patron Scans (check-ins)
└── Denied Entries (log)
```

A user can belong to **multiple organizations** (e.g., a manager who works at two venues). They switch orgs via the dropdown in the top bar.

---

## AAMVA PDF417 Format

US driver's licenses encode data in the AAMVA standard. The scanner parses:

| Field | Code | Example |
|---|---|---|
| Last Name | DCS | SMITH |
| First Name | DAC | JOHN |
| Date of Birth | DBB | 01011990 |
| Expiration | DBA | 01012025 |
| DL Number | DAQ | D123456789 |
| State | DAJ | TX |

Age is computed server-side from DOB at check-in time.

---

## Privacy & Compliance

- DL numbers are stored as **SHA-256 hashes** (one-way) – cannot be reversed
- Full address data is **not stored** in the database
- Sensitive fields (SSN if present) are never persisted
- All data is scoped to the organization (tenant isolation via `org_id`)
- Consider your state's data retention laws; the app does not auto-purge records

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | HS256 signing secret (32+ chars) |
| `ENVIRONMENT` | No | `production` or `development` |
