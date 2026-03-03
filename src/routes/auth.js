/**
 * Auth routes — register, login, logout, magic-link
 */
const { Router } = require('express');
const supabase = require('../services/supabase');
const { authLimiter, magicLinkLimiter } = require('../middleware/rateLimit');
const { validate, registerSchema, loginSchema, magicLinkSchema } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

const router = Router();

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    if (data.user) {
      await supabase.from('users').upsert(
        {
          id: data.user.id,
          email: data.user.email,
          plan: 'free',
          plan_active: false,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }

    // If email confirmation is enabled, session will be null
    if (data.session) {
      res.json({
        user: { id: data.user.id, email: data.user.email, plan: 'free' },
        session: data.session,
      });
    } else {
      res.json({
        user: { id: data.user.id, email: data.user.email, plan: 'free' },
        session: null,
        confirmEmail: true,
      });
    }
  })
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });

    const { data: profile } = await supabase
      .from('users')
      .select('plan, plan_active')
      .eq('id', data.user.id)
      .single();

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        plan: profile?.plan || 'free',
        plan_active: profile?.plan_active || false,
      },
      session: data.session,
    });
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (supabase) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        const token = header.split(' ')[1];
        try {
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user) {
            await supabase.auth.admin.signOut(user.id);
          }
        } catch {
          // Token already invalid — that's fine
        }
      }
    }
    res.json({ ok: true });
  })
);

// POST /api/auth/magic-link
router.post(
  '/magic-link',
  magicLinkLimiter,
  validate(magicLinkSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) return res.status(400).json({ error: 'Could not send magic link' });
    res.json({ sent: true });
  })
);

module.exports = router;
