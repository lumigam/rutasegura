package org.placeat.rutasegura;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Route alerts (departure, arrival, deviation, delay) shown on the tutor's phone. */
final class AlertNotifications {
    static final String CHANNEL_ID = "route_alerts_v1";

    private AlertNotifications() {}

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Avisos de ruta", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Salida, llegada, desvío del camino y retrasos");
        manager.createNotificationChannel(channel);
    }

    static void show(Context context, String title, String body, String tag) {
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title != null ? title : "Ruta Segura")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending);
        try {
            NotificationManagerCompat.from(context).notify(tag != null ? tag : "ruta", 1, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission not granted; the in-app list still reflects the trip state.
        }
    }
}
