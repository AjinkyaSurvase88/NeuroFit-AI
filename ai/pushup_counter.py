from ai.utils import calculate_angle, AngleSmootherEWMA, get_best_arm_landmarks


class PushupCounter:
    """
    Counts pushup reps using elbow angle at the best-visible arm.

    Camera position: Side profile is best, but works from the front too.

    State machine with hysteresis:
      - Starts in "UP" state (arms extended, angle ~160-180°)
      - When angle drops BELOW down_threshold (80°)  → transitions to "DOWN"
      - When angle rises ABOVE up_threshold   (150°) → transitions back to "UP"
        and increments the counter.
    
    Hysteresis gap (80° → 150°) prevents false counts from small angle jitter.
    """

    DOWN_THRESHOLD = 100   # degrees - more forgiving for mobile angles
    UP_THRESHOLD   = 145   # degrees - more forgiving lock-out
    CONFIDENCE     = 0.3   # lower confidence required due to mobile compression

    def __init__(self):
        self.count = 0
        self.state = "UP"
        self._smoother = AngleSmootherEWMA(alpha=0.6) # Faster response
        self._last_angle = None

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
            if angle < self.DOWN_THRESHOLD:
                self.state = "DOWN"
            elif angle > self.UP_THRESHOLD:
                if self.state == "DOWN":
                    self.state = "UP"
                    self.count += 1

        except Exception as e:
            print(f"[PushupCounter] Error: {e}")

        return self.count, self.state, round(self._last_angle or 0, 1)

    def reset(self):
        self.count = 0
        self.state = "UP"
        self._smoother.reset()
        self._last_angle = None
