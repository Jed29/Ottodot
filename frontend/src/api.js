const API = '/api';

async function request(path, opts) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || 'Request failed');
    err.code = body.error;
    err.status = res.status;
    throw err;
  }
  return body;
}

export const getStudents = () => request('/students');
export const getClasses = () => request('/classes');
export const getRoster = (classId) => request(`/classes/${classId}/roster`);
export const createBooking = (studentId, classId) =>
  request('/bookings', {
    method: 'POST',
    body: JSON.stringify({ student_id: studentId, class_id: classId }),
  });
export const payBooking = (bookingId, simulate) =>
  request(`/bookings/${bookingId}/pay`, {
    method: 'POST',
    body: JSON.stringify({ simulate }),
  });
