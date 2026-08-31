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
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;

public class CueCalendarWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String EVENTS_KEY = "shared-events";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_layout);

        // Tap opens app
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.cal_month_title, pendingIntent);
        }

        Calendar cal = Calendar.getInstance();
        int currentMonth = cal.get(Calendar.MONTH);
        int currentYear = cal.get(Calendar.YEAR);
        
        SimpleDateFormat topFmt = new SimpleDateFormat("MMMM yyyy", Locale.getDefault());
        views.setTextViewText(R.id.cal_month_title, topFmt.format(cal.getTime()).toUpperCase(Locale.getDefault()));

        cal.set(Calendar.DAY_OF_MONTH, 1);
        int firstDayOfWeek = cal.get(Calendar.DAY_OF_WEEK) - 1; // 0 for Sunday
        int daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH);

        // Load events
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String eventsJson = prefs.getString(EVENTS_KEY, "[]");
        HashSet<Integer> eventDays = new HashSet<>();

        try {
            JSONArray all = new JSONArray(eventsJson);
            SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
            for (int i = 0; i < all.length(); i++) {
                JSONObject ev = all.getJSONObject(i);
                String start = ev.optString("startDate", "");
                String end = ev.optString("endDate", "");
                
                if (!start.isEmpty()) {
                    Date dStart = fmt.parse(start);
                    Calendar cStart = Calendar.getInstance();
                    cStart.setTime(dStart);
                    
                    Date dEnd = end.isEmpty() ? dStart : fmt.parse(end);
                    Calendar cEnd = Calendar.getInstance();
                    cEnd.setTime(dEnd);
                    
                    while (!cStart.after(cEnd)) {
                        if (cStart.get(Calendar.MONTH) == currentMonth && cStart.get(Calendar.YEAR) == currentYear) {
                            eventDays.add(cStart.get(Calendar.DAY_OF_MONTH));
                        }
                        cStart.add(Calendar.DAY_OF_MONTH, 1);
                    }
                }
            }
        } catch (Exception ignored) {}

        int dayCounter = 1;
        for (int cid = 0; cid < 42; cid++) {
            int viewId = context.getResources().getIdentifier("cal_cell_" + cid, "id", context.getPackageName());
            if (cid < firstDayOfWeek || dayCounter > daysInMonth) {
                views.setTextViewText(viewId, "");
                views.setInt(viewId, "setBackgroundResource", R.drawable.cal_cell_bg_empty);
                views.setTextColor(viewId, 0x00000000); // transparent
            } else {
                views.setTextViewText(viewId, String.valueOf(dayCounter));
                if (eventDays.contains(dayCounter)) {
                    views.setInt(viewId, "setBackgroundResource", R.drawable.cal_cell_bg_event);
                    views.setTextColor(viewId, 0xFFFFFFFF);
                } else {
                    views.setInt(viewId, "setBackgroundResource", R.drawable.cal_cell_bg_empty);
                    views.setTextColor(viewId, 0xFFA1A1AA);
                }
                
                // Allow tapping individual day to open app
                if (launchIntent != null) {
                    views.setOnClickPendingIntent(viewId, PendingIntent.getActivity(
                        context, 0, launchIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    ));
                }
                dayCounter++;
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
