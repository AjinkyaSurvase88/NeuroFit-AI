/* ============================================================
   Neuro Fit AI – script.js
   Mobile-compatible rewrite:
     • requestAnimationFrame render loop (smooth video on canvas)
     • Separate frame-send interval (15 fps to backend)
     • AudioContext created ONCE after user gesture
     • SpeechSynthesis with iOS Safari workaround
     • Explicit video.play() with error handling
     • Rear-camera support for pullups
   ============================================================ */

const socket = io({ transports: ['websocket', 'polling'] });

// ── DOM refs ─────────────────────────────────────────────────
const videoElement   = document.getElementById('videoElement');
const canvasElement  = document.getElementById('outputCanvas');
const canvasCtx      = canvasElement.getContext('2d');
const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');
const resetBtn       = document.getElementById('resetBtn');
const exerciseSelect = document.getElementById('exerciseSelect');
const repCountEl     = document.getElementById('repCount');
const exerciseStateEl= document.getElementById('exerciseState');
const statusMessageEl= document.getElementById('statusMessage');
const calorieCountEl = document.getElementById('calorieCount');
const workoutTimerEl = document.getElementById('workoutTimer');
const infoBtn        = document.getElementById('infoBtn');
const infoModal      = document.getElementById('infoModal');
const closeModalBtn  = document.getElementById('closeModal');
const angleEl        = document.getElementById('angleDisplay');

// ── State ────────────────────────────────────────────────────
let isRunning       = false;
let stream          = null;
let currentExercise = 'pushup';
let sendInterval    = null;
let timerInterval   = null;
let startTime       = null;
let totalCalories   = 0.0;
let lastCount       = 0;
let latestLandmarks = [];   // stored by socket, drawn by rAF
let animFrameId     = null;

// ── Audio (created ONCE after user gesture) ──────────────────
let audioCtx = null;
function ensureAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playBeep() {
    try {
        ensureAudioCtx();
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) { console.warn('Beep error:', e); }
}

function speak(text) {
    try {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate  = 1.2;
        utt.pitch = 1.1;
        utt.volume = 1;
        // iOS Safari workaround: load voices first
        const voices = window.speechSynthesis.getVoices();
        if (voices.length) utt.voice = voices[0];
        window.speechSynthesis.speak(utt);
    } catch (e) { console.warn('Speech error:', e); }
}

// ── Calorie constants ────────────────────────────────────────
const CALORIES = { pushup: 0.32, pullup: 1.0 };

// ── Canvas setup ─────────────────────────────────────────────
canvasElement.width  = 640;
canvasElement.height = 480;

// ── Skeleton drawing ─────────────────────────────────────────
const CONNECTIONS = [
    [11,13],[13,15],[15,21],[15,17],[15,19],[17,19],
    [12,14],[14,16],[16,22],[16,18],[16,20],[18,20],
    [11,12],[23,24],[11,23],[12,24],
    [23,25],[25,27],[27,29],[27,31],[29,31],
    [24,26],[26,28],[28,30],[28,32],[30,32],
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10]
];

function drawFrame() {
    // Draw current video frame
    if (videoElement.readyState >= 2) {
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    }
    // Draw skeleton overlay
    const lms = latestLandmarks;
    if (lms && lms.length > 0) {
        const W = canvasElement.width, H = canvasElement.height;
        // Connections
        canvasCtx.lineWidth    = 3;
        canvasCtx.strokeStyle  = 'rgba(0,255,204,0.85)';
        CONNECTIONS.forEach(([p1, p2]) => {
            const a = lms[p1], b = lms[p2];
            if (a && b && a.visibility > 0.45 && b.visibility > 0.45) {
                canvasCtx.beginPath();
                canvasCtx.moveTo(a.x * W, a.y * H);
                canvasCtx.lineTo(b.x * W, b.y * H);
                canvasCtx.stroke();
            }
        });
        // Dots
        canvasCtx.fillStyle = 'rgba(255,0,85,0.9)';
        lms.forEach(lm => {
            if (lm.visibility > 0.45) {
                canvasCtx.beginPath();
                canvasCtx.arc(lm.x * W, lm.y * H, 5, 0, 2 * Math.PI);
                canvasCtx.fill();
            }
        });
    }
    if (isRunning) animFrameId = requestAnimationFrame(drawFrame);
}

