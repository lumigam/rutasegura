package org.placeat.rutasegura;

import java.util.List;

/** Point-to-polyline distance in meters, using a local equirectangular projection — accurate enough for a short walking route. */
final class RouteGuardGeometry {
    private RouteGuardGeometry() {}
    private static final double EARTH_RADIUS_METERS = 6_371_000;

    static double distanceToPolylineMeters(double lat, double lng, List<double[]> points) {
        if (points.isEmpty()) return Double.MAX_VALUE;
        if (points.size() == 1) return haversine(lat, lng, points.get(0)[0], points.get(0)[1]);
        double refLat = Math.toRadians(points.get(0)[0]);
        double[] p = project(lat, lng, refLat);
        double min = Double.MAX_VALUE;
        for (int index = 0; index < points.size() - 1; index++) {
            double[] a = project(points.get(index)[0], points.get(index)[1], refLat);
            double[] b = project(points.get(index + 1)[0], points.get(index + 1)[1], refLat);
            min = Math.min(min, distanceToSegment(p, a, b));
        }
        return min;
    }

    private static double[] project(double lat, double lng, double refLat) {
        double x = Math.toRadians(lng) * Math.cos(refLat) * EARTH_RADIUS_METERS;
        double y = Math.toRadians(lat) * EARTH_RADIUS_METERS;
        return new double[] { x, y };
    }

    private static double distanceToSegment(double[] p, double[] a, double[] b) {
        double dx = b[0] - a[0], dy = b[1] - a[1];
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared == 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        double t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
        double projX = a[0] + t * dx, projY = a[1] + t * dy;
        return Math.hypot(p[0] - projX, p[1] - projY);
    }

    private static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1), dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
