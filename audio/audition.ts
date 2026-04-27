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
  slide,
  strike3Call,
  batSnap,
  ensureAudio,
  setMuted,
  isMuted,
  setVolume,
  getVolume,
  cheer,
  roar,
  oo,
  gasp,
  groan,
  twoStrikeClap,
  rallyClap,
  applauseTail,
  startBed,
  stopBed,
  setBedFromState,
  isBedRunning,
  startWalkup,
  stopWalkup,
} from './index.js';
import { initialCrowdState } from '../ambience/index.js';

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
    id: 'slide',
    label: 'Slide',
    occurrence: 'baserunner — sliding into a base on a close play',
    play: (w) => slide(w),
    slotMs: 800,
  },
  {
    id: 'strike3',
    label: 'Strike 3 call',
    occurrence: 'pitch — third strike, batter punched out',
    play: (w) => strike3Call(w),
    slotMs: 800,
  },
  {
    id: 'bat-snap',
    label: 'Bat snap (rare)',
    occurrence: 'rare frustration trigger after a strikeout (low probability per K)',
    play: (w) => batSnap(w),
    slotMs: 800,
  },
  {
    id: 'organ',
    label: 'Organ stinger',
    occurrence: 'inningEnd / big play — sparingly',
    play: (w) => organStinger(w),
    slotMs: 1100,
  },
  {
    id: 'cheer',
    label: 'Crowd cheer',
    occurrence: 'home strikeout, mid-leverage hit',
    play: () => cheer(0.7, 1500),
    slotMs: 1700,
  },
  {
    id: 'roar',
    label: 'Crowd roar',
    occurrence: 'home HR / walk-off — sustained',
    play: () => roar(1.0, 6000),
    slotMs: 6500,
  },
  {
    id: 'oo',
    label: 'Crowd "oo"',
    occurrence: 'anticipation lift on a hard-hit ball',
    play: () => oo(0.6, 900),
    slotMs: 1100,
  },
  {
    id: 'gasp',
    label: 'Crowd gasp',
    occurrence: 'suspense — close play / deep fly',
    play: () => gasp(0.5, 700),
    slotMs: 900,
  },
  {
    id: 'groan',
    label: 'Crowd groan',
    occurrence: 'home rally killed / away HR',
    play: () => groan(0.6, 1800),
    slotMs: 2000,
  },
  {
    id: 'rally-clap',
    label: 'Rally clap',
    occurrence: 'building rally — slower bpm clapping',
    play: () => rallyClap(0.7, 3000),
    slotMs: 3200,
  },
  {
    id: 'two-strike-clap',
    label: 'Two-strike clap',
    occurrence: '2-strike count, home pitching',
    play: () => twoStrikeClap(0.7, 2400),
    slotMs: 2600,
  },
  {
    id: 'applause-tail',
    label: 'Applause tail',
    occurrence: 'sustained applause that decays out',
    play: () => applauseTail(0.7, 4000),
    slotMs: 4200,
  },
  {
    id: 'walkup',
    label: 'Walk-up jingle (sample player)',
    occurrence: 'new batter steps in (procedural per-player)',
    play: () => startWalkup({ playerId: 'sample-player-1', intensity: 0.85, durationMs: 4000 }),
    slotMs: 4200,
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

// Crowd-bed audition: start/stop the sustained ambient bed and live-tune
// the (energy, arousal) inputs so you can hear how the bed responds.
const bedToggleBtn = document.createElement('button');
const refreshBedLabel = () => {
  bedToggleBtn.textContent = isBedRunning() ? '■ stop bed' : '▶ start bed';
};
refreshBedLabel();

let bedEnergy = 0.4;
let bedArousal = 0;
let bedAttention = 0.5;
const pushBedState = () => {
  if (!isBedRunning()) return;
  setBedFromState({
    ...initialCrowdState(),
    phase: 'live',
    energy: bedEnergy,
    arousal: bedArousal,
    attention: bedAttention,
  });
};

bedToggleBtn.addEventListener('click', () => {
  ensureAudio();
  if (isBedRunning()) {
    stopBed();
  } else {
    startBed();
    pushBedState();
  }
  refreshBedLabel();
});

const bedRow = document.createElement('div');
bedRow.className = 'controls';
bedRow.style.flexWrap = 'wrap';
const bedSlider = (label: string, init: number, set: (v: number) => void) => {
  const wrap = document.createElement('label');
  wrap.className = 'vol';
  wrap.textContent = `${label} `;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(init);
  input.addEventListener('input', () => {
    set(parseFloat(input.value));
    pushBedState();
  });
  wrap.append(input);
  return wrap;
};
bedRow.append(
  bedToggleBtn,
  bedSlider('energy', bedEnergy, (v) => (bedEnergy = v)),
  bedSlider('arousal', bedArousal, (v) => (bedArousal = v)),
  bedSlider('attention', bedAttention, (v) => (bedAttention = v)),
);

const stopWalkupBtn = document.createElement('button');
stopWalkupBtn.textContent = '■ stop walkup';
stopWalkupBtn.addEventListener('click', () => stopWalkup());

const controls = document.createElement('div');
controls.className = 'controls';
controls.append(playAllBtn, stopBtn, tonebtn, muteBtn, volWrap, stopWalkupBtn);

root.append(controls, bedRow, status, list);

function flash(el: HTMLElement): void {
  el.classList.add('playing');
  window.setTimeout(() => el.classList.remove('playing'), 220);
}
