package org.placeat.rutasegura;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import java.util.Calendar;

public class GeofenceBroadcastReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError() || event.getTriggeringGeofences() == null) return;
        int transition = event.getGeofenceTransition();
        for (Geofence geofence : event.getTriggeringGeofences()) {
            String[] parts = geofence.getRequestId().split(":", 2);
            if (parts.length != 2) continue;
            String routeId = parts[0];
            String endpoint = parts[1];
            RouteGuardRoute route = RouteGuardStore.find(context, routeId);
            if (route == null) continue;
            RouteGuardSchedule schedule = activeScheduleNow(route);
            if (schedule == null) continue;
            if ("origin".equals(endpoint) && transition == Geofence.GEOFENCE_TRANSITION_EXIT) {
                Intent service = new Intent(context, RouteGuardService.class).setAction(RouteGuardService.ACTION_START)
                    .putExtra(RouteGuardService.EXTRA_ROUTE_ID, routeId)
                    .putExtra(RouteGuardService.EXTRA_SCHEDULE_ID, schedule.id);
                ContextCompat.startForegroundService(context, service);
            } else if ("destination".equals(endpoint) && transition == Geofence.GEOFENCE_TRANSITION_ENTER) {
                Intent service = new Intent(context, RouteGuardService.class).setAction(RouteGuardService.ACTION_STOP)
                    .putExtra(RouteGuardService.EXTRA_ROUTE_ID, routeId)
                    .putExtra(RouteGuardService.EXTRA_SCHEDULE_ID, schedule.id);
                ContextCompat.startForegroundService(context, service);
            }
        }
    }

    /** The schedule whose window (scheduledTime - windowBefore .. scheduledTime + windowAfter) contains "now", or null. Geofences have no notion of a time window on their own. */
    private static RouteGuardSchedule activeScheduleNow(RouteGuardRoute route) {
        Calendar now = Calendar.getInstance();
        int day = now.get(Calendar.DAY_OF_WEEK) - 1;
        int nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        for (RouteGuardSchedule schedule : route.schedules) {
            if (!schedule.days.contains(day)) continue;
            String[] parts = schedule.time.split(":");
            int scheduledMinutes = Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
            if (nowMinutes >= scheduledMinutes - schedule.windowMinutesBefore && nowMinutes <= scheduledMinutes + schedule.windowMinutesAfter) {
                return schedule;
            }
        }
        return null;
    }
}
