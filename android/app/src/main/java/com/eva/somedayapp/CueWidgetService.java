package com.eva.somedayapp;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Supplies the rows of the scrollable list widget: every upcoming event, soonest first. */
public class CueWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new EventListFactory(getApplicationContext());
    }

    static class EventListFactory implements RemoteViewsFactory {
        private final Context context;
        private final List<JSONObject> events = new ArrayList<>();

        EventListFactory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {}

        // Called whenever the provider notifies that the data changed
        @Override
        public void onDataSetChanged() {
            events.clear();
            SharedPreferences prefs = context.getSharedPreferences(CueWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            String json = prefs.getString(CueWidgetProvider.EVENTS_KEY, null);
            if (json == null || json.isEmpty()) return;

            try {
                JSONArray all = new JSONArray(json);
                String today = WidgetFormat.todayKey();
                for (int i = 0; i < all.length(); i++) {
                    JSONObject ev = all.getJSONObject(i);
                    String start = ev.optString("startDate", "");
                    String lastDay = ev.optString("endDate", "");
                    if (lastDay.isEmpty()) lastDay = start;
                    if (!lastDay.isEmpty() && lastDay.compareTo(today) >= 0) events.add(ev);
                }
                Collections.sort(events, (a, b) ->
                    a.optString("startDate", "9999-99-99").compareTo(b.optString("startDate", "9999-99-99")));
            } catch (Exception ignored) {
                // Unreadable data shows the empty state
            }
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_list_item);
            if (position < 0 || position >= events.size()) return row;
            JSONObject ev = events.get(position);

            String startDate = ev.optString("startDate", "");
            String badgeDay = "";
            String badgeMonth = "";
            Calendar start = WidgetFormat.parse(startDate);
            if (start != null) {
                badgeDay = String.valueOf(start.get(Calendar.DAY_OF_MONTH));
                badgeMonth = new SimpleDateFormat("MMM", Locale.UK).format(start.getTime());
                Calendar end = WidgetFormat.parse(ev.optString("endDate", ""));
                if (end != null && end.after(start)) badgeDay += "–" + end.get(Calendar.DAY_OF_MONTH);
            }

            StringBuilder where = new StringBuilder(ev.optString("city", ""));
            String venue = ev.optString("venue", "");
            if (!venue.isEmpty()) {
                if (where.length() > 0) where.append(" · ");
                where.append(venue);
            }

            // Date badge in this event's poster colour
            row.setInt(R.id.item_badge_bg, "setColorFilter", WidgetStyle.eventColor(ev));
            row.setInt(R.id.item_badge_bg, "setImageAlpha", 170);
            row.setTextViewText(R.id.item_day, badgeDay);
            row.setTextViewText(R.id.item_month, badgeMonth);
            row.setTextViewText(R.id.item_artist, ev.optString("artist", ev.optString("name", "Event")));
            row.setTextViewText(R.id.item_date, WidgetFormat.formatWhen(ev));
            row.setTextViewText(R.id.item_loc, where.toString());
            row.setViewVisibility(R.id.item_loc, where.length() > 0 ? View.VISIBLE : View.GONE);

            String tags = WidgetFormat.tagLine(ev);
            row.setTextViewText(R.id.item_tag, tags);
            row.setViewVisibility(R.id.item_tag, tags.isEmpty() ? View.GONE : View.VISIBLE);

            // Merged into the provider's pending intent template: opens this event in the app
            Intent fillIn = new Intent();
            fillIn.putExtra("open_event_id", ev.optString("id", ""));
            fillIn.putExtra("open_date", startDate);
            row.setOnClickFillInIntent(R.id.item_card, fillIn);
            return row;
        }

        @Override
        public int getCount() {
            return events.size();
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }

        @Override
        public void onDestroy() {
            events.clear();
        }
    }
}
