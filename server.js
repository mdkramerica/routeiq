/**
 * RouteIQ — Backend API
 * Node.js + Express
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const OpenAI = require('openai');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const axios = require('axios');
const auth = require('./middleware/auth');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Clients (lazy init so server boots even with placeholder env vars)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'placeholder' });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'placeholder');
const supabase = (process.env.SUPABASE_URL || '').startsWith('http')
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;
const resend = new Resend(process.env.RESEND_API_KEY || 'placeholder');

app.use(cors());
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(__dirname));

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES (public)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    // Insert into users table
    if (data.user) {
      await supabase.from('users').upsert({
        id: data.user.id,
        email: data.user.email,
        plan: 'free',
        plan_active: false,
        created_at: new Date().toISOString()
      }, { onConflict: 'id' });
    }

    res.json({
      user: { id: data.user.id, email: data.user.email, plan: 'free' },
      session: data.session
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    // Fetch user profile
    const { data: profile } = await supabase.from('users').select('*').eq('id', data.user.id).single();

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        plan: profile?.plan || 'free',
        plan_active: profile?.plan_active || false
      },
      session: data.session
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  if (!supabase) return res.json({ ok: true });
  try {
    await supabase.auth.signOut();
  } catch {}
  res.json({ ok: true });
});

// POST /api/auth/magic-link
app.post('/api/auth/magic-link', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

  try {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES (require auth middleware)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── ACCOUNTS CRUD ───────────────────────────────────────────────────────────

// GET /api/accounts
app.get('/api/accounts', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', req.user.id)
    .order('priority', { ascending: true })
    .order('last_visited', { ascending: true, nullsFirst: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/accounts
app.post('/api/accounts', auth, async (req, res) => {
  const { name, address, contact_name, contact_email, contact_phone, notes, priority, visit_frequency_days } = req.body;
  if (!name) return res.status(400).json({ error: 'Account name required' });

  const account = {
    user_id: req.user.id,
    name,
    address: address || null,
    contact_name: contact_name || null,
    contact_email: contact_email || null,
    contact_phone: contact_phone || null,
    notes: notes || null,
    priority: priority || 2,
    visit_frequency_days: visit_frequency_days || 30,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Geocode if address provided
  if (address && process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const { data } = await axios.get(url);
      const loc = data.results?.[0]?.geometry?.location;
      if (loc) {
        account.lat = loc.lat;
        account.lng = loc.lng;
      }
    } catch {}
  }

  const { data, error } = await supabase.from('accounts').insert(account).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/accounts/:id
app.put('/api/accounts/:id', auth, async (req, res) => {
  const { name, address, contact_name, contact_email, contact_phone, notes, priority, visit_frequency_days } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (contact_name !== undefined) updates.contact_name = contact_name;
  if (contact_email !== undefined) updates.contact_email = contact_email;
  if (contact_phone !== undefined) updates.contact_phone = contact_phone;
  if (notes !== undefined) updates.notes = notes;
  if (priority !== undefined) updates.priority = priority;
  if (visit_frequency_days !== undefined) updates.visit_frequency_days = visit_frequency_days;

  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/accounts/:id
app.delete('/api/accounts/:id', auth, async (req, res) => {
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

// POST /api/accounts/:id/visit
app.post('/api/accounts/:id/visit', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('accounts')
    .update({ last_visited: today, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/accounts/:id/logs
app.get('/api/accounts/:id/logs', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('call_logs')
    .select('*')
    .eq('account_id', req.params.id)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── ACCOUNT IMPORT ──────────────────────────────────────────────────────────
app.post('/api/accounts/import', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });

  const accounts = [];
  const stream = Readable.from(req.file.buffer.toString('utf-8'));
  stream.pipe(csvParser())
    .on('data', row => accounts.push(row))
    .on('end', async () => {
      const geocoded = await Promise.all(
        accounts.map(async acct => {
          try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(acct.address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
            const { data } = await axios.get(url);
            const loc = data.results?.[0]?.geometry?.location;
            return { ...acct, lat: loc?.lat || null, lng: loc?.lng || null, user_id: req.user.id };
          } catch { return { ...acct, lat: null, lng: null, user_id: req.user.id }; }
        })
      );

      const { error } = await supabase.from('accounts').upsert(geocoded, { onConflict: 'user_id,name' });
      if (error) return res.status(500).json({ error: error.message });

      res.json({ imported: geocoded.length, accounts: geocoded });
    });
});

// ─── ROUTE: TODAY ────────────────────────────────────────────────────────────
app.get('/api/route/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const { data: plan } = await supabase
    .from('route_plans')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('plan_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!plan || !plan.account_order || !plan.account_order.length) {
    return res.json({ stops: [], totalMiles: 0 });
  }

  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .in('id', plan.account_order);

  // Preserve the planned order
  const orderMap = {};
  plan.account_order.forEach((id, i) => { orderMap[id] = i; });
  const ordered = (accounts || []).sort((a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99));

  res.json({ stops: ordered, totalMiles: plan.total_miles || 0 });
});

// ─── ROUTE OPTIMIZATION ──────────────────────────────────────────────────────
app.post('/api/route/optimize', auth, async (req, res) => {
  const { accountIds, startLat = 0, startLng = 0 } = req.body;

  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', req.user.id)
    .in('id', accountIds);

  if (error) return res.status(500).json({ error: error.message });

  // Nearest-neighbor TSP heuristic
  const toRad = d => d * Math.PI / 180;
  const haversine = (lat1, lng1, lat2, lng2) => {
    const R = 3958.8; // miles
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  let unvisited = accounts.filter(a => a.lat && a.lng);
  const route = [];
  let curLat = startLat, curLng = startLng;

  while (unvisited.length > 0) {
    let nearest = unvisited.reduce((best, acct) => {
      const d = haversine(curLat, curLng, acct.lat, acct.lng);
      return !best || d < best.dist ? { acct, dist: d } : best;
    }, null);
    route.push({ ...nearest.acct, distFromPrev: nearest.dist.toFixed(1) });
    curLat = nearest.acct.lat;
    curLng = nearest.acct.lng;
    unvisited = unvisited.filter(a => a.id !== nearest.acct.id);
  }

  const totalMiles = route.reduce((sum, a) => sum + parseFloat(a.distFromPrev || 0), 0);

  // Save to route_plans
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('route_plans').upsert({
    user_id: req.user.id,
    plan_date: today,
    account_order: route.map(a => a.id),
    total_miles: parseFloat(totalMiles.toFixed(1)),
    created_at: new Date().toISOString()
  }, { onConflict: 'user_id,plan_date' }).select();

  res.json({ route, totalMiles: totalMiles.toFixed(1), stops: route.length });
});

// ─── ROUTE PLAN (save/upsert) ────────────────────────────────────────────────
app.post('/api/route/plan', auth, async (req, res) => {
  const { plan_date, account_ids } = req.body;
  if (!plan_date || !account_ids) return res.status(400).json({ error: 'plan_date and account_ids required' });

  const { data, error } = await supabase.from('route_plans').upsert({
    user_id: req.user.id,
    plan_date,
    account_order: account_ids,
    created_at: new Date().toISOString()
  }, { onConflict: 'user_id,plan_date' }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── AI WALK-IN BRIEF ────────────────────────────────────────────────────────
app.post('/api/brief/generate', auth, async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });

  // Check for cached brief (<24hrs)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await supabase
    .from('briefs')
    .select('*')
    .eq('account_id', accountId)
    .eq('user_id', req.user.id)
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (cached) {
    return res.json({ brief: cached.brief, account: cached.account_id, cached: true });
  }

  const { data: account } = await supabase
    .from('accounts').select('*').eq('id', accountId).single();

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { data: logs } = await supabase
    .from('call_logs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(3);

  const logsContext = logs?.length
    ? logs.map(l => `[${new Date(l.created_at).toLocaleDateString()}] ${l.summary}`).join('\n')
    : 'No previous call logs.';

  const prompt = `You are a sales coach. Given this account and call history, write a 2-3 sentence walk-in brief for a field sales rep. Be specific: what to lead with, what the contact cares about, any urgency.

Account: ${account.name}
Primary Contact: ${account.contact_name || 'Unknown'}
Account Notes: ${account.notes || 'None'}
Last Visited: ${account.last_visited || 'Never'}
Recent Call History:
${logsContext}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 180,
    temperature: 0.7,
  });

  const brief = completion.choices[0].message.content.trim();

  await supabase.from('briefs').insert({
    account_id: accountId,
    user_id: req.user.id,
    brief,
    created_at: new Date().toISOString(),
  });

  res.json({ brief, account: account.name });
});

// ─── VOICE LOG ───────────────────────────────────────────────────────────────
app.post('/api/log/voice', auth, upload.single('audio'), async (req, res) => {
  const { accountId } = req.body;
  if (!accountId || !req.file) return res.status(400).json({ error: 'accountId and audio file required' });

  // Transcribe with Whisper
  const file = new File([req.file.buffer], req.file.originalname || 'audio.webm', {
    type: req.file.mimetype || 'audio/webm'
  });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'text',
  });

  // Summarize + extract outcome
  const summaryCompletion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Summarize this field sales call note in 1-2 sentences. Also extract the outcome as one of: positive, neutral, needs_followup, closed.

Return as JSON: {"summary": "...", "outcome": "..."}

Note: "${transcription}"`
    }],
    max_tokens: 150,
    response_format: { type: 'json_object' },
  });

  let summary = '', outcome = '';
  try {
    const parsed = JSON.parse(summaryCompletion.choices[0].message.content);
    summary = parsed.summary || '';
    outcome = parsed.outcome || '';
  } catch {
    summary = summaryCompletion.choices[0].message.content.trim();
  }

  // Insert call log
  await supabase.from('call_logs').insert({
    account_id: accountId,
    user_id: req.user.id,
    transcript: transcription,
    summary,
    outcome,
    created_at: new Date().toISOString(),
  });

  // Update last_visited
  const today = new Date().toISOString().split('T')[0];
  await supabase
    .from('accounts')
    .update({ last_visited: today, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('user_id', req.user.id);

  res.json({ transcript: transcription, summary, outcome });
});

// ─── EVENING RECAP ───────────────────────────────────────────────────────────
app.post('/api/recap/send', auth, async (req, res) => {
  const userId = req.user.id;

  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = new Date().toISOString().split('T')[0];
  const { data: todayLogs } = await supabase
    .from('call_logs')
    .select('*, accounts(name)')
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00Z`)
    .order('created_at');

  // Find overdue accounts for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { data: allAccounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('last_visited', { ascending: true });

  const overdueAccounts = (allAccounts || []).filter(a => {
    if (!a.last_visited) return true;
    const lastVisit = new Date(a.last_visited);
    const dueDate = new Date(lastVisit);
    dueDate.setDate(dueDate.getDate() + (a.visit_frequency_days || 30));
    return dueDate <= tomorrow;
  }).slice(0, 5);

  const logsText = todayLogs?.map(l => `- ${l.accounts?.name}: ${l.summary}`).join('\n') || 'No calls logged today.';
  const prioritiesText = overdueAccounts.map(a => `- ${a.name} (last visited: ${a.last_visited || 'never'})`).join('\n');

  const emailHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0f; color: #e8e8f0; padding: 2rem; border-radius: 12px;">
  <h2 style="color: #a78bfa; margin-bottom: 0.5rem;">RouteIQ Evening Recap</h2>
  <p style="color: #7a7a9a; font-size: 0.9rem;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

  <h3 style="margin-top: 2rem; color: #e8e8f0;">Today's Calls (${todayLogs?.length || 0})</h3>
  <div style="background: #12121a; border: 1px solid #2a2a3f; border-radius: 8px; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${logsText.replace(/\n/g, '<br/>')}
  </div>

  <h3 style="margin-top: 1.5rem; color: #e8e8f0;">Top Priorities for Tomorrow</h3>
  <div style="background: rgba(108,99,255,0.1); border-left: 3px solid #6c63ff; border-radius: 0 8px 8px 0; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${prioritiesText.replace(/\n/g, '<br/>') || 'No upcoming priorities found.'}
  </div>

  <div style="margin-top: 2rem; text-align: center;">
    <a href="${process.env.APP_URL || 'https://routeiq.app'}/dashboard.html" style="background: #6c63ff; color: white; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 700;">Plan Tomorrow's Route</a>
  </div>

  <p style="margin-top: 2rem; color: #7a7a9a; font-size: 0.78rem; text-align: center;">RouteIQ</p>
</div>`;

  await resend.emails.send({
    from: 'RouteIQ <recap@routeiq.app>',
    to: user.email,
    subject: `RouteIQ Recap — ${todayLogs?.length || 0} calls, ${overdueAccounts.length} priorities for tomorrow`,
    html: emailHtml,
  });

  res.json({ sent: true, callsToday: todayLogs?.length || 0, prioritiesQueued: overdueAccounts.length });
});

// ─── STRIPE CHECKOUT ─────────────────────────────────────────────────────────
const PRICE_IDS = {
  solo: process.env.STRIPE_PRICE_SOLO,
  team: process.env.STRIPE_PRICE_TEAM,
  agency: process.env.STRIPE_PRICE_AGENCY
};

app.post('/api/stripe/checkout', auth, async (req, res) => {
  const { plan } = req.body;
  if (!PRICE_IDS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: req.user.email,
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    metadata: { userId: req.user.id, plan },
    success_url: `${process.env.APP_URL || 'https://routeiq.app'}/dashboard.html?upgraded=true`,
    cancel_url: `${process.env.APP_URL || 'https://routeiq.app'}/dashboard.html`,
    trial_period_days: 14,
  });

  res.json({ url: session.url });
});

// ─── STRIPE WEBHOOK (public, verified by signature) ─────────────────────────
app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await supabase.from('users').update({
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        plan: session.metadata.plan,
        plan_active: true,
      }).eq('id', session.metadata.userId);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await supabase.from('users').update({ plan_active: false }).eq('stripe_subscription_id', sub.id);
      break;
    }
  }

  res.json({ received: true });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RouteIQ API running on :${PORT}`));
