// Copy to secrets.h (git-ignored) and fill in. Set SECRET_UNIT_ID to the board
// you're flashing: 1 = Unit A, 2 = Unit B, 3 = Unit C, 4 = Unit D (4 zones + pond
// level). Each key must match that unit's entry ('unit-a' … 'unit-d') in
// backend/config/device_keys.php.
#define SECRET_UNIT_ID       1
#define SECRET_WIFI_SSID     "YOUR_SSID"
#define SECRET_WIFI_PASSWORD "YOUR_PASSWORD"

#if SECRET_UNIT_ID == 1
#define SECRET_API_KEY       "CHANGE_ME"
#elif SECRET_UNIT_ID == 4
#define SECRET_API_KEY       "CHANGE_ME"
#else
#error "No API key in secrets.h for this unit"
#endif
