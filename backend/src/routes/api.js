const express = require('express');
const svc = require('../services/bookingService');
const pool = require('../db/pool');

const router = express.Router();

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof svc.BookingError) {
        return res.status(err.status).json({ error: err.code, message: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
    }
  };
}

router.get(
  '/classes',
  handle(async (req, res) => {
    const classes = await svc.listClasses();
    res.json(classes);
  })
);

router.get(
  '/classes/:id/roster',
  handle(async (req, res) => {
    const roster = await svc.getRoster(Number(req.params.id));
    res.json(roster);
  })
);

router.post(
  '/bookings',
  handle(async (req, res) => {
    const { student_id, class_id } = req.body || {};
    if (!student_id || !class_id) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: 'student_id and class_id are required' });
    }
    const booking = await svc.createBooking({
      studentId: Number(student_id),
      classId: Number(class_id),
    });
    res.status(201).json(booking);
  })
);

router.post(
  '/bookings/:id/pay',
  handle(async (req, res) => {
    const { simulate } = req.body || {};
    const result = await svc.confirmPayment({ bookingId: Number(req.params.id), simulate });
    res.json(result);
  })
);

router.get(
  '/bookings/:id',
  handle(async (req, res) => {
    const booking = await svc.getBooking(Number(req.params.id));
    res.json(booking);
  })
);

// Demo-frontend convenience: parent/child picker data.
router.get(
  '/students',
  handle(async (req, res) => {
    const result = await pool.query(
      `SELECT s.id, s.name, p.name AS parent_name
       FROM students s JOIN parents p ON p.id = s.parent_id
       ORDER BY s.id`
    );
    res.json(result.rows);
  })
);

module.exports = router;
