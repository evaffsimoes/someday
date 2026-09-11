package com.eva.somedayapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public class CueCalendarWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String EVENTS_KEY = "shared-events";
    private static final String ACTION_PREV = "com.eva.somedayapp.cal.PREV";
    private static final String ACTION_NEXT = "com.eva.somedayapp.cal.NEXT";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_PREV.equals(action) || ACTION_NEXT.equals(action)) {
            int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (widgetId != -1) {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                int offset = prefs.getInt("cal_offset_" + widgetId, 0);
                offset = ACTION_PREV.equals(action) ? offset - 1 : offset + 1;
                prefs.edit().putInt("cal_offset_" + widgetId, offset).apply();

                updateWidget(context, AppWidgetManager.getInstance(context), widgetId);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // Reset offsets for updated widgets
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor edit = prefs.edit();
        for (int id : appWidgetIds) {
            edit.putInt("cal_offset_" + id, 0);
        }
        edit.apply();

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_layout);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int monthOffset = prefs.getInt("cal_offset_" + appWidgetId, 0);

        Calendar cal = Calendar.getInstance();
        int realYear = cal.get(Calendar.YEAR);
        int realMonth = cal.get(Calendar.MONTH);
        int realDay = cal.get(Calendar.DAY_OF_MONTH);

        cal.add(Calendar.MONTH, monthOffset);

        int currentMonth = cal.get(Calendar.MONTH);
        int currentYear = cal.get(Calendar.YEAR);
        
        cal.set(Calendar.DAY_OF_MONTH, 1);
        int firstDayOfWeek = cal.get(Calendar.DAY_OF_WEEK) - 1; 
        int daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH);

        cal.add(Calendar.MONTH, -1);
        int prevDaysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH);
        cal.add(Calendar.MONTH, 1);

        String monthNames[] = {"September", "October", "November", "December", "January", "February", "March", "April", "May", "June", "July", "August"};
        // Use standard month naming
        String fullMonthNames[] = {"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"};
        String titleStr = fullMonthNames[currentMonth] + " " + currentYear;
        
        String eventsJson = prefs.getString(EVENTS_KEY, "[]");
        views.setTextViewText(R.id.cal_month_title, titleStr);

        java.util.HashMap<Integer, java.util.List<JSONObject>> dayEvents = new java.util.HashMap<>();

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
                            int d = cStart.get(Calendar.DAY_OF_MONTH);
                            if (!dayEvents.containsKey(d)) dayEvents.put(d, new java.util.ArrayList<>());
                            dayEvents.get(d).add(ev);
                        }
                        cStart.add(Calendar.DAY_OF_MONTH, 1);
                    }
                }
            }
        } catch (Exception ignored) {}

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tapIntent = null;
        if (launchIntent != null) {
            tapIntent = PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.cal_month_title, tapIntent);
        }

        // Nav Intents
        Intent pIntent = new Intent(context, CueCalendarWidgetProvider.class);
        pIntent.setAction(ACTION_PREV);
        pIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        views.setOnClickPendingIntent(R.id.cal_btn_prev, PendingIntent.getBroadcast(context, appWidgetId + 1000, pIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        Intent nIntent = new Intent(context, CueCalendarWidgetProvider.class);
        nIntent.setAction(ACTION_NEXT);
        nIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        views.setOnClickPendingIntent(R.id.cal_btn_next, PendingIntent.getBroadcast(context, appWidgetId + 2000, nIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));


        int dayCounter = 1;
        int nextMonthCounter = 1;

        for (int cid = 0; cid < 42; cid++) {
            int bgId = context.getResources().getIdentifier("cal_cell_bg_" + cid, "id", context.getPackageName());
            int numId = context.getResources().getIdentifier("cal_cell_num_" + cid, "id", context.getPackageName());
            int ev1Id = context.getResources().getIdentifier("cal_cell_ev1_" + cid, "id", context.getPackageName());
            int ev2Id = context.getResources().getIdentifier("cal_cell_ev2_" + cid, "id", context.getPackageName());
            int ev3Id = context.getResources().getIdentifier("cal_cell_ev3_" + cid, "id", context.getPackageName());
            int todayId = context.getResources().getIdentifier("cal_cell_today_" + cid, "id", context.getPackageName());

            views.setTextViewText(ev1Id, "");
            views.setTextViewText(ev2Id, "");
            views.setTextViewText(ev3Id, "");
            views.setViewVisibility(ev1Id, View.GONE);
            views.setViewVisibility(ev2Id, View.GONE);
            views.setViewVisibility(ev3Id, View.GONE);
            views.setViewVisibility(todayId, View.GONE);
            views.setInt(bgId, "setBackgroundResource", R.drawable.cal_cell_bg_empty);
            if (tapIntent != null) views.setOnClickPendingIntent(bgId, tapIntent);

            if (cid < firstDayOfWeek) {
                // Previous month padding - hide completely
                views.setTextViewText(numId, "");
                views.setInt(bgId, "setBackgroundResource", 0);
            } else if (dayCounter > daysInMonth) {
                // Next month padding - hide completely
                views.setTextViewText(numId, "");
                views.setInt(bgId, "setBackgroundResource", 0);
            } else {
                // Current month day
                views.setTextViewText(numId, String.valueOf(dayCounter));
                
                // Highlight today
                boolean isToday = (currentMonth == realMonth && currentYear == realYear && dayCounter == realDay);
                if (isToday) {
                    views.setViewVisibility(todayId, View.VISIBLE);
                }

                if (dayEvents.containsKey(dayCounter)) {
                    java.util.List<JSONObject> evs = dayEvents.get(dayCounter);

                    if (launchIntent != null) {
                        String firstEvId = evs.get(0).optString("id", "");
                        String firstEvDate = String.format(Locale.getDefault(), "%04d-%02d-%02d", currentYear, currentMonth + 1, dayCounter);
                        Intent cellIntent = new Intent(launchIntent);
                        cellIntent.putExtra("open_event_id", firstEvId);
                        cellIntent.putExtra("open_date", firstEvDate);
                        cellIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        PendingIntent cellPending = PendingIntent.getActivity(
                            context,
                            appWidgetId * 1000 + cid + 10000,
                            cellIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        );
                        views.setOnClickPendingIntent(bgId, cellPending);
                    }
                    
                    for (int eIdx = 0; eIdx < evs.size() && eIdx < 3; eIdx++) {
                        JSONObject ev = evs.get(eIdx);
                        int targetEvId = (eIdx == 0) ? ev1Id : ((eIdx == 1) ? ev2Id : ev3Id);
                        
                        if (eIdx == 2 && evs.size() > 3) {
                            views.setTextViewText(targetEvId, "+" + (evs.size() - 2) + " more");
                            views.setTextColor(targetEvId, 0xFFC084FC);
                            views.setInt(targetEvId, "setBackgroundResource", 0);
                            views.setViewVisibility(targetEvId, View.VISIBLE);
                        } else {
                            String cat = ev.optString("category", "Concert");
                            int bgRes = R.drawable.bg_cat_concert;
                            int textClr = 0xFFFFFFFF;
                            if ("Festival".equals(cat)) {
                                bgRes = R.drawable.bg_cat_festival;
                                textClr = 0xFFFEF08A;
                            } else if ("Other".equals(cat) || "Party".equals(cat)) {
                                bgRes = R.drawable.bg_cat_other;
                                textClr = 0xFF99F6E4;
                            }

                            views.setTextViewText(targetEvId, ev.optString("artist", "Event"));
                            views.setTextColor(targetEvId, textClr);
                            views.setInt(targetEvId, "setBackgroundResource", bgRes);
                            views.setViewVisibility(targetEvId, View.VISIBLE);
                        }
                    }
                    views.setTextColor(numId, 0xFFF5F5F5);
                } else {
                    views.setTextColor(numId, isToday ? 0xFFC084FC : 0xFF94949E);
                }
                
                dayCounter++;
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
