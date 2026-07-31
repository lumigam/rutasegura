package org.placeat.rutasegura;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Receives a silent FCM data message asking for a one-off fresh location fix ("ver ahora"). */
public class LocateMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        Context context = getApplicationContext();
        new Thread(() -> LiveLocationApi.registerToken(context, token)).start();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        // Route alerts arrive with a notification payload, which the system shows by itself while the
        // app is backgrounded; in the foreground it lands here instead and we have to post it ourselves.
        RemoteMessage.Notification notification = message.getNotification();
        if (notification != null) {
            AlertNotifications.show(getApplicationContext(), notification.getTitle(), notification.getBody(), data.get("tag"));
            return;
        }
        if (!"LOCATE_REQUEST".equals(data.get("type"))) return;
        String requestId = data.get("requestId");
        if (requestId == null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;

        Context context = getApplicationContext();
        FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(this);
        CancellationTokenSource cancellationSource = new CancellationTokenSource();
        try {
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setDurationMillis(15_000L)
                .build();
            client.getCurrentLocation(request, cancellationSource.getToken())
                .addOnSuccessListener(location -> {
                    if (location != null) new Thread(() -> LiveLocationApi.reportLocation(context, requestId, location.getLatitude(), location.getLongitude())).start();
                    else fallbackToLastLocation(client, context, requestId);
                })
                .addOnFailureListener(exception -> fallbackToLastLocation(client, context, requestId));
        } catch (SecurityException ignored) {}
    }

    private void fallbackToLastLocation(FusedLocationProviderClient client, Context context, String requestId) {
        try {
            client.getLastLocation().addOnSuccessListener(location -> {
                if (location != null) new Thread(() -> LiveLocationApi.reportLocation(context, requestId, location.getLatitude(), location.getLongitude())).start();
            });
        } catch (SecurityException ignored) {}
    }
}
