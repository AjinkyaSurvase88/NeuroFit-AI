const socket = io();

// DOM Elements
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const exerciseSelect = document.getElementById('exerciseSelect');
const repCountEl = document.getElementById('repCount');
const exerciseStateEl = document.getElementById('exerciseState');
const statusMessageEl = document.getElementById('statusMessage');
const calorieCountEl = document.getElementById("calorieCount");
const workoutTimerEl = document.getElementById("workoutTimer");
const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeModal = document.getElementById("closeModal");

// State
let isRunning = false;
let stream = null;
let currentExercise = 'pushup';
let processingInterval = null;
let startTime = null;
let timerInterval = null;
let totalCalories = 0.0;
let lastCount = 0;

// Settings
const FPS = 15; // Send frames at 15 FPS to backend
const CALORIES_PER_REP = {
    'pushup': 0.32,
    'pullup': 1.0
};

// Canvas Setup
canvasElement.width = 640;
canvasElement.height = 480;

// Speech Synthesis for Voice Feedback
const synth = window.speechSynthesis;

function speak(text) {
    if (synth.speaking) {
        synth.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2;
    utterance.pitch = 1.1;
    synth.speak(utterance);
}

function playSuccessSound() {
    // A simple beep using Web Audio API
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime); // A5
    oscillator.frequency.exponentialRampToValueAtTime(1760, context.currentTime + 0.1); // A6
    
    gainNode.gain.setValueAtTime(0, context.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, context.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.2);
    
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
}

// Socket.IO Events
socket.on('connect', () => {
    statusMessageEl.textContent = 'Connected to AI Server';
    statusMessageEl.style.color = 'var(--primary-color)';
    setTimeout(() => { statusMessageEl.textContent = ''; }, 3000);
});

socket.on('disconnect', () => {
    statusMessageEl.textContent = 'Disconnected from Server';
    statusMessageEl.style.color = 'var(--secondary-color)';
});

socket.on('reset_response', (data) => {
    if (data.status === 'success') {
        repCountEl.textContent = '0';
        exerciseStateEl.textContent = 'READY';
        exerciseStateEl.className = 'state-indicator';
        lastCount = 0;
    }
});

socket.on('pose_result', (data) => {
    if (!isRunning) return;

    const { landmarks, count, state, angle } = data;

    // Voice and Sound feedback on rep completion
    if (count > lastCount) {
        playSuccessSound();
        speak(count.toString());
        
        // Update calories
        totalCalories += CALORIES_PER_REP[currentExercise];
        calorieCountEl.innerHTML = `${totalCalories.toFixed(1)} <span class="unit">kcal</span>`;
        
        lastCount = count;
    }

    // Update UI
    repCountEl.textContent = count;
    exerciseStateEl.textContent = state;
    
    // Update State Color
    if (state === 'UP') {
        exerciseStateEl.className = 'state-indicator up';
    } else if (state === 'DOWN') {
        exerciseStateEl.className = 'state-indicator down';
    } else {
        exerciseStateEl.className = 'state-indicator';
    }

    // Draw frame and skeleton
    drawSkeleton(landmarks);
});

// Camera and Canvas Operations
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        videoElement.srcObject = stream;
        
        return new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                canvasElement.width = videoElement.videoWidth;
                canvasElement.height = videoElement.videoHeight;
                resolve();
            };
        });
    } catch (err) {
        console.error('Error accessing camera:', err);
        statusMessageEl.textContent = 'Error: Could not access camera.';
        statusMessageEl.style.color = 'var(--secondary-color)';
        throw err;
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
}

function captureAndSendFrame() {
    if (!isRunning) return;

    // Draw current video frame to canvas
    canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Get base64 string
    // Compress heavily to ensure low latency over network (quality 0.5)
    const imageData = canvasElement.toDataURL('image/jpeg', 0.5);

    // Send to server
    socket.emit('process_frame', {
        image: imageData,
        exercise: currentExercise
    });
}

