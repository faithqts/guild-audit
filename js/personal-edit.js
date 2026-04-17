(function () {
  const textarea = document.getElementById('personal-json');
  const reloadButton = document.getElementById('reload-personal');
  const saveButton = document.getElementById('save-personal');
  const statusEl = document.getElementById('editor-status');

  if (!textarea || !reloadButton || !saveButton || !statusEl) return;

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `editor-status ${type ? `editor-status-${type}` : ''}`.trim();
  }

  function setBusy(isBusy) {
    reloadButton.disabled = isBusy;
    saveButton.disabled = isBusy;
  }

  async function loadPersonalData() {
    setBusy(true);
    setStatus('Loading personal_data.json...', 'info');

    try {
      const response = await fetch('/api/personal-data', {
        cache: 'no-store',
        credentials: 'same-origin',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Failed to load data (${response.status})`);
      }

      textarea.value = JSON.stringify(payload.data || [], null, 2);
      setStatus(`Loaded ${payload.count || 0} entries.`, 'success');
    } catch (err) {
      setStatus(err.message || 'Failed to load personal_data.json.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePersonalData() {
    let parsed;
    try {
      parsed = JSON.parse(textarea.value);
      if (!Array.isArray(parsed)) {
        throw new Error('JSON root must be an array.');
      }
    } catch (err) {
      setStatus(`Invalid JSON: ${err.message}`, 'error');
      return;
    }

    setBusy(true);
    setStatus('Saving and refreshing personal characters...', 'info');

    try {
      const response = await fetch('/api/personal-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify(parsed),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Failed to save data (${response.status})`);
      }

      textarea.value = JSON.stringify(parsed, null, 2);
      setStatus(
        `Saved ${payload.count || 0} entries. Refreshed ${payload.refreshedCount || 0} personal characters.`,
        'success'
      );
    } catch (err) {
      setStatus(err.message || 'Failed to save personal_data.json.', 'error');
    } finally {
      setBusy(false);
    }
  }

  reloadButton.addEventListener('click', loadPersonalData);
  saveButton.addEventListener('click', savePersonalData);

  loadPersonalData();
})();
