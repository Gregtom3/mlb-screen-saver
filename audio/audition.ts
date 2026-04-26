// Dev-only audition page: lists each SFX with the in-game occurrence it
// represents and lets you trigger them individually or play the whole bank
// back-to-back for quick auditioning.

import {
  catcherMittPop,
  fielderGlovePop,
  batCrack,
  hardHitWoosh,
  foulTick,
  organStinger,
  testTone,
  ensureAudio,
  setMuted,
  isMuted,
  setVolume,
  getVolume,
} from './index.js';

interface Cue {
  readonly id: string;
  readonly label: string;
  readonly occurrence: string;
  readonly play: (when?: number) => void;
  /** Composite cues (e.g. crack + woosh) need a longer slot in the sequence. */
  readonly slotMs: number;
}

const CUES: ReadonlyArray<Cue> = [
  {
    id: 'catcher',
    label: 'Catcher mitt pop',
    occurrence: 'pitch — called/swinging strike, ball received cleanly',
    play: (w) => catcherMittPop(w),
    slotMs: 600,
  },
  {
    id: 'foul',
    label: 'Foul tick',
    occurrence: 'pitch — foul tip / glancing nick',
    play: (w) => foulTick(w),
    slotMs: 600,
  },
  {
    id: 'crack',
    label: 'Bat crack',
    occurrence: 'contact — every batted ball',
    play: (w) => batCrack(w),
    slotMs: 700,
  },
  {
    id: 'crack-woosh',
    label: 'Bat crack + hard-hit woosh',
    occurrence: 'contact — exitSpeedMph > ~95 (line drive / deep fly)',
    play: (w) => {
      batCrack(w);
      hardHitWoosh(w);
    },
    slotMs: 900,
  },
  {
    id: 'glove',
    label: 'Fielder glove pop',
    occurrence: "baserunner — out: true, fielder makes the catch/tag",
    play: (w) => fielderGlovePop(w),
    slotMs: 600,
  },
  {
    id: 'organ',
    label: 'Organ stinger',
    occurrence: 'inningEnd / big play — sparingly',
    play: (w) => organStinger(w),
    slotMs: 1100,
  },
];

const root = document.getElementById('audition');
if (!root) throw new Error('#audition element missing');

const status = document.createElement('div');
status.className = 'status';
status.textContent = 'idle';

const list = document.createElement('div');
list.className = 'cues';

for (const cue of CUES) {
  const row = document.createElement('div');
  row.className = 'cue';
  row.dataset['id'] = cue.id;

  const meta = document.createElement('div');
  meta.className = 'cue-meta';
  const name = document.createElement('div');
  name.className = 'cue-name';
  name.textContent = cue.label;
  const desc = document.createElement('div');
  desc.className = 'cue-desc';
  desc.textContent = cue.occurrence;
  meta.append(name, desc);

  const btn = document.createElement('button');
  btn.textContent = '▶ play';
  btn.addEventListener('click', () => {
    ensureAudio();
    cue.play(0);
    flash(row);
    status.textContent = `played: ${cue.label}`;
  });

  row.append(meta, btn);
  list.append(row);
}

const playAllBtn = document.createElement('button');
playAllBtn.className = 'primary';
playAllBtn.textContent = '▶ play all in sequence';

let sequenceTimer: number | null = null;
function cancelSequence(): void {
  if (sequenceTimer !== null) {
    window.clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
}

playAllBtn.addEventListener('click', () => {
  cancelSequence();
  ensureAudio();
  let cursor = 0;
  const step = (): void => {
    if (cursor >= CUES.length) {
      status.textContent = 'sequence done';
      sequenceTimer = null;
      return;
    }
    const cue = CUES[cursor]!;
    const row = list.querySelector<HTMLElement>(`[data-id="${cue.id}"]`);
    if (row) flash(row);
    status.textContent = `▶ ${cue.label} — ${cue.occurrence}`;
    cue.play(0);
    cursor += 1;
    sequenceTimer = window.setTimeout(step, cue.slotMs);
  };
  step();
});

const stopBtn = document.createElement('button');
stopBtn.textContent = '■ stop';
stopBtn.addEventListener('click', () => {
  cancelSequence();
  status.textContent = 'stopped';
});

const tonebtn = document.createElement('button');
tonebtn.textContent = '🔔 test tone (440Hz)';
tonebtn.addEventListener('click', () => {
  const { ctx } = ensureAudio();
  testTone(0);
  status.textContent = `test tone — ctx.state=${ctx.state} sampleRate=${ctx.sampleRate} vol=${getVolume().toFixed(2)} muted=${isMuted()}`;
});

const muteBtn = document.createElement('button');
function syncMuteLabel(): void {
  muteBtn.textContent = isMuted() ? '🔇 unmute' : '🔊 mute';
}
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  syncMuteLabel();
});
syncMuteLabel();

const volWrap = document.createElement('label');
volWrap.className = 'vol';
volWrap.textContent = 'volume ';
const vol = document.createElement('input');
vol.type = 'range';
vol.min = '0';
vol.max = '1';
vol.step = '0.01';
vol.value = String(getVolume());
vol.addEventListener('input', () => {
  setVolume(parseFloat(vol.value));
});
volWrap.append(vol);

const controls = document.createElement('div');
controls.className = 'controls';
controls.append(playAllBtn, stopBtn, tonebtn, muteBtn, volWrap);

root.append(controls, status, list);

function flash(el: HTMLElement): void {
  el.classList.add('playing');
  window.setTimeout(() => el.classList.remove('playing'), 220);
}
