# Motion Games — Android sensor app

Reads the phone's accelerometer / gyroscope / orientation in a foreground service (so it keeps running with the
screen off) and sends the same messages as the web page's phone sensor to the PC page, through the public
HiveMQ MQTT broker.

- `Engine.java` – hit / weightless ("air") / wobble / rotation detection (a port of the web `Sensor` class)
- `Link.java` – MQTT connection. Topics: `motiongames/v1/mg-<CODE>/up` (phone → PC), `…/dn/<device>` (PC → phone), `…/all` ("who's there?")
- `SensorService.java` – foreground service, wake + Wi-Fi locks, notification
- `MainActivity.java` – enter the 6-character game code, start / stop

## Build

Needs JDK 17, Gradle 8.9 and the Android SDK (platform 34, build-tools 34.0.0). `local.properties` points at the SDK.

```
set JAVA_HOME=D:\tools\jdk17
set ANDROID_HOME=D:\tools\android-sdk
D:\tools\gradle\bin\gradle.bat -p android assembleDebug
copy android\app\build\outputs\apk\debug\app-debug.apk motiongames.apk
```

The APK is signed with the debug key in `%USERPROFILE%\.android\debug.keystore`. Keep that file: a phone can only
update the app in place if the new APK is signed with the same key.

## What has been tested

- The detection logic (`Engine`) on a PC with synthetic sensor data (knocks, throws, gyro, tilt).
- The PC page's MQTT side against the real broker with a simulated app.
- On a real Samsung Galaxy S22 (Android 16), over USB debugging: the app connects, receives the PC's settings,
  and streams ~20 frames/second to the PC **with the screen off**.
- Not yet tested on a phone: hit / throw detection by hand, and long runs while unplugged (Doze / battery limits).

## Lessons from the first phone test

- Java only tries the first address DNS returns. On a dual-stack Wi-Fi that was an IPv6 address the broker could not be
  reached on, so every connection timed out. `Link` now looks up the IPv4 address itself.
- Android rejects the broker's certificate when you connect to an IP address, so the secure routes connect by name and
  the plain route (IPv4 address, readings only) is tried first.
- Debug with `adb logcat -s MG:V` — the app logs every connection attempt, message from the PC, and hit it sends.
