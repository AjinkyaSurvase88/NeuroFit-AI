import os
import sys
import cv2
import numpy as np
import base64
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import mediapipe as mp

# Make sure ai/ package is importable when run from project root
sys.path.insert(0, os.path.dirname(__file__))

from ai.pushup_counter import PushupCounter
from ai.pullup_counter import PullupCounter

app = Flask(__name__)
app.config['SECRET_KEY'] = 'neurofit_secret_2024'
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    max_http_buffer_size=5 * 1024 * 1024,  # 5 MB
    async_mode='gevent'
)

# ── MediaPipe Pose ─────────────────────────────────────────────────────────────
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=0, # Changed from 1 to 0 to prevent Render Out-Of-Memory SIGKILL
    smooth_landmarks=True,
    enable_segmentation=False,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

# ── Exercise Counters (per-session singletons) ─────────────────────────────────
pushup_counter = PushupCounter()
pullup_counter = PullupCounter()


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')


# ── Socket.IO Handlers ─────────────────────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    print("Client connected:", request.sid if 'request' in dir() else 'unknown')
    emit('connected', {'status': 'ok'})


@socketio.on('disconnect')
def on_disconnect():
    print("Client disconnected")


@socketio.on('reset')
def handle_reset(data=None):
    exercise = (data or {}).get('exercise', 'all')
    if exercise == 'pushup':
        pushup_counter.reset()
    elif exercise == 'pullup':
        pullup_counter.reset()
    else:
        pushup_counter.reset()
        pullup_counter.reset()
    emit('reset_response', {'status': 'success'})


@socketio.on('process_frame')
def process_frame(data):
    image_data   = data.get('image', '')
    exercise_type = data.get('exercise', 'pushup')

    if not image_data:
        return

    try:
        # ── Decode base64 JPEG frame ───────────────────────────────────────
        if ',' in image_data:
            image_data = image_data.split(',', 1)[1]
        raw = base64.b64decode(image_data)
        nparr = np.frombuffer(raw, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return

        # ── Run MediaPipe ──────────────────────────────────────────────────
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = pose.process(rgb)

        landmarks_list = []
        count = 0
        state = "READY"
        debug_angle = None

        if results.pose_landmarks:
            for lm in results.pose_landmarks.landmark:
                landmarks_list.append({
                    'x': lm.x,
                    'y': lm.y,
                    'z': lm.z,
                    'visibility': lm.visibility,
                })

            if exercise_type == 'pushup':
                count, state, debug_angle = pushup_counter.process_landmarks(landmarks_list)
            elif exercise_type == 'pullup':
                count, state, debug_angle = pullup_counter.process_landmarks(landmarks_list)
        else:
            # No body detected — return last known counter values to avoid UI flicker
            if exercise_type == 'pushup':
                count, state = pushup_counter.count, pushup_counter.state
            else:
                count, state = pullup_counter.count, pullup_counter.state

        # ── Emit results ───────────────────────────────────────────────────
        emit('pose_result', {
            'landmarks': landmarks_list,
            'count': count,
            'state': state,
            'angle': debug_angle,        # shown in UI for debugging
        })

    except Exception as e:
        print(f"[process_frame] Error: {e}")
        import traceback; traceback.print_exc()


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    from flask import request  # noqa: import here to avoid circular
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Neuro Fit AI on http://0.0.0.0:{port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False)
