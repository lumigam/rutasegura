package org.placeat.rutasegura;

import android.content.Context;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Reports a trip event directly to the backend. Must be called from a background thread. */
final class RouteGuardApi {
    private RouteGuardApi() {}

    static void reportEvent(Context context, String scheduleId, String type, Double lat, Double lng) {
        JSONObject session = RouteGuardStore.session(context);
        if (session == null || scheduleId == null) return;
        HttpURLConnection connection = null;
        try {
            String apiBaseUrl = session.getString("apiBaseUrl");
            String token = session.getString("token");
            JSONObject body = new JSONObject().put("scheduleId", scheduleId).put("type", type);
            if (lat != null) body.put("lat", lat);
            if (lng != null) body.put("lng", lng);
            URL url = new URL(apiBaseUrl + "/api/trips/events");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setDoOutput(true);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            connection.getResponseCode();
        } catch (Exception ignored) {
            // Sin conexión en este momento; la próxima comprobación programada del servidor sigue adelante igualmente.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
