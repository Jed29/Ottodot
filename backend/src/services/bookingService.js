const pool = require('../db/pool');

class BookingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Create a new trial booking in `pending_payment` status.
 *
 * This does NOT reserve a seat. Seats are only allocated at payment-confirmation
 * time (see confirmPayment). This keeps "browsing / about to pay" users from
 * permanently locking a seat if they abandon checkout, while the unique index
 * on (student_id, class_id) WHERE status IN ('pending_payment','confirmed')
 * still stops the same child from opening two bookings for the same class.
 *
 * We also do a soft, non-authoritative capacity check here purely for UX
 * (fail fast with a friendly message) — it is NOT what prevents overbooking.
 * The authoritative check happens inside confirmPayment's transaction.
 */
async function createBooking({ studentId, classId }) {
  const client = await pool.connect();
  try {
    const classRes = await client.query(
      'SELECT id, capacity FROM trial_classes WHERE id = $1',
      [classId]
    );
    if (classRes.rowCount === 0) {
      throw new BookingError(404, 'class_not_found', 'Trial class not found');
    }

    const studentRes = await client.query(
      'SELECT id FROM students WHERE id = $1',
      [studentId]
    );
    if (studentRes.rowCount === 0) {
      throw new BookingError(404, 'student_not_found', 'Student not found');
    }

    // Check for an existing active (pending_payment/confirmed) booking for this
    // exact child+class BEFORE the capacity check, so a duplicate attempt is
    // always reported as "duplicate_booking" rather than being masked by a
    // "class_full" result if the class happens to have filled up since.
    const dupeRes = await client.query(
      `SELECT id FROM bookings
       WHERE student_id = $1 AND class_id = $2 AND status IN ('pending_payment', 'confirmed')`,
      [studentId, classId]
    );
    if (dupeRes.rowCount > 0) {
      throw new BookingError(
        409,
        'duplicate_booking',
        'This child already has an active or confirmed booking for this class'
      );
    }

    const confirmedCountRes = await client.query(
      `SELECT count(*)::int AS n FROM bookings WHERE class_id = $1 AND status = 'confirmed'`,
      [classId]
    );
    const capacity = classRes.rows[0].capacity;
    if (confirmedCountRes.rows[0].n >= capacity) {
      // Soft/UX-only rejection. The hard guarantee still lives in confirmPayment.
      throw new BookingError(409, 'class_full', 'This trial class is already full');
    }

    try {
      const insertRes = await client.query(
        `INSERT INTO bookings (student_id, class_id, status)
         VALUES ($1, $2, 'pending_payment')
         RETURNING id, student_id, class_id, status, created_at`,
        [studentId, classId]
      );
      return insertRes.rows[0];
    } catch (err) {
      // Postgres unique_violation on our partial index -> duplicate active booking.
      if (err.code === '23505') {
        throw new BookingError(
          409,
          'duplicate_booking',
          'This child already has an active or confirmed booking for this class'
        );
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Confirm (or fail) payment for a pending booking.
 *
 * This is the function that must be race-safe under the "last seat" scenario.
 *
 * Approach: pessimistic row locking.
 *   1. Start a DB transaction.
 *   2. `SELECT ... FOR UPDATE` the trial_classes row for this booking's class.
 *      This blocks any other concurrent payment-confirmation transaction for
 *      the SAME class until this one commits or rolls back — i.e. concurrent
 *      requests for the same class are serialized at this point.
 *   3. While holding the lock, count currently CONFIRMED bookings for the class.
 *   4. If count >= capacity -> reject this payment (class_full), even if the
 *      payment itself would have succeeded. Mark the booking payment_failed.
 *   5. Otherwise, run the mock payment. If it succeeds, flip booking to
 *      'confirmed' inside the same transaction (so the seat-count check other
 *      waiting transactions will see is already up to date once we commit).
 *      If it fails, flip booking to 'payment_failed' — no seat is consumed.
 *   6. Commit, releasing the lock for the next waiter.
 *
 * Why this approach: it's simple to reason about and test, needs no extra
 * infrastructure (no queue, no distributed lock), and Postgres already gives
 * us transactional row locking for free. The tradeoff is that concurrent
 * payment attempts for the *same class* are serialized (a brief queue at the
 * DB level) rather than parallelized — acceptable here because trial classes
 * are small (capacity 4) and payment confirmation is fast.
 */
async function confirmPayment({ bookingId, simulate }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingRes = await client.query(
      `SELECT id, student_id, class_id, status FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (bookingRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new BookingError(404, 'booking_not_found', 'Booking not found');
    }
    const booking = bookingRes.rows[0];

    if (booking.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      throw new BookingError(
        409,
        'invalid_state',
        `Booking is not awaiting payment (current status: ${booking.status})`
      );
    }

    // Lock the class row itself: this is what serializes concurrent
    // confirmations for the same class (the last-seat race).
    const classRes = await client.query(
      `SELECT id, capacity FROM trial_classes WHERE id = $1 FOR UPDATE`,
      [booking.class_id]
    );
    const capacity = classRes.rows[0].capacity;

    const confirmedCountRes = await client.query(
      `SELECT count(*)::int AS n FROM bookings WHERE class_id = $1 AND status = 'confirmed'`,
      [booking.class_id]
    );
    const confirmedCount = confirmedCountRes.rows[0].n;

    if (confirmedCount >= capacity) {
      await client.query(
        `UPDATE bookings SET status = 'payment_failed', updated_at = now() WHERE id = $1`,
        [bookingId]
      );
      await client.query(
        `INSERT INTO payment_attempts (booking_id, status, reason) VALUES ($1, 'failed', $2)`,
        [bookingId, 'class_full_at_confirmation']
      );
      await client.query('COMMIT');
      throw new BookingError(
        409,
        'class_full',
        'Seat was taken by another booking before payment completed'
      );
    }

    // Mock payment step. `simulate` lets callers/tests force success/failure;
    // defaults to success if not specified.
    const paymentSucceeds = simulate !== 'fail';

    if (!paymentSucceeds) {
      await client.query(
        `UPDATE bookings SET status = 'payment_failed', updated_at = now() WHERE id = $1`,
        [bookingId]
      );
      await client.query(
        `INSERT INTO payment_attempts (booking_id, status, reason) VALUES ($1, 'failed', $2)`,
        [bookingId, 'simulated_failure']
      );
      await client.query('COMMIT');
      throw new BookingError(402, 'payment_failed', 'Payment failed');
    }

    await client.query(
      `UPDATE bookings SET status = 'confirmed', updated_at = now() WHERE id = $1`,
      [bookingId]
    );
    await client.query(
      `INSERT INTO payment_attempts (booking_id, status) VALUES ($1, 'success')`,
      [bookingId]
    );
    await client.query('COMMIT');

    return { bookingId, status: 'confirmed' };
  } catch (err) {
    // If we haven't already committed above, make sure we roll back.
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore if already committed/rolled back */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getBooking(bookingId) {
  const res = await pool.query(
    `SELECT b.id, b.status, b.created_at, b.updated_at,
            s.id AS student_id, s.name AS student_name,
            c.id AS class_id, c.subject, c.scheduled_at
     FROM bookings b
     JOIN students s ON s.id = b.student_id
     JOIN trial_classes c ON c.id = b.class_id
     WHERE b.id = $1`,
    [bookingId]
  );
  if (res.rowCount === 0) {
    throw new BookingError(404, 'booking_not_found', 'Booking not found');
  }
  return res.rows[0];
}

async function getRoster(classId) {
  const classRes = await pool.query(
    'SELECT id, subject, teacher_name, scheduled_at, capacity FROM trial_classes WHERE id = $1',
    [classId]
  );
  if (classRes.rowCount === 0) {
    throw new BookingError(404, 'class_not_found', 'Trial class not found');
  }

  const rosterRes = await pool.query(
    `SELECT s.id AS student_id, s.name AS student_name, b.id AS booking_id, b.updated_at AS confirmed_at
     FROM bookings b
     JOIN students s ON s.id = b.student_id
     WHERE b.class_id = $1 AND b.status = 'confirmed'
     ORDER BY b.updated_at ASC`,
    [classId]
  );

  return {
    class: classRes.rows[0],
    confirmed_count: rosterRes.rowCount,
    seats_remaining: classRes.rows[0].capacity - rosterRes.rowCount,
    roster: rosterRes.rows,
  };
}

async function listClasses() {
  const res = await pool.query(
    `SELECT c.id, c.subject, c.teacher_name, c.scheduled_at, c.capacity,
            count(b.id) FILTER (WHERE b.status = 'confirmed')::int AS confirmed_count
     FROM trial_classes c
     LEFT JOIN bookings b ON b.class_id = c.id
     GROUP BY c.id
     ORDER BY c.id`
  );
  return res.rows.map((r) => ({
    ...r,
    seats_remaining: r.capacity - r.confirmed_count,
  }));
}

module.exports = {
  BookingError,
  createBooking,
  confirmPayment,
  getBooking,
  getRoster,
  listClasses,
};
