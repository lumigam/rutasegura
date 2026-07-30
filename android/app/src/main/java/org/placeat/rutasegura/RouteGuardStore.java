package org.placeat.rutasegura;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

final class RouteGuardStore {
    private static final String PREFS = "route_guard_store";
    private static final String DATA = "encrypted_routes";
    private static final String SESSION = "encrypted_session";
    private static final String KEY_ALIAS = "rutasegura_route_guard_v1";

    private RouteGuardStore() {}

    static synchronized List<RouteGuardRoute> all(Context context) {
        List<RouteGuardRoute> result = new ArrayList<>();
        try {
            String encrypted = prefs(context).getString(DATA, null);
            if (encrypted == null) return result;
            JSONArray array = new JSONArray(decrypt(encrypted));
            for (int index = 0; index < array.length(); index++) result.add(RouteGuardRoute.fromJson(array.getJSONObject(index)));
        } catch (Exception ignored) {
            prefs(context).edit().remove(DATA).apply();
        }
        return result;
    }

    static synchronized RouteGuardRoute find(Context context, String routeId) {
        for (RouteGuardRoute route : all(context)) if (route.id.equals(routeId)) return route;
        return null;
    }

    static synchronized void replaceAll(Context context, List<RouteGuardRoute> routes) {
        try {
            JSONArray array = new JSONArray();
            for (RouteGuardRoute route : routes) array.put(route.toJson());
            prefs(context).edit().putString(DATA, encrypt(array.toString())).apply();
        } catch (Exception exception) {
            throw new IllegalStateException("No se pudieron proteger las rutas", exception);
        }
    }

    static synchronized void saveSession(Context context, String token, String apiBaseUrl) {
        try {
            JSONObject session = new JSONObject().put("token", token).put("apiBaseUrl", apiBaseUrl);
            prefs(context).edit().putString(SESSION, encrypt(session.toString())).apply();
        } catch (Exception exception) {
            throw new IllegalStateException("No se pudo guardar la sesión", exception);
        }
    }

    static synchronized JSONObject session(Context context) {
        try {
            String encrypted = prefs(context).getString(SESSION, null);
            if (encrypted == null) return null;
            return new JSONObject(decrypt(encrypted));
        } catch (Exception ignored) {
            return null;
        }
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }

    private static String decrypt(String encrypted) throws Exception {
        String[] parts = encrypted.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
