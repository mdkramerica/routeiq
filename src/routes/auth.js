/**
 * Auth routes — register, login, logout, magic-link
 */
const { Router } = require('express');
const supabase = require('../services/supabase');
const { authLimiter, magicLinkLimiter } = require('../middleware/rateLimit');
const { validate, registerSchema, loginSchema, magicLinkSchema, forgotPasswordSchema, resetPasswordSchema } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');
const { config } = require('../config');

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

    const redirectTo = `${config.appUrl}/login.html`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) return res.status(400).json({ error: 'Could not send magic link' });
    res.json({ sent: true });
  })
);

// GET /api/auth/me — return user profile from a valid token
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const token = header.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

    const { data: profile } = await supabase
      .from('users')
      .select('plan, plan_active')
      .eq('id', user.id)
      .single();

    res.json({
      user: {
        id: user.id,
        email: user.email,
        plan: profile?.plan || 'free',
        plan_active: profile?.plan_active || false,
      },
    });
  })
);

// POST /api/auth/forgot-password
router.post(
  '/forgot-password',
  magicLinkLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const redirectTo = `${config.appUrl}/reset-password.html`;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    // Always return success to avoid leaking whether the email exists
    res.json({ sent: true });
  })
);

// POST /api/auth/reset-password
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { access_token, password } = req.body;
    if (!supabase) return res.status(500).json({ error: 'Auth service unavailable' });

    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    if (userError || !user) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) return res.status(400).json({ error: 'Could not update password. Please try again.' });

    res.json({ ok: true });
  })
);

module.exports = router;
