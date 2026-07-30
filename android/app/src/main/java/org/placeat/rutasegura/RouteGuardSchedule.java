package org.placeat.rutasegura;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class RouteGuardSchedule {
    String id;
    List<Integer> days = new ArrayList<>();
    String time;
    int windowMinutesBefore;
    int windowMinutesAfter;

    static RouteGuardSchedule fromJson(JSONObject json) throws JSONException {
        RouteGuardSchedule schedule = new RouteGuardSchedule();
        schedule.id = json.getString("id");
        JSONArray daysArray = json.getJSONArray("days");
        for (int index = 0; index < daysArray.length(); index++) schedule.days.add(daysArray.getInt(index));
        schedule.time = json.getString("time");
        schedule.windowMinutesBefore = json.optInt("windowMinutesBefore", 15);
        schedule.windowMinutesAfter = json.optInt("windowMinutesAfter", 45);
        return schedule;
    }

    JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        JSONArray daysArray = new JSONArray();
        for (int day : days) daysArray.put(day);
        json.put("days", daysArray);
        json.put("time", time);
        json.put("windowMinutesBefore", windowMinutesBefore);
        json.put("windowMinutesAfter", windowMinutesAfter);
        return json;
    }
}
