package org.placeat.rutasegura;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class RouteGuardRoute {
    String id;
    double originLat;
    double originLng;
    double destLat;
    double destLng;
    final List<double[]> corridorPoints = new ArrayList<>();
    int corridorWidthMeters;
    String mode = "WALK";
    final List<RouteGuardSchedule> schedules = new ArrayList<>();

    static RouteGuardRoute fromJson(JSONObject json) throws JSONException {
        RouteGuardRoute route = new RouteGuardRoute();
        route.id = json.getString("id");
        route.mode = json.optString("mode", "WALK");
        JSONArray points = json.getJSONArray("points");
        for (int index = 0; index < points.length(); index++) {
            JSONObject point = points.getJSONObject(index);
            route.corridorPoints.add(new double[] { point.getDouble("lat"), point.getDouble("lng") });
        }
        if (!route.corridorPoints.isEmpty()) {
            double[] first = route.corridorPoints.get(0);
            double[] last = route.corridorPoints.get(route.corridorPoints.size() - 1);
            route.originLat = first[0];
            route.originLng = first[1];
            route.destLat = last[0];
            route.destLng = last[1];
        }
        route.corridorWidthMeters = json.getInt("corridorWidthMeters");
        JSONArray schedules = json.getJSONArray("schedules");
        for (int index = 0; index < schedules.length(); index++) route.schedules.add(RouteGuardSchedule.fromJson(schedules.getJSONObject(index)));
        return route;
    }

    JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("mode", mode);
        JSONArray points = new JSONArray();
        for (double[] point : corridorPoints) points.put(new JSONObject().put("lat", point[0]).put("lng", point[1]));
        json.put("points", points);
        json.put("corridorWidthMeters", corridorWidthMeters);
        JSONArray schedulesJson = new JSONArray();
        for (RouteGuardSchedule schedule : schedules) schedulesJson.put(schedule.toJson());
        json.put("schedules", schedulesJson);
        return json;
    }
}
