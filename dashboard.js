// ── CONFIG ──
const API = 'http://127.0.0.1:5000';

function getToken() { return localStorage.getItem('drt_token'); }
function getUserName() { return localStorage.getItem('drt_user_name') || 'User'; }

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
    };
}

// ── AUTH GUARD ──
(function() {
    if (!getToken()) {
        window.location.href = 'index.html';
    }
    // Apply saved theme
    if (localStorage.getItem('theme') === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }
})();

// ── STATE ──
let tasks = [];
let appSettings = { restDaysOfWeek: [], notificationsEnabled: false };
let focusTimeSeconds = 0;
let selectedDate = new Date().toDateString();
let timer = { time: 1500, active: false, interval: null };
let routineChart = null;
let analyticsChart = null;

const dailyQuotes = [
    "Own the day.",
    "Consistency is power.",
    "Focus brings reality.",
    "Keep pushing.",
    "Small steps, big impact."
];

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
    loadLocalSettings();
    initCharts();
    updateHeaderAndQuotes();
    await fetchTasks();
    renderAll();
    setInterval(checkMidnightReset, 60000);
    setInterval(checkNotifications, 30000); // Check every 30s for better accuracy
});

// ── LOAD/SAVE LOCAL SETTINGS (only settings, not tasks) ──
function loadLocalSettings() {
    appSettings = JSON.parse(localStorage.getItem('orbitSettingsPro')) || { restDaysOfWeek: [], notificationsEnabled: false };
    focusTimeSeconds = parseInt(localStorage.getItem('orbitFocus') || '0');
    updateSettingsUI();
}

function saveLocalSettings() {
    localStorage.setItem('orbitSettingsPro', JSON.stringify(appSettings));
    localStorage.setItem('orbitFocus', focusTimeSeconds);
}

// ── FETCH TASKS FROM BACKEND ──
async function fetchTasks() {
    try {
        const res = await fetch(API + '/tasks', {
            headers: authHeaders()
        });
        if (res.status === 401) {
            // Token expired or invalid — send back to login
            logoutApp(true);
            return;
        }
        const data = await res.json();

        // Convert backend format to frontend format
        tasks = data.map(t => ({
            id: t.id,
            title: t.title,
            cat: t.cat || 'General',
            time: t.time,
            history: buildHistory(t.completions)
        }));

        // Sort by time
        tasks.sort((a, b) => parseTimeStr(a.time) - parseTimeStr(b.time));

    } catch (e) {
        console.error('Failed to fetch tasks:', e);
    }
}

// Convert completions array ['2024-01-15', ...] to history object
function buildHistory(completions) {
    const history = {};
    if (!completions) return history;
    completions.forEach(dateStr => {
        // Convert 'YYYY-MM-DD' to toDateString() format e.g. 'Mon Jan 15 2024'
        const d = new Date(dateStr + 'T00:00:00');
        history[d.toDateString()] = { done: true };
    });
    return history;
}

// ── MIDNIGHT RESET ──
function checkMidnightReset() {
    const currentActualDay = new Date().toDateString();
    if (selectedDate !== currentActualDay) {
        selectedDate = currentActualDay;
        updateHeaderAndQuotes();
        fetchTasks().then(() => renderAll());
    }
}

function isRestDay(dateString) {
    return appSettings.restDaysOfWeek.includes(new Date(dateString).getDay());
}

// ── TASK LOGIC ──
function parseTimeStr(timeStr) {
    if (!timeStr) return 0;
    const [time, ampm] = timeStr.split(' ');
    let [h, m] = time.split(':').map(Number);
    if (h === 12) h = 0;
    if (ampm === 'PM') h += 12;
    return (h * 60) + m;
}

// Format date to YYYY-MM-DD for backend
function toBackendDate(dateString) {
    const d = new Date(dateString);
    return d.toISOString().split('T')[0];
}

async function saveItem() {
    const title = document.getElementById('inp-title').value.trim();
    const cat = document.getElementById('inp-cat').value;
    const h = document.getElementById('inp-hr').value;
    const m = document.getElementById('inp-min').value;
    const ap = document.getElementById('inp-ampm').value;

    if (!title) return;

    const timeStr = `${h}:${m} ${ap}`;

    try {
        const res = await fetch(API + '/tasks', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ title, cat, time: timeStr })
        });
        const newTask = await res.json();
        if (res.ok) {
            tasks.push({
                id: newTask.id,
                title: newTask.title,
                cat: newTask.cat,
                time: newTask.time,
                history: {}
            });
            tasks.sort((a, b) => parseTimeStr(a.time) - parseTimeStr(b.time));
            renderAll();
            closeModal('modal-add');
            document.getElementById('inp-title').value = '';
        } else {
            alert(newTask.error);
        }
    } catch (e) {
        alert('Failed to save task. Is the server running?');
    }
}

