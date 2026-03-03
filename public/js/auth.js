/**
 * Auth page logic — login, signup, magic link
 */

(function () {
  // Redirect if already logged in
  if (getToken()) {
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
})();
