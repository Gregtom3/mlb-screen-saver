import type { MenuContext } from './menu-shared.js';
import { emptyState } from './menu-shared.js';

// Phase 5.5 step 5.5.12 — history view stub. Empty-state pages with hooks
// ready for Phase 6 (multi-season persistence).

export const renderHistory = (host: HTMLElement, ctx: MenuContext): void => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>History</h2>`;

  const sec1 = document.createElement('section');
  sec1.innerHTML = '<h3>Past seasons</h3>';
  sec1.appendChild(emptyState('Season 1 in progress — no past seasons yet. Phase 6 will fill this in once an offseason has rolled.'));
  wrap.appendChild(sec1);

  const sec2 = document.createElement('section');
  sec2.innerHTML = '<h3>Single-season records</h3>';
  sec2.appendChild(emptyState('Records will appear here as the season finishes.'));
  wrap.appendChild(sec2);

  const sec3 = document.createElement('section');
  sec3.innerHTML = '<h3>All-time records</h3>';
  sec3.appendChild(emptyState('All-time records require multiple completed seasons. Phase 6.'));
  wrap.appendChild(sec3);

  const sec4 = document.createElement('section');
  sec4.innerHTML = '<h3>Hall of fame</h3>';
  sec4.appendChild(emptyState('Hall of fame inductions begin once players retire (Phase 6).'));
  wrap.appendChild(sec4);

  // Friendly footer: where current state IS visible right now.
  const note = document.createElement('div');
  note.className = 'menu-hint';
  note.textContent = `Live league: ${ctx.teams.length} teams, season ${ctx.getAggregates().seasonYear}.`;
  wrap.appendChild(note);

  host.appendChild(wrap);
};
