(function () {
  const REFRESH_MS = 60 * 1000;
  const source = document.body?.dataset?.auditSource === 'personal' ? 'personal' : 'guild';
  const tableBody = document.querySelector('table tbody');
  const tableFoot = document.querySelector('table tfoot');
  const auditUpdated = document.getElementById('audit-updated');
  const playersUpdated = document.getElementById('players-updated');

  if (!tableBody || !tableFoot) return;

  let inFlight = false;

  function setTime(el, value) {
    if (!el) return;
    const safeValue = value || '';
    el.setAttribute('datetime', safeValue);
    el.textContent = safeValue;
  }

  function updateTitle(title) {
    if (title) {
      document.title = title;
    }
  }

  function applyData(payload) {
    if (!payload) return;

    tableBody.innerHTML = payload.rowsHtml || '';
    tableFoot.innerHTML = payload.summaryHtml || '';
    setTime(auditUpdated, payload.auditCreated);
    setTime(playersUpdated, payload.playersCreated);

    if (typeof window.formatAuditTimestamps === 'function') {
      window.formatAuditTimestamps();
    }
    if (typeof window.applyCurrentSort === 'function') {
      window.applyCurrentSort();
    }

    updateTitle(payload.auditTitle);
  }

  async function refreshNow() {
    if (inFlight) return;
    inFlight = true;

    try {
      const response = await fetch(`/api/dashboard-data?source=${encodeURIComponent(source)}&refresh=true`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Dashboard refresh failed (${response.status})`);
      }

      const payload = await response.json();
      applyData(payload);
    } catch (err) {
      console.error(err);
    } finally {
      inFlight = false;
    }
  }

  const refreshTimer = setInterval(refreshNow, REFRESH_MS);
  window.addEventListener('beforeunload', () => clearInterval(refreshTimer));
})();
