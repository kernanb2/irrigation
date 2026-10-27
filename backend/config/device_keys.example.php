<?php
// Copy to device_keys.php and fill in real keys. Generate each with:
//   openssl rand -hex 32
// Each ESP32 sends its own key as "Authorization: Bearer <key>".
// unit_id ties the key to a row in the units table (5 = Unit E, filter flush).
return [
    'unit-a'       => ['key' => 'CHANGE_ME', 'unit_id' => 1],
    'unit-b'       => ['key' => 'CHANGE_ME', 'unit_id' => 2],
    'unit-c'       => ['key' => 'CHANGE_ME', 'unit_id' => 3],
    'filter-flush' => ['key' => 'CHANGE_ME', 'unit_id' => 5],
];
