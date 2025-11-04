# Deployment Guide - captcha-ark Launchpad

## 📋 Prerequisites

- Ubuntu/Debian server with root access
- Domain name pointing to your server
- Node.js 18+ installed
- Nginx installed
- PM2 for process management
- SSL certificate (Let's Encrypt)

## 🚀 Deployment Steps

### 1. Nginx Configuration

Create/update nginx config at `/etc/nginx/sites-available/launchpad.nearspace.info`:

```nginx
# Backend API server (Node.js)
upstream launchpad_backend {
    server 127.0.0.1:3181;
    keepalive 64;
}

server {
    server_name launchpad.nearspace.info;
    root /var/www/html/nearspace.info/launchpad;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Frontend static files
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "public, max-age=3600";
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://launchpad_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;

        # CORS headers (backup, handled by Express)
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Credentials true always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;

        # Handle preflight
        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://launchpad_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    listen 443 ssl http2;
    listen [::]:443 ssl http2 ipv6only=on;
    ssl_certificate /etc/letsencrypt/live/launchpad.nearspace.info/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/launchpad.nearspace.info/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = launchpad.nearspace.info) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    listen [::]:80;
    server_name launchpad.nearspace.info;
    return 404;
}
```

### 2. Deploy Backend

```bash
# Navigate to project directory
cd /var/www/html/nearspace.info/launchpad

# Create backend directory
mkdir -p backend
cd backend

# Copy backend files
# (Upload server.js, package.json from launchpad-backend/)

# Install dependencies
npm install

# Create .env file
nano .env
```

Add to `.env`:
```bash
PORT=3181
NODE_ENV=production
ALLOWED_ORIGINS=https://launchpad.nearspace.info
SESSION_SECRET=YOUR_RANDOM_SECRET_HERE_CHANGE_THIS
HCAPTCHA_SITE_KEY=your_hcaptcha_site_key
HCAPTCHA_SECRET=your_hcaptcha_secret
```

```bash
# Start with PM2
pm2 start server.js --name launchpad-backend -i 1

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 3. Deploy Frontend

```bash
# Navigate to frontend directory
cd /var/www/html/nearspace.info/launchpad

# Copy index.html from launchpad-frontend/
# Upload index.html to this directory

# Set correct permissions
sudo chown -R www-data:www-data /var/www/html/nearspace.info/launchpad
sudo chmod -R 755 /var/www/html/nearspace.info/launchpad
```

### 4. Enable Nginx Configuration

```bash
# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 5. Get hCaptcha Keys (Optional)

1. Visit [https://www.hcaptcha.com/](https://www.hcaptcha.com/)
2. Sign up for free account
3. Create new site: `launchpad.nearspace.info`
4. Copy Site Key and Secret Key
5. Update `.env` file with real keys
6. Restart backend: `pm2 restart launchpad-backend`

**Note**: If you don't set hCaptcha keys, test keys will be used (always pass verification).

## 🔍 Verification

### Check Backend Status

```bash
# Check if backend is running
pm2 status

# View backend logs
pm2 logs launchpad-backend

# Test API endpoint
curl https://launchpad.nearspace.info/api/session
```

### Check Frontend

Visit `https://launchpad.nearspace.info` in browser:
- Should see launchpad page
- Check browser console for errors
- Session ID should appear in top right

### Test WebSocket

Open browser console on `https://launchpad.nearspace.info`:
```javascript
const ws = new WebSocket('wss://launchpad.nearspace.info/ws?session_id=test123');
ws.onopen = () => console.log('WebSocket connected!');
ws.onerror = (err) => console.error('WebSocket error:', err);
```

## 🐛 Troubleshooting

### CORS Errors

1. Check `ALLOWED_ORIGINS` in backend `.env`
2. View backend logs: `pm2 logs launchpad-backend`
3. Check nginx logs: `sudo tail -f /var/log/nginx/error.log`

### WebSocket Connection Failed

1. Check nginx WebSocket proxy configuration
2. Verify backend is running: `pm2 status`
3. Check firewall: `sudo ufw status`
4. Test WebSocket: `wscat -c wss://launchpad.nearspace.info/ws?session_id=test`

### Session Cookies Not Working

1. Ensure `NODE_ENV=production` in `.env`
2. Check `SESSION_SECRET` is set
3. Verify HTTPS is working
4. Check cookie settings in browser DevTools

### Backend Not Starting

```bash
# Check logs
pm2 logs launchpad-backend --lines 100

# Check if port is in use
sudo lsof -i :3181

# Restart backend
pm2 restart launchpad-backend
```

## 📊 Monitoring

### PM2 Monitoring

```bash
# View status
pm2 status

# View logs
pm2 logs launchpad-backend

# Monitor resources
pm2 monit

# View detailed info
pm2 show launchpad-backend
```

### Nginx Monitoring

```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log

# Test config
sudo nginx -t
```

## 🔄 Updates

### Update Backend

```bash
cd /var/www/html/nearspace.info/launchpad/backend

# Pull new code or upload new files
# ...

# Install dependencies
npm install

# Restart
pm2 restart launchpad-backend
```

### Update Frontend

```bash
cd /var/www/html/nearspace.info/launchpad

# Upload new index.html
# ...

# Clear nginx cache if needed
sudo systemctl reload nginx
```

## 🔒 Security Checklist

- ✅ HTTPS enabled with valid SSL certificate
- ✅ `SESSION_SECRET` is random and secure
- ✅ `NODE_ENV=production` in backend
- ✅ Firewall configured (only 80, 443, 22 open)
- ✅ PM2 running as non-root user
- ✅ File permissions set correctly (755 for dirs, 644 for files)
- ✅ Real hCaptcha keys (not test keys)
- ✅ CORS origins limited to your domain
- ✅ Regular updates: `npm audit fix`

## 📝 Useful Commands

```bash
# Restart everything
pm2 restart all && sudo systemctl reload nginx

# View all logs
pm2 logs --lines 200

# Stop backend
pm2 stop launchpad-backend

# Delete from PM2
pm2 delete launchpad-backend

# Check disk space
df -h

# Check memory
free -h
```
