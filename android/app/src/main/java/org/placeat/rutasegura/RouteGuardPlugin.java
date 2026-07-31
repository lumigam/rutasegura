package org.placeat.rutasegura;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "RouteGuard", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class RouteGuardPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestForegroundLocation(PluginCall call) {
        if (hasForegroundLocation()) { call.resolve(statusObject()); return; }
        requestPermissionForAlias("location", call, "foregroundLocationCallback");
    }

    @PermissionCallback
    private void foregroundLocationCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (!hasForegroundLocation() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.resolve(statusObject()); return; }
        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationCallback");
    }

    @PermissionCallback
    private void backgroundLocationCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        String token = call.getString("token");
        String apiBaseUrl = call.getString("apiBaseUrl");
        if (token == null || apiBaseUrl == null) { call.reject("Faltan datos de sesión"); return; }
        RouteGuardStore.saveSession(getContext(), token, apiBaseUrl);
        call.resolve();
    }

    @PluginMethod
    public void syncRoutes(PluginCall call) {
        try {
            JSArray input = call.getArray("routes", new JSArray());
            List<RouteGuardRoute> routes = new ArrayList<>();
            for (int index = 0; index < input.length(); index++) routes.add(RouteGuardRoute.fromJson(input.getJSONObject(index)));
            RouteGuardScheduler.syncGeofences(getContext(), routes);
            call.resolve(statusObject());
        } catch (Exception exception) {
            call.reject("No se pudieron sincronizar las rutas", exception);
        }
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        RouteGuardScheduler.stopAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (hasNotifications()) { call.resolve(statusObject()); return; }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void registerLiveToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                Context context = getContext();
                new Thread(() -> LiveLocationApi.registerToken(context, token)).start();
                call.resolve();
            })
            .addOnFailureListener(exception -> call.reject("No se pudo obtener el token de notificaciones", exception));
    }

    private boolean hasForegroundLocation() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNotifications() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject statusObject() {
        boolean playServices = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        return new JSObject()
            .put("foregroundLocation", hasForegroundLocation())
            .put("backgroundLocation", hasBackgroundLocation())
            .put("notifications", hasNotifications())
            .put("playServicesAvailable", playServices)
            .put("activeRouteCount", RouteGuardStore.all(getContext()).size());
    }
}
