/**
 * Auth page logic — login, signup, magic link, password reset
 */

(function () {
  // ─── Handle magic link callback (token in URL hash) ────────────────────
  const hashParams = window.location.hash.length > 1
    ? new URLSearchParams(window.location.hash.substring(1))
    : null;

  if (hashParams && hashParams.get('access_token') && hashParams.get('type') === 'magiclink') {
    (async function handleMagicLink() {
      const token = hashParams.get('access_token');
      const session = { access_token: token, refresh_token: hashParams.get('refresh_token') || '' };

      // Fetch user profile so dashboard has email/plan
      try {
        const res = await fetch(`${API}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          setAuth(session, data.user);
        } else {
          setAuth(session, { email: '' });
        }
      } catch {
        setAuth(session, { email: '' });
      }
      window.location.replace('dashboard.html');
    })();
    return;
  }

  // Redirect if already logged in (skip on password reset pages)
  const isResetPage = window.location.pathname.includes('reset-password') || window.location.pathname.includes('forgot-password');
  if (!isResetPage && getToken()) {
    window.location.href = 'dashboard.html';
    return;
  }

  const $error = document.getElementById('error');
  const $success = document.getElementById('success');

  function showError(msg) {
    if ($error) {
      $error.textContent = msg;
      $error.style.display = 'block';
    }
    if ($success) $success.style.display = 'none';
  }

  function showSuccess(msg) {
    if ($success) {
      $success.textContent = msg;
      $success.style.display = 'block';
    }
    if ($error) $error.style.display = 'none';
  }

  // ─── Signup Form ─────────────────────────────────────────────────────────
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('signup-btn');
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      if ($error) $error.style.display = 'none';

      try {
        const res = await fetch(`${API}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        if (data.session) {
          setAuth(data.session, data.user);
          window.location.href = 'dashboard.html';
        } else {
          // Email confirmation required — show success message
          showSuccess('Account created! Check your email to confirm, then log in.');
          btn.disabled = false;
          btn.textContent = 'Create Free Account';
        }
        return;
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Create Free Account';
      }
    });
  }

  // ─── Login Form ──────────────────────────────────────────────────────────
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'Logging in...';
      if ($error) $error.style.display = 'none';

      try {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        setAuth(data.session, data.user);
        window.location.href = 'dashboard.html';
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Log In';
      }
    });
  }

  // ─── Magic Link Toggle ──────────────────────────────────────────────────
  const magicToggle = document.getElementById('magic-toggle');
  if (magicToggle) {
    magicToggle.addEventListener('click', () => {
      const mf = document.getElementById('magic-form');
      const lf = document.getElementById('login-form');
      if (mf.style.display === 'none' || !mf.style.display) {
        mf.style.display = 'block';
        lf.style.display = 'none';
        magicToggle.textContent = 'Use password instead';
      } else {
        mf.style.display = 'none';
        lf.style.display = 'block';
        magicToggle.textContent = 'Send Magic Link instead';
      }
    });
  }

  // ─── Magic Link Form ────────────────────────────────────────────────────
  const magicForm = document.getElementById('magic-form');
  if (magicForm) {
    magicForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`${API}/api/auth/magic-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('magic-email').value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send magic link');
        showSuccess('Magic link sent! Check your email.');
      } catch (err) {
        showError(err.message);
      }
    });
  }
  // ─── Forgot Password Form ──────────────────────────────────────────────
  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('forgot-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      if ($error) $error.style.display = 'none';

      try {
        const res = await fetch(`${API}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send reset link');
        showSuccess('If that email is registered, you\'ll receive a reset link shortly.');
        btn.textContent = 'Link Sent';
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
      }
    });
  }

  // ─── Reset Password Form ─────────────────────────────────────────────
  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    // Extract access_token from URL hash (Supabase format: #access_token=...&type=recovery)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');

    if (!accessToken || type !== 'recovery') {
      showError('Invalid or missing reset link. Please request a new one.');
      resetForm.style.display = 'none';
    }

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;

      if (password !== confirm) {
        showError('Passwords do not match.');
        return;
      }

      const btn = document.getElementById('reset-btn');
      btn.disabled = true;
      btn.textContent = 'Resetting...';
      if ($error) $error.style.display = 'none';

      try {
        const res = await fetch(`${API}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: accessToken,
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset password');
        showSuccess('Password updated! Redirecting to login...');
        resetForm.style.display = 'none';
        setTimeout(() => { window.location.href = 'login.html'; }, 2000);
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Reset Password';
      }
    });
  }
})();
