const fs = require('fs');
let xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/widget_background"
    android:padding="8dp">

    <!-- Header: Arrows and Month Title -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:layout_marginBottom="4dp">
        
        <TextView
            android:id="@+id/cal_btn_prev"
            android:layout_width="32dp"
            android:layout_height="24dp"
            android:text="◀"
            android:textColor="#C084FC"
            android:textSize="12sp"
            android:gravity="center" />
            
        <TextView
            android:id="@+id/cal_month_title"
            android:layout_width="0dp"
            android:layout_weight="1"
            android:layout_height="wrap_content"
            android:textColor="#C084FC"
            android:textStyle="bold"
            android:textSize="14sp"
            android:gravity="center" />
            
        <TextView
            android:id="@+id/cal_btn_next"
            android:layout_width="32dp"
            android:layout_height="24dp"
            android:text="▶"
            android:textColor="#C084FC"
            android:textSize="12sp"
            android:gravity="center" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal">`;

const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
for (let d of days) {
    xml += `\n        <TextView android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:gravity="center" android:textColor="#71717A" android:textStyle="bold" android:textSize="9sp" android:text="${d}" />`;
}
xml += `\n    </LinearLayout>`;

let cid = 0;
for (let r = 0; r < 6; r++) {
    xml += `\n    <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="horizontal" android:layout_marginTop="2dp" android:baselineAligned="false">`;
    for (let c = 0; c < 7; c++) {
        // FrameLayout so we can stack a border for "today"
        xml += `\n        <FrameLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:layout_margin="1dp">`;

        xml += `\n            <LinearLayout android:id="@+id/cal_cell_bg_${cid}" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center_horizontal" android:background="@drawable/cal_cell_bg_empty" android:padding="1dp">`;
        xml += `\n                <TextView android:id="@+id/cal_cell_num_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center" android:textColor="#ffffff" android:textSize="9sp" android:textStyle="bold" />`;
        xml += `\n                <TextView android:id="@+id/cal_cell_ev1_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="left" android:textColor="#ffffff" android:textSize="7.5sp" android:textStyle="bold" android:maxLines="1" android:layout_marginTop="1dp" android:paddingLeft="2dp" android:paddingRight="1dp" android:singleLine="true" android:ellipsize="end" />`;
        xml += `\n                <TextView android:id="@+id/cal_cell_ev2_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="left" android:textColor="#ffffff" android:textSize="7.5sp" android:textStyle="bold" android:maxLines="1" android:layout_marginTop="1dp" android:paddingLeft="2dp" android:paddingRight="1dp" android:singleLine="true" android:ellipsize="end" />`;
        xml += `\n            </LinearLayout>`;

        // Use FrameLayout instead of pure View to guarantee support in AppWidgets
        xml += `\n            <FrameLayout android:id="@+id/cal_cell_today_${cid}" android:layout_width="match_parent" android:layout_height="match_parent" android:background="@drawable/bg_cal_today" android:visibility="gone" />`;

        xml += `\n        </FrameLayout>`;
        cid++;
    }
    xml += `\n    </LinearLayout>`;
}
xml += `\n</LinearLayout>\n`;
fs.writeFileSync('android/app/src/main/res/layout/widget_calendar_layout.xml', xml);
console.log('Done rendering widget');
