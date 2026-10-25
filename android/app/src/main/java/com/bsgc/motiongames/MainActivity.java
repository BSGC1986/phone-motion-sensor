package com.bsgc.motiongames;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Enter the 6-character game code, press Start, and the sensor keeps running with the screen off. */
public class MainActivity extends Activity {
    private EditText code;
    private Button go, battery;
    private TextView team, game, big, sub, conn, help;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            boolean on = SensorService.running;
            go.setText(on ? "Stop sensor" : "Start sensor");
            code.setEnabled(!on);
            conn.setText(on ? SensorService.stConn : "Not running");
            team.setText(on ? SensorService.stTeam : "");
            try { team.setTextColor(Color.parseColor(SensorService.stColor)); } catch (Exception ignored) { team.setTextColor(Color.WHITE); }
            game.setText(on ? SensorService.stGame : "");
            big.setText(on ? SensorService.stBig : "");
            sub.setText(on ? SensorService.stSub : "");
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            battery.setVisibility(on && !pm.isIgnoringBatteryOptimizations(getPackageName()) ? View.VISIBLE : View.GONE);
            ui.postDelayed(this, 500);
        }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("mg", MODE_PRIVATE);
        int pad = dp(18);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad + dp(8), pad, pad);
        root.setBackgroundColor(Color.parseColor("#0F1115"));

        root.addView(text("Motion Games", 22, Color.parseColor("#FFB547"), true));
        root.addView(text("Sensor app — keeps working with the screen off.", 14, Color.parseColor("#8A92A3"), false));

        root.addView(space(16));
        root.addView(text("Game code", 13, Color.parseColor("#8A92A3"), false));
        code = new EditText(this);
        code.setHint("e.g. K7QX2M");
        code.setHintTextColor(Color.parseColor("#4A5060"));
        code.setTextColor(Color.WHITE);
        code.setTextSize(30);
        code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        code.setSingleLine(true);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        code.setFilters(new InputFilter[]{new InputFilter.AllCaps(), new InputFilter.LengthFilter(9)});
        code.setText(prefs.getString("code", ""));
        root.addView(code);

        go = new Button(this);
        go.setAllCaps(false);
        go.setTextSize(18);
        go.setOnClickListener(v -> { if (SensorService.running) stop(); else start(); });
        root.addView(go, lp(dp(8)));

        battery = new Button(this);
        battery.setAllCaps(false);
        battery.setText("Allow running in the background (important)");
        battery.setOnClickListener(v -> askBatteryExemption());
        battery.setVisibility(View.GONE);
        root.addView(battery);

        root.addView(space(18));
        conn = text("Not running", 14, Color.parseColor("#8A92A3"), true);
        root.addView(conn);
        team = text("", 26, Color.WHITE, true);
        root.addView(team);
        game = text("", 16, Color.parseColor("#C3C9D6"), false);
        root.addView(game);
        big = text("", 56, Color.WHITE, true);
        big.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(big);
        sub = text("", 15, Color.parseColor("#C3C9D6"), false);
        sub.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(sub);

        root.addView(space(20));
        help = text("1. On the PC, start a game and note its 6-character code.\n"
                + "2. Type the code above and press Start.\n"
                + "3. Put the phone in the ball. You can switch the screen off — the sensor keeps running, "
                + "and a notification shows while it does.\n\n"
                + "If a phone stops sending when the screen is off, press \"Allow running in the background\" "
                + "and set this app to \"Unrestricted\" in the phone's battery settings.", 13, Color.parseColor("#8A92A3"), false);
        root.addView(help);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#0F1115"));
        sv.addView(root);
        setContentView(sv);
        handle(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); handle(i); }
    @Override protected void onResume() { super.onResume(); ui.post(refresh); }
    @Override protected void onPause() { super.onPause(); ui.removeCallbacks(refresh); }

    /** motiongames://join/K7QX2M  — from the web page's "Open the app" link. */
    private void handle(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && "motiongames".equals(d.getScheme())) {
            String c = normalize(d.getLastPathSegment());
            if (c != null) { code.setText(c); if (!SensorService.running) start(); }
        }
    }

    /** "k7q x2m", "MG-K7QX2M" → "K7QX2M"; null if it isn't a 6-character code. */
    static String normalize(String s) {
        if (s == null) return null;
        String c = s.toUpperCase(java.util.Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (c.length() == 8 && c.startsWith("MG")) c = c.substring(2);
        return c.length() == 6 ? c : null;
    }

    private void start() {
        String c = normalize(code.getText().toString());
        if (c == null) { code.setError("Enter the 6-character code shown on the PC"); return; }
        prefs.edit().putString("code", c).apply();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);   // optional: the sensor runs either way
        Intent s = new Intent(this, SensorService.class).putExtra(SensorService.EXTRA_GAME, "mg-" + c);
        startForegroundService(s);
        ui.post(refresh);
    }

    private void stop() {
        stopService(new Intent(this, SensorService.class));
        ui.postDelayed(refresh, 300);
    }

    private void askBatteryExemption() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    // ---- tiny view helpers ----
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private View space(int h) { View v = new View(this); v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h))); return v; }
    private LinearLayout.LayoutParams lp(int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top; return p;
    }
    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(sp); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }
}
