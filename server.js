/**
 * RouteIQ — Backend API
 * Node.js + Express
 *
 * Routes:
 *   POST /api/accounts/import  — CSV import + geocode
 *   POST /api/route/optimize   — TSP route optimization
 *   POST /api/brief/generate   — AI walk-in brief per account
 *   POST /api/log/voice        — Voice note transcription + storage
 *   POST /api/recap/send       — Evening recap email
 *   POST /api/stripe/checkout  — Create Stripe checkout session
 *   POST /api/stripe/webhook   — Stripe webhook handler
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

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(__dirname));

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── ACCOUNT IMPORT ──────────────────────────────────────────────────────────
/**
 * POST /api/accounts/import
 * Body: multipart/form-data — file (CSV), userId (string)
 * Expected CSV columns: name, address, contact_name, contact_email, notes
 */
app.post('/api/accounts/import', upload.single('file'), async (req, res) => {
  const { userId } = req.body;
  if (!userId || !req.file) return res.status(400).json({ error: 'userId and file required' });

  const accounts = [];

  const stream = Readable.from(req.file.buffer.toString('utf-8'));
  stream.pipe(csvParser())
    .on('data', row => accounts.push(row))
    .on('end', async () => {
      // Geocode each address using Google Maps Geocoding API
      const geocoded = await Promise.all(
        accounts.map(async acct => {
          try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(acct.address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
            const { data } = await axios.get(url);
            const loc = data.results?.[0]?.geometry?.location;
            return { ...acct, lat: loc?.lat || null, lng: loc?.lng || null, user_id: userId };
          } catch { return { ...acct, lat: null, lng: null, user_id: userId }; }
        })
      );

      // Upsert to Supabase
      const { error } = await supabase.from('accounts').upsert(geocoded, { onConflict: 'user_id,name' });
      if (error) return res.status(500).json({ error: error.message });

      res.json({ imported: geocoded.length, accounts: geocoded });
    });
});

// ─── ROUTE OPTIMIZATION ──────────────────────────────────────────────────────
/**
 * POST /api/route/optimize
 * Body: { userId, accountIds: string[], startLat, startLng }
 * Returns: ordered list of accounts (nearest-neighbor TSP)
 */
app.post('/api/route/optimize', async (req, res) => {
  const { userId, accountIds, startLat = 0, startLng = 0 } = req.body;

  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
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
  res.json({ route, totalMiles: totalMiles.toFixed(1), stops: route.length });
});

// ─── AI WALK-IN BRIEF ────────────────────────────────────────────────────────
/**
 * POST /api/brief/generate
 * Body: { accountId, userId }
 * Returns: AI-generated 3-sentence walk-in brief
 */
app.post('/api/brief/generate', async (req, res) => {
  const { accountId, userId } = req.body;

  const { data: account } = await supabase
    .from('accounts').select('*').eq('id', accountId).single();

  const { data: logs } = await supabase
    .from('call_logs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(5);

  const logsContext = logs?.length
    ? logs.map(l => `[${new Date(l.created_at).toLocaleDateString()}] ${l.summary}`).join('\n')
    : 'No previous call logs.';

  const prompt = `You are a sales coaching AI helping a field sales rep prepare for a customer visit.

Account: ${account.name}
Primary Contact: ${account.contact_name || 'Unknown'}
Account Notes: ${account.notes || 'None'}
Recent Call History:
${logsContext}

Write a 3-sentence walk-in brief for this rep. Include:
1. The most important thing to know about this account right now (timing, pain point, relationship status)
2. A specific reference from the last interaction they can mention to show they remember
3. A concrete action or conversation opener for this visit

Keep it punchy and practical. Write in second person ("You should..."). No fluff.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 180,
    temperature: 0.7,
  });

  const brief = completion.choices[0].message.content.trim();

  // Store the brief
  await supabase.from('briefs').insert({
    account_id: accountId,
    user_id: userId,
    brief,
    created_at: new Date().toISOString(),
  });

  res.json({ brief, account: account.name });
});

// ─── VOICE LOG ───────────────────────────────────────────────────────────────
/**
 * POST /api/log/voice
 * Body: multipart — audio (file), accountId, userId
 * Transcribes via Whisper, summarizes, stores
 */
app.post('/api/log/voice', upload.single('audio'), async (req, res) => {
  const { accountId, userId } = req.body;

  // Transcribe with Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: req.file,
    model: 'whisper-1',
    response_format: 'text',
  });

  // Summarize
  const summary = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Summarize this field sales call note in 1–2 sentences. Extract: outcome, next action, any customer sentiment signals.\n\nNote: "${transcription}"`
    }],
    max_tokens: 100,
  });

  const summaryText = summary.choices[0].message.content.trim();

  await supabase.from('call_logs').insert({
    account_id: accountId,
    user_id: userId,
    transcript: transcription,
    summary: summaryText,
    created_at: new Date().toISOString(),
  });

  res.json({ transcript: transcription, summary: summaryText });
});

