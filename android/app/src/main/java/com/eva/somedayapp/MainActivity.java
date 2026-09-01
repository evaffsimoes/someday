package com.eva.somedayapp;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private SharedPreferences.OnSharedPreferenceChangeListener prefsListener;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Handle share intent if app was opened via share sheet
        handleShareIntent(getIntent());

        // Listen for SharedPreferences changes → refresh widgets immediately
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        prefsListener = (sharedPreferences, key) -> {
            if ("shared-events".equals(key)) {
                triggerWidgetRefresh();
            }
        };
        prefs.registerOnSharedPreferenceChangeListener(prefsListener);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShareIntent(intent);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        if (prefsListener != null) prefs.unregisterOnSharedPreferenceChangeListener(prefsListener);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) || type == null) return;

        String sharedText = null;

        if (type.equals("text/plain")) {
            // Instagram shares the post URL as TEXT
            sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (type.startsWith("image/")) {
            // Image share — for now just try to get a URL from EXTRA_TEXT if present
            sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        }

        if (sharedText != null && !sharedText.isEmpty()) {
            SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            prefs.edit().putString("pending-share-intent", sharedText).apply();
            
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().post(() -> {
                    getBridge().getWebView().evaluateJavascript(
                        "if(typeof window.checkForSharedDataNative === 'function') window.checkForSharedDataNative();",
                        null
                    );
                });
            }
        }
    }

    private void triggerWidgetRefresh() {
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);

        int[] listIds = mgr.getAppWidgetIds(new ComponentName(this, CueWidgetProvider.class));
        for (int id : listIds) CueWidgetProvider.updateWidget(this, mgr, id);

        int[] calIds = mgr.getAppWidgetIds(new ComponentName(this, CueCalendarWidgetProvider.class));
        for (int id : calIds) CueCalendarWidgetProvider.updateWidget(this, mgr, id);
    }
}
