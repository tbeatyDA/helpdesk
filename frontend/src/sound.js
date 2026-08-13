// ── Sound ────────────────────────────────────────────────────────────────────

const SOUND_KEY = 'it.sound';

export function isSoundEnabled() {
  try {
    const val = localStorage.getItem(SOUND_KEY);
    return val === null ? true : val === 'true';
  } catch { return true; }
}

export function setSoundEnabled(val) {
  try { localStorage.setItem(SOUND_KEY, String(val)); } catch {}
}

export function playPing() {
  if (!isSoundEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1047, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(523, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
      osc.onended = () => ctx.close();
    };
    // AudioContext may be suspended in background tabs — resume first
    if (ctx.state === 'suspended') {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch {}
}

// ── Browser notifications ─────────────────────────────────────────────────────

const NOTIFY_KEY = 'it.notify';

export function isNotifyEnabled() {
  try {
    const val = localStorage.getItem(NOTIFY_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

export function setNotifyEnabled(val) {
  try { localStorage.setItem(NOTIFY_KEY, String(val)); } catch {}
}

export function notifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function requestNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function showNotification(title, body) {
  if (!isNotifyEnabled()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico' });
    setTimeout(() => n.close(), 6000);
    // Clicking the notification focuses the helpdesk tab
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}
