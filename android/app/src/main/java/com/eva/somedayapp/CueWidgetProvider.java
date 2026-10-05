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
import java.util.Calendar;
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

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, android.os.Bundle newOptions) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions);
        updateWidget(context, appWidgetManager, appWidgetId);
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);

        // Calculate max items that fit current widget height on home screen (Default to 3-4, up to 6 when expanded)
        android.os.Bundle options = appWidgetManager.getAppWidgetOptions(appWidgetId);
        int minHeight = 120;
        if (options != null && options.containsKey(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)) {
            minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
        }

        int maxItemsToShow = 4; // Default to 3-4 events for standard sizes
        if (minHeight >= 210) {
            maxItemsToShow = 6; // Half screen or larger
        } else if (minHeight >= 160) {
            maxItemsToShow = 5;
        } else {
            maxItemsToShow = 4;
        }

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
        int MAX_ITEMS = 6;
        int[] artistIds = { R.id.w_item_0_artist, R.id.w_item_1_artist, R.id.w_item_2_artist, R.id.w_item_3_artist, R.id.w_item_4_artist, R.id.w_item_5_artist };
        int[] dateIds   = { R.id.w_item_0_date,   R.id.w_item_1_date,   R.id.w_item_2_date,   R.id.w_item_3_date,   R.id.w_item_4_date,   R.id.w_item_5_date   };
        int[] locIds    = { R.id.w_item_0_loc,    R.id.w_item_1_loc,    R.id.w_item_2_loc,    R.id.w_item_3_loc,    R.id.w_item_4_loc,    R.id.w_item_5_loc    };
        int[] dayIds    = { R.id.w_item_0_day,    R.id.w_item_1_day,    R.id.w_item_2_day,    R.id.w_item_3_day,    R.id.w_item_4_day,    R.id.w_item_5_day    };
        int[] monthIds  = { R.id.w_item_0_month,  R.id.w_item_1_month,  R.id.w_item_2_month,  R.id.w_item_3_month,  R.id.w_item_4_month,  R.id.w_item_5_month  };
        int[] cardIds   = { R.id.w_card_0,        R.id.w_card_1,        R.id.w_card_2,        R.id.w_card_3,        R.id.w_card_4,        R.id.w_card_5        };
        int[] tagIds    = { R.id.w_item_0_tag,    R.id.w_item_1_tag,    R.id.w_item_2_tag,    R.id.w_item_3_tag,    R.id.w_item_4_tag,    R.id.w_item_5_tag    };

        for (int i = 0; i < MAX_ITEMS; i++) {
            views.setTextViewText(artistIds[i], "");
            views.setTextViewText(dateIds[i], "");
            views.setTextViewText(locIds[i], "");
            views.setTextViewText(dayIds[i], "");
            views.setTextViewText(monthIds[i], "");
            views.setTextViewText(tagIds[i], "");
            views.setViewVisibility(tagIds[i], android.view.View.GONE);
            views.setViewVisibility(cardIds[i], android.view.View.GONE);
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String eventsJson = prefs.getString(EVENTS_KEY, null);

        if (eventsJson == null || eventsJson.isEmpty()) {
            views.setViewVisibility(R.id.w_card_0, android.view.View.VISIBLE);
            views.setTextViewText(R.id.w_item_0_artist, "cue setup");
            views.setTextViewText(R.id.w_item_0_loc, "Tap here to open & sync");
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        try {
            JSONArray all = new JSONArray(eventsJson);
            String todayStr = WidgetFormat.todayKey();

            // Filter upcoming events & sort chronologically by startDate
            java.util.List<JSONObject> upcomingList = new java.util.ArrayList<>();
            for (int i = 0; i < all.length(); i++) {
                JSONObject ev = all.getJSONObject(i);
                String checkDate = ev.optString("endDate", ev.optString("startDate", ""));
                if (!checkDate.isEmpty() && checkDate.compareTo(todayStr) >= 0) {
                    upcomingList.add(ev);
                }
            }

            java.util.Collections.sort(upcomingList, (a, b) -> {
                String d1 = a.optString("startDate", "9999-99-99");
                String d2 = b.optString("startDate", "9999-99-99");
                return d1.compareTo(d2);
            });

            if (upcomingList.isEmpty()) {
                views.setViewVisibility(R.id.w_card_0, android.view.View.VISIBLE);
                views.setTextViewText(R.id.w_item_0_artist, "No upcoming events");
                views.setTextViewText(R.id.w_item_0_loc, "Add one in cue");
            } else {
                SimpleDateFormat monFmt = new SimpleDateFormat("MMM", Locale.UK);

                for (int i = 0; i < MAX_ITEMS; i++) {
                    if (i < upcomingList.size() && i < maxItemsToShow) {
                        JSONObject ev = upcomingList.get(i);
                        views.setViewVisibility(cardIds[i], android.view.View.VISIBLE);
                        String artist = ev.optString("artist", ev.optString("name", "Event"));
                        String venue  = ev.optString("venue", "");
                        String city   = ev.optString("city", "");
                        String startDate = ev.optString("startDate", "");
                        String endDate   = ev.optString("endDate", "");

                        StringBuilder loc = new StringBuilder();
                        if (!city.isEmpty()) loc.append(city);
                        if (!venue.isEmpty()) { if (loc.length() > 0) loc.append(" · "); loc.append(venue); }

                        // Date badge: "8" / "OCT", or "17–19" / "OCT" for multi-day events
                        String badgeDay = "", badgeMonth = "";
                        Calendar start = WidgetFormat.parse(startDate);
                        if (start != null) {
                            badgeDay = String.valueOf(start.get(Calendar.DAY_OF_MONTH));
                            badgeMonth = monFmt.format(start.getTime());
                            Calendar end = WidgetFormat.parse(endDate);
                            if (end != null && end.after(start)) {
                                badgeDay += "–" + end.get(Calendar.DAY_OF_MONTH);
                            }
                        }

                        views.setTextViewText(artistIds[i], artist);
                        views.setTextViewText(dateIds[i], WidgetFormat.formatWhen(ev));
                        views.setTextViewText(locIds[i], loc.length() > 0 ? loc.toString() : "");
                        views.setTextViewText(dayIds[i], badgeDay);
                        views.setTextViewText(monthIds[i], badgeMonth);

                        String tags = WidgetFormat.tagLine(ev);
                        views.setTextViewText(tagIds[i], tags);
                        views.setViewVisibility(tagIds[i], tags.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);

                        if (launchIntent != null) {
                            String evId = ev.optString("id", "");
                            Intent itemIntent = new Intent(launchIntent);
                            itemIntent.putExtra("open_event_id", evId);
                            itemIntent.putExtra("open_date", startDate);
                            itemIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                            PendingIntent itemPending = PendingIntent.getActivity(
                                context,
                                appWidgetId * 10 + i + 5000,
                                itemIntent,
                                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            );
                            views.setOnClickPendingIntent(cardIds[i], itemPending);
                        }
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
