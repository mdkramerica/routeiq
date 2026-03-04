# TerritoryPilot Codebase Review & Refactoring Plan

**Date:** 2026-03-03
**Scope:** Full codebase audit — security, efficiency, architecture, and quality

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Security Vulnerabilities](#2-security-vulnerabilities)
3. [Backend Issues & Refactoring](#3-backend-issues--refactoring)
4. [Frontend Issues & Refactoring](#4-frontend-issues--refactoring)
5. [Database & Schema](#5-database--schema)
6. [Performance & Efficiency](#6-performance--efficiency)
7. [Code Organization & Structure](#7-code-organization--structure)
8. [Missing Features & Gaps](#8-missing-features--gaps)
9. [Prioritized Action Plan](#9-prioritized-action-plan)

---

## 1. Architecture Overview

### Current Stack
- **Backend:** Node.js + Express (single `server.js`, 623 lines)
- **Frontend:** 4 vanilla HTML files with inline CSS/JS (~3,200 lines total)
- **Database:** Supabase (PostgreSQL) with RLS
- **External APIs:** OpenAI, Google Maps, Stripe, Resend
- **Auth:** Supabase Auth (JWT) + custom middleware

### File Layout
```
territorypilot/
├── index.html          (823 lines — landing page)
├── signup.html         (253 lines — registration)
├── login.html          (302 lines — login)
├── dashboard.html      (1175 lines — SPA app)
├── server.js           (623 lines — all API routes)
├── schema.sql          (83 lines — database schema)
├── middleware/auth.js   (34 lines — JWT validation)
├── package.json
└── .env.example
```

### What's Good
- RLS on every table provides defense-in-depth
- Server-side user_id filtering on all queries (double-layered with RLS)
- XSS protection via the `esc()` helper on user-rendered content
- Supabase Auth handles password hashing/JWT minting (not custom crypto)
- Stripe webhook signature verification is present
- Lazy client init allows graceful startup without env vars
- Mobile-first responsive design

---

## 2. Security Vulnerabilities

### CRITICAL

#### 2.1 — No Rate Limiting on Auth Endpoints
**File:** `server.js:43-121`
**Risk:** Brute-force login, credential stuffing, magic-link abuse
```
POST /api/auth/register   — no limit
POST /api/auth/login      — no limit
POST /api/auth/magic-link — no limit (could spam victim's inbox)
```
**Fix:** Add `express-rate-limit` with strict limits on auth routes (e.g., 5 attempts/min for login, 3/hr for magic link).

#### 2.2 — `app.use(express.static(__dirname))` Serves Entire Project Root
**File:** `server.js:33`
**Risk:** Exposes `server.js`, `package.json`, `schema.sql`, `.env.example`, `middleware/auth.js`, `node_modules/`, and any `.env` file if present. An attacker can read server source code, schema, and dependency versions.
```js
app.use(express.static(__dirname)); // DANGER: serves EVERYTHING
```
**Fix:** Create a `public/` directory, move HTML files there, and serve only that:
```js
app.use(express.static(path.join(__dirname, 'public')));
```

#### 2.3 — CORS is Fully Open
**File:** `server.js:30`
```js
app.use(cors()); // allows ALL origins
```
**Risk:** Any website can make authenticated requests to the API if the user's browser has a valid token. This enables CSRF-like attacks from malicious sites.
**Fix:** Restrict to your domain:
```js
app.use(cors({ origin: process.env.APP_URL, credentials: true }));
```

#### 2.4 — Internal Error Messages Leaked to Clients
**Files:** `server.js:68,95,119` and throughout
```js
res.status(500).json({ error: err.message }); // leaks stack/internal details
```
**Risk:** Stack traces, Supabase internal errors, and dependency details exposed to attackers.
**Fix:** Log the real error server-side, return a generic message to the client:
```js
console.error('Register error:', err);
res.status(500).json({ error: 'An unexpected error occurred' });
```

#### 2.5 — Supabase Service Key Used for All Operations
**File:** `server.js:26`, `middleware/auth.js:4`
The server uses `SUPABASE_SERVICE_KEY` (admin/service role) for all database queries. The service key **bypasses RLS**. If the backend code has any logic bug where `user_id` isn't filtered, RLS won't save you because the service key skips it entirely.
**Fix:** Use a separate Supabase client with the `anon` key + user JWT for data queries. Reserve the service key only for admin operations (webhook processing, user creation).

### HIGH

#### 2.6 — No Input Validation/Sanitization
**File:** `server.js:143-176` (account creation), and most endpoints
- No validation on email format, phone format, priority range (could be -1 or 999)
- No string length limits (name, notes, address could be megabytes)
- Account `priority` accepts any value — no check for 1/2/3
- `visit_frequency_days` has no bounds check
- `plan_date` is not validated as a date
- CSV import trusts all column values from uploaded file
**Fix:** Add a validation library (e.g., `zod`, `joi`, or `express-validator`) and validate every input.

#### 2.7 — CSV Import Has No Size Limit or Field Validation
**File:** `server.js:247-271`
- `multer({ storage: multer.memoryStorage() })` has no file size limit — an attacker can upload a gigabyte file and crash the server (OOM)
- CSV rows are blindly inserted into the database with no field validation
- All rows fire geocoding requests in parallel with `Promise.all` — 10,000 rows = 10,000 Google Maps API calls simultaneously
**Fix:**
```js
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});
```
Add row validation, limit import to ~500 rows, and batch geocoding requests.

#### 2.8 — No Ownership Check on Brief Generation
**File:** `server.js:392-394`
```js
const { data: account } = await supabase
  .from('accounts').select('*').eq('id', accountId).single();
```
This query does NOT filter by `user_id`. Any authenticated user can generate briefs for any other user's accounts and see their account details (name, contact, notes, visit history). The cached brief check on line 378 does filter by `user_id`, but if no cached brief exists, it falls through to the unfiltered query.
**Fix:** Add `.eq('user_id', req.user.id)` to the account lookup.

#### 2.9 — No Ownership Check on Voice Log Account Update
**File:** `server.js:437-495`
The voice log endpoint takes `accountId` from the request body but does not verify that the account belongs to `req.user.id` before inserting a call_log. The `last_visited` update on line 488-492 does check `user_id`, but the call_log insert on line 477-484 could create logs against another user's account.
**Fix:** Verify account ownership before processing.

#### 2.10 — `localStorage` for Token Storage
**File:** `dashboard.html:634`, `signup.html:237`, `login.html:269`
`localStorage` is accessible to any JavaScript running on the page, including injected scripts (XSS). If any XSS vector exists (e.g., a future feature that renders unsanitized content), the token is immediately compromised.
**Fix:** Use `httpOnly` cookies for token storage. This requires backend changes to set/read cookies instead of Authorization headers.

### MEDIUM

#### 2.11 — No Helmet / Security Headers
Missing `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, etc.
**Fix:** `npm install helmet` and add `app.use(helmet())`.

#### 2.12 — Stripe Webhook Error Message Leaks Internal Details
**File:** `server.js:597`
```js
return res.status(400).send(`Webhook Error: ${err.message}`);
```
**Fix:** Return a generic 400 response.

#### 2.13 — No Password Strength Validation on Server
**File:** `server.js:45`
Only checks `!password` (truthy). A 1-character password would pass. The frontend enforces `minlength="8"` but the backend doesn't.
**Fix:** Validate `password.length >= 8` on the server.

---

## 3. Backend Issues & Refactoring

### 3.1 — Monolithic `server.js` (623 lines, all routes in one file)
**Problem:** Difficult to maintain, test, and review. Every change touches the same file.
**Fix:** Split into route modules:
```
src/
├── server.js           (app setup, middleware, listen)
├── routes/
│   ├── auth.js         (register, login, logout, magic-link)
│   ├── accounts.js     (CRUD, import, visit)
│   ├── routes.js       (today, optimize, plan)
│   ├── briefs.js       (generate)
│   ├── voice.js        (voice log)
│   ├── recap.js        (evening email)
│   └── stripe.js       (checkout, webhook)
├── middleware/
│   ├── auth.js
│   ├── rateLimit.js
│   └── validate.js
├── services/
│   ├── supabase.js     (client initialization)
│   ├── openai.js       (AI helpers)
│   ├── geocode.js      (Google Maps)
│   └── email.js        (Resend)
└── utils/
    └── haversine.js    (distance calculation)
```

### 3.2 — No Global Error Handler
**Problem:** Unhandled promise rejections or thrown errors crash the process. Some routes don't have try/catch (e.g., `GET /api/accounts` on line 130-140).
**Fix:** Add an Express error handler and wrap async routes:
```js
// Wrap async route handlers
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

### 3.3 — Duplicate Supabase Client Initialization
**Files:** `server.js:25-27` and `middleware/auth.js:3-5`
The Supabase client is created independently in both files with the same lazy-init logic.
**Fix:** Create a shared `services/supabase.js` module.

### 3.4 — No Request Logging
**Problem:** No visibility into what requests hit the server, response times, or errors in production.
**Fix:** Add `morgan` for HTTP request logging:
```js
app.use(morgan('combined'));
```

### 3.5 — Logout Route is a No-Op
**File:** `server.js:100-106`
```js
app.post('/api/auth/logout', async (req, res) => {
  if (!supabase) return res.json({ ok: true });
  try { await supabase.auth.signOut(); } catch {}
  res.json({ ok: true });
});
```
Calling `supabase.auth.signOut()` on the **server's** client doesn't invalidate the user's token. The token remains valid until it expires. This gives users a false sense of security.
**Fix:** If using Supabase Auth, call `supabase.auth.admin.signOut(userId)` to invalidate the server-side session, or implement token blacklisting.

### 3.6 — `File` Constructor Not Available in Node.js < 20
**File:** `server.js:442-444`
```js
const file = new File([req.file.buffer], req.file.originalname || 'audio.webm', {
  type: req.file.mimetype || 'audio/webm'
});
```
`File` is a browser API. It's only available in Node.js 20+. For broader compatibility, use `openai.toFile()` or pass a Buffer with metadata.

### 3.7 — Route Optimization Saves to Today's Date, Not the Planned Date
**File:** `server.js:343`
```js
const today = new Date().toISOString().split('T')[0];
```
When optimizing a route via the Plan tab, the user may have selected a future date, but the optimization always saves to today. The `plan_date` from the request body is not used.
**Fix:** Accept `plan_date` from the request body and use it.

---

## 4. Frontend Issues & Refactoring

### 4.1 — All CSS & JS Inline (No Separation of Concerns)
**Problem:**
- `dashboard.html` is 1,175 lines with ~470 lines of CSS and ~540 lines of JS mixed with HTML
- CSS is duplicated across all 4 HTML files (same `:root` variables, similar styles)
- No minification, no caching benefits (any HTML change invalidates the entire CSS/JS cache)
- Difficult to maintain and impossible to lint/test
**Fix:** Extract into separate files:
```
public/
├── css/
│   ├── common.css      (shared variables, reset, typography)
│   ├── landing.css
│   ├── auth.css
│   └── dashboard.css
├── js/
│   ├── api.js          (apiFetch, authHeaders, token management)
│   ├── dashboard.js    (tab logic, data loading)
│   ├── voice.js        (MediaRecorder logic)
│   └── auth.js         (login/signup form handling)
├── index.html
├── signup.html
├── login.html
└── dashboard.html
```

### 4.2 — XSS via `innerHTML` with Partially Escaped Content
**Files:** `dashboard.html:726-742,816-824,860-866`
The `esc()` function is used on some values but `innerHTML` is used throughout. Any missed `esc()` call is an XSS vector. Several places construct HTML strings with unescaped values:
- Line 738: `onclick="openVoiceLog('${s.id}', '${esc(s.name)}')"` — if `s.name` contains a single quote that survives `esc()`, it breaks out of the onclick attribute. `esc()` escapes HTML entities but NOT JavaScript string delimiters within HTML attributes.
- Line 844: `document.getElementById('detail-meta').innerHTML` — `account.address` and `account.contact_name` go through partial escaping but the overall construction is fragile.
**Fix:** Use `textContent` where possible. For complex templates, use a proper templating approach or DOM construction. At minimum, escape single quotes in inline event handlers.

### 4.3 — No Loading States for Initial Data Fetch
**File:** `dashboard.html:710-747,800-808`
`loadToday()` and `loadAccounts()` show no skeleton/loading UI. The page appears empty until the API responds.
**Fix:** Add loading skeleton UI or spinners for initial loads.

### 4.4 — No Offline Handling
**Problem:** Field sales reps will frequently be in areas with poor connectivity (rural areas, inside hospitals/buildings). The app silently fails when offline.
**Fix (short-term):** Detect `navigator.onLine` and show a banner when offline.
**Fix (long-term):** Add a service worker for offline caching of account data and queued actions.

### 4.5 — `JSON.parse(localStorage.getItem('user') || 'null')` is Fragile
**File:** `dashboard.html:635`
If `localStorage` contains corrupted data, `JSON.parse` throws and the entire page breaks with a white screen.
**Fix:** Wrap in try/catch:
```js
let user = null;
try { user = JSON.parse(localStorage.getItem('user')); } catch {}
```

### 4.6 — Token Expiry Not Handled Proactively
**File:** `dashboard.html:650-654`
The token is only checked when a 401 response comes back. Supabase tokens typically expire after 1 hour. A user who leaves the app open will get a jarring redirect to login mid-session.
**Fix:** Check token expiry on page load and implement token refresh using Supabase's `refreshSession()`.

### 4.7 — Voice Modal "Done" Button Reassigns `onclick` and Leaks Event Listeners
**File:** `dashboard.html:1144`
```js
actionBtn.onclick = () => document.getElementById('voice-modal').classList.remove('show');
```
This replaces the original click handler. After closing, the "Start Recording" button no longer works for subsequent recordings.
**Fix:** Reset the button state and handler properly when closing the modal.

### 4.8 — No Confirmation for Destructive Actions
The app has no delete account UI, but the API endpoint exists. When delete is eventually added to the frontend, ensure a confirmation dialog is present. Similarly, "Mark Visited" is irreversible with no undo.

---

## 5. Database & Schema

### 5.1 — Missing Indexes
**File:** `schema.sql`
- No index on `briefs(account_id, user_id, created_at)` — the brief cache lookup (server.js:378-386) queries by all three columns
- No index on `route_plans(user_id, plan_date)` — queried by both columns on every Today tab load
- No unique constraint on `route_plans(user_id, plan_date)` in the schema (the upsert on line 344 uses `onConflict: 'user_id,plan_date'` but the schema has no matching unique constraint)
**Fix:**
```sql
CREATE INDEX briefs_cache_idx ON briefs(account_id, user_id, created_at DESC);
CREATE UNIQUE INDEX route_plans_user_date_idx ON route_plans(user_id, plan_date);
```

### 5.2 — No Cascade Delete Cleanup for Briefs
When an account is deleted, `call_logs` are cascaded (FK with `ON DELETE CASCADE`), but old briefs for deleted accounts may accumulate. The FK on `briefs.account_id` does have `ON DELETE CASCADE`, so this is handled — but there's no TTL/cleanup for expired briefs (>24hr).
**Fix:** Add a scheduled job or database function to purge old briefs:
```sql
DELETE FROM briefs WHERE created_at < NOW() - INTERVAL '24 hours';
```

### 5.3 — `outcome` Column Should Be an ENUM
**File:** `schema.sql:44`
```sql
outcome text,  -- 'positive', 'neutral', 'needs_followup', 'closed'
```
Currently any string value is accepted. If the AI returns an unexpected value, the data is inconsistent.
**Fix:** Use a CHECK constraint or a proper ENUM type.

### 5.4 — No `updated_at` Trigger
**File:** `schema.sql:32`
`updated_at` on `accounts` defaults to `now()` but is only updated when the server explicitly sets it. If a query updates an account without setting `updated_at`, it becomes stale.
**Fix:** Add a Postgres trigger:
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 6. Performance & Efficiency

### 6.1 — Geocoding Every Account on CSV Import in Parallel
**File:** `server.js:255-264`
`Promise.all` fires all geocoding requests simultaneously. For 500 accounts, that's 500 concurrent HTTP requests to Google Maps, likely triggering rate limits and failures.
**Fix:** Batch with concurrency control (e.g., `p-limit` with concurrency of 10) or use a queue.

### 6.2 — Brief Generation is Sequential for Batch
**File:** `dashboard.html:990-997`
```js
for (const id of ids) {
  await apiFetch('/api/brief/generate', { ... });
}
```
Generating briefs for 10 accounts takes 10 sequential API round trips. Each call to OpenAI takes ~1-3 seconds.
**Fix:** Use `Promise.allSettled` with a concurrency limit, or add a batch endpoint on the backend.

### 6.3 — `loadAccounts()` is Called Multiple Times on Init
**File:** `dashboard.html:1169-1172`
```js
loadToday();
loadAccounts();
loadPlanAccounts(); // calls loadAccounts() again if allAccounts is empty
loadProfile();
```
`loadAccounts()` may be called twice — once directly and once inside `loadPlanAccounts()`.
**Fix:** Await `loadAccounts()` before calling `loadPlanAccounts()`, or use a shared promise.

### 6.4 — No Pagination on Accounts List
**File:** `server.js:130-140`
`SELECT *` loads all accounts for a user every time. A user with 1,000+ accounts will see slow loads and high memory usage.
**Fix:** Add pagination (limit/offset or cursor-based).

### 6.5 — Haversine + TSP Computed on Every Optimization Request
**File:** `server.js:316-338`
The nearest-neighbor algorithm is O(n^2) and recomputes from scratch each time. For typical use (5-15 stops) this is fine, but for larger sets it will be slow.
**Not urgent** — only a concern if account limits increase significantly.

### 6.6 — `SELECT *` Used Everywhere
**Files:** `server.js` throughout
Every query selects all columns even when only a few are needed (e.g., the brief generation only needs account name, contact, notes, and last_visited).
**Fix:** Select only needed columns to reduce data transfer.

---

## 7. Code Organization & Structure

### 7.1 — Proposed Project Structure
```
territorypilot/
├── public/                     # Static files (ONLY this is served)
│   ├── index.html
│   ├── signup.html
│   ├── login.html
│   ├── dashboard.html
│   ├── css/
│   │   ├── common.css
│   │   ├── landing.css
│   │   ├── auth.css
│   │   └── dashboard.css
│   └── js/
│       ├── api.js
│       ├── auth.js
│       ├── dashboard.js
│       └── voice.js
├── src/
│   ├── app.js                  # Express app setup
│   ├── server.js               # Listen + startup
│   ├── config.js               # Environment validation
│   ├── routes/
│   │   ├── auth.js
│   │   ├── accounts.js
│   │   ├── routes.js
│   │   ├── briefs.js
│   │   ├── voice.js
│   │   ├── recap.js
│   │   └── stripe.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── errorHandler.js
│   │   ├── rateLimit.js
│   │   └── validate.js
│   ├── services/
│   │   ├── supabase.js
│   │   ├── openai.js
│   │   ├── geocode.js
│   │   └── email.js
│   └── utils/
│       └── haversine.js
├── tests/
│   ├── routes/
│   ├── services/
│   └── utils/
├── schema.sql
├── package.json
└── .env.example
```

### 7.2 — Environment Variable Validation
**Problem:** No validation at startup. The server boots with placeholder keys and fails at runtime with cryptic errors.
**Fix:** Add a `config.js` that validates required env vars on startup:
```js
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY'];
for (const key of required) {
  if (!process.env[key] || process.env[key] === 'placeholder') {
    console.warn(`WARNING: ${key} is not configured`);
  }
}
```

### 7.3 — No Tests
**Problem:** Jest is configured (`"test": "jest"`) but zero tests exist. Critical business logic (route optimization, auth, account CRUD) has no test coverage.
**Priority tests to write:**
1. Auth middleware (valid token, invalid token, missing header)
2. Account CRUD (create, read, update, delete, ownership checks)
3. Route optimization (haversine correctness, TSP ordering)
4. Input validation (malformed emails, missing fields, boundary values)
5. Stripe webhook handling (signature verification, plan updates)

### 7.4 — CSS Variables Duplicated Across All HTML Files
The same `:root` CSS variables are copy-pasted in `index.html`, `signup.html`, `login.html`, and `dashboard.html`. Any theme change requires editing 4 files.
**Fix:** Extract into `common.css`.

---

## 8. Missing Features & Gaps

### 8.1 — No Token Refresh Mechanism
Supabase JWT tokens expire (default: 1 hour). The frontend doesn't refresh them. Users get silently logged out.

### 8.2 — No Account Delete UI
The `DELETE /api/accounts/:id` endpoint exists but there's no button in the dashboard to trigger it.

### 8.3 — No CSV Import UI
The `POST /api/accounts/import` endpoint exists but the dashboard has no upload interface.

### 8.4 — No Plan Selection for Upgrade
The upgrade button always sends `plan: 'solo'`. There's no way to choose Team or Agency from the dashboard.

### 8.5 — Recap Email Not Automated
`POST /api/recap/send` must be manually triggered. There's no cron/scheduled job and no button in the dashboard.
**Fix:** Add a cron job (e.g., via `node-cron` or an external scheduler) to send recaps at 6pm in each user's timezone.

### 8.6 — No Error Recovery on API Failure
Most catch blocks in the frontend just show a toast. There's no retry logic, no recovery, and no detailed error display.

### 8.7 — No Activity Logging / Audit Trail
No record of who changed what, when. Important for multi-user (Team/Agency) plans.

---

## 9. Prioritized Action Plan

### Phase 1 — Critical Security (Do First)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Move HTML to `public/`, stop serving project root | server.js, file structure | 30 min |
| 2 | Restrict CORS to app domain | server.js | 5 min |
| 3 | Add rate limiting on auth routes | server.js, new middleware | 30 min |
| 4 | Fix missing `user_id` check on brief account lookup | server.js:392 | 5 min |
| 5 | Fix missing ownership check on voice log | server.js:437 | 10 min |
| 6 | Stop leaking error messages to client | server.js (all catch blocks) | 30 min |
| 7 | Add helmet for security headers | server.js | 5 min |
| 8 | Add file size limit to multer | server.js:20 | 5 min |
| 9 | Server-side password length validation | server.js:45 | 5 min |

### Phase 2 — Input Validation & Stability

| # | Task | Files | Effort |
|---|------|-------|--------|
| 10 | Add input validation library (zod/joi) | new middleware, all routes | 2-3 hrs |
| 11 | Validate CSV import rows + limit count | server.js accounts import | 1 hr |
| 12 | Add global async error handler | server.js | 30 min |
| 13 | Fix localStorage JSON.parse crash | dashboard.html | 10 min |
| 14 | Fix voice modal button handler leak | dashboard.html | 20 min |
| 15 | Fix route optimization saving to wrong date | server.js:343 | 10 min |

### Phase 3 — Code Organization

| # | Task | Files | Effort |
|---|------|-------|--------|
| 16 | Split server.js into route modules | major refactor | 3-4 hrs |
| 17 | Extract shared Supabase client | server.js, middleware/auth.js | 30 min |
| 18 | Extract CSS into separate files | all HTML files | 2 hrs |
| 19 | Extract JS into separate files | all HTML files | 2-3 hrs |
| 20 | Add env var validation on startup | new config.js | 30 min |
| 21 | Add request logging (morgan) | server.js | 10 min |

### Phase 4 — Performance & UX

| # | Task | Files | Effort |
|---|------|-------|--------|
| 22 | Add loading skeletons | dashboard.html | 1 hr |
| 23 | Batch geocoding with concurrency limit | server.js import | 1 hr |
| 24 | Add batch brief generation endpoint | server.js, dashboard.html | 1 hr |
| 25 | Add pagination for accounts | server.js, dashboard.html | 2 hrs |
| 26 | Add missing database indexes | schema.sql | 15 min |
| 27 | Fix duplicate loadAccounts() call | dashboard.html | 10 min |
| 28 | Add token refresh logic | dashboard.html | 1 hr |

### Phase 5 — Missing Features

| # | Task | Files | Effort |
|---|------|-------|--------|
| 29 | Add CSV import UI to dashboard | dashboard.html | 2 hrs |
| 30 | Add account delete button with confirmation | dashboard.html | 1 hr |
| 31 | Add plan selection for upgrade (solo/team/agency) | dashboard.html | 1 hr |
| 32 | Add cron for automated evening recap | new cron.js | 2 hrs |
| 33 | Add offline detection banner | dashboard.html | 30 min |
| 34 | Migrate token storage to httpOnly cookies | server.js, all frontend | 3-4 hrs |

### Phase 6 — Testing

| # | Task | Files | Effort |
|---|------|-------|--------|
| 35 | Auth middleware unit tests | tests/ | 1 hr |
| 36 | Account CRUD integration tests | tests/ | 2 hrs |
| 37 | Route optimization unit tests | tests/ | 1 hr |
| 38 | Stripe webhook tests | tests/ | 1 hr |
| 39 | Input validation tests | tests/ | 1 hr |

---

## Summary

The codebase is a functional MVP with solid foundational choices (Supabase RLS, JWT auth, XSS escaping). However, it has **9 security vulnerabilities** that need immediate attention, the most critical being the static file serving of the entire project root and the missing ownership checks on brief/voice endpoints. The monolithic architecture and inline code will become increasingly difficult to maintain as features are added. The prioritized plan above addresses the most impactful issues first while keeping each phase achievable in focused work sessions.
