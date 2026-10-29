// German speech (PLAN §10.6). Never on the prompt side: callers speak only after an answer and
// on the intro card. Safe when the device has no German voice.
let voices = [];
const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

function load() {
  voices = synth ? synth.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang)) : [];
}
if (synth) {
  load();
  synth.addEventListener?.('voiceschanged', load);
}

const QUALITY = /enhanced|premium|erweitert|verbessert|natural/i;

// German voices, best first (Enhanced/Premium, then de-DE, then other German).
export function germanVoices() {
  const score = (v) => (QUALITY.test(v.name) ? 0 : 2) + (/^de-DE$/i.test(v.lang) ? 0 : 1);
  return [...voices].sort((a, b) => score(a) - score(b));
}

export function speak(text, { voice = null, rate = 1 } = {}) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = rate;
  const v = germanVoices().find((x) => x.voiceURI === voice) || germanVoices()[0];
  if (v) u.voice = v;
  synth.speak(u);
}

export function stop() {
  synth?.cancel();
}
