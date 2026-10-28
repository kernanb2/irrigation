# Backend — PHP + MySQL + Apache

## Server Setup (paradisepond.tech)

### 1. Deploy files
```bash
git clone https://github.com/kernanb2/irrigation.git /var/www/irrigation
```

### 2. Set up database
```bash
mysql -u root -p < /var/www/irrigation/backend/db/schema.sql
```
Then uncomment and run the `CREATE USER` lines at the bottom of schema.sql.

For an existing database, apply migrations in `backend/db/migrations/` in date order, e.g.:
```bash
mysql -u irrigation_user -p irrigation < /var/www/irrigation/backend/db/migrations/2026-10-26_units_d_e.sql
```

### 3. Configure the app
Edit `/var/www/irrigation/backend/config/config.php`:
- Set `DB_PASS` to the MySQL user password
- Set `TIMEZONE` to your local timezone

Then create the per-device API keys (git-ignored):
```bash
cp backend/config/device_keys.example.php backend/config/device_keys.php
openssl rand -hex 32   # run once per device, paste into device_keys.php
```
Each ESP-32 sends its own key. A key only works for the unit it's assigned to.

### 4. Create your login
```bash
php /var/www/irrigation/backend/db/create_user.php admin yourpassword
```

Forgot a password? It can't be looked up (only a hash is stored); set a new one:
```
php backend/db/reset_password.php admin
```

### 5. Configure Apache
```bash
cp /var/www/irrigation/backend/apache/irrigation.conf /etc/apache2/sites-available/
a2ensite irrigation.conf
# Get SSL cert for the subdomain:
certbot --apache -d irrigation.paradisepond.tech
systemctl reload apache2
```

### 6. Set up the cron job
```bash
crontab -e
```
Add:
```
* * * * * php /var/www/irrigation/backend/cron/check_schedules.php >> /var/log/irrigation_cron.log 2>&1
```

## API Endpoints

| Endpoint              | Auth         | Method        | Description                      |
|-----------------------|--------------|---------------|----------------------------------|
| `/api/status.php`     | Session      | GET           | All zone states, moisture, temps |
| `/api/valve.php`      | Session      | POST          | Request a zone valve open/close (the unit applies it on its next check-in) |
| `/api/unit_report.php` | API Key (Units A–C) | POST   | Zone unit check-in every 5 s: valve states, events, sensors; reply = desired valves |
| `/api/filter.php`     | Session      | GET/POST      | Unit E: status (flush cycles + Pond Drain) / change flush settings |
| `/api/drain.php`      | Session      | POST          | Unit E Pond Drain: set target position (0–100%) |
| `/api/filter_report.php` | API Key (Unit E) | POST     | Unit E reports status and valve events, gets cycle settings |
| `/api/schedules.php`  | Session      | GET/POST/PATCH/DELETE | Manage schedules        |
| `/api/events.php`     | Session      | GET           | Valve event history              |
| `/api/settings.php`   | Session      | POST          | Update system settings           |

## Directory Structure

```
backend/
├── apache/irrigation.conf    Apache vhost config
├── config/config.php         Credentials and settings
├── config/device_keys.php    Per-ESP32 API keys (git-ignored; see device_keys.example.php)
├── cron/check_schedules.php  Starts scheduled runs (run every minute); units close valves on their own timers
├── db/
│   ├── schema.sql            Full database schema
│   ├── create_user.php       CLI tool to create login accounts
│   └── reset_password.php    CLI tool to set a new password (prompts, no echo)
├── public/                   Apache document root
│   ├── index.php             Dashboard
│   ├── login.php / logout.php
│   ├── api/                  REST endpoints
│   ├── css/style.css
│   └── js/app.js
└── src/
    ├── Auth.php              Session management
    ├── Database.php          PDO singleton
    ├── FilterFlush.php       Unit E flush-cycle settings and event logging
    ├── PondDrain.php         Unit E Pond Drain target + command counter
    └── ZoneUnit.php          Units A–C: desired valve states, check-ins, events, sensor storage
```
