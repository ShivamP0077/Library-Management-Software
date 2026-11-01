/**
 * Copies each table's <th> text onto its <td>s as data-label, so CSS can render
 * table rows as labelled cards on small screens. Watches the DOM for new/updated tables.
 */
function labelTable(table) {
  const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
  if (!heads.length) return;
  table.querySelectorAll('tbody tr').forEach(tr => {
    let col = 0;
    Array.from(tr.children).forEach(td => {
      const label = heads[col];
      if (label && td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
      col += td.colSpan || 1;
    });
  });
}

export function initResponsiveTables(root = document.body) {
  let scheduled = false;
  const run = () => { scheduled = false; root.querySelectorAll('table.data-grid').forEach(labelTable); };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(run); } };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
}
