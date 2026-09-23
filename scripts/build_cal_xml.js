const fs = require('fs');
let xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@drawable/widget_background"
    android:padding="12dp">

    <!-- Header: Arrows and Month Title -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:layout_marginBottom="8dp">
        
        <TextView
            android:id="@+id/cal_btn_prev"
            android:layout_width="28dp"
            android:layout_height="28dp"
            android:text="‹"
            android:textColor="#C084FC"
            android:textSize="18sp"
            android:textStyle="bold"
            android:gravity="center" />
            
        <TextView
            android:id="@+id/cal_month_title"
            android:layout_width="0dp"
            android:layout_weight="1"
            android:layout_height="wrap_content"
            android:textColor="#C084FC"
            android:textStyle="bold"
            android:textSize="15sp"
            android:gravity="center" />
            
        <TextView
            android:id="@+id/cal_btn_next"
            android:layout_width="28dp"
            android:layout_height="28dp"
            android:text="›"
            android:textColor="#C084FC"
            android:textSize="18sp"
            android:textStyle="bold"
            android:gravity="center" />
    </LinearLayout>

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:layout_marginBottom="4dp">`;

const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
for (let d of days) {
    xml += `\n        <TextView android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:gravity="center" android:textColor="#F5F5F5" android:textStyle="bold" android:textSize="10sp" android:text="${d}" />`;
}
xml += `\n    </LinearLayout>`;

let cid = 0;
for (let r = 0; r < 6; r++) {
    xml += `\n    <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="horizontal" android:layout_marginTop="2dp" android:baselineAligned="false">`;
    for (let c = 0; c < 7; c++) {
        xml += `\n        <FrameLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:layout_margin="1.5dp">`;

        // The cell container is ALWAYS an empty dark card
        xml += `\n            <LinearLayout android:id="@+id/cal_cell_bg_${cid}" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="top" android:background="@drawable/cal_cell_bg_empty" android:padding="3dp">`;
        xml += `\n                <TextView android:id="@+id/cal_cell_num_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="left" android:textColor="#94949E" android:textSize="9.5sp" android:textStyle="bold" android:layout_marginBottom="2dp" />`;
        
        // Each event name is its own individual rounded pill capsule with background
        xml += `\n                <TextView android:id="@+id/cal_cell_ev1_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center_vertical|left" android:textColor="#ffffff" android:textSize="7sp" android:textStyle="bold" android:maxLines="1" android:paddingLeft="4dp" android:paddingRight="4dp" android:paddingTop="1dp" android:paddingBottom="1dp" android:layout_marginBottom="2dp" android:singleLine="true" android:ellipsize="end" android:visibility="gone" />`;
        xml += `\n                <TextView android:id="@+id/cal_cell_ev2_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center_vertical|left" android:textColor="#ffffff" android:textSize="7sp" android:textStyle="bold" android:maxLines="1" android:paddingLeft="4dp" android:paddingRight="4dp" android:paddingTop="1dp" android:paddingBottom="1dp" android:layout_marginBottom="2dp" android:singleLine="true" android:ellipsize="end" android:visibility="gone" />`;
        xml += `\n                <TextView android:id="@+id/cal_cell_ev3_${cid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center_vertical|left" android:textColor="#ffffff" android:textSize="7sp" android:textStyle="bold" android:maxLines="1" android:paddingLeft="4dp" android:paddingRight="4dp" android:paddingTop="1dp" android:paddingBottom="1dp" android:singleLine="true" android:ellipsize="end" android:visibility="gone" />`;
        xml += `\n            </LinearLayout>`;

        xml += `\n            <FrameLayout android:id="@+id/cal_cell_today_${cid}" android:layout_width="match_parent" android:layout_height="match_parent" android:background="@drawable/bg_cal_today" android:visibility="gone" />`;

        xml += `\n        </FrameLayout>`;
        cid++;
    }
    xml += `\n    </LinearLayout>`;
}
xml += `\n</LinearLayout>\n`;
fs.writeFileSync('android/app/src/main/res/layout/widget_calendar_layout.xml', xml);
console.log('Done rendering widget');


