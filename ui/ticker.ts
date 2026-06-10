// /ui/ticker.ts — bottom-of-screen news ticker. A thin DOM strip that
// rotates short headlines (finals, leaders, milestones) and lets the app
// jump the queue with breaking items (home runs, walk-offs, champions).
// Pure DOM overlay: consumes strings, knows nothing about the sim.

export type TickerKind = 'news' | 'score' | 'milestone' | 'breaking';

export interface TickerItem {
  readonly text: string;
  readonly kind?: TickerKind;
}

export interface MountTickerOptions {
  /** Insert before this element (e.g. the controls bar) instead of appending. */
  readonly before?: Element | null;
}

export interface TickerHandle {
  /** Replace the base rotation (e.g. at the start of each league day). */
  setHeadlines(items: readonly TickerItem[]): void;
  /** Show this item next, ahead of the rotation. */
  pushBreaking(item: TickerItem): void;
  destroy(): void;
}

const TAG: Record<TickerKind, { label: string; color: string }> = {
  news: { label: 'NEWS', color: '#7aa2f7' },
  score: { label: 'FINAL', color: '#9ece6a' },
  milestone: { label: 'MILESTONE', color: '#e0af68' },
  breaking: { label: 'BREAKING', color: '#f7768e' },
};

const ROTATE_MS = 7000;

export const mountTicker = (
  parent: HTMLElement,
  options: MountTickerOptions = {},
): TickerHandle => {
  const style = document.createElement('style');
  style.textContent = `
    #news-ticker {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 10px;
      padding: 4px 14px;
      background: rgba(11, 13, 16, 0.85);
      border-top: 1px solid #1d2128;
      font-size: 12px;
      color: #c9cdd3;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
    }
    #news-ticker .tag {
      flex: 0 0 auto;
      padding: 1px 6px;
      font-size: 10px;
      letter-spacing: 1px;
      border: 1px solid currentColor;
    }
    #news-ticker .headline {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'news-ticker';
  el.setAttribute('aria-live', 'off');
  const tag = document.createElement('span');
  tag.className = 'tag';
  const headline = document.createElement('span');
  headline.className = 'headline';
  el.append(tag, headline);
  if (options.before) parent.insertBefore(el, options.before);
  else parent.appendChild(el);

  let base: readonly TickerItem[] = [];
  let baseIdx = 0;
  const breaking: TickerItem[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const show = (item: TickerItem) => {
    const t = TAG[item.kind ?? 'news'];
    tag.textContent = t.label;
    tag.style.color = t.color;
    headline.textContent = item.text;
    el.style.display = '';
  };

  const step = () => {
    const next = breaking.shift();
    if (next) {
      show(next);
      return;
    }
    if (base.length === 0) {
      el.style.display = 'none';
      return;
    }
    show(base[baseIdx % base.length]!);
    baseIdx += 1;
  };

  const ensureTimer = () => {
    if (timer === null) timer = setInterval(step, ROTATE_MS);
  };

  el.style.display = 'none';

  return {
    setHeadlines(items) {
      base = items;
      baseIdx = 0;
      ensureTimer();
      if (breaking.length === 0) step();
    },
    pushBreaking(item) {
      breaking.push(item);
      ensureTimer();
      // Breaking news doesn't wait for the rotation slot.
      show(breaking.shift()!);
    },
    destroy() {
      if (timer !== null) clearInterval(timer);
      el.remove();
      style.remove();
    },
  };
};
