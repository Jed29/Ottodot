# Ottodot Trial Booking — Reliability Slice

A minimal backend-led implementation of trial-class booking for Ottodot, focused on
correctness under duplicate-booking, overbooking, payment-failure, and last-seat-race
scenarios rather than UI polish.

## Stack

- **Backend**: Node.js + Express (API only)
- PostgreSQL (raw `pg`, no ORM — chosen so the transaction/locking logic in
  `backend/src/services/bookingService.js` is fully visible and auditable)
- **Frontend**: React + Vite (`frontend/`) — talks to the backend over `/api/*`,
  proxied by Vite's dev server to `http://localhost:3000` so there's no CORS
  friction in dev

## Project Structure
```
backend/
  src/
    db/
      schema.sql       -- table definitions + the partial unique index
      pool.js           -- pg Pool (reads DATABASE_URL)
      seed.js            -- drops/recreates schema, inserts synthetic seed data
    services/
      bookingService.js  -- all booking/payment/roster business logic + the
                              race-safe transaction (this is the file that matters most)
    routes/
      api.js              -- Express routes, thin wrappers around bookingService
    app.js                -- Express app wiring (JSON, CORS, /api)
    server.js              -- entrypoint (npm start), listens on :3000
  tests/
    run-tests.js            -- re-seeds DB, then exercises every required edge case
frontend/
  src/
    api.js                  -- thin fetch wrapper for the backend API
    App.jsx                  -- BookingPanel (book + pay) and RosterPanel (admin view)
    main.jsx, App.css
  vite.config.js              -- dev proxy: /api -> http://localhost:3000
```

## How to Run

### 1. Prerequisites
- Node.js 18+
- A reachable PostgreSQL instance. Easiest path — Docker:
  ```bash
  docker run -d --name ottodot-pg -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=ottodot_trial -p 5432:5432 postgres:16-alpine
  ```
  Or use a local Postgres install and `createdb ottodot_trial`.

### 2. Backend
```bash
cd backend
npm install
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/ottodot_trial'  # optional, this is the default
npm run seed   # applies schema + seed data — safe to re-run, drops/recreates tables
npm start
# -> Ottodot trial booking API listening on http://localhost:3000
```

### 3. Frontend (separate terminal)
```bash
cd frontend
npm install
npm run dev
# -> http://localhost:5173
```
Open `http://localhost:5173`: pick a child, pick a trial class, book, pay
(success or forced failure), then check the roster panel. All requests go to
`/api/*`, proxied to the backend on :3000 — no separate API base URL to configure.

### 4. Run verification tests (re-seeds DB first, so it's repeatable)
```bash
cd backend
npm test
```
This exercises every required edge case, including firing two concurrent payment
confirmations at the literal last seat of a class and asserting exactly one wins.

