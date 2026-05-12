import numpy as np
from collections import deque


def calculate_angle(a, b, c):
    """
    Calculate the angle at point b, formed by the lines b->a and b->c.
    Points are (x, y) coordinates.
    Returns an angle in degrees between 0 and 180.
    """
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    c = np.array(c, dtype=float)

    ba = a - b
    bc = c - b

    cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    cosine_angle = np.clip(cosine_angle, -1.0, 1.0)
    angle = np.degrees(np.arccos(cosine_angle))

    return float(angle)


class AngleSmootherEWMA:
    """Exponential Weighted Moving Average smoother to reduce jitter."""
    def __init__(self, alpha=0.4):
        self.alpha = alpha
        self._value = None

    def update(self, new_value):
        if self._value is None:
            self._value = new_value
        else:
            self._value = self.alpha * new_value + (1 - self.alpha) * self._value
        return self._value

    def reset(self):
        self._value = None


def get_best_arm_landmarks(landmarks, confidence_threshold=0.5):
    """
    Pick the arm side (left or right) with higher average visibility.
    Returns (shoulder, elbow, wrist) dicts or None if neither is confident enough.
    Left side:  shoulder=11, elbow=13, wrist=15
    Right side: shoulder=12, elbow=14, wrist=16
    """
    # Left side
    l_sh, l_el, l_wr = landmarks[11], landmarks[13], landmarks[15]
    l_vis = min(l_sh['visibility'], l_el['visibility'], l_wr['visibility'])

    # Right side
    r_sh, r_el, r_wr = landmarks[12], landmarks[14], landmarks[16]
    r_vis = min(r_sh['visibility'], r_el['visibility'], r_wr['visibility'])

    if l_vis < confidence_threshold and r_vis < confidence_threshold:
        return None, None, None

    if l_vis >= r_vis:
        return l_sh, l_el, l_wr
    else:
        return r_sh, r_el, r_wr
