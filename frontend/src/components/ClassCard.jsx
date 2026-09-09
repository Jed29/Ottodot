import { subjectIcon, gradientForClass, fmtDate } from '../theme';

export default function ClassCard({ cls, selected, onSelect }) {
  const full = cls.seats_remaining <= 0;
  const pct = Math.min(100, Math.round((cls.confirmed_count / cls.capacity) * 100));

  return (
    <button
      type="button"
      className={`class-card${selected ? ' selected' : ''}${full ? ' full' : ''}`}
      onClick={() => onSelect(cls.id)}
      disabled={full}
      title={full ? 'This class is full' : `Select ${cls.subject}`}
    >
      <div className="class-banner" style={{ background: gradientForClass(cls.id) }}>
        <span className="class-icon">{subjectIcon(cls.subject)}</span>
        {full && <span className="full-pill">FULL</span>}
        {!full && cls.seats_remaining === 1 && <span className="last-pill">LAST SEAT</span>}
      </div>
      <div className="class-body">
        <h3>{cls.subject}</h3>
        <p className="class-meta">{cls.teacher_name}</p>
        <p className="class-meta">{fmtDate(cls.scheduled_at)}</p>
        <div className="seat-meter">
          <div className="seat-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="seat-text">
          {cls.confirmed_count}/{cls.capacity} seats filled
        </p>
      </div>
    </button>
  );
}
