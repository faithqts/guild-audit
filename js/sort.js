(function () {
  function sortByHeader(th, asc) {
    const table = th.closest('table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = Array.from(th.parentNode.children).indexOf(th);
    const type = th.dataset.sort;

    table.querySelectorAll('th.sortable').forEach(h => h.classList.remove('asc', 'desc'));
    th.classList.add(asc ? 'asc' : 'desc');

    rows.sort((a, b) => {
      let aVal;
      let bVal;

      if (type === 'role') {
        const order = { tank: 1, healer: 2, dps: 3 };
        aVal = order[a.children[idx]?.dataset.role] || 99;
        bVal = order[b.children[idx]?.dataset.role] || 99;
        return asc ? aVal - bVal : bVal - aVal;
      }

      aVal = a.children[idx]?.textContent.trim() ?? '';
      bVal = b.children[idx]?.textContent.trim() ?? '';
      if (type === 'number') {
        return asc
          ? (parseFloat(aVal) || 0) - (parseFloat(bVal) || 0)
          : (parseFloat(bVal) || 0) - (parseFloat(aVal) || 0);
      }
      return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

    rows.forEach(r => tbody.appendChild(r));
  }

  function applyCurrentSort() {
    const current = document.querySelector('th.sortable.asc, th.sortable.desc');
    if (current) {
      sortByHeader(current, current.classList.contains('asc'));
      return;
    }

    // Default sort: Role ascending (tank -> healer -> dps)
    const roleHeader = document.querySelector('th.sortable[data-sort="role"]');
    if (roleHeader) {
      sortByHeader(roleHeader, true);
    }
  }

  function initializeTableSort() {
    document.querySelectorAll('th.sortable').forEach(th => {
      if (th.dataset.sortBound === '1') return;
      th.addEventListener('click', () => {
        const asc = !th.classList.contains('asc');
        sortByHeader(th, asc);
      });
      th.dataset.sortBound = '1';
    });

    applyCurrentSort();
  }

  window.applyCurrentSort = applyCurrentSort;
  window.initializeTableSort = initializeTableSort;

  initializeTableSort();
})();
