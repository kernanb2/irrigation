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

### 3. Configure the app
Edit `/var/www/irrigation/backend/config/config.php`:
- Set `DB_PASS` to the MySQL user password
- Set `ESP32_API_KEY` to a long random string (used by ESP-32 units to post sensor data)
- Set `TIMEZONE` to your local timezone

### 4. Create your login
```bash
php /var/www/irrigation/backend/db/create_user.php admin yourpassword
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
| `/api/valve.php`      | Session      | POST          | Open/close a valve               |
| `/api/sensors.php`    | API Key      | POST          | ESP-32 sensor data ingestion     |
| `/api/schedules.php`  | Session      | GET/POST/PATCH/DELETE | Manage schedules        |
| `/api/events.php`     | Session      | GET           | Valve event history              |
| `/api/settings.php`   | Session      | POST          | Update system settings           |

## Directory Structure

```
backend/
├── apache/irrigation.conf    Apache vhost config
├── config/config.php         Credentials and settings (not committed with real values)
├── cron/check_schedules.php  Schedule + auto-close processor (run every minute)
├── db/
│   ├── schema.sql            Full database schema
│   └── create_user.php       CLI tool to create login accounts
├── public/                   Apache document root
│   ├── index.php             Dashboard
│   ├── login.php / logout.php
│   ├── api/                  REST endpoints
│   ├── css/style.css
│   └── js/app.js
└── src/
    ├── Auth.php              Session management
    ├── Database.php          PDO singleton
    └── Unit.php              ESP-32 communication
```
