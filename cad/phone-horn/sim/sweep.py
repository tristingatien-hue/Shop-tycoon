import numpy as np, hornsim as h
F = np.geomspace(300, 8000, 160)
band = (F >= 400) & (F <= 6000)

def hypex(fc, T, Dm, A0=90.0):
    x0 = 343000 / (2 * np.pi * fc)
    Am = np.pi * Dm**2 / 4
    s = np.linspace(0, 3000, 30001)
    A = A0 * (np.cosh(s / x0) + T * np.sinh(s / x0))**2
    n = np.searchsorted(A, Am)
    s, A = s[:n + 1], A[:n + 1]
    return s[::10] if len(s) > 20 else s, A[::10] if len(A) > 20 else A

def score(g):
    gb = g[band]
    # smooth over ~1/3 octave to judge ripple the ear would notice
    k = 7
    sm = np.convolve(gb, np.ones(k) / k, mode="same")[k:-k]
    return gb.mean(), np.std(sm), gb.min()

print("v1 (rect 15000mm2, exp 600Hz, L233):",
      [round(v, 1) for v in score(h.gain_db(90 * np.exp(0.022 * np.linspace(0, 233, 240)), np.linspace(0, 233, 240), F))])
rows = []
for fc in (300, 350, 400, 450, 500, 600):
    for T in (0.5, 0.7, 1.0):
        for Dm in (120, 140, 160, 170, 180):
            s, A = hypex(fc, T, Dm)
            for baffle in (True,):
                g = h.gain_db(A, s, F, baffle)
                mean, rip, mn = score(g)
                rows.append((mean - 0.7 * rip, fc, T, Dm, round(s[-1]), mean, rip, mn))
rows.sort(reverse=True)
print("score  fc   T   Dm  L   meanGain ripple minGain")
for r in rows[:15]:
    print(f"{r[0]:5.1f} {r[1]:4} {r[2]:.1f} {r[3]:4} {r[4]:4} {r[5]:6.1f} {r[6]:6.1f} {r[7]:6.1f}")
