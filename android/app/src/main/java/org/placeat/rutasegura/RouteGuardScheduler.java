package org.placeat.rutasegura;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import java.util.ArrayList;
import java.util.List;

final class RouteGuardScheduler {
    private RouteGuardScheduler() {}
    private static final float GEOFENCE_RADIUS_METERS = 120f;

    static void syncGeofences(Context context, List<RouteGuardRoute> routes) {
        RouteGuardStore.replaceAll(context, routes);
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        GeofencingClient client = LocationServices.getGeofencingClient(context);
        client.removeGeofences(pendingIntent(context));
        List<Geofence> geofences = new ArrayList<>();
        for (RouteGuardRoute route : routes) {
            if (route.corridorPoints.size() < 2) continue;
            geofences.add(buildGeofence(route.id + ":origin", route.originLat, route.originLng));
            geofences.add(buildGeofence(route.id + ":destination", route.destLat, route.destLng));
        }
        if (geofences.isEmpty()) return;
        GeofencingRequest request = new GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofences(geofences)
            .build();
        try {
            client.addGeofences(request, pendingIntent(context));
        } catch (SecurityException ignored) {}
    }

    static void restore(Context context) {
        List<RouteGuardRoute> routes = RouteGuardStore.all(context);
        if (!routes.isEmpty()) syncGeofences(context, routes);
    }

    static void stopAll(Context context) {
        LocationServices.getGeofencingClient(context).removeGeofences(pendingIntent(context));
        RouteGuardStore.clear(context);
    }

    private static Geofence buildGeofence(String requestId, double lat, double lng) {
        return new Geofence.Builder()
            .setRequestId(requestId)
            .setCircularRegion(lat, lng, GEOFENCE_RADIUS_METERS)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
            .build();
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, GeofenceBroadcastReceiver.class).setAction("org.placeat.rutasegura.GEOFENCE_EVENT");
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }
}
