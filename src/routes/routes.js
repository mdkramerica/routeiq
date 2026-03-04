/**
 * Route optimization and planning routes
 */
const { Router } = require('express');
const supabase = require('../services/supabase');
const auth = require('../middleware/auth');
const { validate, optimizeRouteSchema, savePlanSchema } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');
const { nearestNeighborTSP } = require('../utils/haversine');

const router = Router();

// GET /api/route/today
router.get(
  '/today',
  auth,
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const { data: plan } = await supabase
      .from('route_plans')
      .select('account_order, total_miles')
      .eq('user_id', req.user.id)
      .eq('plan_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!plan || !plan.account_order?.length) {
      return res.json({ stops: [], totalMiles: 0 });
    }

    const { data: accounts } = await supabase
      .from('accounts')
      .select('*')
      .in('id', plan.account_order)
      .eq('user_id', req.user.id);

    // Preserve planned order
    const orderMap = {};
    plan.account_order.forEach((id, i) => {
      orderMap[id] = i;
    });
    const ordered = (accounts || []).sort(
      (a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99)
    );

    res.json({ stops: ordered, totalMiles: plan.total_miles || 0 });
  })
);

// POST /api/route/optimize
router.post(
  '/optimize',
  auth,
  validate(optimizeRouteSchema),
  asyncHandler(async (req, res) => {
    const { accountIds, startLat, startLng, plan_date } = req.body;

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', req.user.id)
      .in('id', accountIds);

    if (error) return res.status(500).json({ error: 'Failed to load accounts' });

    const { route, totalMiles } = nearestNeighborTSP(accounts, startLat, startLng);

    // Save to route_plans — use provided date or default to today
    const targetDate = plan_date || new Date().toISOString().split('T')[0];
    await supabase
      .from('route_plans')
      .upsert(
        {
          user_id: req.user.id,
          plan_date: targetDate,
          account_order: route.map((a) => a.id),
          total_miles: totalMiles,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,plan_date' }
      )
      .select();

    res.json({ route, totalMiles: totalMiles.toFixed(1), stops: route.length });
  })
);

// POST /api/route/plan
router.post(
  '/plan',
  auth,
  validate(savePlanSchema),
  asyncHandler(async (req, res) => {
    const { plan_date, account_ids } = req.body;

    const { data, error } = await supabase
      .from('route_plans')
      .upsert(
        {
          user_id: req.user.id,
          plan_date,
          account_order: account_ids,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,plan_date' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Failed to save plan' });
    res.json(data);
  })
);

// GET /api/route/:date — fetch route plan for a specific date (YYYY-MM-DD)
// Must be registered AFTER /today, /optimize, /plan to avoid param conflicts
router.get(
  '/:date',
  auth,
  asyncHandler(async (req, res) => {
    const dateStr = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const { data: plan } = await supabase
      .from('route_plans')
      .select('account_order, total_miles')
      .eq('user_id', req.user.id)
      .eq('plan_date', dateStr)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!plan || !plan.account_order?.length) {
      return res.json({ stops: [], totalMiles: 0, planDate: dateStr });
    }

    const { data: accounts } = await supabase
      .from('accounts')
      .select('*')
      .in('id', plan.account_order)
      .eq('user_id', req.user.id);

    const orderMap = {};
    plan.account_order.forEach((id, i) => { orderMap[id] = i; });
    const ordered = (accounts || []).sort(
      (a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99)
    );

    res.json({ stops: ordered, totalMiles: plan.total_miles || 0, planDate: dateStr });
  })
);

module.exports = router;
