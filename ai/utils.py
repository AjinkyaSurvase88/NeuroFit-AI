import numpy as np


def calculate_angle(a, b, c):
    """
    Calculate the angle at vertex b, formed by rays b->a and b->c.
    Applies a 4:3 aspect ratio correction since MediaPipe coords are normalized.
    """
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    c = np.array(c, dtype=float)

    # Correct for 4:3 aspect ratio (typical camera frame)
    # x is stretched relative to y in normalized coords
    aspect_ratio_correction = np.array([4.0 / 3.0, 1.0])
    a = a * aspect_ratio_correction
    b = b * aspect_ratio_correction
    c = c * aspect_ratio_correction

    ba = a - b
    bc = c - b

    norm = np.linalg.norm(ba) * np.linalg.norm(bc)
    if norm < 1e-6:
        return 180.0

    cosine = np.dot(ba, bc) / norm
    cosine = float(np.clip(cosine, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


class AngleSmootherEWMA:
    """
    Exponential Weighted Moving Average — reduces jitter without adding lag.
    alpha=0.6 means 60% weight on new value → faster response than 0.4.
    """
    def __init__(self, alpha=0.6):
        self.alpha = alpha
        self._value = None

    def update(self, new_value):
        if self._value is None:
            self._value = new_value
        else:
            self._value = self.alpha * new_value + (1.0 - self.alpha) * self._value
        return self._value

    def reset(self):
        self._value = None


def get_best_arm_landmarks(landmarks, confidence_threshold=0.3):
    """
    Pick the arm side (left or right) with higher AVERAGE visibility.
    Uses AVERAGE (not min) so a single slightly-occluded landmark
    doesn't discard the whole arm.

    MediaPipe indices:
      Left:  shoulder=11, elbow=13, wrist=15
      Right: shoulder=12, elbow=14, wrist=16
    """
    l_sh = landmarks[11]
    l_el = landmarks[13]
    l_wr = landmarks[15]
    l_vis = (l_sh['visibility'] + l_el['visibility'] + l_wr['visibility']) / 3.0

    r_sh = landmarks[12]
    r_el = landmarks[14]
    r_wr = landmarks[16]
    r_vis = (r_sh['visibility'] + r_el['visibility'] + r_wr['visibility']) / 3.0

    # Reject if NEITHER arm has even moderate confidence
    if l_vis < confidence_threshold and r_vis < confidence_threshold:
        return None, None, None

    if l_vis >= r_vis:
        return l_sh, l_el, l_wr
    else:
        return r_sh, r_el, r_wr
