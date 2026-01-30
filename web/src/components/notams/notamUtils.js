// Format date for display
export function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

// Format relative time
export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date - now;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    // Past
    const absDiffHours = Math.abs(diffHours);
    const absDiffDays = Math.abs(diffDays);
    if (absDiffDays > 1) return `${absDiffDays} days ago`;
    if (absDiffHours > 1) return `${absDiffHours} hours ago`;
    return 'recently';
  } else {
    // Future
    if (diffDays > 1) return `in ${diffDays} days`;
    if (diffHours > 1) return `in ${diffHours} hours`;
    return 'soon';
  }
}
