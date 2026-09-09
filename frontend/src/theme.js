const GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#0ea5e9,#22d3ee)',
  'linear-gradient(135deg,#f59e0b,#fb923c)',
  'linear-gradient(135deg,#10b981,#34d399)',
  'linear-gradient(135deg,#ec4899,#f472b6)',
];

export function subjectIcon(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('science')) return '🔬';
  if (s.includes('math')) return '🧮';
  return '📚';
}

export function gradientForClass(id) {
  return GRADIENTS[(Number(id) - 1 + GRADIENTS.length) % GRADIENTS.length];
}

export function initials(name) {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
