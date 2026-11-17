// Port PERSIS dari agybot/bot.js (logic inti, tanpa Telegram)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGY = process.env.AGY_BIN || '/root/.local/bin/agy';
export const BASE = path.join(__dirname, 'sessions');
export const TOKEN_FILE = process.env.AGY_TOKEN_FILE || path.join(process.env.HOME || '/root', '.gemini/antigravity-cli/antigravity-oauth-token');
const TOKEN_BAK = path.join(__dirname, 'auth-backup', 'antigravity-oauth-token.bak');
const ENV = () => ({ ...process.env, PATH: `/root/.local/bin:${process.env.PATH}` });
export const DEFAULT_MODEL = 'gemini-3.8-flash-high'; // fallback sama dgn bot.js

fs.mkdirSync(BASE, { recursive: true });

// ---------- auth ----------
export function whoamiEmail() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).id_token_email || '(email tidak diketahui)'; }
  catch { return null; }
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
export function extractLoginUrl(buf) {
  const m = stripAnsi(String(buf)).match(/https:\/\/accounts\.google\.com\S*/);
  return m ? m[0].trim() : null;
}

// ---------- sesi (1 chat web = 1 folder, seperti 1 topic di bot) ----------
export const slugify = (s) => (s || 'sesi').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sesi';

export function topicDir(slug) {
  const d = path.join(BASE, slug);
  fs.mkdirSync(path.join(d, 'project'), { recursive: true });
  return _topicDir(d, slug);
}
function _topicDir(d, slug) {
  const agentMd = path.join(d, 'AGENT.md');
  if (!fs.existsSync(agentMd)) {
    fs.writeFileSync(agentMd, `# AGENT — ${slug}\n\nKamu adalah agent coding di folder proyek "${slug}".\nSemua file yang di-upload user ada di folder ./project/.\nKerjakan tugas di dalam folder ini. Tulis catatan penting ke AGENT.md ini.\n\nFormat Tabel & Respon:\n- Jika user meminta perbandingan, jadwal, daftar harga, spesifikasi, atau data terstruktur, selalu sajikan dalam format Markdown Table standar.\n- Berikan respon yang ramah, ringkas, solutif, dan profesional\n\nDibuat otomatis: ${new Date().toLocaleString('id-ID')}\n`);
  }
  return d;
}
export function readState(slug) {
  try { return JSON.parse(fs.readFileSync(path.join(BASE, slug, 'state.json'), 'utf8')); } catch { return {}; }
}
export function writeState(slug, st) {
  fs.mkdirSync(path.join(BASE, slug), { recursive: true });
  fs.writeFileSync(path.join(BASE, slug, 'state.json'), JSON.stringify(st, null, 2));
}

// ---------- limit ----------
export function detectLimit(raw) {
  const t = String(raw || '');
  const hit = (re) => re.test(t);
  if (hit(/week/i) && hit(/limit|quota|exceed/i)) return { window: 'week', label: 'Mingguan (1 week)' };
  if (hit(/5\s*hour|\b5h\b|lima jam/i) && hit(/limit|quota|exceed/i)) return { window: '5h', label: '5 jam' };
  if (hit(/rate.?limit|\b429\b|resource.?exhausted|quota|limit.*(reach|exceed)/i)) return { window: 'other', label: 'Rate limit' };
  return null;
}
export function extractResetIn(raw) {
  const m = String(raw || '').match(/Resets? in ([0-9dhm s]+)/i);
  return m ? m[1].trim() : null;
}

// ---------- agyPrompt (async) ----------
export function agyPrompt(cwd, text, model, conversationId) {
  return new Promise((resolve) => {
    const args = ['-p', text, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    if (conversationId) args.push('--conversation', conversationId);
    const proc = spawn(AGY, args, { cwd, env: ENV() });
    let out = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 10 * 60 * 1000);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ status: 'ERROR', response: String(e.message || e), error: String(e) }); });
    proc.on('close', () => {
      clearTimeout(timer);
      const lim = detectLimit(out);
      const m = out.match(/\{[\s\S]*\}/);
      if (m) { try { const j = JSON.parse(m[0]); j.limitDetected = lim; j.raw_output = out; resolve(j); return; } catch {} }
      resolve({ status: 'ERROR', response: out.trim() || '(tidak ada output)', error: 'parse', limitDetected: lim, raw_output: out });
    });
  });
}

