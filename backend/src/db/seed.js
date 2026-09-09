/**
 * Drops/recreates the schema and inserts synthetic seed data covering every
 * required edge case:
 *   - class 1: open, no confirmed bookings yet
 *   - class 2: exactly 3 confirmed students (1 seat remaining)
 *   - class 3: exactly 4 confirmed students (full -> overbooking case)
 *   - a pre-existing payment_failed booking (payment failure case)
 *   - student 3 is already confirmed in class 2 -> ready-made duplicate-booking target
 *
 * Safe to re-run: it drops and recreates all tables via schema.sql first.
 */
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function seed() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const parents = await pool.query(
    `INSERT INTO parents (name, email) VALUES
      ('Siti Amalia', 'siti.amalia@example.com'),
      ('Budi Wijaya', 'budi.wijaya@example.com'),
      ('Dewi Kartika', 'dewi.kartika@example.com'),
      ('Rina Santoso', 'rina.santoso@example.com')
     RETURNING id`
  );
  const [p1, p2, p3, p4] = parents.rows.map((r) => r.id);

  const students = await pool.query(
    `INSERT INTO students (parent_id, name) VALUES
      ($1, 'Amir Amalia'),
      ($1, 'Nadia Amalia'),
      ($2, 'Putri Wijaya'),
      ($2, 'Rangga Wijaya'),
      ($2, 'Salsa Wijaya'),
      ($3, 'Raka Kartika'),
      ($4, 'Bagas Santoso'),
      ($3, 'Made Kartika'),
      ($4, 'Ayu Santoso'),
      ($2, 'Dimas Wijaya')
     RETURNING id`,
    [p1, p2, p3, p4]
  );
  const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10] = students.rows.map((r) => r.id);

  const classes = await pool.query(
    `INSERT INTO trial_classes (subject, teacher_name, scheduled_at, capacity) VALUES
      ('Math Trial', 'Andi Prasetyo', now() + interval '3 days', 4),
      ('Science Trial', 'Budi Hartono', now() + interval '4 days', 4),
      ('Math Trial B', 'Citra Wulandari', now() + interval '5 days', 4)
     RETURNING id`
  );
  const [c1, c2, c3] = classes.rows.map((r) => r.id);

  // Class 2: exactly 3 confirmed students (1 seat remaining).
  // Student 3 (Putri Wijaya) ends up here -> use her again to demo a
  // duplicate-booking rejection for the same child + class.
  for (const studentId of [s1, s2, s3]) {
    const b = await pool.query(
      `INSERT INTO bookings (student_id, class_id, status) VALUES ($1, $2, 'confirmed') RETURNING id`,
      [studentId, c2]
    );
    await pool.query(`INSERT INTO payment_attempts (booking_id, status) VALUES ($1, 'success')`, [b.rows[0].id]);
  }

  // Class 3: exactly 4 confirmed students (full) -> overbooking demo target.
  for (const studentId of [s4, s5, s8, s9]) {
    const b = await pool.query(
      `INSERT INTO bookings (student_id, class_id, status) VALUES ($1, $2, 'confirmed') RETURNING id`,
      [studentId, c3]
    );
    await pool.query(`INSERT INTO payment_attempts (booking_id, status) VALUES ($1, 'success')`, [b.rows[0].id]);
  }

  // Pre-seeded payment failure: Dimas Wijaya tried class 1 and payment failed.
  // He does not occupy a seat and does not appear on the roster.
  const failedBooking = await pool.query(
    `INSERT INTO bookings (student_id, class_id, status) VALUES ($1, $2, 'payment_failed') RETURNING id`,
    [s10, c1]
  );
  await pool.query(
    `INSERT INTO payment_attempts (booking_id, status, reason) VALUES ($1, 'failed', 'simulated_failure')`,
    [failedBooking.rows[0].id]
  );

  console.log('Seed complete.');
  console.log('Classes:', { math_trial_open: c1, science_trial_3of4: c2, math_trial_b_full: c3 });
  console.log('Students:', {
    s1_amir: s1,
    s2_nadia: s2,
    s3_putri_confirmed_in_c2: s3,
    s4_rangga: s4,
    s5_salsa: s5,
    s6_raka_unbooked: s6,
    s7_bagas_unbooked: s7,
    s8_made: s8,
    s9_ayu: s9,
    s10_dimas_payment_failed: s10,
  });
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
