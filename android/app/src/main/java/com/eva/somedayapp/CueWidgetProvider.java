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

        // Clear all cells first
        int[] artistIds = { R.id.w_item_0_artist, R.id.w_item_1_artist, R.id.w_item_2_artist };
        int[] locIds    = { R.id.w_item_0_loc,    R.id.w_item_1_loc,    R.id.w_item_2_loc    };
        int[] dayIds    = { R.id.w_item_0_day,    R.id.w_item_1_day,    R.id.w_item_2_day    };
        int[] monthIds  = { R.id.w_item_0_month,  R.id.w_item_1_month,  R.id.w_item_2_month  };
        int[] cardIds   = { R.id.w_card_0,        R.id.w_card_1,        R.id.w_card_2        };

        for (int i = 0; i < 3; i++) {
            views.setTextViewText(artistIds[i], "");
            views.setTextViewText(locIds[i], "");
            views.setTextViewText(dayIds[i], "");
            views.setTextViewText(monthIds[i], "");
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String eventsJson = prefs.getString(EVENTS_KEY, null);

        if (eventsJson == null || eventsJson.isEmpty()) {
            views.setTextViewText(R.id.w_item_0_artist, "cue setup");
            views.setTextViewText(R.id.w_item_0_loc, "Tap here to open & sync");
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        try {
            JSONArray all = new JSONArray(eventsJson);
            String todayStr = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date());

            // Find upcoming events
            JSONArray upcoming = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject ev = all.getJSONObject(i);
                String checkDate = ev.optString("endDate", ev.optString("startDate", ""));
                if (!checkDate.isEmpty() && checkDate.compareTo(todayStr) >= 0) {
                    upcoming.put(ev);
                }
            }

            if (upcoming.length() == 0) {
                views.setTextViewText(R.id.w_item_0_artist, "No upcoming events");
                views.setTextViewText(R.id.w_item_0_loc, "Add one in cue");
            } else {
                SimpleDateFormat inFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                SimpleDateFormat dayFmt = new SimpleDateFormat("d", Locale.getDefault());
                SimpleDateFormat monFmt = new SimpleDateFormat("MMM", Locale.getDefault());

                for (int i = 0; i < 3; i++) {
                    if (i < upcoming.length()) {
                        JSONObject ev = upcoming.getJSONObject(i);
                        String artist = ev.optString("artist", ev.optString("name", "Event"));
                        String venue  = ev.optString("venue", "");
                        String city   = ev.optString("city", "");
                        String startDate = ev.optString("startDate", "");

                        StringBuilder loc = new StringBuilder();
                        if (!venue.isEmpty()) loc.append(venue);
                        if (!city.isEmpty()) { if (loc.length() > 0) loc.append(", "); loc.append(city); }

                        String dayStr2 = "", monStr = "";
                        try {
                            Date d = inFmt.parse(startDate);
                            dayStr2 = dayFmt.format(d);
                            monStr  = monFmt.format(d);
                        } catch (Exception ignored) {}

                        views.setTextViewText(artistIds[i], artist);
                        views.setTextViewText(locIds[i], loc.length() > 0 ? loc.toString() : startDate);
                        views.setTextViewText(dayIds[i], dayStr2);
                        views.setTextViewText(monthIds[i], monStr);
                    }
                }
            }
        } catch (Exception e) {
            views.setTextViewText(R.id.w_item_0_artist, "Error loading");
            views.setTextViewText(R.id.w_item_0_loc, e.getMessage());
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