async function toggleTask(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;

    if (!t.history[selectedDate]) t.history[selectedDate] = { done: false };
    const newDone = !t.history[selectedDate].done;
    t.history[selectedDate].done = newDone;

    if (newDone) playDing();

    // Optimistic UI update
    renderAll();

    try {
        await fetch(API + '/tasks/toggle', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                taskId: id,
                date: toBackendDate(selectedDate),
                isDone: newDone
            })
        });
    } catch (e) {
        // Revert on failure
        t.history[selectedDate].done = !newDone;
        renderAll();
    }
}

async function delTask(id) {
    if (!confirm("Permanently delete this task from all days?")) return;

    tasks = tasks.filter(t => t.id !== id);
    renderAll();

    try {
        await fetch(API + '/tasks/' + id, {
            method: 'DELETE',
            headers: authHeaders()
        });
    } catch (e) {
        console.error('Delete failed:', e);
        await fetchTasks();
        renderAll();
    }
}

function selectDate(dateStr) {
    selectedDate = dateStr;
    renderAll();
}

// ── RENDERING ──
function renderAll() {
    const rList = document.getElementById('list-routines');
    const tList = document.getElementById('list-tasks');
    rList.innerHTML = '';
    tList.innerHTML = '';

    let doneCount = 0;
    const total = tasks.length;
    const isRest = isRestDay(selectedDate);

    if (total === 0) {
        rList.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-muted);">Routine is clear. Open Tasks to start.</div>`;
        tList.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-muted);">Your task list is empty. Tap + New to add one.</div>`;
    } else {
        tasks.forEach(t => {
            const tData = t.history[selectedDate] || { done: false };
            if (tData.done) doneCount++;

            rList.innerHTML += `
                <div class="task-row ${tData.done ? 'done' : ''}">
                    <div class="checkbox" onclick="toggleTask(${t.id})"></div>
                    <div class="task-info">
                        <div class="task-cat">${t.cat}</div>
                        <div class="task-txt">${t.title}</div>
                        <div class="task-time">${t.time}</div>
                    </div>
                </div>`;

            tList.innerHTML += `
                <div class="task-row" style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="checkbox" onclick="toggleTask(${t.id})" style="flex-shrink:0;"></div>
                    <div class="task-info">
                        <div class="task-cat">${t.cat}</div>
                        <div class="task-txt" style="color:var(--text-main);">${t.title}</div>
                        <div class="task-time">${t.time}</div>
                    </div>
                    <button class="btn-del" onclick="delTask(${t.id})" title="Delete Task">×</button>
                </div>`;
        });
    }

    document.getElementById('goal-status').innerText = `Goal: ${doneCount}/${total}`;
    const pct = total > 0 ? (doneCount / total) * 100 : 0;
    document.getElementById('stat-tasks-done').innerText = doneCount;
    document.getElementById('stat-productivity').innerText = total ? Math.round(pct) + '%' : '0%';
    document.getElementById('stat-focus-time').innerText = `${Math.floor(focusTimeSeconds / 3600)}h ${Math.floor((focusTimeSeconds % 3600) / 60)}m`;

    if (routineChart) {
        const drawPct = isRest ? 1 : (total > 0 ? doneCount / total : 0);
        routineChart.data.datasets[0].backgroundColor = isRest
            ? getComputedStyle(document.body).getPropertyValue('--rest-color').trim()
            : getComputedStyle(document.body).getPropertyValue('--neon-primary').trim();
        routineChart.data.datasets[0].data = [drawPct];
        routineChart.data.datasets[1].data = [1 - drawPct];
        routineChart.update();
    }

    renderDateBar();
    updateAnalyticsChart();
    calculateStreak();
}

