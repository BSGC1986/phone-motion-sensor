package com.bsgc.motiongames;

import android.hardware.SensorManager;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Turns raw Android sensor readings into the same messages the web page's phone sensor sends:
 * a 20 Hz "f" frame, plus "hit" (a bounce / knock) and "air" (weightless: thrown or dropped) events.
 * All timestamps are milliseconds from the sensor event clock.
 */
class Engine {
    interface Out { void send(JSONObject m); }

    private static final double G = 9.81, DEG = 180.0 / Math.PI;

    private final Out out;

    // settings the host can change (written from the network thread, read on the sensor thread)
    volatile double thr = 2.5, gapMs = 200, airThr = 0.5, sw = 250;
    volatile boolean hasLinear = false;

    // running totals and latest readings
    private double rot, wob, gmax = 0, gmin = 99, g = 1;
    private double ax, ay, az = G, lx, ly, lz, ra, rb, rg;
    private double beta, gamma, alpha;
    private double[] grav;
    private double lastAccelT, lastGyroT, lastFrameT;

    // hit detection
    private boolean rearm = true;
    private double lastHit = -1e9, pendT0, pendPeak;
    private boolean pending;

    // weightless detection
    private double airStart;
    private int airN;

    // swing detection
    private static class Swing {
        double t0, pk, tPk, acc, ang, tw, twPk, quiet;
        double[] ax = new double[3], g0, g1;
        boolean sat;
        java.util.ArrayList<Double> tr = new java.util.ArrayList<>();
    }
    private Swing swg;
    private double swEnd = -1e9, wmax;

    Engine(Out out) { this.out = out; }

    void onAccel(float[] v, double now) {
        double dt = lastAccelT > 0 ? Math.min(now - lastAccelT, 100) / 1000.0 : 0.016;
        lastAccelT = now;
        ax = v[0]; ay = v[1]; az = v[2];
        g = Math.sqrt(ax * ax + ay * ay + az * az) / G;
        wob += Math.abs(g - 1) * dt;
        if (g > gmax) gmax = g;
        if (g < gmin) gmin = g;

        if (grav == null) grav = new double[]{ax, ay, az};
        double k = 1 - Math.exp(-dt / 0.15);                      // slow average = gravity
        grav[0] += (ax - grav[0]) * k; grav[1] += (ay - grav[1]) * k; grav[2] += (az - grav[2]) * k;
        if (!hasLinear) { lx = ax - grav[0]; ly = ay - grav[1]; lz = az - grav[2]; }

        // a bounce / knock: force rises above the trigger, counted once until it settles again
        if (pending) {
            if (g > pendPeak) pendPeak = g;
            if (now - pendT0 >= 40) commitHit();
        }
        if (!rearm && g < thr * 0.7 && now - lastHit > gapMs) rearm = true;
        if (rearm && !pending && g > thr && now - lastHit > gapMs) {
            pending = true; pendT0 = now; pendPeak = g; rearm = false; lastHit = now;
        }

        // weightless: force falls well below 1 g (thrown, dropped, in free fall)
        if (g < airThr) {
            if (airStart == 0) { airStart = now; airN = 0; }
            airN++;
        } else if (airStart != 0) {
            double ms = now - airStart;
            if (airN >= 4 && ms >= 100) {
                JSONObject m = new JSONObject();
                try { m.put("t", "air"); m.put("ms", Math.round(ms)); } catch (JSONException ignored) { }
                out.send(m);
            }
            airStart = 0;
        }

        if (lastFrameT == 0) lastFrameT = now;
        if (now - lastFrameT >= 50) frame(now);
    }

    void onGyro(float[] v, double now) {
        double dt = lastGyroT > 0 ? Math.min(now - lastGyroT, 100) / 1000.0 : 0.016;
        lastGyroT = now;
        // Android: x, y, z in rad/s.  Web: alpha = about z, beta = about x, gamma = about y, in deg/s.
        ra = v[2] * DEG; rb = v[0] * DEG; rg = v[1] * DEG;
        rot += Math.sqrt(ra * ra + rb * rb + rg * rg) * dt;
        swing(now, dt);
    }

