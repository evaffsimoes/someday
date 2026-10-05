package com.eva.somedayapp;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * Date and label formatting for the home screen widgets.
 * Mirrors fmtDateRange / fmtEventWhen / relativeDayLabel in js/core.js so widgets read like the app.
 */
final class WidgetFormat {

    // The app UI is English, e.g. "Thu 8 Oct"
    private static final Locale LOCALE = Locale.UK;
    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    private WidgetFormat() {}

    /** Parses "yyyy-MM-dd" to local midnight, or null when missing/invalid. */
    static Calendar parse(String ymd) {
        if (ymd == null || ymd.isEmpty()) return null;
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            in.setLenient(false);
            Calendar cal = Calendar.getInstance();
            cal.setTime(in.parse(ymd));
            return cal;
        } catch (Exception e) {
            return null;
        }
    }

    static Calendar today() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal;
    }

    static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(today().getTime());
    }

    /** "Thu 8 Oct" (or "8 Oct" without weekday); the year is added when it isn't the current one. */
    static String formatDate(Calendar date, boolean weekday) {
        boolean otherYear = date.get(Calendar.YEAR) != today().get(Calendar.YEAR);
        String pattern = (weekday ? "EEE d MMM" : "d MMM") + (otherYear ? " yyyy" : "");
        return new SimpleDateFormat(pattern, LOCALE).format(date.getTime());
    }

    /** "Thu 8 Oct", "17–19 Oct" or "30 Oct – 1 Nov". */
    static String formatRange(String startDate, String endDate) {
        Calendar start = parse(startDate);
        if (start == null) return "";
        Calendar end = parse(endDate);
        if (end == null || !end.after(start)) return formatDate(start, true);

        if (start.get(Calendar.MONTH) == end.get(Calendar.MONTH) && start.get(Calendar.YEAR) == end.get(Calendar.YEAR)) {
            String monthYear = formatDate(end, false).replaceFirst("^\\d+\\s*", "");
            return start.get(Calendar.DAY_OF_MONTH) + "–" + end.get(Calendar.DAY_OF_MONTH) + " " + monthYear;
        }
        return formatDate(start, false) + " – " + formatDate(end, false);
    }

    /** "Thu 8 Oct · 21:00" */
    static String formatWhen(JSONObject event) {
        String when = formatRange(event.optString("startDate", ""), event.optString("endDate", ""));
        String time = event.optString("time", "");
        if (time.isEmpty()) return when;
        return when.isEmpty() ? time : when + " · " + time;
    }

    /** "Today", "Tomorrow", "In 3 days", "In 2 weeks", "Happening now" — empty when far away or past. */
    static String relativeLabel(String startDate, String endDate) {
        Calendar start = parse(startDate);
        if (start == null) return "";
        Calendar end = parse(endDate);
        if (end == null) end = start;
        Calendar today = today();

        if (start.before(today) && !end.before(today)) return "Happening now";
        long days = Math.round((start.getTimeInMillis() - today.getTimeInMillis()) / (double) DAY_MS);
        if (days < 0) return "";
        if (days == 0) return "Today";
        if (days == 1) return "Tomorrow";
        if (days < 14) return "In " + days + " days";
        if (days <= 60) return "In " + Math.round(days / 7.0) + " weeks";
        return "";
    }

    /** Line under an event: how soon it is and whether a ticket is still missing, e.g. "In 3 days · Need ticket". */
    static String tagLine(JSONObject event) {
        StringBuilder tags = new StringBuilder(relativeLabel(event.optString("startDate", ""), event.optString("endDate", "")));
        String status = event.optString("ticketStatus", "");
        String ticket = "need_ticket".equals(status) ? "Need ticket" : "maybe".equals(status) ? "Maybe" : "";
        if (!ticket.isEmpty()) {
            if (tags.length() > 0) tags.append(" · ");
            tags.append(ticket);
        }
        return tags.toString();
    }
}
