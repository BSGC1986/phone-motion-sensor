package com.bsgc.motiongames;

import android.os.Handler;
import android.os.Looper;

import org.eclipse.paho.client.mqttv3.IMqttActionListener;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

import javax.net.ssl.SSLContext;

/**
 * The phone's line to the PC, through a public MQTT broker.
 * Same JSON messages as the web version:  phone → PC on  motiongames/v1/&lt;game&gt;/up,
 * PC → phone on  motiongames/v1/&lt;game&gt;/dn/&lt;device&gt;  (and /all for "who's there?").
 */
class Link implements MqttCallbackExtended {
    interface Listener {
        void onConn(String text, boolean ok);
        void onMsg(JSONObject m);
    }

    // Same public broker, three routes. If one is blocked by the network (some Wi-Fi blocks odd ports) we try the next.
    private static final String[] BROKERS = {
            "ssl://broker.hivemq.com:8883",           // MQTT over TLS
            "wss://broker.hivemq.com:8884/mqtt",      // MQTT over a secure WebSocket (what the PC's browser uses)
            "tcp://broker.hivemq.com:1883"            // plain MQTT (readings only — nothing private)
    };

    private final String base, dev;
    private final Listener ln;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MqttAsyncClient cl;
    private volatile boolean stopped;
    private int route = 0;

    /** The deepest cause, e.g. "UnknownHostException: broker.hivemq.com" — what the user actually needs to see. */
    private static String why(Throwable e) {
        Throwable t = e;
        while (t != null && t.getCause() != null && t.getCause() != t) t = t.getCause();
        if (t == null) return "unknown error";
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m != null && !m.isEmpty() ? ": " + (m.length() > 90 ? m.substring(0, 90) + "…" : m) : "");
    }

    private static String routeName(String uri) { return uri.startsWith("ssl") ? "TLS" : uri.startsWith("wss") ? "WebSocket" : "plain"; }

    /** @param gameId the host id, e.g. "mg-K7QX2M" */
    Link(String gameId, String dev, Listener ln) {
        this.base = "motiongames/v1/" + gameId;
        this.dev = dev;
        this.ln = ln;
    }

    void start() {
        stopped = false;
        connect();
    }

    private void connect() {
        if (stopped) return;
        if (cl != null) { try { cl.close(); } catch (Exception ignored) { } cl = null; }      // drop a failed attempt before retrying
        final String uri = BROKERS[route];
        try {
            cl = new MqttAsyncClient(uri, "mgp-" + dev + "-" + (int) (Math.random() * 1e6), new MemoryPersistence());
            cl.setCallback(this);
            MqttConnectOptions o = new MqttConnectOptions();
            o.setCleanSession(true);
            o.setAutomaticReconnect(true);
            o.setKeepAliveInterval(20);
            o.setConnectionTimeout(10);
            o.setWill(base + "/up", byeJson().getBytes(StandardCharsets.UTF_8), 0, false);
            if (!uri.startsWith("tcp")) o.setSocketFactory(SSLContext.getDefault().getSocketFactory());   // use Android's own TLS, not Paho's
            ln.onConn("Connecting (" + routeName(uri) + ")…", false);
            cl.connect(o, null, new IMqttActionListener() {
                @Override public void onSuccess(IMqttToken t) { /* connectComplete() does the work */ }
                @Override public void onFailure(IMqttToken t, Throwable e) { failed(uri, e); }
            });
        } catch (Throwable e) {
            failed(uri, e);
        }
    }

    private void failed(String uri, Throwable e) {
        if (stopped) return;
        route = (route + 1) % BROKERS.length;
        ln.onConn("Can't reach the game server via " + routeName(uri) + " (" + why(e) + ") — trying " + routeName(BROKERS[route]) + "…", false);
        main.postDelayed(this::connect, route == 0 ? 6000 : 1500);              // quick through the routes, then a breather
    }

    private String byeJson() {
        try { return new JSONObject().put("t", "bye").put("d", dev).toString(); } catch (Exception e) { return "{}"; }
    }

    void sendHello() {
        try { send(new JSONObject().put("t", "hello").put("app", 1)); } catch (Exception ignored) { }
    }

    void send(JSONObject m) {
        MqttAsyncClient c = cl;
        if (c == null || !c.isConnected()) return;
        try {
            m.put("d", dev);
            c.publish(base + "/up", m.toString().getBytes(StandardCharsets.UTF_8), 0, false);
        } catch (Exception ignored) { }
    }

    void stop() {
        stopped = true;
        main.removeCallbacksAndMessages(null);
        MqttAsyncClient c = cl;
        if (c == null) return;
        try {
            if (c.isConnected()) {
                c.publish(base + "/up", byeJson().getBytes(StandardCharsets.UTF_8), 0, false);
                c.disconnect(500);
            }
        } catch (Exception ignored) { }
        try { c.close(); } catch (Exception ignored) { }
        cl = null;
    }

    // ---- MqttCallbackExtended ----
    @Override public void connectComplete(boolean reconnect, String uri) {
        try {
            cl.subscribe(base + "/dn/" + dev, 0);
            cl.subscribe(base + "/all", 0);
        } catch (MqttException ignored) { }
        ln.onConn("Connected ✓ (" + routeName(uri) + ")", true);
        sendHello();
    }

    @Override public void connectionLost(Throwable cause) {
        if (!stopped) ln.onConn("Connection lost — reconnecting…", false);
    }

    @Override public void messageArrived(String topic, MqttMessage msg) {
        try {
            JSONObject m = new JSONObject(new String(msg.getPayload(), StandardCharsets.UTF_8));
            if (topic.endsWith("/all")) { if ("who".equals(m.optString("t"))) sendHello(); return; }
            ln.onMsg(m);
        } catch (Exception ignored) { }
    }

    @Override public void deliveryComplete(IMqttDeliveryToken token) { }
}
