package com.everm4iva.starl.storage;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class StorageManager extends CordovaPlugin {
    // storage Access Framework "create document" request - lets the user pick where the file
    // lands (Downloads, Drive, wherever) instead of us guessing a path.
    private static final int REQ_SAVE_FILE = 7830;
    private CallbackContext saveCallback = null;
    private String pendingContent = null;

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if ("getDeviceStorage".equals(action)) {
            // storage reads touch the filesystem (a data-dir walk), so keep them off the UI thread.
            cordova.getThreadPool().execute(() -> {
                try {
                    callbackContext.success(readDeviceStorage());
                } catch (Exception e) {
                    callbackContext.error("storage read failed: " + e.getMessage());
                }
            });
            return true;
        }
        if ("saveTextFile".equals(action)) {
            // args: [filename, mimeType, content] - opens the system "save as" picker.
            String filename = args.optString(0, "export.json");
            String mimeType = args.optString(1, "application/json");
            String content = args.optString(2, "");
            saveTextFile(filename, mimeType, content, callbackContext);
            return true;
        }
        return false;
    }

    private void saveTextFile(String filename, String mimeType, String content, CallbackContext cb) {
        if (saveCallback != null) {
            cb.error("A save is already in progress.");
            return;
        }
        saveCallback = cb;
        pendingContent = content == null ? "" : content;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.isEmpty() ? "application/json" : mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename == null || filename.isEmpty() ? "export.json" : filename);
        try {
            cordova.startActivityForResult(this, intent, REQ_SAVE_FILE);
        } catch (Exception e) {
            saveCallback = null;
            pendingContent = null;
            cb.error("Could not open the file picker: " + e.getMessage());
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent intent) {
        if (requestCode != REQ_SAVE_FILE) {
            super.onActivityResult(requestCode, resultCode, intent);
            return;
        }
        CallbackContext cb = saveCallback;
        String body = pendingContent;
        saveCallback = null;
        pendingContent = null;
        if (cb == null) return;
        if (resultCode != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            // user backed out of the picker - report as a plain cancel, not an error toast.
            cb.error("cancelled");
            return;
        }
        Uri uri = intent.getData();
        String text = body == null ? "" : body;
        // the actual write can be a few KB - keep it off the UI thread.
        cordova.getThreadPool().execute(() -> {
            try (OutputStream os = cordova.getActivity().getContentResolver().openOutputStream(uri, "w")) {
                if (os == null) {
                    cb.error("Could not open the chosen file for writing.");
                    return;
                }
                os.write(text.getBytes(StandardCharsets.UTF_8));
                os.flush();
                cb.success(uri.toString());
            } catch (Exception e) {
                cb.error("Write failed: " + e.getMessage());
            }
        });
    }

    private JSONObject readDeviceStorage() throws JSONException {
        StatFs stat = new StatFs(Environment.getDataDirectory().getPath());
        long totalBytes = stat.getTotalBytes();
        long freeBytes = stat.getAvailableBytes();

        long appBytes = 0L;
        Context ctx = this.cordova.getActivity();
        if (ctx != null && ctx.getApplicationInfo() != null && ctx.getApplicationInfo().dataDir != null) {
            appBytes = dirSize(new File(ctx.getApplicationInfo().dataDir));
        }

        JSONObject result = new JSONObject();
        result.put("totalBytes", totalBytes);
        result.put("freeBytes", freeBytes);
        result.put("appBytes", appBytes);
        return result;
    }

    // recursive footprint of the app's private data dir (files, caches, databases).
    private long dirSize(File dir) {
        if (dir == null || !dir.exists()) return 0L;
        if (dir.isFile()) return dir.length();
        long size = 0L;
        File[] children = dir.listFiles();
        if (children == null) return 0L;
        for (File child : children) {
            size += dirSize(child);
        }
        return size;
    }
}
