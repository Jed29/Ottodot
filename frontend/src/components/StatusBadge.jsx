const STATUS_META = {
  pending_payment: { label: 'Pending payment', icon: '⏳', className: 'badge-pending' },
  confirmed: { label: 'Confirmed', icon: '✅', className: 'badge-confirmed' },
  payment_failed: { label: 'Payment failed', icon: '❌', className: 'badge-failed' },
  cancelled: { label: 'Cancelled', icon: '🚫', className: 'badge-cancelled' },
  book_error: { label: 'Booking rejected', icon: '🚫', className: 'badge-failed' },
  error: { label: 'Error', icon: '⚠️', className: 'badge-failed' },
};

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, icon: 'ℹ️', className: 'badge-pending' };
  return (
    <span className={`badge ${meta.className}`}>
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}
