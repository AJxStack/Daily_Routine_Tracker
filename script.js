// ── THEME (synced with dashboard localStorage key) ──
(function() {
    var saved = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (saved === null && prefersDark)) {
        document.body.setAttribute('data-theme', 'dark');
    }
    syncIcon();
})();

function syncIcon() {
    var dark = document.body.hasAttribute('data-theme');
    document.getElementById('themeBtn').innerHTML = dark
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

document.getElementById('themeBtn').addEventListener('click', function() {
    var dark = document.body.hasAttribute('data-theme');
    dark ? document.body.removeAttribute('data-theme') : document.body.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', dark ? 'light' : 'dark');
    syncIcon();
});

function showView(viewId) {
    document.querySelectorAll('.auth-view').forEach(function(view) {
        view.classList.remove('active');
    });
    document.getElementById('view-' + viewId).classList.add('active');
}

// ── SIGNUP ──
document.getElementById('form-signup').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-pass').value;

    const res = await fetch('http://127.0.0.1:5000/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
        alert(data.message);
        showView('login');
    } else {
        alert(data.error);
    }
});

// ── LOGIN ──
document.getElementById('form-login').addEventListener('submit', async function(e) {
    e.preventDefault();
    const email = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    const res = await fetch('http://127.0.0.1:5000/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
        // Save token and user info separately — never clear these on logout
        localStorage.setItem('drt_token', data.token);
        localStorage.setItem('drt_user_name', data.name);
        localStorage.setItem('drt_user_email', data.email);
        window.location.href = 'dashboard.html';
    } else {
        alert(data.error);
    }
});

// ── FORGOT ──
document.getElementById('form-forgot').addEventListener('submit', function(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    alert("Reset link sent to " + email);
    showView('login');
});