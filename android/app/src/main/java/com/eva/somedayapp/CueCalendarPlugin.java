package com.eva.somedayapp;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/** Opens an exported .ics file in the phone's calendar app, which then offers to add the events. */
@CapacitorPlugin(name = "CueCalendar")
public class CueCalendarPlugin extends Plugin {

    @PluginMethod
    public void openIcs(PluginCall call) {
        String uri = call.getString("uri");
        String path = uri == null ? null : Uri.parse(uri).getPath();
        if (path == null) {
            call.reject("Missing file");
            return;
        }

        File file = new File(path);
        Uri content = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(content, "text/calendar");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        // No calendar app handles .ics: let the web side fall back to the share sheet
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No calendar app can open .ics files");
            return;
        }
        try {
            getActivity().startActivity(Intent.createChooser(intent, "Add to calendar"));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No calendar app can open .ics files");
        }
    }
}
