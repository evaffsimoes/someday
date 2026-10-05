package com.eva.somedayapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/** Scrollable list of upcoming events; rows come from CueWidgetService. */
public class CueWidgetProvider extends AppWidgetProvider {

    static final String PREFS_NAME = "CapacitorStorage";
    static final String EVENTS_KEY = "shared-events";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
        // Periodic updates also refresh "Today" / "In 3 days" labels
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        // Rows come from the service; a unique data URI keeps one adapter per widget
        Intent serviceIntent = new Intent(context, CueWidgetService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, serviceIntent);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent openApp = PendingIntent.getActivity(
                context, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_header, openApp);
            views.setOnClickPendingIntent(R.id.widget_empty, openApp);

            // Each row fills in its event id; the template must be mutable to accept those extras
            Intent rowIntent = new Intent(launchIntent);
            rowIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int mutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent rowTemplate = PendingIntent.getActivity(
                context, appWidgetId + 5000, rowIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | mutable
            );
            views.setPendingIntentTemplate(R.id.widget_list, rowTemplate);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /** Re-reads events into every list widget (called when the app saves events). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, CueWidgetProvider.class));
        if (ids.length == 0) return;
        for (int id : ids) updateWidget(context, manager, id);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}
