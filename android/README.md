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

## Not covered by automated tests

The detection logic (`Engine`) is tested on a PC with synthetic sensor data; the PC page's MQTT side is tested
against the real broker with a simulated app. The app itself has not been run on a physical phone.
