// frontend/auth.js
// Replace these with your Supabase project values

// NOTE: This should be your project API URL (example: https://<project-ref>.supabase.co)
const SUPABASE_URL = 'https://qgzjxgrvelfktxgvlbnk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnemp4Z3J2ZWxma3R4Z3ZsYm5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NDI5NjcsImV4cCI6MjA4MjIxODk2N30.oFHnuIqfESkuyJwRR13pEP4pUlQUEQvoNHseCOmd_N0';

let _supabaseClient = null;

function supabaseCreateClient(url, key) {
  return window.supabase.createClient(url, key);
}

async function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;

  // If the SDK is already present, create client immediately
  if (typeof window !== 'undefined' && window.supabase) {
    console.debug('Supabase SDK detected on window — creating client');
    _supabaseClient = supabaseCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  }

  // Otherwise wait for DOMContentLoaded (non-blocking). Do not poll.
  await new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    } else {
      resolve();
    }
  });
  // If SDK loaded by then, create client
  if (typeof window !== 'undefined' && window.supabase) {
    console.debug('Supabase SDK loaded after DOMContentLoaded — creating client');
    _supabaseClient = supabaseCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  }

  // Try to load a versioned CDN non-blocking with fallback to unpkg
  if (typeof document !== 'undefined') {
    const loadScript = (src, timeout = 7000) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let done = false;
      s.src = src;
      s.async = true;
      const t = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error('timeout')); } }, timeout);
      s.onload = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      s.onerror = () => { if (!done) { done = true; clearTimeout(t); s.remove(); reject(new Error('load error')); } };
      document.head.appendChild(s);
    });

    try {
      // first try jsDelivr (pinned major v2)
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/dist/umd/supabase.min.js');
    } catch (e1) {
      console.warn('jsDelivr CDN failed, trying unpkg fallback', e1);
      try {
        await loadScript('https://unpkg.com/@supabase/supabase-js@2/dist/supabase.min.js');
      } catch (e2) {
        console.error('Both CDN attempts failed:', e2);
      }
    }
  }

  if (typeof window !== 'undefined' && window.supabase) {
    console.debug('Supabase SDK loaded after dynamic injection — creating client');
    _supabaseClient = supabaseCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  }

  const err = new Error('Supabase SDK not found after attempting CDN injection. Check network/CSP or host the SDK locally.');
  console.error(err.message);
  throw err;
}

// signUp: name, email, phone, password
async function signUp(name, email, phone, password) {
  let client;
  try { client = await getSupabaseClient(); } catch (e) { return { error: e }; }
  console.debug('signUp called', { name, email, phone });

  // check existing in profiles
  const { data: existing, error: checkErr } = await client.from('profiles').select('id').or(`email.eq.${email},phone.eq.${phone}`).limit(1).maybeSingle();
  if (checkErr) return { error: checkErr };
  if (existing) return { error: { message: 'An account with that email or phone already exists' } };

    // compute password hash (SHA-256) client-side so the DB does not store plaintext
    async function sha256Hex(str) {
      if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
        const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        return hex;
      }
      // fallback: simple (not cryptographically secure) shim using Math.random (not recommended)
      return 'fallback-' + Math.random().toString(36).slice(2, 12);
    }

    const pwHash = await sha256Hex(password || '');

    // create the auth user as before (optional). We'll still create the Supabase auth account
    // so that Supabase features can be used later; but sign-in will validate against `profiles` table as requested.
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { error };

    const userId = data.user?.id || data?.user?.id || data?.id;

    // Insert profile without specifying `id` so the database can use its
    // auto-increment integer primary key. Store the password hash in `password`.
    const { error: insertErr } = await client.from('profiles').insert([{ name, email, phone, auth_user_id: userId, password: pwHash }]);
    if (insertErr) return { error: insertErr };

    return { data };
}

// signIn: username, email, password
// Make sure 'supabase' is initialized globally before this runs
// const supabase = window.supabase.createClient(...)
async function signIn(username, email, password) {

  let client;

  try { client = await getSupabaseClient(); } catch (e) { return { error: e }; }

  console.debug('signIn called', { username, email });



  const normalizedEmail = email ? email.trim() : email;

  console.debug('Attempting profile lookup for email:', normalizedEmail);



  // 1) exact match

  let { data: profile, error: profileErr } = await client.from('profiles').select('id,name,email,phone').eq('email', normalizedEmail).limit(1).maybeSingle();

  if (profileErr) {

    console.error('profiles lookup (eq) error', profileErr);

    return { error: profileErr };

  }



  // 2) case-insensitive match (ilike) if not found

  if (!profile && normalizedEmail) {

    try {

      const resp = await client.from('profiles').select('id,name,email,phone').ilike('email', normalizedEmail).limit(1).maybeSingle();

      profile = resp.data || null;

      if (resp.error) console.warn('profiles lookup (ilike) produced error', resp.error);

    } catch (ie) {

      console.warn('profiles ilike lookup failed', ie);

    }

  }



  // 3) try trailing/leading whitespace tolerant search

  if (!profile && normalizedEmail) {

    try {

      const resp2 = await client.from('profiles').select('id,name,email,phone').ilike('email', `%${normalizedEmail}%`).limit(1).maybeSingle();

      profile = resp2.data || null;

      if (resp2.error) console.warn('profiles lookup (contains) produced error', resp2.error);

    } catch (ie2) {

      console.warn('profiles contains lookup failed', ie2);

    }

  }



  // 4) if still not found and input looks like a phone, try phone lookup

  const phoneLike = /^\+?[0-9]{6,}$/;

  if (!profile && normalizedEmail && phoneLike.test(normalizedEmail)) {

    const respPhone = await client.from('profiles').select('id,name,email,phone').eq('phone', normalizedEmail).limit(1).maybeSingle();

    if (respPhone.error) return { error: respPhone.error };

    profile = respPhone.data || null;

  }



  if (!profile) {

    console.debug('Profile not found after all fallbacks for:', normalizedEmail);

    return { error: { message: 'No account found for that email' } };

  }



  // check username matches stored name (optional strict check)

  if (username && profile.name && username.trim() !== profile.name.trim()) {

    return { error: { message: 'Username does not match account name' } };

  }



  const { data, error } = await client.auth.signInWithPassword({ email, password });

  return { data, error };

}

// Export for pages
window.auth = {
  getSupabaseClient,
  signUp,
  signIn,
};
