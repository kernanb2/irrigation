<?php
// Friendly names for the WiFi access points the units connect to, from WIFI_AP_NAMES
// in config.php. An access point that isn't listed shows as its BSSID.
class WifiAp {
    public static function name(?string $bssid): ?string {
        if (!$bssid) return null;
        $bssid = strtoupper($bssid);
        return WIFI_AP_NAMES[$bssid] ?? $bssid;
    }
}
