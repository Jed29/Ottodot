import { initials } from '../theme';

export default function ChildPicker({ students, value, onChange }) {
  return (
    <div className="chip-row">
      {students.map((s) => (
        <button
          type="button"
          key={s.id}
          className={`chip${String(s.id) === value ? ' selected' : ''}`}
          onClick={() => onChange(String(s.id))}
        >
          <span className="avatar">{initials(s.name)}</span>
          <span className="chip-text">
            <strong>{s.name}</strong>
            <small>parent: {s.parent_name}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
