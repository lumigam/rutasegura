package org.placeat.rutasegura;

import android.content.Context;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Talks to the /api/live/* endpoints for "ver ahora". Must be called from a background thread. */
final class LiveLocationApi {
    private LiveLocationApi() {}

    static void registerToken(Context context, String fcmToken) {
        try { post(context, "/api/live/token", new JSONObject().put("token", fcmToken)); } catch (Exception ignored) {}
    }

    static void reportLocation(Context context, String requestId, double lat, double lng) {
        try { post(context, "/api/live/location", new JSONObject().put("requestId", requestId).put("lat", lat).put("lng", lng)); } catch (Exception ignored) {}
    }

    private static void post(Context context, String path, JSONObject body) {
        JSONObject session = RouteGuardStore.session(context);
        if (session == null) return;
        HttpURLConnection connection = null;
        try {
            String apiBaseUrl = session.getString("apiBaseUrl");
            String token = session.getString("token");
            URL url = new URL(apiBaseUrl + path);
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
            // Sin conexión en este momento; "ver ahora" simplemente caducará en el backend.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
