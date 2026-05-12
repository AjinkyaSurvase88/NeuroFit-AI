from ai.utils import calculate_angle, AngleSmootherEWMA, get_best_arm_landmarks


class PullupCounter:
    """
    Counts pullup reps using elbow angle at the best-visible arm.

    Camera position: Front-facing (you face the camera while hanging).
    The bar is above you. 

    How the elbow angle works in a pullup (front camera):
      - Dead hang (arms fully extended) → elbow angle is large (160–180°)
      - Top of pullup (chin over bar)   → elbow angle is small (50–70°)

    State machine with hysteresis:
      - Starts in "DOWN" state (dead hang)
      - When angle drops BELOW up_threshold (75°)   → transitions to "UP" (chin above bar)
        and increments the counter.
      - When angle rises ABOVE down_threshold (140°) → transitions back to "DOWN" (dead hang)
    
    Note: The rep is counted on the WAY UP when chin clears the bar, not on the way down.
    This prevents partial-rep counting.

    We also use the nose vs wrist Y-position as a secondary gate for the "chin above bar"
    condition (works when wrists are visible and approximately at bar level).
    """

    UP_THRESHOLD   = 90    # degrees - more forgiving elbow angle at top (was 75)
    DOWN_THRESHOLD = 130   # degrees - more forgiving at bottom (dead hang, was 140)
    CONFIDENCE     = 0.3   # lower confidence due to mobile compression

    def __init__(self):
        self.count = 0
        self.state = "DOWN"
        self._smoother = AngleSmootherEWMA(alpha=0.6) # Faster response
        self._last_angle = None

    def _chin_above_bar(self, landmarks, shoulder, wrist):
        """
        Gate check: verify that nose (chin proxy) is at or above wrist level.
        In MediaPipe normalised coords, y=0 is the TOP of the frame.
        So "above" means SMALLER y value.

        We allow a 10% tolerance so the check doesn't reject legitimate reps
        where the camera angle makes the chin appear slightly below wrist.
        """
        nose = landmarks[0]
        if nose['visibility'] < self.CONFIDENCE:
            return True  # can't verify, be permissive

        tolerance = 0.10   # allow chin to be 10% below wrist level
        return nose['y'] <= (wrist['y'] + tolerance)

    def process_landmarks(self, landmarks):
        """
        Returns (count, state, debug_angle).
        """
        if not landmarks:
            return self.count, self.state, None

        shoulder, elbow, wrist = get_best_arm_landmarks(landmarks, self.CONFIDENCE)
        if shoulder is None:
            return self.count, self.state, None

        try:
            raw_angle = calculate_angle(
                [shoulder['x'], shoulder['y']],
                [elbow['x'],    elbow['y']],
                [wrist['x'],    wrist['y']]
            )
            angle = self._smoother.update(raw_angle)
            self._last_angle = angle

            # ── State machine with hysteresis ──────────────────────────────
            if angle > self.DOWN_THRESHOLD:
                # Arms are extended → dead hang
                self.state = "DOWN"

            elif angle < self.UP_THRESHOLD:
                # Arms are bent to a high degree → potentially at top of pullup
                if self.state == "DOWN":
                    # Secondary gate: chin must be at or near bar level
                    if self._chin_above_bar(landmarks, shoulder, wrist):
                        self.state = "UP"
                        self.count += 1

        except Exception as e:
            print(f"[PullupCounter] Error: {e}")

        return self.count, self.state, round(self._last_angle or 0, 1)

    def reset(self):
        self.count = 0
        self.state = "DOWN"
        self._smoother.reset()
        self._last_angle = None