// ---------- agyPromptStream: sama dengan agyPrompt tapi --output-format stream-json ----------
// onEvent(ev) dipanggil per baris NDJSON (init / step_update / result) → buat timeline "proses mikir".
export function agyPromptStream(cwd, text, model, conversationId, onEvent, signal) {
  return new Promise((resolve) => {
    const args = ['-p', text, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    if (conversationId) args.push('--conversation', conversationId);
    const proc = spawn(AGY, args, { cwd, env: ENV() });
    let out = '', buf = '', result = null, convId = null, usage = null;
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 10 * 60 * 1000);
    if (signal) {
      const stop = () => { try { proc.kill('SIGKILL'); } catch {} };
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    }
    const handleLine = (line) => {
      line = line.trim(); if (!line) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.conversation_id) convId = ev.conversation_id;
      const su = ev.step_update;
      if (su?.conversation_id) convId = su.conversation_id;
      if (su?.usage) usage = su.usage;
      if (ev.event === 'result') result = ev.result;
      try { onEvent && onEvent(ev); } catch {}
    };
    proc.stdout.on('data', (d) => {
      const s = d.toString(); out += s; buf += s;
      let i; while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ status: 'ERROR', response: String(e.message || e), error: String(e) }); });
    proc.on('close', () => {
      clearTimeout(timer);
      if (buf) handleLine(buf);
      const lim = detectLimit(out);
      if (result) { resolve({ ...result, conversation_id: result.conversation_id || convId, usage: result.usage || usage, limitDetected: lim, raw_output: out }); return; }
      resolve({ status: 'ERROR', response: out.replace(/\{"event"[^\n]*\n?/g, '').trim() || '(tidak ada output)', conversation_id: convId, error: 'parse', limitDetected: lim, raw_output: out });
    });
  });
}

// ---------- antrean (MAX_PARALLEL = 2, per slug) ----------
export const MAX_PARALLEL = 2;
export let running = 0;
export const queues = {};
function pump() {
  while (running < MAX_PARALLEL) {
    let next = null;
    for (const slug of Object.keys(queues)) {
      if (queues[slug].length) { next = { slug, job: queues[slug].shift() }; break; }
    }
    if (!next) return;
    running++;
    Promise.resolve().then(next.job.fn)
      .then((r) => next.job.resolve(r))
      .catch((e) => next.job.resolve({ status: 'ERROR', response: String(e.message || e) }))
      .finally(() => { running--; pump(); });
  }
}
export function runQueued(slug, fn) {
  return new Promise((resolve) => { (queues[slug] = queues[slug] || []).push({ fn, resolve }); pump(); });
}
export const runningCount = () => running;

// ---------- models & quota ----------
export function listModels() {
  const r = spawnSync(AGY, ['models'], { encoding: 'utf8', timeout: 60000, env: ENV() });
  return (r.stdout || '').split('\n').filter((l) => l.includes('\t')).map((l) => {
    const [id, ...rest] = l.split('\t');
    return { id: id.trim(), name: rest.join(' ').trim() || id.trim() };
  });
}
export function getQuota() {
  const r = spawnSync(AGY, ['-p', '/usage', '--output-format', 'json'], { encoding: 'utf8', timeout: 90000, env: ENV() });
  if (r.status === 0 && r.stdout) {
    try { const g = JSON.parse(r.stdout)?.command?.data?.groups; if (Array.isArray(g)) return g; } catch {}
  }
  return null;
}

