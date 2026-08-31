const fs = require('fs');

let xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/widget_background"
    android:padding="8dp">

    <!-- Month Title -->
    <TextView
        android:id="@+id/cal_month_title"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:textColor="#C084FC"
        android:textStyle="bold"
        android:textSize="13sp"
        android:gravity="center"
        android:layout_marginBottom="4dp" />

    <!-- Days of Week Header -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:layout_marginBottom="2dp">`;

const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
for (const d of days) {
    xml += `\n        <TextView android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:gravity="center" android:textColor="#A1A1AA" android:textSize="10sp" android:text="${d}" />`;
}
xml += `\n    </LinearLayout>\n\n    <!-- Calendar Grid (42 cells) -->`;

let cid = 0;
for (let r = 0; r < 6; r++) {
    xml += `\n    <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="horizontal" android:layout_marginTop="2dp" android:baselineAligned="false">`;
    for (let c = 0; c < 7; c++) {
        xml += `\n        <FrameLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:padding="1dp">`;
        xml += `\n            <TextView android:id="@+id/cal_cell_${cid}" android:layout_width="match_parent" android:layout_height="match_parent" android:gravity="center" android:textColor="#ffffff" android:textSize="10sp" android:textStyle="bold" android:background="@drawable/cal_cell_bg_empty" />`;
        xml += `\n        </FrameLayout>`;
        cid++;
    }
    xml += `\n    </LinearLayout>`;
}

xml += `\n</LinearLayout>\n`;

fs.writeFileSync('android/app/src/main/res/layout/widget_calendar_layout.xml', xml);
console.log('done');