// ─── EVENING RECAP ───────────────────────────────────────────────────────────
/**
 * POST /api/recap/send
 * Body: { userId }
 * Aggregates today's logs, generates recap, sends email
 */
app.post('/api/recap/send', async (req, res) => {
  const { userId } = req.body;

  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();

  const today = new Date().toISOString().split('T')[0];
  const { data: todayLogs } = await supabase
    .from('call_logs')
    .select('*, accounts(name)')
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00Z`)
    .order('created_at');

  const { data: upcomingAccounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('last_visited', { ascending: true })
    .limit(3);

  const logsText = todayLogs?.map(l => `- ${l.accounts?.name}: ${l.summary}`).join('\n') || 'No calls logged today.';
  const prioritiesText = upcomingAccounts?.map(a => `- ${a.name} (last visited: ${a.last_visited || 'never'})`).join('\n');

  const emailHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0f; color: #e8e8f0; padding: 2rem; border-radius: 12px;">
  <h2 style="color: #a78bfa; margin-bottom: 0.5rem;">📊 RouteIQ Evening Recap</h2>
  <p style="color: #7a7a9a; font-size: 0.9rem;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

  <h3 style="margin-top: 2rem; color: #e8e8f0;">Today's Calls (${todayLogs?.length || 0})</h3>
  <div style="background: #12121a; border: 1px solid #2a2a3f; border-radius: 8px; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${logsText.replace(/\n/g, '<br/>')}
  </div>

  <h3 style="margin-top: 1.5rem; color: #e8e8f0;">🎯 Top Priorities for Tomorrow</h3>
  <div style="background: rgba(108,99,255,0.1); border-left: 3px solid #6c63ff; border-radius: 0 8px 8px 0; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${prioritiesText?.replace(/\n/g, '<br/>') || 'No upcoming priorities found.'}
  </div>

  <div style="margin-top: 2rem; text-align: center;">
    <a href="https://routeiq.app/plan" style="background: #6c63ff; color: white; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 700;">Plan Tomorrow's Route →</a>
  </div>

  <p style="margin-top: 2rem; color: #7a7a9a; font-size: 0.78rem; text-align: center;">RouteIQ · <a href="https://routeiq.app/unsubscribe" style="color: #7a7a9a;">Unsubscribe</a></p>
</div>`;

  await resend.emails.send({
    from: 'RouteIQ <recap@routeiq.app>',
    to: user.email,
    subject: `📊 RouteIQ Recap — ${todayLogs?.length || 0} calls, ${upcomingAccounts?.length || 0} priorities for tomorrow`,
    html: emailHtml,
  });

  res.json({ sent: true, callsToday: todayLogs?.length, prioritiesQueued: upcomingAccounts?.length });
});

// ─── STRIPE CHECKOUT ─────────────────────────────────────────────────────────
const PRICE_IDS = {
  solo: process.env.STRIPE_PRICE_SOLO,    // $29/mo
  team: process.env.STRIPE_PRICE_TEAM,    // $79/mo
  agency: process.env.STRIPE_PRICE_AGENCY // $199/mo
};

app.post('/api/stripe/checkout', async (req, res) => {
  const { plan, userId, email } = req.body;
  if (!PRICE_IDS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    metadata: { userId, plan },
    success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/pricing`,
    trial_period_days: 14,
  });

  res.json({ url: session.url });
});

// ─── STRIPE WEBHOOK ──────────────────────────────────────────────────────────
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