// ---------- login state machine (persis /login bot.js) ----------
let loginState = null; // { proc, poll, timeout, url, status, email, hadOld }
export const getLoginState = () => loginState && { status: loginState.status, url: loginState.url, email: loginState.email };
let lastLoginResult = null;
export const getLastLoginResult = () => lastLoginResult;

function loginCleanup(restoreOld) {
  if (!loginState) return;
  try { clearInterval(loginState.poll); } catch {}
  try { clearTimeout(loginState.timeout); } catch {}
  try { loginState.proc.kill('SIGKILL'); } catch {}
  if (restoreOld && loginState.hadOld && fs.existsSync(TOKEN_BAK)) fs.copyFileSync(TOKEN_BAK, TOKEN_FILE);
  loginState = null;
}

export function startLogin() {
  if (loginState) return { ok: false, error: 'Masih ada proses login berjalan.', ...getLoginState() };
  const hadOld = fs.existsSync(TOKEN_FILE);
  try { fs.mkdirSync(path.dirname(TOKEN_BAK), { recursive: true }); } catch {}
  if (hadOld) {
    try { fs.copyFileSync(TOKEN_FILE, TOKEN_BAK); fs.unlinkSync(TOKEN_FILE); } catch {}
  }
  const proc = spawn('script', ['-qfc', `stty cols 2000 rows 50 2>/dev/null; ${AGY}`, '/dev/null'], { env: ENV() });
  loginState = { proc, poll: null, timeout: null, url: null, status: 'preparing', email: null, hadOld };
  lastLoginResult = null;
  const st = loginState;
  let out = '';
  proc.stdout.on('data', (d) => {
    out += d;
    if (!st.url) { const u = extractLoginUrl(out); if (u) { st.url = u; st.status = 'waiting'; } }
  });
  proc.stderr.on('data', (d) => { out += d; });
  // Enter untuk pilih opsi pertama di welcome screen (sama dgn bot.js)
  setTimeout(() => { try { proc.stdin.write('\r'); } catch {} }, 2500);
  setTimeout(() => { try { if (!st.url) proc.stdin.write('\r'); } catch {} }, 6000);

  st.poll = setInterval(() => {
    if (loginState !== st) return;
    if (fs.existsSync(TOKEN_FILE)) {
      const email = whoamiEmail() || 'akun baru';
      loginCleanup(false);
      try { fs.unlinkSync(TOKEN_BAK); } catch {}
      lastLoginResult = { status: 'success', email };
    } else if (!st.url && Date.now() - st.started > 30000) {
      loginCleanup(true);
      lastLoginResult = { status: 'failed', error: 'Gagal mengambil link login. Coba lagi.', raw: stripAnsi(out).slice(-800) };
    }
  }, 1500);
  st.started = Date.now();
  st.timeout = setTimeout(() => {
    if (loginState !== st) return;
    loginCleanup(true);
    lastLoginResult = { status: 'timeout', error: 'Waktu login habis (5 menit). Akun lama tetap dipakai.' };
  }, 5 * 60 * 1000);
  return { ok: true, status: 'preparing' };
}

// Beberapa versi CLI minta user paste kode otorisasi setelah login
export function submitLoginCode(code) {
  if (!loginState) return { ok: false, error: 'Tidak ada proses login.' };
  try { loginState.proc.stdin.write(String(code).trim() + '\r'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
export function cancelLogin() {
  if (!loginState) return { ok: false, error: 'Tidak ada proses login.' };
  loginCleanup(true);
  lastLoginResult = { status: 'cancelled' };
  return { ok: true };
}
export function logout() {
  if (loginState) return { ok: false, error: 'Selesaikan/batalkan proses login dulu.' };
  const email = whoamiEmail();
  if (!email) return { ok: false, error: 'Memang belum login.' };
  try { fs.mkdirSync(path.dirname(TOKEN_BAK), { recursive: true }); fs.copyFileSync(TOKEN_FILE, TOKEN_BAK); } catch {}
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  return { ok: true, email };
}