### API quick reference
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/classes` | List trial classes with seats remaining |
| GET | `/api/students` | List children (for the booking picker) |
| POST | `/api/bookings` `{student_id, class_id}` | Create a `pending_payment` booking |
| POST | `/api/bookings/:id/pay` `{simulate: 'success'\|'fail'}` | Mock payment step; confirms or fails the booking |
| GET | `/api/bookings/:id` | Booking status |
| GET | `/api/classes/:id/roster` | Confirmed roster for a class (admin/teacher view) |

## What I Built

- Full booking lifecycle: create pending booking → mock payment → confirmed /
  payment_failed, with status readable at every step.
- Roster endpoint showing only confirmed students per class.
- A minimal React (Vite) frontend so the flow can be clicked through
  end-to-end, not just curled — but per the brief, most of the 3–4h timebox
  went into getting the concurrency/invariant behavior right and well-tested
  rather than UI polish.

## Time Spent
~3.5 hours: schema/design (45 min), service + routes (60 min), seed data (20 min),
tests incl. the concurrency test (45 min), one bug found and fixed by the tests
(duplicate-check ordering — see below), README/AI_USAGE (30 min).

## Assumptions Made
- "Trial booking" is per child (student), not per parent — a parent can book
  multiple children into the same or different classes.
- Payment is mocked synchronously (`simulate: 'success'|'fail'` in the request body)
  rather than integrating a real payment gateway or webhook.
- A `pending_payment` booking does not itself occupy a seat — seats are only
  consumed on confirmed payment. This means many parents could theoretically be
  "in checkout" for the same last seat at once; the system's job is to make sure
  at most one of them ends up `confirmed`, not to prevent multiple people from
  attempting.
- One booking row per (attempt), not per payment retry — if a payment fails,
  the booking is marked `payment_failed`, and (per the schema) the parent would
  need to be surfaced a "try again" flow that creates a new booking (not
  implemented — see "what I deliberately cut").

## Key Architecture & Backend Decisions

### Data model
- `parents` — id, name, email
- `students` — id, parent_id, name
- `trial_classes` — id, subject, teacher_name, scheduled_at, capacity (default 4)
- `bookings` — id, student_id, class_id, status, created_at, updated_at
  - status ∈ {`pending_payment`, `confirmed`, `payment_failed`, `cancelled`}
- `payment_attempts` — id, booking_id, status (`success`/`failed`), amount_cents, reason, created_at

### Preventing duplicate bookings
Two layers, deliberately redundant:
1. **Application check** in `createBooking`: before inserting, look for any existing
   `pending_payment` or `confirmed` booking for the same `(student_id, class_id)`
   and reject with `duplicate_booking` if found.
2. **DB constraint (the real guarantee)**: a partial unique index —
   ```sql
   CREATE UNIQUE INDEX ux_bookings_active_per_student_class
     ON bookings (student_id, class_id)
     WHERE status IN ('pending_payment', 'confirmed');
   ```
   This holds even if two requests race past the application check simultaneously —
   Postgres will reject the second insert with a unique-violation, which the service
   catches and turns into a clean `409 duplicate_booking`.

### Preventing overbooking + handling the last-seat race
This is the core reliability requirement, so it gets its own section.

**Approach: pessimistic row locking inside a transaction**, at payment-confirmation
time (`confirmPayment` in `bookingService.js`):

1. `BEGIN` a transaction.
2. `SELECT ... FOR UPDATE` the booking row, then the `trial_classes` row for its
   class. The row lock on `trial_classes` is what matters: any other transaction
   trying to confirm a payment for the *same class* will block here until this
   transaction commits or rolls back.
3. While holding the lock, count currently `confirmed` bookings for the class.
4. If `confirmed_count >= capacity` → reject this payment (mark the booking
   `payment_failed`, log a failed `payment_attempt` with reason
   `class_full_at_confirmation`) and commit. No seat is consumed.
5. Otherwise, run the mock payment. Success → flip the booking to `confirmed`
   in the same transaction. Failure → flip to `payment_failed`. Either way, commit.
6. Committing releases the lock, letting the next waiting transaction proceed —
   it will now see the updated confirmed count and correctly reject if the seat
   is gone.

**Why this approach:**
- It reuses a Postgres primitive (`SELECT ... FOR UPDATE`) instead of adding
  infrastructure (a queue, a distributed lock/Redis, etc.) — appropriate for a
  4-seat trial class where contention is small and brief.
- It's easy to reason about and to test deterministically: fire two
  `Promise.all` payment confirmations at the same class and assert exactly one
  succeeds (see `backend/tests/run-tests.js`, test #6).
- The invariant is enforced at the last possible moment (payment confirmation),
  which is correct — a `pending_payment` booking is only an intent, not a
  reservation, so a race between "add to cart" and "someone else already has a
  cart" isn't the real hazard. The real hazard is two payments completing for
  the same seat, which is exactly what's locked.

**Tradeoff accepted:** concurrent payment confirmations *for the same class*
are serialized (one waits briefly for the DB lock rather than being processed
in parallel). For a capacity-4 trial class with occasional bursts this is a
non-issue in practice; it would need revisiting (e.g. a dedicated seat-holds
table with short TTLs, or moving the count into a single atomic
`UPDATE ... WHERE confirmed_count < capacity`-style statement) if this were
scaled to large public classes with heavy simultaneous checkout traffic.

### Handling payment failure
`confirmPayment` marks the booking `payment_failed` and records a failed
`payment_attempts` row, but never marks it `confirmed`. The roster query only
ever selects `status = 'confirmed'`, so a failed payment can never appear on
the class roster — there's no code path where a `payment_failed` booking
counts toward capacity or shows up for the teacher.

### Where each check lives
| Check | Layer | Why |
|---|---|---|
| Required fields present | Backend (route handler) | Fast, cheap input validation |
| Duplicate active booking (soft) | Backend (service, before insert) | Friendly error message, avoids an unnecessary DB round-trip to trigger the constraint |
| Duplicate active booking (hard) | Database (partial unique index) | The actual guarantee — holds under concurrency, survives future code changes |
| Class full (soft, at booking time) | Backend (service) | UX only — tells the user immediately if the class already looks full |
| Class full / last-seat race (hard) | Database transaction + row lock (`SELECT ... FOR UPDATE`) inside backend service | The actual guarantee — this is what makes the last-seat race safe |
| Payment success/failure | Backend (mocked in service; would be a payment-gateway webhook/callback in production) | Business logic, not a DB-level concern |
| Booking status transitions valid (e.g. can't pay an already-confirmed booking) | Backend (service) | Application-level state machine |

A background job isn't used anywhere in this slice — every invariant here can
be enforced synchronously within a single request's transaction. If this grew
to include e.g. auto-expiring stale `pending_payment` bookings after N minutes,
that would be the first candidate for a background job (a periodic sweep or
a delayed job), since it doesn't need to happen inline with any user request.

## What I Deliberately Cut
- No real payment gateway integration — `simulate` flag stands in for it.
- No auth/session layer — `student_id` is passed directly; a real system would
  derive it from an authenticated parent's session and verify the child belongs
  to them.
- No expiry/TTL on `pending_payment` bookings (a booking that never gets paid
  stays `pending_payment` forever). In production I'd add a `expires_at` column
  and a cleanup job to flip stale ones to `cancelled` so they stop blocking the
  duplicate-booking constraint for that child.
- Frontend is deliberately scoped (class cards, a mock payment form, a step
  indicator, a roster panel — no routing, no global state management library,
  no loading skeletons) — verified via automated backend tests, curl through
  the Vite dev proxy, and a headless-Chromium (Playwright) click-through of
  the full book → pay success / pay decline → roster flow.
- No pagination/filtering on roster or class listing (fine at this data scale).
- No idempotency key on the payment endpoint for retried client requests (the
  booking-state check — "must be `pending_payment`" — prevents double-confirming
  from a naive retry, but a proper idempotency key would be more robust for
  network-level retries).

## What I'd Monitor After Release
- Rate of `class_full` responses to `POST /bookings/:id/pay` (i.e. how often
  someone loses the last-seat race) — a proxy for how much contention exists
  and whether the UX needs a "seat taken, here are similar classes" flow.
- Payment failure rate (`payment_attempts.status = 'failed'`) segmented by reason.
- Count of stale `pending_payment` bookings older than N minutes, per class —
  signals whether an expiry job is needed sooner than planned.
- DB lock wait time on the `trial_classes` row during payment confirmation, to
  catch if this ever becomes a real bottleneck at higher traffic.
- 5xx rate / unhandled errors on the booking and payment endpoints.

## What I'd Do Next With More Time
- Add `expires_at` + a sweep job for abandoned `pending_payment` bookings.
- Add idempotency keys on the payment endpoint.
- Add authentication and scope `student_id` to the authenticated parent.
- Further frontend polish: auto-refresh seat counts on an interval (so a
  second tab sees a class fill without a manual reload), disable/gray a class
  card the instant it hits 0 seats client-side, and a loading skeleton for the
  first data fetch.
- Add integration tests that go through the actual HTTP layer (supertest) in
  addition to the current service-level tests.
- Consider moving the capacity check into a single atomic SQL statement
  (`UPDATE bookings SET status='confirmed' WHERE ... AND (SELECT count(*) ...) < capacity`)
  to reduce lock hold time further, if profiling showed the current approach
  as a bottleneck.