// Drawing Utilities
function drawSkeleton(landmarks) {
    if (!landmarks || landmarks.length === 0) return;

    // MediaPipe Connections
    const connections = [
        [11, 13], [13, 15], [15, 21], [15, 17], [15, 19], [17, 19], // Left arm
        [12, 14], [14, 16], [16, 22], [16, 18], [16, 20], [18, 20], // Right arm
        [11, 12], // Shoulders
        [23, 24], // Hips
        [11, 23], [12, 24], // Torso
        [23, 25], [25, 27], [27, 29], [27, 31], [29, 31], // Left leg
        [24, 26], [26, 28], [28, 30], [28, 32], [30, 32], // Right leg
        [0, 1], [1, 2], [2, 3], [3, 7], // Face left
        [0, 4], [4, 5], [5, 6], [6, 8], // Face right
        [9, 10] // Mouth
    ];

    const width = canvasElement.width;
    const height = canvasElement.height;

    // Draw connections
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(0, 255, 204, 0.8)'; // Neon Cyan

    connections.forEach(([p1, p2]) => {
        const lm1 = landmarks[p1];
        const lm2 = landmarks[p2];

        // Only draw if confident
        if (lm1.visibility > 0.5 && lm2.visibility > 0.5) {
            canvasCtx.beginPath();
            canvasCtx.moveTo(lm1.x * width, lm1.y * height);
            canvasCtx.lineTo(lm2.x * width, lm2.y * height);
            canvasCtx.stroke();
        }
    });

    // Draw landmarks
    canvasCtx.fillStyle = 'rgba(255, 0, 85, 0.9)'; // Neon Pink
    landmarks.forEach(lm => {
        if (lm.visibility > 0.5) {
            canvasCtx.beginPath();
            canvasCtx.arc(lm.x * width, lm.y * height, 4, 0, 2 * Math.PI);
            canvasCtx.fill();
        }
    });
}

// Timer functionality
function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateTimer() {
    if (!startTime) return;
    const now = new Date();
    const diff = Math.floor((now - startTime) / 1000);
    workoutTimerEl.textContent = formatTime(diff);
}

// Event Listeners
startBtn.addEventListener('click', async () => {
    currentExercise = exerciseSelect.value;
    try {
        await startCamera();
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        exerciseSelect.disabled = true;
        
        // Reset state
        socket.emit('reset');
        totalCalories = 0.0;
        calorieCountEl.innerHTML = `0.0 <span class="unit">kcal</span>`;
        startTime = new Date();
        timerInterval = setInterval(updateTimer, 1000);
        
        // Start processing loop
        processingInterval = setInterval(captureAndSendFrame, 1000 / FPS);
        
        statusMessageEl.textContent = `Tracking ${currentExercise}s...`;
        speak(`Starting ${currentExercise} tracking`);
        
    } catch (err) {
        // Handled in startCamera
    }
});

stopBtn.addEventListener('click', () => {
    isRunning = false;
    stopCamera();
    clearInterval(processingInterval);
    clearInterval(timerInterval);
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    exerciseSelect.disabled = false;
    
    statusMessageEl.textContent = 'Tracking stopped.';
});

resetBtn.addEventListener('click', () => {
    socket.emit('reset');
    totalCalories = 0.0;
    calorieCountEl.innerHTML = `0.0 <span class="unit">kcal</span>`;
    startTime = isRunning ? new Date() : null;
    workoutTimerEl.textContent = '00:00';
});

exerciseSelect.addEventListener("change", (e) => {
    currentExercise = e.target.value;
});

// Modal Event Listeners
infoBtn.addEventListener("click", () => {
    infoModal.style.display = "block";
});

closeModal.addEventListener("click", () => {
    infoModal.style.display = "none";
});

window.addEventListener("click", (e) => {
    if (e.target === infoModal) {
        infoModal.style.display = "none";
    }
});
