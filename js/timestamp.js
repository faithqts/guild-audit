function formatTime(timeId, tzId) {
  const el = document.getElementById(timeId);
  if (el) {
    const d = new Date(el.getAttribute('datetime'));
    if (!isNaN(d)) {
      const pad = n => String(n).padStart(2, '0');
      el.textContent = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      const offset = -d.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const hrs = Math.floor(Math.abs(offset) / 60);
      const mins = Math.abs(offset) % 60;
      const label = document.getElementById(tzId);
      if (label) label.textContent = '(GMT' + sign + hrs + (mins ? ':' + pad(mins) : '') + ')';
    }
  }
}

function formatAuditTimestamps() {
  formatTime('audit-updated', 'audit-tz');
  formatTime('players-updated', 'players-tz');
}

window.formatAuditTimestamps = formatAuditTimestamps;
formatAuditTimestamps();
