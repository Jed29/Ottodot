import { useEffect, useState } from 'react';
import { getRoster } from '../api';
import { subjectIcon, initials, fmtDate } from '../theme';

export default function RosterPanel({ classes, refreshKey }) {
  const [classId, setClassId] = useState('');
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!classId && classes.length) setClassId(String(classes[0].id));
  }, [classes, classId]);

  useEffect(() => {
    if (!classId) return;
    setError(null);
    getRoster(classId)
      .then(setRoster)
      .catch((err) => {
        setRoster(null);
        setError(err.message);
      });
  }, [classId, refreshKey]);

  return (
    <div className="card">
      <h2>2. Class roster <span className="card-subtitle">admin / teacher view</span></h2>

      <div className="tabs">
        {classes.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`tab${String(c.id) === classId ? ' selected' : ''}`}
            onClick={() => setClassId(String(c.id))}
          >
            <span>{subjectIcon(c.subject)}</span> {c.subject}
          </button>
        ))}
      </div>

      {error && <div className="seats">Error loading roster: {error}</div>}

      {roster && (
        <>
          <div className="roster-meta">
            <div className="seat-meter">
              <div
                className="seat-meter-fill"
                style={{ width: `${Math.min(100, (roster.confirmed_count / roster.class.capacity) * 100)}%` }}
              />
            </div>
            <span>
              {roster.confirmed_count}/{roster.class.capacity} confirmed — {roster.seats_remaining} seat(s)
              remaining
            </span>
          </div>

          <ul className="roster">
            {roster.roster.length ? (
              roster.roster.map((r) => (
                <li key={r.booking_id} className="roster-row">
                  <span className="avatar small">{initials(r.student_name)}</span>
                  <span className="roster-name">{r.student_name}</span>
                  <span className="roster-time">confirmed {fmtDate(r.confirmed_at)}</span>
                </li>
              ))
            ) : (
              <li className="roster-empty">No confirmed students yet.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
