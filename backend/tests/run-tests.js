/**
 * Lightweight verification script (no test framework dependency, so it runs
 * anywhere with just `node`). It re-seeds the DB before running so results
 * are deterministic, then exercises every required edge case against the
 * booking service directly (bypassing HTTP for speed/determinism, but this
 * is the same code path the API routes call).
 */
const { execSync } = require('child_process');
const path = require('path');

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ottodot_trial';

let passed = 0;
let failed = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  PASS - ${label}`);
    passed++;
  } else {
    console.log(`  FAIL - ${label}`);
    failed++;
  }
}

async function main() {
  console.log('Re-seeding database for a clean test run...');
  execSync('node ' + path.join(__dirname, '../src/db/seed.js'), { stdio: 'inherit' });

  // Re-require after seeding so the pool is fresh.
  const svc = require('../src/services/bookingService');

  // --- Test 1: available seats -> booking + payment succeeds ---
  console.log('\n[1] Class with available seats: create + confirm booking');
  {
    const booking = await svc.createBooking({ studentId: 6, classId: 1 }); // Raka Kartika, class 1 (open)
    ok('booking created as pending_payment', booking.status === 'pending_payment');
    const result = await svc.confirmPayment({ bookingId: booking.id, simulate: 'success' });
    ok('payment success -> confirmed', result.status === 'confirmed');
    const fetched = await svc.getBooking(booking.id);
    ok('booking status persisted as confirmed', fetched.status === 'confirmed');
  }

  // --- Test 2: class with exactly 3 confirmed -> 4th booking succeeds, fills it ---
  console.log('\n[2] Class 2 has 3/4 confirmed: 4th booking should succeed and fill the class');
  {
    const roster0 = await svc.getRoster(2);
    ok('class 2 starts with 3 confirmed, 1 seat remaining', roster0.confirmed_count === 3 && roster0.seats_remaining === 1);

    const booking = await svc.createBooking({ studentId: 6, classId: 2 }); // Raka Kartika
    const result = await svc.confirmPayment({ bookingId: booking.id, simulate: 'success' });
    ok('4th student confirmed', result.status === 'confirmed');

    const roster1 = await svc.getRoster(2);
    ok('class 2 now full (4/4), 0 seats remaining', roster1.confirmed_count === 4 && roster1.seats_remaining === 0);
  }

  // --- Test 3: duplicate booking attempt for same child + class ---
  console.log('\n[3] Duplicate booking attempt for the same child and class is rejected');
  {
    let threw = false;
    let code = null;
    try {
      // Student 3 already has a confirmed booking in class 2 (seeded).
      await svc.createBooking({ studentId: 3, classId: 2 });
    } catch (err) {
      threw = true;
      code = err.code;
    }
    ok('duplicate booking rejected', threw && code === 'duplicate_booking');
  }

  // --- Test 4: payment failure does not add child to confirmed roster ---
  console.log('\n[4] Payment failure keeps child off the confirmed roster');
  {
    const booking = await svc.createBooking({ studentId: 7, classId: 1 }); // Bagas Santoso, class 1
    let threw = false;
    let code = null;
    try {
      await svc.confirmPayment({ bookingId: booking.id, simulate: 'fail' });
    } catch (err) {
      threw = true;
      code = err.code;
    }
    ok('payment failure surfaces payment_failed error', threw && code === 'payment_failed');
    const fetched = await svc.getBooking(booking.id);
    ok('booking status is payment_failed, not confirmed', fetched.status === 'payment_failed');
    const roster = await svc.getRoster(1);
    ok(
      'student 7 does not appear in confirmed roster',
      !roster.roster.some((r) => r.student_id === 7)
    );
  }

  // --- Test 5: overbooking is rejected once class is full ---
  console.log('\n[5] Overbooking beyond capacity (class 3 is already 4/4) is rejected');
  {
    let threw = false;
    let code = null;
    try {
      await svc.createBooking({ studentId: 6, classId: 3 });
      // If creation succeeded (soft check may pass/fail depending on timing),
      // try to confirm — the hard check in confirmPayment must reject it.
    } catch (err) {
      threw = true;
      code = err.code;
    }
    ok('overbooking rejected at booking creation (soft check)', threw && code === 'class_full');
  }

  // --- Test 6: THE LAST-SEAT RACE ---
  // Simulate: two different students both hold a pending_payment booking for
  // class 1 (which currently has exactly 3 confirmed, 1 seat left after test 1
  // added one -> we need a fresh class-at-3 scenario). We re-derive the seat
  // count and set up two pending bookings for the *same last seat*, then fire
  // both payment confirmations concurrently.
  console.log('\n[6] Last-seat race: two concurrent payment confirmations, only one seat left');
  {
    // Create a dedicated class with exactly 3 confirmed seats for a clean race test.
    const pool = require('../src/db/pool');
    const classRes = await pool.query(
      `INSERT INTO trial_classes (subject, teacher_name, scheduled_at, capacity)
       VALUES ('Race Test Class', 'Ms. Race', now() + interval '5 days', 4)
       RETURNING id`
    );
    const raceClassId = classRes.rows[0].id;

    // Fill 3 seats directly (students 1,2,3 already used elsewhere, use fresh ones).
    const extraParent = await pool.query(
      `INSERT INTO parents (name, email) VALUES ('Race Parent', 'race@example.com') RETURNING id`
    );
    const parentId = extraParent.rows[0].id;
    const studentIds = [];
    for (let i = 0; i < 5; i++) {
      const s = await pool.query(
        `INSERT INTO students (parent_id, name) VALUES ($1, $2) RETURNING id`,
        [parentId, `Race Student ${i}`]
      );
      studentIds.push(s.rows[0].id);
    }
    for (let i = 0; i < 3; i++) {
      const b = await pool.query(
        `INSERT INTO bookings (student_id, class_id, status) VALUES ($1, $2, 'confirmed') RETURNING id`,
        [studentIds[i], raceClassId]
      );
      await pool.query(`INSERT INTO payment_attempts (booking_id, status) VALUES ($1, 'success')`, [b.rows[0].id]);
    }

    // User A and User B both grab a pending booking for the same (last) seat.
    const bookingA = await svc.createBooking({ studentId: studentIds[3], classId: raceClassId });
    const bookingB = await svc.createBooking({ studentId: studentIds[4], classId: raceClassId });

    // Fire both payment confirmations at the same time.
    const [resultA, resultB] = await Promise.allSettled([
      svc.confirmPayment({ bookingId: bookingA.id, simulate: 'success' }),
      svc.confirmPayment({ bookingId: bookingB.id, simulate: 'success' }),
    ]);

    const outcomes = [resultA, resultB];
    const confirmedCount = outcomes.filter((o) => o.status === 'fulfilled').length;
    const rejectedCount = outcomes.filter((o) => o.status === 'rejected').length;

    ok('exactly one of the two concurrent payments confirmed', confirmedCount === 1);
    ok('exactly one of the two concurrent payments was rejected', rejectedCount === 1);

    const finalRoster = await svc.getRoster(raceClassId);
    ok('final confirmed count for race class is exactly capacity (4), not 5', finalRoster.confirmed_count === 4);

    const rejected = outcomes.find((o) => o.status === 'rejected');
    ok(
      'the rejected one failed with class_full (lost the race), not a generic error',
      rejected && rejected.reason && rejected.reason.code === 'class_full'
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  const pool = require('../src/db/pool');
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
