"""1-D horn model (plane-wave transfer matrices of ~1 mm steps).

Gain = radiated power with horn / radiated power of the bare speaker port,
for the same volume velocity (good approximation for a phone micro-speaker,
whose moving mass dominates the acoustic load). Ignores bends and higher-order
modes, so treat results above ~2-3 kHz (wide mouths) as indicative only.
"""
import numpy as np
from scipy.special import j1, struve

RHO, C = 1.204, 343.0


def z_piston(S, f, baffle=True):
    """Radiation impedance of a circular piston of area S (m^2)."""
    a = np.sqrt(S / np.pi)
    k = 2 * np.pi * f / C
    x = 2 * k * a
    R = 1 - 2 * j1(x) / x
    X = 2 * struve(1, x) / x
    z = RHO * C / S * (R + 1j * X)
    if not baffle:  # crude unflanged approx: half the resistance at low ka
        z = RHO * C / S * (R * np.where(k * a < 1.5, 0.5 + 0.5 * (k * a / 1.5) ** 2, 1) + 1j * X * 0.75)
    return z


def tube_tm(S, L, f):
    """Transfer matrix (p, U) of a short cylinder; the horn is built from ~1 mm steps."""
    k = 2 * np.pi * f / C
    Zc = RHO * C / S
    return np.array([[np.cos(k * L), 1j * Zc * np.sin(k * L)],
                     [1j * np.sin(k * L) / Zc, np.cos(k * L)]])


def gain_db(areas_mm2, s_mm, freqs, baffle=True, throat_mm2=None):
    S = np.asarray(areas_mm2) * 1e-6
    s = np.asarray(s_mm) * 1e-3
    out = []
    for f in freqs:
        Zl = z_piston(S[-1], f, baffle)
        p, U = Zl, 1.0  # start at mouth with U=1
        for i in range(len(S) - 1, 0, -1):
            T = tube_tm(np.sqrt(S[i - 1] * S[i]), s[i] - s[i - 1], f)
            p, U = T[0, 0] * p + T[0, 1] * U, T[1, 0] * p + T[1, 1] * U
        zin = p / U
        z0 = z_piston((throat_mm2 or areas_mm2[0]) * 1e-6, f, True)
        out.append(10 * np.log10(zin.real / z0.real))
    return np.array(out)