// ── DATE BAR ──
function renderDateBar() {
    const container = document.getElementById('date-bar');
    container.innerHTML = '';

    for (let i = -3; i <= 3; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dStr = d.toDateString();
        const isRest = isRestDay(dStr);

        let dayDone = 0;
        const total = tasks.length;
        tasks.forEach(t => { if (t.history[dStr] && t.history[dStr].done) dayDone++; });

        const isHit = (total > 0 && dayDone >= total);
        const active = dStr === selectedDate ? 'active' : '';
        let streakCls = isRest ? 'rest' : (isHit ? 'streak' : '');

        let fireSVG = (isHit && !isRest && i <= 0)
            ? `<svg class="pill-fire" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>`
            : '';

        if (i > 0) {
            container.innerHTML += `<div class="date-pill disabled">
                <span class="day">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</span>
                <span class="num">${d.getDate()}</span>
            </div>`;
        } else {
            container.innerHTML += `<div class="date-pill ${active} ${streakCls}" onclick="selectDate('${dStr}')">
                ${fireSVG}
                <span class="day">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</span>
                <span class="num">${d.getDate()}</span>
            </div>`;
        }
    }

    setTimeout(() => {
        const wrapper = document.getElementById('scroll-wrapper');
        if (wrapper) wrapper.scrollLeft = (wrapper.scrollWidth / 2) - (wrapper.clientWidth / 2);
    }, 10);
}

// ── STREAK CALCULATION ──
function calculateStreak() {
    let currentStreak = 0;
    let streakActive = true;

    for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dStr = d.toDateString();
        const isRest = isRestDay(dStr);

        let dayDone = 0;
        const total = tasks.length;
        tasks.forEach(t => { if (t.history[dStr] && t.history[dStr].done) dayDone++; });
        const isHit = (total > 0 && dayDone >= total);

        if (isHit) currentStreak++;
        else if (!isRest && i !== 0) streakActive = false;
        if (!streakActive) break;
    }
    document.getElementById('stat-routines').innerText = currentStreak;
}

