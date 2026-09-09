const STEPS = ['Choose', 'Pay', 'Done'];

// phase: 'select' | 'book_error' | 'pending_payment' | 'payment_failed' | 'error' | 'confirmed'
export default function StepIndicator({ phase }) {
  const failed = phase === 'book_error' || phase === 'payment_failed' || phase === 'error';
  const activeIndex =
    phase === 'pending_payment' || phase === 'payment_failed' || phase === 'error'
      ? 1
      : phase === 'confirmed'
        ? 3
        : 0;

  return (
    <div className="steps">
      {STEPS.map((label, i) => {
        let state = 'upcoming';
        if (i < activeIndex) state = 'done';
        else if (i === activeIndex) state = failed ? 'failed' : 'active';

        return (
          <div className={`step step-${state}`} key={label}>
            <span className="step-dot">{state === 'done' ? '✓' : state === 'failed' ? '✕' : i + 1}</span>
            <span className="step-label">{label}</span>
            {i < STEPS.length - 1 && <span className="step-line" />}
          </div>
        );
      })}
    </div>
  );
}
