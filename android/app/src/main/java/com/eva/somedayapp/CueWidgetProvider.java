package com.eva.somedayapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public class CueWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String EVENTS_KEY = "shared-events";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        // Tap opens app
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
        }

        // Load events from Capacitor SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String eventsJson = prefs.getString(EVENTS_KEY, null);

        if (eventsJson == null || eventsJson.isEmpty()) {
            views.setTextViewText(R.id.widget_artist, "No upcoming events");
            views.setTextViewText(R.id.widget_date_loc, "Open cue to add events");
            views.setTextViewText(R.id.widget_days_badge, "");
            views.setTextViewText(R.id.widget_next, "");
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        try {
            JSONArray all = new JSONArray(eventsJson);
            String todayStr = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date());

            // Find upcoming events (startDate >= today)
            JSONArray upcoming = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject ev = all.getJSONObject(i);
                String checkDate = ev.optString("endDate", ev.optString("startDate", ""));
                if (!checkDate.isEmpty() && checkDate.compareTo(todayStr) >= 0) {
                    upcoming.put(ev);
                }
            }

            // Sort by startDate (already sorted in app, but double-check first two)
            if (upcoming.length() == 0) {
                views.setTextViewText(R.id.widget_artist, "No upcoming events");
                views.setTextViewText(R.id.widget_date_loc, "Open cue to add one");
                views.setTextViewText(R.id.widget_days_badge, "");
                views.setTextViewText(R.id.widget_next, "");
            } else {
                JSONObject next = upcoming.getJSONObject(0);
                String artist = next.optString("artist", next.optString("name", "Event"));
                String startDate = next.optString("startDate", "");
                String venue = next.optString("venue", "");
                String city = next.optString("city", "");

                // Days until
                String badge = "";
                if (!startDate.isEmpty()) {
                    try {
                        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                        Date eventDate = sdf.parse(startDate);
                        Date now = new Date();
                        long diffMs = eventDate.getTime() - now.getTime();
                        long days = TimeUnit.MILLISECONDS.toDays(diffMs);
                        if (days == 0) badge = "TODAY";
                        else if (days == 1) badge = "TOMORROW";
                        else badge = days + " DAYS";
                    } catch (Exception ignored) {}
                }

                // Location string
                StringBuilder loc = new StringBuilder();
                if (!venue.isEmpty()) loc.append(venue);
                if (!city.isEmpty()) {
                    if (loc.length() > 0) loc.append(", ");
                    loc.append(city);
                }

                // Date display
                String dateDisplay = startDate;
                try {
                    SimpleDateFormat inFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                    SimpleDateFormat outFmt = new SimpleDateFormat("d MMM yyyy", Locale.getDefault());
                    dateDisplay = outFmt.format(inFmt.parse(startDate));
                } catch (Exception ignored) {}

                String dateLoc = dateDisplay + (loc.length() > 0 ? "  ·  " + loc : "");

                views.setTextViewText(R.id.widget_artist, artist);
                views.setTextViewText(R.id.widget_date_loc, dateLoc);
                views.setTextViewText(R.id.widget_days_badge, badge);

                // Next after that
                if (upcoming.length() > 1) {
                    JSONObject second = upcoming.getJSONObject(1);
                    String a2 = second.optString("artist", second.optString("name", "Event"));
                    String d2 = second.optString("startDate", "");
                    try {
                        SimpleDateFormat inFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                        SimpleDateFormat outFmt = new SimpleDateFormat("d MMM", Locale.getDefault());
                        d2 = outFmt.format(inFmt.parse(d2));
                    } catch (Exception ignored) {}
                    views.setTextViewText(R.id.widget_next, "Next: " + a2 + "  ·  " + d2);
                } else {
                    views.setTextViewText(R.id.widget_next, "");
                }
            }
        } catch (Exception e) {
            views.setTextViewText(R.id.widget_artist, "Error loading events");
            views.setTextViewText(R.id.widget_date_loc, e.getMessage());
            views.setTextViewText(R.id.widget_days_badge, "");
            views.setTextViewText(R.id.widget_next, "");
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
