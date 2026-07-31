package org.placeat.rutasegura;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(RouteGuardPlugin.class);
        // The channel must exist before FCM delivers a backgrounded alert, or the system drops it.
        AlertNotifications.ensureChannel(this);
        super.onCreate(savedInstanceState);
    }
}
