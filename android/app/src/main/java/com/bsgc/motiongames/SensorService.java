package com.bsgc.motiongames;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

/**
 * Keeps reading the sensors and talking to the PC with the screen off.
 * It runs as a foreground service (the permanent notification) and holds a CPU and Wi-Fi lock.
 */
public class SensorService extends Service implements SensorEventListener {
    static final String ACTION_STOP = "com.bsgc.motiongames.STOP";
    static final String EXTRA_GAME = "game";            // e.g. "mg-K7QX2M"
    private static final String CHANNEL = "motiongames";
    private static final int NOTIF_ID = 1;

    // what the activity shows (written here, read by MainActivity)
    static volatile boolean running;
    static volatile String stConn = "Stopped", stTeam = "", stColor = "#ffffff", stGame = "", stBig = "", stSub = "";

    private SensorManager sm;
    private HandlerThread thread;
    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;
    private Engine engine;
    private Link link;
    private long lastNotify;
    private boolean linearOk;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        SharedPreferences p = getSharedPreferences("mg", MODE_PRIVATE);
        String game = intent != null ? intent.getStringExtra(EXTRA_GAME) : null;
        if (game == null) game = p.getString("game", null);           // restarted by the system after being killed
        if (game == null) { stopSelf(); return START_NOT_STICKY; }
        p.edit().putString("game", game).apply();
        if (running) return START_STICKY;
        running = true;

        createChannel();
        Notification n = buildNotification("Starting…", "Joining game " + game.replace("mg-", ""));
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIF_ID, n);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "motiongames:sensors");
        cpuLock.acquire();
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "motiongames:wifi");
        wifiLock.acquire();

        String dev = p.getString("dev", null);
        if (dev == null) { dev = Long.toString((long) (Math.random() * 1e12), 36); p.edit().putString("dev", dev).apply(); }

        link = new Link(game, dev, new Link.Listener() {
            @Override public void onConn(String text, boolean ok) { stConn = text; }
            @Override public void onMsg(JSONObject m) { onHost(m); }
        });
        engine = new Engine(m -> {
            if (!"f".equals(m.optString("t"))) android.util.Log.i("MG", "send " + m);       // hits and throws (frames are too frequent to log)
            link.send(m);
        });

        thread = new HandlerThread("sensors");
        thread.start();
        Handler h = new Handler(thread.getLooper());
        sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        int us = 5000;                                                // ~200 Hz: sharper swing peaks and hit timing (frames to the PC stay at 20 Hz)
        reg(Sensor.TYPE_ACCELEROMETER, us, h);
        reg(Sensor.TYPE_GYROSCOPE, us, h);
        linearOk = reg(Sensor.TYPE_LINEAR_ACCELERATION, us, h);
        engine.hasLinear = linearOk;
        if (!reg(Sensor.TYPE_GAME_ROTATION_VECTOR, us, h)) reg(Sensor.TYPE_ROTATION_VECTOR, us, h);

        android.util.Log.i("MG", "service started for " + game + " dev=" + dev + " sensors: accel=" + (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
                + " gyro=" + (sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null) + " linear=" + linearOk
                + " rot=" + (sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR) != null) + " cpuLock=" + cpuLock.isHeld() + " wifiLock=" + wifiLock.isHeld());
        link.start();
        return START_STICKY;
    }

    private boolean reg(int type, int us, Handler h) {
        Sensor s = sm.getDefaultSensor(type);
        return s != null && sm.registerListener(this, s, us, h);
    }

    // ---- sensor callbacks (run on the "sensors" thread) ----
    @Override public void onSensorChanged(SensorEvent e) {
        double now = e.timestamp / 1e6;
        switch (e.sensor.getType()) {
            case Sensor.TYPE_ACCELEROMETER: engine.onAccel(e.values, now); break;
            case Sensor.TYPE_GYROSCOPE: engine.onGyro(e.values, now); break;
            case Sensor.TYPE_LINEAR_ACCELERATION: engine.onLinear(e.values); break;
            case Sensor.TYPE_GAME_ROTATION_VECTOR:
            case Sensor.TYPE_ROTATION_VECTOR: engine.onRotation(e.values); break;
        }
    }
    @Override public void onAccuracyChanged(Sensor s, int a) { }

    // ---- messages from the PC ----
    private void onHost(JSONObject m) {
        switch (m.optString("t")) {
            case "cfg": {
                JSONObject c = m.optJSONObject("cfg");
                if (c != null && engine != null) {
                    engine.thr = c.optDouble("thr", engine.thr);
                    engine.gapMs = c.optDouble("gap", engine.gapMs);
                    engine.airThr = c.optDouble("air", engine.airThr);
                    engine.sw = c.optDouble("sw", engine.sw);
                }
                break;
            }
            case "mode":
                stGame = m.optString("id").isEmpty() || "null".equals(m.optString("id")) ? "" : (m.optString("emoji") + " " + m.optString("title")).trim();
                if ("break".equals(m.optString("id")) || "final".equals(m.optString("id"))) stGame = (m.optString("emoji") + " " + m.optString("title")).trim();
                break;
            case "ph":
                stTeam = m.optString("name"); stColor = m.optString("color", "#ffffff");
                stBig = m.isNull("big") ? "" : String.valueOf(m.opt("big")); stSub = m.optString("sub");
                notifyThrottled();
                break;
        }
    }

    private void notifyThrottled() {
        long now = System.currentTimeMillis();
        if (now - lastNotify < 1000) return;
        lastNotify = now;
        String title = (stTeam.isEmpty() ? "Motion Games" : stTeam) + (stGame.isEmpty() ? "" : " · " + stGame);
        String text = (stBig.isEmpty() ? "" : stBig + "  ") + stSub;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, buildNotification(title, text.isEmpty() ? stConn : text));
    }

    // ---- notification ----
    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Sensor running", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
    }

    private Notification buildNotification(String title, String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, SensorService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title).setContentText(text)
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat), "Stop", stopPi).build())
                .build();
    }

    @Override public void onDestroy() {
        android.util.Log.i("MG", "service stopped");
        running = false; stConn = "Stopped";
        if (sm != null) sm.unregisterListener(this);
        if (thread != null) thread.quitSafely();
        if (link != null) link.stop();
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        super.onDestroy();
    }
}
