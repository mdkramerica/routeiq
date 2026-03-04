/**
 * Evening recap email route
 */
const { Router } = require('express');
const supabase = require('../services/supabase');
const resend = require('../services/email');
const auth = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { config } = require('../config');

const router = Router();

// POST /api/recap/send
router.post(
  '/send',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    if (!resend) return res.status(500).json({ error: 'Email service unavailable' });

    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = new Date().toISOString().split('T')[0];
    const { data: todayLogs } = await supabase
      .from('call_logs')
      .select('summary, outcome, created_at, accounts(name)')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00Z`)
      .order('created_at');

    // Find overdue accounts for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { data: allAccounts } = await supabase
      .from('accounts')
      .select('name, last_visited, visit_frequency_days')
      .eq('user_id', userId)
      .order('last_visited', { ascending: true });

    const overdueAccounts = (allAccounts || [])
      .filter((a) => {
        if (!a.last_visited) return true;
        const dueDate = new Date(a.last_visited);
        dueDate.setDate(dueDate.getDate() + (a.visit_frequency_days || 30));
        return dueDate <= tomorrow;
      })
      .slice(0, 5);

    const logsText =
      todayLogs?.map((l) => `- ${l.accounts?.name}: ${l.summary}`).join('\n') ||
      'No calls logged today.';
    const prioritiesText = overdueAccounts
      .map((a) => `- ${a.name} (last visited: ${a.last_visited || 'never'})`)
      .join('\n');

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const emailHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0f; color: #e8e8f0; padding: 2rem; border-radius: 12px;">
  <h2 style="color: #a78bfa; margin-bottom: 0.5rem;">TerritoryPilot Evening Recap</h2>
  <p style="color: #7a7a9a; font-size: 0.9rem;">${dateStr}</p>

  <h3 style="margin-top: 2rem; color: #e8e8f0;">Today's Calls (${todayLogs?.length || 0})</h3>
  <div style="background: #12121a; border: 1px solid #2a2a3f; border-radius: 8px; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${logsText.replace(/\n/g, '<br/>')}
  </div>

  <h3 style="margin-top: 1.5rem; color: #e8e8f0;">Top Priorities for Tomorrow</h3>
  <div style="background: rgba(108,99,255,0.1); border-left: 3px solid #6c63ff; border-radius: 0 8px 8px 0; padding: 1rem; font-size: 0.9rem; line-height: 1.7;">
    ${prioritiesText.replace(/\n/g, '<br/>') || 'No upcoming priorities found.'}
  </div>

  <div style="margin-top: 2rem; text-align: center;">
    <a href="${config.appUrl}/dashboard.html" style="background: #6c63ff; color: white; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 700;">Plan Tomorrow's Route</a>
  </div>

  <p style="margin-top: 2rem; color: #7a7a9a; font-size: 0.78rem; text-align: center;">TerritoryPilot</p>
</div>`;

    await resend.emails.send({
      from: 'TerritoryPilot <recap@territorypilot.app>',
      to: user.email,
      subject: `TerritoryPilot Recap — ${todayLogs?.length || 0} calls, ${overdueAccounts.length} priorities for tomorrow`,
      html: emailHtml,
    });

    res.json({
      sent: true,
      callsToday: todayLogs?.length || 0,
      prioritiesQueued: overdueAccounts.length,
    });
  })
);

module.exports = router;
