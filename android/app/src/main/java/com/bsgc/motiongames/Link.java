package com.bsgc.motiongames;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

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

import java.net.Inet4Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.SSLContext;

/**
 * The phone's line to the PC, through a public MQTT broker.
 * Same JSON messages as the web version:  phone → PC on  motiongames/v1/&lt;game&gt;/up,
 * PC → phone on  motiongames/v1/&lt;game&gt;/dn/&lt;device&gt;  (and /all for "who's there?").
 *
 * Why the IPv4 lookup: many home networks hand out IPv6 addresses but cannot actually reach the broker over IPv6,
 * and Java only tries the first address DNS returns (usually the IPv6 one), so the connection just times out.
 * Browsers retry over IPv4 automatically; here we do it ourselves.
 */
class Link implements MqttCallbackExtended {
    interface Listener {
        void onConn(String text, boolean ok);
        void onMsg(JSONObject m);
    }

    private static final String HOST = "broker.hivemq.com";
    // scheme, port, path, connect-by-IPv4-address — the same public broker, three routes. If one is blocked we try the next.
    // Plain MQTT goes first by IPv4 address (it works on networks whose IPv6 is broken; the data is only motion readings).
    // The secure routes connect by NAME, because Android only accepts the broker's certificate when it knows the name.
    private static final Object[][] ROUTES = {
            {"tcp", 1883, "", true},
            {"ssl", 8883, "", false},
            {"wss", 8884, "/mqtt", false}
    };

    private final String base, dev;
    private final Listener ln;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MqttAsyncClient cl;
    private volatile boolean stopped;
    private int route = 0;

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

    /** The deepest cause, e.g. "SocketTimeoutException: failed to connect…" — what the user actually needs to see. */
    private static String why(Throwable e) {
        Throwable t = e;
        while (t != null && t.getCause() != null && t.getCause() != t) t = t.getCause();
        if (t == null) return "unknown error";
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m != null && !m.isEmpty() ? ": " + (m.length() > 90 ? m.substring(0, 90) + "…" : m) : "");
    }

    private static String routeName(String scheme) { return scheme.equals("ssl") ? "TLS" : scheme.equals("wss") ? "WebSocket" : "plain"; }

    private void connect() {
        if (stopped) return;
        new Thread(this::connectNow, "mg-connect").start();           // DNS must not run on the main thread
    }

    private void connectNow() {
        if (stopped) return;
        if (cl != null) { try { cl.close(); } catch (Exception ignored) { } cl = null; }      // drop a failed attempt before retrying
        final String scheme = (String) ROUTES[route][0];
        final int port = (Integer) ROUTES[route][1];
        final String path = (String) ROUTES[route][2];
        final boolean byIp = (Boolean) ROUTES[route][3];

        String addr = HOST;                                            // fall back to the name if the lookup finds no IPv4
        if (byIp) {
            try {
                for (InetAddress a : InetAddress.getAllByName(HOST)) if (a instanceof Inet4Address) { addr = a.getHostAddress(); break; }
            } catch (Exception e) {
                Log.w("MG", "DNS lookup failed", e);
            }
        }
        final String uri = scheme + "://" + addr + ":" + port + path;

        try {
            cl = new MqttAsyncClient(uri, "mgp-" + dev + "-" + (int) (Math.random() * 1e6), new MemoryPersistence());
            cl.setCallback(this);
            MqttConnectOptions o = new MqttConnectOptions();
            o.setCleanSession(true);
            o.setAutomaticReconnect(true);
            o.setKeepAliveInterval(20);
            o.setConnectionTimeout(8);
            o.setWill(base + "/up", byeJson().getBytes(StandardCharsets.UTF_8), 0, false);
            if (!scheme.equals("tcp")) o.setSocketFactory(SSLContext.getDefault().getSocketFactory());        // Android's own TLS
            Log.i("MG", "connecting " + uri);
            ln.onConn("Connecting (" + routeName(scheme) + ")…", false);
            cl.connect(o, null, new IMqttActionListener() {
                @Override public void onSuccess(IMqttToken t) { /* connectComplete() does the work */ }
                @Override public void onFailure(IMqttToken t, Throwable e) { failed(uri, scheme, e); }
            });
        } catch (Throwable e) {
            failed(uri, scheme, e);
        }
    }

    private void failed(String uri, String scheme, Throwable e) {
        if (stopped) return;
        Log.w("MG", "connect failed via " + uri, e);
        route = (route + 1) % ROUTES.length;
        ln.onConn("Can't reach the game server via " + routeName(scheme) + " (" + why(e) + ") — trying " + routeName((String) ROUTES[route][0]) + "…", false);
        main.postDelayed(this::connect, route == 0 ? 6000 : 1000);     // quick through the routes, then a breather
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
        Log.i("MG", "connected via " + uri + " reconnect=" + reconnect + " base=" + base);
        ln.onConn("Connected ✓ (" + routeName(uri.substring(0, uri.indexOf(':'))) + ")", true);
        sendHello();
    }

    @Override public void connectionLost(Throwable cause) {
        Log.w("MG", "connection lost", cause);
        if (!stopped) ln.onConn("Connection lost — reconnecting…", false);
    }

    @Override public void messageArrived(String topic, MqttMessage msg) {
        try {
            JSONObject m = new JSONObject(new String(msg.getPayload(), StandardCharsets.UTF_8));
            if (topic.endsWith("/all")) { if ("who".equals(m.optString("t"))) sendHello(); return; }
            if (!"ph".equals(m.optString("t"))) Log.i("MG", "from PC: " + m.optString("t") + " " + (m.length() > 200 ? "" : m));
            ln.onMsg(m);
        } catch (Exception ignored) { }
    }

    @Override public void deliveryComplete(IMqttDeliveryToken token) { }
}
