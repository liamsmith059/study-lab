// Optional Supabase sync. Only loads supabase-js (from a CDN) when config.js has a URL and anon key.
import { mergeStores, normalize } from "./engine.js";

const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function syncConfigured() {
  const c = window.STUDY_LAB_CONFIG || {};
  return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
}

export function createSync({ getStore, setStore, onStatus }) {
  let client = null;
  let user = null;
  let timer = null;
  let busy = Promise.resolve();
  const status = (s) => onStatus({ user, ...s });

  async function init() {
    if (!syncConfigured()) return;
    const c = window.STUDY_LAB_CONFIG;
    try {
      const mod = await import(CDN);
      client = mod.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (err) {
      status({ state: "error", message: "Couldn't load sync library. Progress is still saved on this device." });
      return;
    }
    let heard = false;
    client.auth.onAuthStateChange((_event, session) => {
      const first = !heard;
      heard = true;
      const next = session ? session.user : null;
      const changed = first || (next && next.id) !== (user && user.id);
      user = next;
      if (!changed) return; // token refreshes etc. don't change who is signed in
      if (user) pull();
      else status({ state: "signed-out" });
    });
    const { data } = await client.auth.getSession();
    if (heard) return;
    user = data.session ? data.session.user : null;
    if (user) pull(); else status({ state: "signed-out" });
  }

  async function fetchRemote() {
    const { data, error } = await client.from("progress").select("data, updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }

  // Merge remote into local, save locally, then write the merged result back.
  function pull() {
    return queue(async () => {
      status({ state: "syncing" });
      const remote = await fetchRemote();
      const merged = remote ? mergeStores(getStore(), remote) : normalize(getStore());
      setStore(merged);
      await write(merged);
    });
  }

  // Re-read before writing so another device's newer answers are merged, not overwritten.
  function push() {
    if (!client || !user) return Promise.resolve();
    return queue(async () => {
      status({ state: "syncing" });
      const remote = await fetchRemote();
      const merged = remote ? mergeStores(getStore(), remote) : getStore();
      if (remote) setStore(merged);
      await write(merged);
    });
  }

  async function write(st) {
    const { error } = await client.from("progress").upsert({ user_id: user.id, data: st, updated_at: new Date().toISOString() });
    if (error) throw error;
    status({ state: "synced", at: Date.now() });
  }

  function queue(fn) {
    busy = busy.then(fn).catch((err) => {
      status({ state: "error", message: "Sync failed: " + (err && err.message ? err.message : String(err)) + ". Progress is still saved on this device." });
    });
    return busy;
  }

  // Overwrite the remote copy without merging (used by Reset progress).
  function replaceRemote(st) {
    if (!client || !user) return Promise.resolve();
    clearTimeout(timer); timer = null;
    return queue(async () => { status({ state: "syncing" }); await write(st); });
  }

  function schedulePush() {
    if (!client || !user) return;
    clearTimeout(timer);
    timer = setTimeout(push, 2000);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; push(); }
  }

  async function signIn(email) {
    const redirect = location.origin + location.pathname;
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) throw error;
  }

  async function signOut() {
    flush();
    await busy;
    await client.auth.signOut();
    user = null;
    status({ state: "signed-out" });
  }

  return { init, replaceRemote, schedulePush, flush, signIn, signOut, syncNow: pull, get user() { return user; } };
}
