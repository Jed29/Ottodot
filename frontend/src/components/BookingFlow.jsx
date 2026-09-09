import { useEffect, useState } from 'react';
import { getStudents, createBooking, payBooking } from '../api';
import ChildPicker from './ChildPicker';
import ClassCard from './ClassCard';
import StepIndicator from './StepIndicator';
import PaymentForm from './PaymentForm';
import StatusBadge from './StatusBadge';

export default function BookingFlow({ classes, onBooked }) {
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [booking, setBooking] = useState(null);
  const [result, setResult] = useState(null); // { status, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStudents().then(setStudents).catch(() => {});
  }, []);

  const phase = booking ? booking.status : 'select';
  const selectedStudent = students.find((s) => String(s.id) === studentId);

  async function handleBook() {
    setBusy(true);
    setResult(null);
    try {
      const b = await createBooking(studentId, classId);
      setBooking(b);
    } catch (err) {
      setResult({ status: 'book_error', text: `${err.code || 'error'} — ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(simulate) {
    if (!booking) return;
    setBusy(true);
    try {
      const r = await payBooking(booking.id, simulate);
      setResult({ status: r.status, text: `Booking #${r.bookingId} is now ${r.status}.` });
    } catch (err) {
      setResult({
        status: err.code === 'class_full' ? 'payment_failed' : err.code === 'payment_failed' ? 'payment_failed' : 'error',
        text: `${err.code} — ${err.message}`,
      });
    } finally {
      setBooking(null);
      setBusy(false);
      onBooked();
    }
  }

  function startOver() {
    setBooking(null);
    setResult(null);
  }

  return (
    <div className="card">
      <h2>1. Book a trial class</h2>

      <StepIndicator phase={result ? result.status : phase} />

      {!booking && !result && (
        <>
          <label>Child</label>
          <ChildPicker students={students} value={studentId} onChange={setStudentId} />

          <label>Trial class</label>
          <div className="class-grid">
            {classes.map((c) => (
              <ClassCard key={c.id} cls={c} selected={String(c.id) === classId} onSelect={(id) => setClassId(String(id))} />
            ))}
          </div>

          <button disabled={busy || !studentId || !classId} onClick={handleBook}>
            Book trial
          </button>
        </>
      )}

      {booking && !result && (
        <PaymentForm
          bookingId={booking.id}
          studentName={selectedStudent?.name}
          parentName={selectedStudent?.parent_name}
          busy={busy}
          onPay={handlePay}
        />
      )}

      {result && (
        <div className={`result-panel result-${result.status}`}>
          <StatusBadge status={result.status} />
          <p>{result.text}</p>
          <button className="secondary" onClick={startOver}>
            Book another trial
          </button>
        </div>
      )}
    </div>
  );
}