    private double[] gravUnit() {
        double[] g = grav == null ? new double[]{0, 0, G} : grav;
        double m = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]); if (m == 0) m = 1;
        return new double[]{g[0] / m, g[1] / m, g[2] / m};
    }

    /**
     * A swing = the phone spinning faster than `sw` degrees/second, then settling again. One summary message per swing
     * (same fields as the web page): peak speed, when it peaked, duration, total turn, peak acceleration, twist,
     * axis of rotation, gravity at start and at the peak, and a 16-point speed curve.
     */
    private void swing(double now, double dt) {
        double w = Math.sqrt(ra * ra + rb * rb + rg * rg), acc = Math.sqrt(lx * lx + ly * ly + lz * lz), start = sw;
        if (w > wmax) wmax = w;
        Swing S = swg;
        if (S == null) {
            if (w <= start || now - swEnd < 250) return;
            S = swg = new Swing();
            S.t0 = now; S.pk = w; S.tPk = now; S.acc = acc; S.g0 = gravUnit();
        }
        S.ang += w * dt;
        S.ax[0] += rb * dt; S.ax[1] += rg * dt; S.ax[2] += ra * dt;
        S.tw += rg * dt;
        if (acc > S.acc) S.acc = acc;
        if (w >= 1950) S.sat = true;
        if (w > S.pk) { S.pk = w; S.tPk = now; S.twPk = S.tw; S.g1 = gravUnit(); }
        if (S.tr.size() < 200) S.tr.add(w);
        S.quiet = w < start * 0.5 ? S.quiet + dt * 1000 : 0;
        if (S.quiet < 50 && now - S.t0 < 1600) return;
        swg = null; swEnd = now;
        double dur = now - S.t0;
        if (S.pk < start * 1.4 || dur < 70) return;
        double am = Math.sqrt(S.ax[0] * S.ax[0] + S.ax[1] * S.ax[1] + S.ax[2] * S.ax[2]); if (am == 0) am = 1;
        try {
            JSONObject m = new JSONObject();
            m.put("t", "swing"); m.put("pk", Math.round(S.pk)); m.put("at", Math.round(S.tPk)); m.put("dur", Math.round(dur));
            m.put("tpk", Math.round(S.tPk - S.t0)); m.put("ang", Math.round(S.ang)); m.put("acc", round(S.acc, 1)); m.put("tw", Math.round(S.twPk));
            m.put("ax", new org.json.JSONArray().put(round(S.ax[0] / am, 2)).put(round(S.ax[1] / am, 2)).put(round(S.ax[2] / am, 2)));
            double[] g1 = S.g1 == null ? S.g0 : S.g1;
            m.put("g0", new org.json.JSONArray().put(round(S.g0[0], 2)).put(round(S.g0[1], 2)).put(round(S.g0[2], 2)));
            m.put("g1", new org.json.JSONArray().put(round(g1[0], 2)).put(round(g1[1], 2)).put(round(g1[2], 2)));
            m.put("sat", S.sat);
            int n = 16, len = S.tr.size();
            org.json.JSONArray tr = new org.json.JSONArray();
            for (int i = 0; i < n; i++) {
                int lo = i * len / n, hi = Math.max((i + 1) * len / n, lo + 1); double mx = 0;
                for (int k = lo; k < hi && k < len; k++) mx = Math.max(mx, S.tr.get(k));
                tr.put(Math.round(mx / 10));
            }
            m.put("tr", tr);
            out.send(m);
        } catch (JSONException ignored) { }
    }

    void onLinear(float[] v) { lx = v[0]; ly = v[1]; lz = v[2]; }

    /** Rotation vector → the web's alpha / beta / gamma (degrees). */
    void onRotation(float[] vec) {
        float[] r = new float[9];
        SensorManager.getRotationMatrixFromVector(r, vec);
        beta = Math.asin(Math.max(-1, Math.min(1, r[7]))) * DEG;
        gamma = Math.atan2(-r[6], r[8]) * DEG;
        alpha = Math.atan2(-r[1], r[4]) * DEG;
        if (alpha < 0) alpha += 360;
    }

    private void commitHit() {
        pending = false;
        JSONObject m = new JSONObject();
        try { m.put("t", "hit"); m.put("g", round(pendPeak, 2)); } catch (JSONException ignored) { }
        out.send(m);
    }

    private void frame(double now) {
        if (pending && now - pendT0 >= 40) commitHit();
        JSONObject f = new JSONObject();
        try {
            f.put("t", "f");
            f.put("dt", Math.round(now - lastFrameT));
            f.put("gx", round(gmax, 2));
            f.put("gn", round(Math.min(gmin, 9), 2));
            f.put("b", round(beta, 1)); f.put("c", round(gamma, 1)); f.put("al", Math.round(alpha));
            f.put("rot", round(rot, 1)); f.put("wob", round(wob, 3));
            f.put("air", airN >= 3 && airStart != 0);
            f.put("v", 1);
            f.put("ax", round(ax, 2)); f.put("ay", round(ay, 2)); f.put("az", round(az, 2));
            f.put("lx", round(lx, 2)); f.put("ly", round(ly, 2)); f.put("lz", round(lz, 2));
            f.put("ra", Math.round(ra)); f.put("rb", Math.round(rb)); f.put("rg", Math.round(rg));
            f.put("wm", Math.round(wmax));
        } catch (JSONException ignored) { }
        lastFrameT = now; gmax = g; gmin = g; wmax = 0;
        out.send(f);
    }

    private static double round(double v, int places) {
        double p = Math.pow(10, places);
        return Math.round(v * p) / p;
    }
}
