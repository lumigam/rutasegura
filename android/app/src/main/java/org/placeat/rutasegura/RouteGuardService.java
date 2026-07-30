package org.placeat.rutasegura;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import android.app.Service;

public class RouteGuardService extends Service {
    static final String CHANNEL_ID = "route_guard_tracking_v1";
    static final int NOTIFICATION_ID = 927410;
    static final String ACTION_START = "org.placeat.rutasegura.START_TRIP";
    static final String ACTION_STOP = "org.placeat.rutasegura.STOP_TRIP";
    static final String EXTRA_ROUTE_ID = "routeId";
    static final String EXTRA_SCHEDULE_ID = "scheduleId";

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private String routeId;
    private String scheduleId;
    private int outsideCorridorCount = 0;
    private boolean deviatedReported = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel(this);
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            report("ARRIVED", null);
            stopTracking();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            routeId = intent.getStringExtra(EXTRA_ROUTE_ID);
            scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID);
            outsideCorridorCount = 0;
            deviatedReported = false;
            startForeground(NOTIFICATION_ID, notification());
            report("DEPARTED", null);
            startTracking();
        }
        return START_STICKY;
    }

    private void startTracking() {
        client = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 30_000L)
            .setMinUpdateIntervalMillis(20_000L)
            .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location != null) checkCorridor(location);
            }
        };
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper());
        } catch (SecurityException ignored) {}
    }

    private void checkCorridor(Location location) {
        RouteGuardRoute route = RouteGuardStore.find(this, routeId);
        if (route == null) return;
        double distance = RouteGuardGeometry.distanceToPolylineMeters(location.getLatitude(), location.getLongitude(), route.corridorPoints);
        if (distance > route.corridorWidthMeters) {
            outsideCorridorCount++;
            if (outsideCorridorCount >= 3 && !deviatedReported) {
                deviatedReported = true;
                report("DEVIATED", location);
            }
        } else {
            outsideCorridorCount = 0;
        }
    }

    private void report(String type, @Nullable Location location) {
        Double lat = location != null ? location.getLatitude() : null;
        Double lng = location != null ? location.getLongitude() : null;
        String reportedScheduleId = scheduleId;
        Context context = this;
        new Thread(() -> RouteGuardApi.reportEvent(context, reportedScheduleId, type, lat, lng)).start();
    }

    private void stopTracking() {
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private Notification notification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Ruta Segura")
            .setContentText("Siguiendo la ruta en curso.")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Seguimiento de ruta", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Aviso mientras se sigue una ruta programada");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        stopTracking();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