// ── Camera ───────────────────────────────────────────────────
async function startCamera() {
    // Pick facing mode based on exercise
    const facingMode = (currentExercise === 'pullup') ? 'environment' : 'user';
    const constraints = {
        video: {
            facingMode,
            width:  { ideal: 640 },
            height: { ideal: 480 },
        },
        audio: false
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
        // Fallback: try without facingMode constraint
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;

    // Explicit play() – required on iOS
    await videoElement.play().catch(e => console.warn('video.play():', e));

    // Wait for dimensions
    await new Promise(resolve => {
        if (videoElement.videoWidth > 0) { resolve(); return; }
        videoElement.addEventListener('loadedmetadata', resolve, { once: true });
    });

    canvasElement.width  = videoElement.videoWidth  || 640;
    canvasElement.height = videoElement.videoHeight || 480;
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    videoElement.srcObject = null;
}

// ── Frame sender ─────────────────────────────────────────────
function captureAndSend() {
    if (!isRunning || videoElement.readyState < 2) return;
    // Downscale frame to 320x240 to prevent Render Out-Of-Memory SIGKILL
    const tmp = document.createElement('canvas');
    tmp.width  = 320;
    tmp.height = 240;
    tmp.getContext('2d').drawImage(videoElement, 0, 0, tmp.width, tmp.height);
    const jpeg = tmp.toDataURL('image/jpeg', 0.4); // 0.4 compression saves even more bandwidth
    socket.emit('process_frame', { image: jpeg, exercise: currentExercise });
}

// ── Timer ────────────────────────────────────────────────────
function formatTime(s) {
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function tickTimer() {
    if (!startTime) return;
    workoutTimerEl.textContent = formatTime(Math.floor((Date.now() - startTime) / 1000));
}

// ── Socket events ─────────────────────────────────────────────
socket.on('connect', () => {
    showStatus('Connected to AI Server', 'var(--primary-color)', 3000);
});
socket.on('disconnect', () => {
    showStatus('Disconnected from server', 'var(--secondary-color)');
});

socket.on('reset_response', data => {
    if (data.status === 'success') {
        repCountEl.textContent      = '0';
        exerciseStateEl.textContent = 'READY';
        exerciseStateEl.className   = 'state-indicator';
        lastCount = 0;
        if (angleEl) angleEl.textContent = '--°';
    }
});

socket.on('pose_result', data => {
    if (!isRunning) return;
    const { landmarks, count, state, angle } = data;

    // Store landmarks for the rAF render loop
    latestLandmarks = landmarks || [];

    // Rep feedback
    if (count > lastCount) {
        playBeep();
        speak(String(count));
        totalCalories += CALORIES[currentExercise] || 0;
        calorieCountEl.innerHTML = `${totalCalories.toFixed(1)} <span class="unit">kcal</span>`;
        lastCount = count;
    }

    repCountEl.textContent = count;
    if (angleEl && angle != null) angleEl.textContent = Math.round(angle) + '°';

    const s = state || 'READY';
    exerciseStateEl.textContent = s;
    exerciseStateEl.className = 'state-indicator' + (s === 'UP' ? ' up' : s === 'DOWN' ? ' down' : '');
});

// ── UI helpers ────────────────────────────────────────────────
function showStatus(msg, color = 'var(--warning-color)', clearAfterMs = 0) {
    statusMessageEl.textContent = msg;
    statusMessageEl.style.color = color;
    if (clearAfterMs) setTimeout(() => { statusMessageEl.textContent = ''; }, clearAfterMs);
}

// ── Controls ──────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
    ensureAudioCtx();   // must happen inside user gesture
    currentExercise = exerciseSelect.value;

    showStatus('Starting camera…');
    try {
        await startCamera();
    } catch (err) {
        showStatus('Camera error: ' + err.message, 'var(--secondary-color)');
        console.error(err);
        return;
    }

    isRunning = true;
    startBtn.disabled      = true;
    stopBtn.disabled       = false;
    exerciseSelect.disabled= true;

    socket.emit('reset', { exercise: currentExercise });
    totalCalories = 0;
    calorieCountEl.innerHTML = `0.0 <span class="unit">kcal</span>`;
    startTime = Date.now();
    timerInterval = setInterval(tickTimer, 1000);

    // Start render loop and frame sender
    animFrameId  = requestAnimationFrame(drawFrame);
    sendInterval = setInterval(captureAndSend, 1000 / 15);   // 15 fps

    showStatus(`Tracking ${currentExercise}s…`, 'var(--primary-color)');
    speak(`Starting ${currentExercise} tracking`);
});

stopBtn.addEventListener('click', () => {
    isRunning = false;
    cancelAnimationFrame(animFrameId);
    clearInterval(sendInterval);
    clearInterval(timerInterval);
    stopCamera();
    latestLandmarks = [];
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    startBtn.disabled      = false;
    stopBtn.disabled       = true;
    exerciseSelect.disabled= false;

    showStatus('Tracking stopped.');
});

resetBtn.addEventListener('click', () => {
    socket.emit('reset', { exercise: currentExercise });
    totalCalories = 0;
    calorieCountEl.innerHTML = `0.0 <span class="unit">kcal</span>`;
    startTime = isRunning ? Date.now() : null;
    workoutTimerEl.textContent = '00:00';
    lastCount = 0;
});

exerciseSelect.addEventListener('change', e => {
    currentExercise = e.target.value;
});

// ── Modal ─────────────────────────────────────────────────────
infoBtn.addEventListener('click', () => { infoModal.style.display = 'block'; });
closeModalBtn.addEventListener('click', () => { infoModal.style.display = 'none'; });
window.addEventListener('click', e => { if (e.target === infoModal) infoModal.style.display = 'none'; });

// iOS: pre-load speech voices
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
