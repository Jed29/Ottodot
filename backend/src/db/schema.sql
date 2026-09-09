-- Ottodot Trial Booking — Schema
-- Design notes are in README.md. Key invariant-enforcing pieces are marked below.

DROP TABLE IF EXISTS payment_attempts CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS trial_classes CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS parents CASCADE;

CREATE TABLE parents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE trial_classes (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES trial_classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'payment_failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INVARIANT #1: a student cannot have two "active" (in-flight or confirmed)
-- bookings for the same class at once. This is the DB-level backstop for the
-- duplicate-booking requirement — it holds even if application logic has a bug
-- or two requests race each other at booking-creation time.
CREATE UNIQUE INDEX ux_bookings_active_per_student_class
  ON bookings (student_id, class_id)
  WHERE status IN ('pending_payment', 'confirmed');

CREATE INDEX ix_bookings_class_status ON bookings (class_id, status);

CREATE TABLE payment_attempts (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  amount_cents INTEGER NOT NULL DEFAULT 9900,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
