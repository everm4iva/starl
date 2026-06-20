/**
 * ☆=========================================☆
 * BackgroundManager - pass android's battery optimization settings.
 * Actions:
 * - isIgnoringBatteryOptimizations,
 * - requestIgnoreBatteryOptimizations,
 * - openBatteryOptimizationSettings,
 * - openAppSettings.
 * ☆=========================================☆
 */

package com.everm4iva.starl.background;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaArgs;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONException;

public class BackgroundManager extends CordovaPlugin {
    private static final String ACTION_IS_IGNORING = "isIgnoringBatteryOptimizations";
    private static final String ACTION_REQUEST_IGNORE = "requestIgnoreBatteryOptimizations";
    private static final String ACTION_OPEN_BATTERY_SETTINGS = "openBatteryOptimizationSettings";
    private static final String ACTION_OPEN_APP_SETTINGS = "openAppSettings";

    @Override
    public boolean execute(String action, CordovaArgs args, CallbackContext callbackContext) throws JSONException {
        if (ACTION_IS_IGNORING.equals(action)) {
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, isIgnoringBatteryOptimizations()));
            return true;
        }

        if (ACTION_REQUEST_IGNORE.equals(action)) {
            cordova.getActivity().runOnUiThread(() -> {
                try {
                    requestIgnoreBatteryOptimizations();
                    callbackContext.success();
                } catch (Exception error) {
                    callbackContext.error(error.getMessage());
                }
            });
            return true;
        }

        if (ACTION_OPEN_BATTERY_SETTINGS.equals(action)) {
            cordova.getActivity().runOnUiThread(() -> {
                try {
                    openBatteryOptimizationSettings();
                    callbackContext.success();
                } catch (Exception error) {
                    callbackContext.error(error.getMessage());
                }
            });
            return true;
        }

        if (ACTION_OPEN_APP_SETTINGS.equals(action)) {
            cordova.getActivity().runOnUiThread(() -> {
                try {
                    openAppSettings();
                    callbackContext.success();
                } catch (Exception error) {
                    callbackContext.error(error.getMessage());
                }
            });
            return true;
        }

        return false;
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }

        PowerManager powerManager = (PowerManager) cordova.getActivity().getSystemService(android.content.Context.POWER_SERVICE);
        if (powerManager == null) {
            return false;
        }

        return powerManager.isIgnoringBatteryOptimizations(cordova.getActivity().getPackageName());
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + cordova.getActivity().getPackageName()));
        cordova.getActivity().startActivity(intent);
    }

    private void openBatteryOptimizationSettings() {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        cordova.getActivity().startActivity(intent);
    }

    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + cordova.getActivity().getPackageName()));
        cordova.getActivity().startActivity(intent);
    }
}