// ── CHARTS ──
function initCharts() {
    const ctxR = document.getElementById('routineChart').getContext('2d');
    routineChart = new Chart(ctxR, {
        type: 'bar',
        data: {
            labels: [''],
            datasets: [
                { data: [0], backgroundColor: '#0066FF', borderRadius: 10 },
                { data: [1], backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 10 }
            ]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false, max: 1 }, y: { display: false } }
        }
    });

    const ctxA = document.getElementById('analyticsChart').getContext('2d');
    const color = getComputedStyle(document.body).getPropertyValue('--neon-primary').trim() || '#0066FF';
    analyticsChart = new Chart(ctxA, {
        type: 'line',
        data: {
            labels: ['', '', '', '', '', '', ''],
            datasets: [{
                data: [0, 0, 0, 0, 0, 0, 0],
                borderColor: color,
                backgroundColor: color + '22',
                fill: true,
                tension: 0.4,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

function updateAnalyticsChart() {
    if (!analyticsChart) return;
    const labels = [];
    const data = [];

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dStr = d.toDateString();
        labels.push(dStr.split(' ')[0]);
        let dayDone = 0;
        tasks.forEach(t => { if (t.history[dStr] && t.history[dStr].done) dayDone++; });
        data.push(dayDone);
    }

    const color = getComputedStyle(document.body).getPropertyValue('--neon-primary').trim() || '#0066FF';
    analyticsChart.data.labels = labels;
    analyticsChart.data.datasets[0].data = data;
    analyticsChart.data.datasets[0].borderColor = color;
    analyticsChart.data.datasets[0].backgroundColor = color + '22';
    analyticsChart.update();
}

// ── SETTINGS & THEME ──
function updateSettingsUI() {
    const isDark = document.body.hasAttribute('data-theme');
    const btnTheme = document.getElementById('btn-theme');
    const knobTheme = document.getElementById('theme-knob');
    if (isDark) {
        if (btnTheme) btnTheme.style.background = 'var(--neon-primary)';
        if (knobTheme) { knobTheme.style.left = '26px'; knobTheme.style.background = '#000'; }
    } else {
        if (btnTheme) btnTheme.style.background = 'transparent';
        if (knobTheme) { knobTheme.style.left = '2px'; knobTheme.style.background = 'var(--text-muted)'; }
    }

    const btnNotif = document.getElementById('btn-notif');
    const knobNotif = document.getElementById('notif-knob');
    if (appSettings.notificationsEnabled) {
        if (btnNotif) btnNotif.style.background = 'var(--neon-primary)';
        if (knobNotif) { knobNotif.style.left = '26px'; knobNotif.style.background = '#000'; }
    } else {
        if (btnNotif) btnNotif.style.background = 'transparent';
        if (knobNotif) { knobNotif.style.left = '2px'; knobNotif.style.background = 'var(--text-muted)'; }
    }

    for (let i = 0; i < 7; i++) {
        const bubble = document.getElementById('bubble-' + i);
        if (bubble) {
            if (appSettings.restDaysOfWeek.includes(i)) bubble.classList.add('active');
            else bubble.classList.remove('active');
        }
    }
}

function toggleNotifications() {
    appSettings.notificationsEnabled = !appSettings.notificationsEnabled;
    if (appSettings.notificationsEnabled && "Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
    saveLocalSettings();
    updateSettingsUI();
}

// ── FIXED NOTIFICATIONS (Problem 13) ──
// Check every 30 seconds, match within a 1-minute window so it never misses
function checkNotifications() {
    if (!appSettings.notificationsEnabled) return;
    if (Notification.permission !== "granted") return;

    const now = new Date();
    const todayStr = now.toDateString();

    tasks.forEach(t => {
        const tData = t.history[todayStr] || { done: false };
        if (tData.done) return; // Already done, skip

        // Parse task time
        const taskMinutes = parseTimeStr(t.time);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        // Fire notification if within 1-minute window of task time
        if (nowMinutes >= taskMinutes && nowMinutes <= taskMinutes + 1) {
            // Prevent duplicate notifications using a flag
            const notifKey = `notif_${t.id}_${todayStr}_${taskMinutes}`;
            if (!sessionStorage.getItem(notifKey)) {
                new Notification("⏰ Daily Routine Tracker", {
                    body: `Time for: ${t.title}`,
                    icon: '/favicon.ico'
                });
                playDing();
                sessionStorage.setItem(notifKey, '1');
            }
        }
    });
}

function toggleRestDayPicker(dayIndex) {
    const idx = appSettings.restDaysOfWeek.indexOf(dayIndex);
    if (idx > -1) {
        appSettings.restDaysOfWeek.splice(idx, 1);
    } else {
        if (appSettings.restDaysOfWeek.length >= 2) { alert("Max 2 rest days."); return; }
        appSettings.restDaysOfWeek.push(dayIndex);
    }
    saveLocalSettings();
    updateSettingsUI();
    renderAll();
}

function toggleTheme() {
    if (document.body.hasAttribute('data-theme')) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
    updateSettingsUI();
    updateAnalyticsChart();
}

// ── FIXED LOGOUT (Problem 7) — only clears user session, keeps theme/settings ──
function logoutApp(silent = false) {
    if (silent || confirm("Logout?")) {
        localStorage.removeItem('drt_token');
        localStorage.removeItem('drt_user_name');
        localStorage.removeItem('drt_user_email');
        window.location.href = 'index.html';
    }
}

// ── TIMER ──
function toggleTimer() {
    const btn = document.getElementById('btn-toggle');
    if (timer.active) {
        clearInterval(timer.interval);
        timer.active = false;
        btn.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    } else {
        timer.active = true;
        btn.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        timer.interval = setInterval(() => {
            if (timer.time > 0) {
                timer.time--;
                focusTimeSeconds++;
                updateTimerDisplay();
                if (focusTimeSeconds % 10 === 0) saveLocalSettings();
            } else {
                clearInterval(timer.interval);
                timer.active = false;
                playDing();
                alert("Focus session complete! Great work 🎉");
                resetTimer();
            }
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(timer.interval);
    timer.active = false;
    timer.time = 1500;
    updateTimerDisplay();
    document.getElementById('btn-toggle').innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
}

function startBreak() {
    clearInterval(timer.interval);
    timer.active = false;
    timer.time = 300;
    updateTimerDisplay();
    document.getElementById('btn-toggle').innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
}

function updateTimerDisplay() {
    const m = Math.floor(timer.time / 60).toString().padStart(2, '0');
    const s = (timer.time % 60).toString().padStart(2, '0');
    document.getElementById('time-display').innerText = `${m}:${s}`;
}

// ── UTILS ──
function playDing() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    } catch (e) {}
}

function updateHeaderAndQuotes() {
    const userName = getUserName();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
    document.getElementById('greeting').innerText = `${greeting}, ${userName.split(' ')[0]} 👋`;
    document.getElementById('full-date').innerText = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    document.getElementById('daily-quote').innerText = `"${dailyQuotes[Math.floor(Math.random() * dailyQuotes.length)]}"`;
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function switchView(id, btn) {
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.getElementById('view-' + id).style.display = 'block';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}