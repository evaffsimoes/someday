package com.eva.somedayapp;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Vidro look for the widgets: event colours and the poster-coloured glow background.
 * Mirrors CATEGORY_COLORS / eventColor / applyGlow in the web app (js/core.js, js/media.js).
 */
final class WidgetStyle {

    static final int BASE = 0xFF0E0D14;
    private static final float CORNER_DP = 22f;

    private WidgetStyle() {}

    /** Poster colour saved by the app ("r, g, b"), or the category colour when there is none. */
    static int eventColor(JSONObject ev) {
        String rgb = ev.optString("color", "");
        if (!rgb.isEmpty()) {
            String[] parts = rgb.split(",");
            if (parts.length == 3) {
                try {
                    return Color.rgb(Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim()), Integer.parseInt(parts[2].trim()));
                } catch (NumberFormatException ignored) {
                    // Fall back to the category colour
                }
            }
        }
        String category = ev.optString("category", "Concert");
        if ("Festival".equals(category)) return Color.rgb(234, 88, 12);
        if ("Other".equals(category) || "Party".equals(category)) return Color.rgb(13, 148, 136);
        return Color.rgb(124, 58, 237);
    }

    /** Colour of the soonest upcoming event, which lights the widget like the app's glow. */
    static int nextUpColor(JSONArray events) {
        String today = WidgetFormat.todayKey();
        JSONObject next = null;
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev == null) continue;
            String start = ev.optString("startDate", "");
            String end = ev.optString("endDate", "");
            if (start.isEmpty() || (end.isEmpty() ? start : end).compareTo(today) < 0) continue;
            if (next == null || start.compareTo(next.optString("startDate", "")) < 0) next = ev;
        }
        return next == null ? Color.rgb(124, 58, 237) : eventColor(next);
    }

    /** The colour with its hue moved a little, for the second, softer glow (like --glow2). */
    static int neighbourHue(int color) {
        float[] hsv = new float[3];
        Color.colorToHSV(color, hsv);
        hsv[0] = (hsv[0] + 36f) % 360f;
        return Color.HSVToColor(hsv);
    }

    static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    /**
     * Rounded dark background with the glow painted in, sized to the widget so corners stay round.
     * Drawn at reduced resolution: the glow is soft, and RemoteViews bitmaps should stay small.
     */
    static Bitmap glowBackground(Context context, AppWidgetManager manager, int widgetId, int color) {
        Bundle options = manager.getAppWidgetOptions(widgetId);
        int widthDp = Math.max(110, options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) : 250);
        int heightDp = Math.max(110, options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180) : 180);
        float scale = context.getResources().getDisplayMetrics().density * 0.6f;
        int w = Math.round(widthDp * scale);
        int h = Math.round(heightDp * scale);

        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        float radius = CORNER_DP * scale;
        Path clip = new Path();
        clip.addRoundRect(new RectF(0, 0, w, h), radius, radius, Path.Direction.CW);
        canvas.clipPath(clip);
        canvas.drawColor(BASE);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float span = Math.max(w, h);
        paint.setShader(new RadialGradient(w * 0.25f, h * 0.2f, span * 0.75f,
            withAlpha(color, 0xA6), withAlpha(color, 0x00), Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);
        int second = neighbourHue(color);
        paint.setShader(new RadialGradient(w * 0.95f, 0, span * 0.55f,
            withAlpha(second, 0x5C), withAlpha(second, 0x00), Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, w, h, paint);

        // Hairline border, like the app's glass edge
        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(Math.max(1f, scale));
        border.setColor(0x1FFFFFFF);
        canvas.drawPath(clip, border);
        return bitmap;
    }
}
